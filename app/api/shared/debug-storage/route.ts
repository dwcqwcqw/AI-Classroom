import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { getD1, ensureSharedTables } from '@/lib/server/cloudflare-d1';

export async function GET() {
  try {
    const db = getD1();
    if (!db) {
      return apiSuccess({
        dbBound: false,
        sharedStagesCount: 0,
        sharedFilesCount: 0,
        latestStageIds: [],
      });
    }

    await ensureSharedTables(db);

    const stageCountRow = await db
      .prepare('SELECT COUNT(*) as count FROM shared_stages')
      .first<{ count: number }>();
    const fileCountRow = await db
      .prepare('SELECT COUNT(*) as count FROM shared_files')
      .first<{ count: number }>();

    const latest = await db
      .prepare('SELECT id, updated_at FROM shared_stages ORDER BY updated_at DESC LIMIT 5')
      .all<{ id: string; updated_at: number }>();

    return apiSuccess({
      dbBound: true,
      sharedStagesCount: Number(stageCountRow?.count ?? 0),
      sharedFilesCount: Number(fileCountRow?.count ?? 0),
      latestStageIds: latest.results.map((r) => ({ id: r.id, updatedAt: Number(r.updated_at) })),
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to inspect shared storage',
      error instanceof Error ? error.message : String(error),
    );
  }
}
