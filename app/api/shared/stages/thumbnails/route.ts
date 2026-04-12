import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { listSharedFiles } from '@/lib/server/shared-files';
import { getD1, ensureSharedTables } from '@/lib/server/cloudflare-d1';
import { createLogger } from '@/lib/logger';

const log = createLogger('StageThumbs');

/** Batch thumbnail endpoint: accepts ?stageIds=id1,id2,...
 *  Returns thumbnail canvas data + resolved image URLs for every stage in one shot.
 *  Uses D1 (Cloudflare) to avoid N+1 round-trips.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stageIds = (searchParams.get('stageIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (stageIds.length === 0) {
      return apiSuccess({ thumbnails: {} });
    }

    const db = getD1();
    if (!db) {
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'D1 database not available');
    }

    await ensureSharedTables(db);

    // Fetch stage_json + scenes_json for all requested stages in one query
    const placeholders = stageIds.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT id, stage_json, scenes_json FROM shared_stages WHERE id IN (${placeholders})`,
      )
      .bind(...stageIds)
      .all<{ id: string; stage_json: string; scenes_json: string }>();

    log.info(`[thumbnails] Query returned ${results?.length ?? 0} rows for ${stageIds.length} requested stageIds`);

    const thumbnails: Record<string, object | null> = {};

    for (const stageId of stageIds) {
      const row = results?.find((r) => r.id === stageId);
      if (!row) {
        log.warn(`[thumbnails] Stage not found in D1: ${stageId}`);
        thumbnails[stageId] = null;
        continue;
      }

      // Fallback: try stage_json if scenes_json is empty/invalid
      let storeData: object | null = null;
      const scenesJsonRaw = row.scenes_json;
      if (scenesJsonRaw && scenesJsonRaw.trim() !== '') {
        try {
          storeData = JSON.parse(scenesJsonRaw);
        } catch {
          log.warn(`[thumbnails] Failed to parse scenes_json for stage ${stageId}, trying stage_json`);
        }
      }

      // If scenes_json failed, try extracting scenes from stage_json
      if (!storeData) {
        try {
          const stageJsonParsed = JSON.parse(row.stage_json);
          // The stage object may have a scenes field directly
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (stageJsonParsed && typeof stageJsonParsed === 'object' && 'scenes' in stageJsonParsed) {
            storeData = { scenes: (stageJsonParsed as any).scenes };
            log.info(`[thumbnails] Recovered scenes from stage_json for stage ${stageId}`);
          }
        } catch {
          log.warn(`[thumbnails] Also failed to parse stage_json for stage ${stageId}`);
        }
      }

      if (!storeData) {
        thumbnails[stageId] = null;
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scenes = (storeData as any)?.scenes ?? [];
      if (scenes.length === 0) {
        log.warn(`[thumbnails] Stage ${stageId} has 0 scenes in scenes_json`);
      }
      const firstSlide = scenes.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s.content?.type === 'slide',
      );
      if (!firstSlide) {
        log.warn(`[thumbnails] Stage ${stageId} has no slide scene`);
        thumbnails[stageId] = null;
        continue;
      }

      const canvas = firstSlide.content?.canvas ?? null;
      thumbnails[stageId] = canvas;
    }

    // Resolve generated media placeholders (gen_img_*/gen_vid_*) in parallel
    const fileResolvePromises = stageIds.map(async (stageId) => {
      const slide = thumbnails[stageId];
      if (!slide || typeof slide !== 'object') return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elements: any[] = (slide as any)?.elements ?? [];
      const placeholders = elements.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (el: any) => el.type === 'image' && typeof el.src === 'string' && /^gen_(img|vid)_[\w-]+$/i.test(el.src),
      );
      if (placeholders.length === 0) return;

      try {
        const files = await listSharedFiles(stageId);
        const imageFileByElementId = new Map<string, string>();
        for (const f of files) {
          if (f.kind !== 'image') continue;
          const base = f.fileName.replace(/\.[^.]+$/, '');
          const normalized = base.endsWith('-poster') ? base.slice(0, -7) : base;
          if (!imageFileByElementId.has(normalized)) {
            imageFileByElementId.set(normalized, `/api/shared/files/${encodeURIComponent(f.id)}`);
          }
        }
        for (const el of placeholders) {
          el.src = imageFileByElementId.get(el.src) ?? '';
        }
      } catch {
        // silently skip file resolution failures for thumbnails
      }
    });

    await Promise.all(fileResolvePromises);

    return apiSuccess({ thumbnails });
  } catch (error) {
    log.error('[shared/stages/thumbnails] Failed:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load thumbnails',
      error instanceof Error ? error.message : String(error),
    );
  }
}
