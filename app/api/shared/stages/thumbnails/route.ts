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

    const thumbnails: Record<string, object | null> = {};

    for (const stageId of stageIds) {
      const row = results?.find((r) => r.id === stageId);
      if (!row) {
        thumbnails[stageId] = null;
        continue;
      }

      let storeData: object | null = null;
      try {
        const parsed = JSON.parse(row.scenes_json);
        storeData = parsed;
      } catch {
        thumbnails[stageId] = null;
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scenes = (storeData as any)?.scenes ?? [];
      const firstSlide = scenes.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s.content?.type === 'slide',
      );
      if (!firstSlide) {
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
