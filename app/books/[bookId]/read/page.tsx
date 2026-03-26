import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLibraryBookById } from '@/lib/books/library-server';

export default async function BookReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const book = await getLibraryBookById(bookId);
  if (!book) return notFound();

  const pdfUrl = `/api/books/library/${book.id}/file`;

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-4 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <div className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
          <div>
            <h1 className="text-lg font-bold md:text-xl">{book.title}</h1>
            <p className="text-xs text-muted-foreground md:text-sm">作者：{book.author}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted md:text-sm"
            >
              新窗口打开
            </a>
            <Link href={`/books/${book.id}`} className="text-xs text-violet-600 hover:text-violet-500 md:text-sm">
              返回详情
            </Link>
          </div>
        </div>

        <div className="h-[calc(100dvh-120px)] overflow-hidden rounded-xl border border-border bg-background">
          <iframe src={pdfUrl} title={book.title} className="h-full w-full" />
        </div>
      </div>
    </main>
  );
}
