import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSharedFileById } from '@/lib/server/shared-files';

export async function GET(_: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await context.params;
    const result = await getSharedFileById(fileId);
    if (!result) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'File not found');
    }

    const buf = await result.object.body!.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': result.meta.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(result.meta.fileName)}`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to load shared file',
      error instanceof Error ? error.message : String(error),
    );
  }
}
