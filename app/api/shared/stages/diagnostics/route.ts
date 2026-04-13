import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getD1, ensureSharedTables } from '@/lib/server/cloudflare-d1';

/** Diagnostic endpoint: check scenes_json data for all stages */
export async function GET() {
  try {
    const db = getD1();
    if (!db) {
      return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'D1 database not available');
    }

    await ensureSharedTables(db);

    const { results } = await db
      .prepare(
        `SELECT id, name, scene_count, LENGTH(scenes_json) as scenes_len, scenes_json
         FROM shared_stages
         ORDER BY updated_at DESC
         LIMIT 50`,
      )
      .all<{
        id: string;
        name: string;
        scene_count: number;
        scenes_len: number;
        scenes_json: string;
      }>();

    const diagnostics = results.map((r) => {
      let scenesCount = 0;
      let firstSceneType = 'unknown';
      let hasSlide = false;

      try {
        const parsed = JSON.parse(r.scenes_json || '[]');
        const scenes = Array.isArray(parsed) ? parsed : (parsed?.scenes ?? []);
        scenesCount = scenes.length;
        if (scenes.length > 0) {
          firstSceneType = scenes[0]?.content?.type ?? 'unknown';
          hasSlide = scenes.some((s: any) => s?.content?.type === 'slide');
        }
      } catch {
        firstSceneType = 'parse_error';
      }

      return {
        id: r.id,
        name: r.name,
        sceneCount: r.scene_count,
        scenesJsonLength: r.scenes_len,
        parsedScenesCount: scenesCount,
        firstSceneType,
        hasSlide,
      };
    });

    return apiSuccess({ diagnostics });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to run diagnostics',
      error instanceof Error ? error.message : String(error),
    );
  }
}