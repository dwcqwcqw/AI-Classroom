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
      return new Response('Interactive file not found', { status: 404 });
    }

    return new Response(result.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        // Allow embedding in an iframe for cross-origin isolation
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    console.error('[interactive/files] Failed to load file:', error);
    return new Response('Failed to load interactive file', { status: 500 });
  }
}
