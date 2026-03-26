import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { migrateLegacyClassroomsToShared } from '@/lib/server/classroom-migration';

export async function POST() {
  try {
    const result = await migrateLegacyClassroomsToShared();
    return apiSuccess({ result });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to migrate legacy classrooms',
      error instanceof Error ? error.message : String(error),
    );
  }
}
