import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSharedFileById } from '@/lib/server/shared-files';

async function readR2ObjectBytes(object: unknown): Promise<ArrayBuffer> {
  const anyObject = object as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    body?: {
      arrayBuffer?: () => Promise<ArrayBuffer>;
      getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
    } | null;
  };

  if (typeof anyObject.arrayBuffer === 'function') {
    return anyObject.arrayBuffer();
  }

  if (anyObject.body && typeof anyObject.body.arrayBuffer === 'function') {
    return anyObject.body.arrayBuffer();
  }

  if (anyObject.body && typeof anyObject.body.getReader === 'function') {
    const reader = anyObject.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }

  throw new Error('R2 object body is not readable');
}

export async function GET(_: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await context.params;
    const result = await getSharedFileById(fileId);
    if (!result) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'File not found');
    }

    const buf = await readR2ObjectBytes(result.object);
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
