/**
 * Stage Storage Manager
 *
 * Manages multiple stage data in IndexedDB
 * Each stage has its own storage key based on stageId
 */

import { Stage, Scene, type SceneRefineSession } from '../types/stage';
import { ChatSession } from '../types/chat';
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
    const starredIds = getStarredIds();
    const starredSet = new Set(starredIds);
    return stages.map((s) => ({ ...s, isBookmarked: starredSet.has(s.id) }));
  } catch (error) {
    log.error('Failed to list shared stages:', error);
    return [];
  }
}

/**
 * Get first slide scene's canvas data for each stage (for thumbnail preview).
 * Also resolves gen_img_* placeholders from mediaFiles so thumbnails show real images.
 * Returns a map of stageId -> Slide (canvas data with resolved images)
 */
export async function getFirstSlideByStages(
  stageIds: string[],
): Promise<Record<string, import('../types/slides').Slide>> {
  const result: Record<string, import('../types/slides').Slide> = {};
  try {
    await Promise.all(
      stageIds.map(async (stageId) => {
        const res = await fetch(`/api/shared/stages/${encodeURIComponent(stageId)}`);
        if (!res.ok) return;

        const json = (await res.json()) as {
          success: boolean;
          data?: StageStoreData | { data?: StageStoreData };
        };
        const payload = json.data;
        if (!payload) return;

        const storeData =
          'stage' in payload ? (payload as StageStoreData) : ((payload.data ?? null) as StageStoreData | null);
        if (!storeData) return;

        const firstSlide = storeData.scenes.find((s) => s.content?.type === 'slide');
        if (!firstSlide || firstSlide.content.type !== 'slide') return;

        const slide = structuredClone(firstSlide.content.canvas);

        // Resolve generated media placeholders (gen_img_*/gen_vid_*) from shared files API.
        // On homepage we cannot rely on local media store, so map by uploaded filename prefix.
        const placeholders = slide.elements.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (el: any) => el.type === 'image' && typeof el.src === 'string' && /^gen_(img|vid)_[\w-]+$/i.test(el.src),
        ) as Array<{ src: string }>;

        if (placeholders.length > 0) {
          const filesRes = await fetch(`/api/shared/files?stageId=${encodeURIComponent(stageId)}`);
          if (filesRes.ok) {
            const filesJson = (await filesRes.json()) as {
              success: boolean;
              files?: Array<{ id: string; fileName: string; kind: string }>;
            };
            const files = filesJson.files ?? [];

            const imageFileByElementId = new Map<string, string>();
            for (const f of files) {
              if (f.kind !== 'image') continue;
              // Uploaded names are like: gen_img_xxx.png or gen_vid_xxx-poster.png
              const base = f.fileName.replace(/\.[^.]+$/, '');
              const normalized = base.endsWith('-poster') ? base.slice(0, -7) : base;
              if (!imageFileByElementId.has(normalized)) {
                imageFileByElementId.set(normalized, `/api/shared/files/${encodeURIComponent(f.id)}`);
              }
            }

            for (const el of placeholders) {
              el.src = imageFileByElementId.get(el.src) ?? '';
            }
          }
        }

        result[stageId] = slide;
      }),
    );
  } catch (error) {
    log.error('Failed to load thumbnails:', error);
  }
  return result;
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

const BOOKMARK_STORAGE_KEY = 'maic:starredClassrooms';

export function getStarredIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BOOKMARK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isStarred(stageId: string): boolean {
  return getStarredIds().includes(stageId);
}

export function toggleBookmark(stageId: string): boolean {
  const ids = new Set(getStarredIds());
  const nowStarred = ids.has(stageId);
  if (nowStarred) {
    ids.delete(stageId);
  } else {
    ids.add(stageId);
  }
  try {
    localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
  return !nowStarred;
}

