import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getInteractiveFile } from '@/lib/server/interactive-files';

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const decodedId = decodeURIComponent(id);
    const result = await getInteractiveFile(decodedId);

    if (!result) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Interactive file not found');
    }

    return new Response(result.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load interactive file',
      error instanceof Error ? error.message : String(error),
    );
  }
}
