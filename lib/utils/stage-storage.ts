/**
 * Stage Storage Manager
 *
 * Manages multiple stage data in IndexedDB
 * Each stage has its own storage key based on stageId
 */

import { Stage, Scene } from '../types/stage';
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
}

export interface StageListItem {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Save stage data to IndexedDB
 */
export async function saveStageData(stageId: string, data: StageStoreData): Promise<void> {
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
    if ('stage' in payload) return payload as StageStoreData;
    if ('data' in payload) return payload.data ?? null;
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
    return json.stages ?? [];
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
