import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { listSharedStages } from '@/lib/server/shared-data';

export async function GET() {
  try {
    const stages = await listSharedStages();
    return apiSuccess({ stages });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load shared stages',
      error instanceof Error ? error.message : String(error),
    );
  }
}
