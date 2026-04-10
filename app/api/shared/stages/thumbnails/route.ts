import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { listSharedFiles } from '@/lib/server/shared-files';
import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';
const log = createLogger('StageThumbs');

/** Batch thumbnail endpoint: accepts ?ids=id1,id2,...&stageIds=stageId1,stageId2,...
 *  Returns thumbnail canvas data + resolved image URLs for every stage in one shot.
 *  Replaces the N+1 loop in getFirstSlideByStages().
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

    type StageRow = {
      data: string;
    };

    const rows = await db
      .prepare(
        `SELECT id, data FROM ${db.stages.name} WHERE id IN (${stageIds.map(() => '?').join(',')})`,
      )
      .bind(...stageIds)
      .all<StageRow>();

    const thumbnails: Record<string, object | null> = {};
    const missingStageIds: string[] = [];

    for (const stageId of stageIds) {
      const row = rows.results?.find((r) => r.id === stageId);
      if (!row) {
        missingStageIds.push(stageId);
        thumbnails[stageId] = null;
        continue;
      }

      let storeData: object | null = null;
      try {
        const parsed = JSON.parse(row.data);
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
