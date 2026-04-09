import { getInteractiveFile } from '@/lib/server/interactive-files';
import { createLogger } from '@/lib/logger';
const log = createLogger('InteractiveFilesRoute');

export async function GET(
  _: Request,
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

    return new Response(result.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
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
