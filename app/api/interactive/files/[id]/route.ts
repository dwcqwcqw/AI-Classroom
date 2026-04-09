import { getInteractiveFile } from '@/lib/server/interactive-files';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const file = await getInteractiveFile(decodedId);

  if (!file) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(file.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
