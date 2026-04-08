import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { deleteSharedStage, getSharedStage, saveSharedStage, toggleStageStar } from '@/lib/server/shared-data';

export async function GET(_: Request, context: { params: Promise<{ stageId: string }> }) {
  try {
    const { stageId } = await context.params;
    const data = await getSharedStage(stageId);
    if (!data) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Stage not found');
    return apiSuccess({ data });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load stage',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function PUT(request: Request, context: { params: Promise<{ stageId: string }> }) {
  try {
    const { stageId } = await context.params;
    const body = await request.json();
    if (!body?.data) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required field: data');
    }
    await saveSharedStage(stageId, body.data);
    return apiSuccess({ ok: true });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to save stage',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ stageId: string }> }) {
  try {
    const { stageId } = await context.params;
    await deleteSharedStage(stageId);
    return apiSuccess({ ok: true });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to delete stage',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ stageId: string }> }) {
  try {
    const { stageId } = await context.params;
    const body = await request.json();

    if (body.action === 'toggleStar') {
      const isStarred = await toggleStageStar(stageId);
      return apiSuccess({ isStarred });
    }

    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid action');
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to toggle star',
      error instanceof Error ? error.message : String(error),
    );
  }
}
