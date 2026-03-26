import Link from 'next/link';
import { getLibraryBooks } from '@/lib/books/library-server';
import { BookCover } from '@/components/books/book-cover';

export default async function RecommendedBooksPage() {
  const books = await getLibraryBooks();

  return (
    <main className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">图书推荐</h1>
          <Link href="/" className="text-sm text-violet-600 hover:text-violet-500">
            返回首页
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {books.map((book) => (
            <Link
              key={book.id}
              href={`/books/${book.id}`}
              className="rounded-xl border border-border bg-background p-3 hover:border-violet-400/60"
            >
              <BookCover title={book.title} fallback={book.cover} className="aspect-[3/4] w-full rounded-md object-cover" />
              <p className="mt-2 truncate text-sm font-semibold">{book.title}</p>
              <p className="text-xs text-muted-foreground">{book.author}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{book.intro}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
