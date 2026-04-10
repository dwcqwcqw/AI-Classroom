import { getInteractiveFile } from '@/lib/server/interactive-files';
import { createLogger } from '@/lib/logger';
const log = createLogger('InteractiveFilesRoute');

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const decodedId = decodeURIComponent(id);
    log.info(`[interactive/files] GET id="${decodedId}"`);

    const result = await getInteractiveFile(decodedId);

    if (!result) {
      log.error(`[interactive/files] 文件未找到: "${decodedId}"`);
      return new Response(
        JSON.stringify({ error: 'Interactive file not found', key: decodedId }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // ETag based on content hash for browser-side cache invalidation
    let etag: string | null = null;
    const htmlLen = result.html.length;
    if (htmlLen > 0) {
      // Simple integer ETag: sequential ID means sequential content for same file
      etag = `W/"${result.meta.id.slice(0, 8)}-s${htmlLen}"`;
    }

    const headers: HeadersInit = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Frame-Options': 'SAMEORIGIN',
    };
    if (etag) headers['ETag'] = etag;

    // Handle conditional requests (If-None-Match)
    const ifNoneMatch = request.headers?.get('If-None-Match');
    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return new Response(null, { status: 304 });
    }

    return new Response(result.html, { status: 200, headers });
  } catch (error) {
    log.error('[interactive/files] 异常:', error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    return new Response(
      JSON.stringify({
        error: 'Failed to load interactive file',
        detail: message,
        stack: stack,
        key: '',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
