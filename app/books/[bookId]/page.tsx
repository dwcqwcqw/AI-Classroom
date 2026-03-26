import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookCover } from '@/components/books/book-cover';
import { getLibraryBookById } from '@/lib/books/library-server';

export default async function BookDetailPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const book = await getLibraryBookById(bookId);
  if (!book) return notFound();

  return (
    <main className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex items-start gap-6 rounded-2xl border border-border bg-background p-6">
          <BookCover title={book.title} fallback={book.cover} className="w-48 rounded-xl object-cover" />
          <div className="space-y-2">
            <p className="text-xs text-violet-600">{book.category}</p>
            <h1 className="text-3xl font-bold">{book.title}</h1>
            <p className="text-sm text-muted-foreground">作者：{book.author}</p>
            <p className="pt-2 text-sm leading-6 text-muted-foreground">{book.intro}</p>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">在线阅读</h2>
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="mb-4 text-sm text-muted-foreground">点击下方按钮直接打开 PDF 阅读器。</p>
            <Link
              href={`/books/${book.id}/read`}
              className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            >
              打开 PDF
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
