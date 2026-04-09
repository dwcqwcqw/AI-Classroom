import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { listInteractiveFiles } from '@/lib/server/interactive-files';

export async function GET() {
  try {
    const files = await listInteractiveFiles();
    return apiSuccess({ files });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to list interactive files',
      error instanceof Error ? error.message : String(error),
    );
  }
}
