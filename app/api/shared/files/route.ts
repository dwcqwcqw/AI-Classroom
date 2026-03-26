import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { listSharedFiles, putSharedFile } from '@/lib/server/shared-files';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stageId = searchParams.get('stageId') || undefined;
    const files = await listSharedFiles(stageId);
    return apiSuccess({ files });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to list shared files',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const stageId = (form.get('stageId') as string | null) ?? undefined;
    const kind = (form.get('kind') as string | null) ?? undefined;

    if (!(file instanceof File)) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required file upload');
    }

    const data = await file.arrayBuffer();
    const saved = await putSharedFile({
      fileName: file.name || 'unnamed.bin',
      mimeType: file.type || 'application/octet-stream',
      data,
      stageId,
      kind: (kind as 'ppt' | 'image' | 'audio' | 'video' | 'pdf' | 'other' | undefined) ?? undefined,
    });

    return apiSuccess({ file: saved }, 201);
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to upload shared file',
      error instanceof Error ? error.message : String(error),
    );
  }
}
