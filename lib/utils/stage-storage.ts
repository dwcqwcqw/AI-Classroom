/**
 * Stage Storage Manager
 *
 * Manages multiple stage data in IndexedDB
 * Each stage has its own storage key based on stageId
 */

import { Stage, Scene, type SceneRefineSession } from '../types/stage';
import { ChatSession } from '../types/chat';
import type { SceneOutline } from '@/lib/types/generation';
import { db } from './database';
import { deleteChatSessions } from './chat-storage';
import { clearPlaybackState } from './playback-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('StageStorage');

export interface StageStoreData {
  stage: Stage;
  scenes: Scene[];
  currentSceneId: string | null;
  chats: ChatSession[];
  refineSessions?: Record<string, SceneRefineSession>;
  outlines?: SceneOutline[];
  /** Persisted on shared_stages; optional for backward-compatible payloads */
  isStarred?: boolean;
}

export interface StageListItem {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
  isBookmarked?: boolean;
}

function getRefineStorageKey(stageId: string) {
  return `maic:refine-sessions:${stageId}`;
}

function readRefineSessionsFromLocal(stageId: string): Record<string, SceneRefineSession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getRefineStorageKey(stageId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SceneRefineSession> | null;
    return parsed ?? {};
  } catch (error) {
    log.warn(`Failed to read refine sessions from localStorage: ${stageId}`, error);
    return {};
  }
}

function writeRefineSessionsToLocal(
  stageId: string,
  refineSessions?: Record<string, SceneRefineSession>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const hasSessions = !!refineSessions && Object.keys(refineSessions).length > 0;
    if (!hasSessions) {
      window.localStorage.removeItem(getRefineStorageKey(stageId));
      return;
    }
    window.localStorage.setItem(getRefineStorageKey(stageId), JSON.stringify(refineSessions));
  } catch (error) {
    log.warn(`Failed to write refine sessions to localStorage: ${stageId}`, error);
  }
}

/**
 * Save stage data to IndexedDB
 */
export async function saveStageData(stageId: string, data: StageStoreData): Promise<void> {
  writeRefineSessionsToLocal(stageId, data.refineSessions);
  try {
    const res = await fetch(`/api/shared/stages/${encodeURIComponent(stageId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });

    if (!res.ok) throw new Error(`Save shared stage failed: ${res.status}`);
    log.info(`Saved shared stage: ${stageId}`);
  } catch (error) {
    log.error('Failed to save shared stage:', error);
    throw error;
  }
}

/**
 * Load stage data from IndexedDB
 */
export async function loadStageData(stageId: string): Promise<StageStoreData | null> {
  try {
    const res = await fetch(`/api/shared/stages/${encodeURIComponent(stageId)}`);
    if (!res.ok) return null;

    const json = (await res.json()) as {
      success: boolean;
      data?: StageStoreData | { data?: StageStoreData };
    };
    const payload = json.data;
    if (!payload) return null;
    const refineSessions = readRefineSessionsFromLocal(stageId);
    if ('stage' in payload) return { ...(payload as StageStoreData), refineSessions };
    if ('data' in payload) return payload.data ? { ...payload.data, refineSessions } : null;
    return null;
  } catch (error) {
    log.error('Failed to load shared stage:', error);
    return null;
  }
}

/**
 * Delete stage and all related data
 */
export async function deleteStageData(stageId: string): Promise<void> {
  try {
    const res = await fetch(`/api/shared/stages/${encodeURIComponent(stageId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Delete shared stage failed: ${res.status}`);

    // Also clear local playback/chat caches for current browser session
    await deleteChatSessions(stageId);
    await clearPlaybackState(stageId);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(getRefineStorageKey(stageId));
    }

    log.info(`Deleted shared stage: ${stageId}`);
  } catch (error) {
    log.error('Failed to delete shared stage:', error);
    throw error;
  }
}

/**
 * List all stages
 */
export async function listStages(): Promise<StageListItem[]> {
  try {
    const res = await fetch('/api/shared/stages');
    if (!res.ok) return [];

    const json = (await res.json()) as { success: boolean; stages?: StageListItem[] };
    const stages = json.stages ?? [];

    // Load bookmarks from local cache for immediate display
    const localBookmarks = loadBookmarksFromLocal();

    // Merge server data with local bookmark cache
    return stages.map(stage => ({
      ...stage,
      isBookmarked: localBookmarks[stage.id] ?? stage.isBookmarked ?? false,
    }));
  } catch (error) {
    log.error('Failed to list shared stages:', error);
    return [];
  }
}

/**
 * Get first slide scene's canvas data for each stage (for thumbnail preview).
 * Also resolves gen_img_* placeholders from mediaFiles so thumbnails show real images.
 * Returns a map of stageId -> Slide (canvas data with resolved images)
 *
 * Uses the batch thumbnails endpoint (/api/shared/stages/thumbnails) to avoid N+1.
 */
export async function getFirstSlideByStages(
  stageIds: string[],
): Promise<Record<string, import('../types/slides').Slide>> {
  if (stageIds.length === 0) return {};

  try {
    const res = await fetch(
      `/api/shared/stages/thumbnails?stageIds=${stageIds.map((id) => encodeURIComponent(id)).join(',')}`,
    );
    if (!res.ok) throw new Error(`Batch thumbnail API failed: ${res.status}`);

    const json = (await res.json()) as {
      success: boolean;
      thumbnails?: Record<string, import('../types/slides').Slide | null>;
      data?: { thumbnails: Record<string, import('../types/slides').Slide | null> };
    };
    // Support both response formats: { thumbnails } or { data: { thumbnails } }
    const raw = json.thumbnails ?? json.data?.thumbnails ?? {};

    // Filter out nulls and cast to Slide
    const result: Record<string, import('../types/slides').Slide> = {};
    for (const [stageId, slide] of Object.entries(raw)) {
      if (slide && typeof slide === 'object') {
        result[stageId] = slide as import('../types/slides').Slide;
      }
    }
    return result;
  } catch (error) {
    log.error('Failed to load thumbnails:', error);
    return {};
  }
}

/**
 * Rename a stage (updates only the name field in IndexedDB)
 */
export async function renameStage(stageId: string, newName: string): Promise<void> {
  try {
    await db.stages.update(stageId, { name: newName, updatedAt: Date.now() });
    log.info(`Renamed stage ${stageId} to "${newName}"`);
  } catch (error) {
    log.error('Failed to rename stage:', error);
    throw error;
  }
}

/**
 * Check if stage exists
 */
export async function stageExists(stageId: string): Promise<boolean> {
  try {
    const stage = await db.stages.get(stageId);
    return !!stage;
  } catch (error) {
    log.error('Failed to check stage existence:', error);
    return false;
  }
}

// ─── Bookmark (star) ───────────────────────────────────────────────────────────

const BOOKMARK_STORAGE_KEY = 'maic:bookmarks';

function getBookmarksFromLocal(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveBookmarksToLocal(bookmarks: Record<string, boolean>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // ignore
  }
}

export async function toggleBookmark(stageId: string): Promise<boolean> {
  // First, get current state from local cache (for immediate UI update)
  const localBookmarks = getBookmarksFromLocal();
  const wasStarred = localBookmarks[stageId] ?? false;
  const nowStarred = !wasStarred;

  // Update local cache immediately for persistence
  const newLocalBookmarks = { ...localBookmarks, [stageId]: nowStarred };
  saveBookmarksToLocal(newLocalBookmarks);

  try {
    const res = await fetch(`/api/shared/stages/${encodeURIComponent(stageId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleStar' }),
    });

    if (!res.ok) return false;
    const json = (await res.json()) as { success: boolean; isStarred?: boolean };
    const serverStarred = json.isStarred ?? nowStarred;

    // Sync local cache with server state
    if (serverStarred !== nowStarred) {
      const syncedBookmarks = { ...getBookmarksFromLocal(), [stageId]: serverStarred };
      saveBookmarksToLocal(syncedBookmarks);
    }

    return serverStarred;
  } catch (error) {
    log.error('Failed to toggle bookmark:', error);
    // Return the optimistic state (local cache already updated)
    return nowStarred;
  }
}

/**
 * Load bookmark state from local cache (for initial page load).
 * This ensures bookmarks are available immediately without waiting for API.
 */
export function loadBookmarksFromLocal(): Record<string, boolean> {
  return getBookmarksFromLocal();
}

/**
 * Sync bookmarks from server to local cache (call on app initialization).
 */
export async function syncBookmarksFromServer(): Promise<Record<string, boolean>> {
  try {
    const res = await fetch('/api/shared/stages');
    if (!res.ok) return getBookmarksFromLocal();

    const json = (await res.json()) as { success: boolean; stages?: Array<{ id: string; isBookmarked?: boolean }> };
    const stages = json.stages ?? [];

    const serverBookmarks: Record<string, boolean> = {};
    for (const stage of stages) {
      serverBookmarks[stage.id] = stage.isBookmarked ?? false;
    }

    // Merge with local bookmarks (server takes precedence for synced data)
    const localBookmarks = getBookmarksFromLocal();
    const merged = { ...localBookmarks, ...serverBookmarks };
    saveBookmarksToLocal(merged);

    return merged;
  } catch (error) {
    log.warn('Failed to sync bookmarks from server:', error);
    return getBookmarksFromLocal();
  }
}

