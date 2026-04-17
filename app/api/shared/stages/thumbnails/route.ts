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

    log.info(`[thumbnails] Loading for stageIds: ${stageIds.join(', ')}`);

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

    log.info(`[thumbnails] DB returned ${results?.length ?? 0} rows out of ${stageIds.length} requested`);

    const thumbnails: Record<string, object | null> = {};

    for (const stageId of stageIds) {
      const row = results?.find((r) => r.id === stageId);
      if (!row) {
        log.warn(`[thumbnails] No database row found for stage ${stageId}`);
        thumbnails[stageId] = null;
        continue;
      }

      let scenes: object[] = [];
      try {
        const parsed = JSON.parse(row.scenes_json || '[]');
        // scenes_json 可以是数组或 { scenes: [...] } 两种格式
        scenes = Array.isArray(parsed) ? parsed : (parsed?.scenes ?? []);
        log.info(`[thumbnails] stage ${stageId}: parsed ${scenes.length} scenes, raw: ${row.scenes_json?.slice(0, 100)}`);
      } catch (e) {
        log.error(`[thumbnails] Failed to parse scenes_json for stage ${stageId}:`, e);
        thumbnails[stageId] = null;
        continue;
      }

      // Find first slide-type scene (scenes can be array or { scenes: [...] })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstSlide = (scenes as any[]).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s?.content?.type === 'slide',
      );
      if (!firstSlide) {
        const sceneTypes = (scenes as any[]).map((s: any) => s?.content?.type ?? 'unknown').slice(0, 5);
        log.warn(`[thumbnails] No slide scene found for stage ${stageId} (scenes: ${scenes.length}, types: ${sceneTypes.join(', ')})`);
        thumbnails[stageId] = null;
        continue;
      }

      const canvas = firstSlide.content?.canvas ?? null;
      if (!canvas) {
        log.warn(`[thumbnails] First slide has no canvas for stage ${stageId}`);
      }
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
        log.info(`[thumbnails] stage ${stageId}: found ${imageFileByElementId.size} image files, placeholders: ${placeholders.map((p) => p.src).join(', ')}`);
        for (const el of placeholders) {
          const resolved = imageFileByElementId.get(el.src);
          if (resolved) {
            el.src = resolved;
          } else {
            log.warn(`[thumbnails] No file found for placeholder: ${el.src}`);
            el.src = '';
          }
        }
      } catch {
        // silently skip file resolution failures for thumbnails
      }
    });

    await Promise.all(fileResolvePromises);

    log.info(`[thumbnails] Returning thumbnails for ${Object.keys(thumbnails).length} stages`);
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
