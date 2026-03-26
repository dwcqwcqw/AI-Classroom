import Link from 'next/link';
import { notFound } from 'next/navigation';
import { makeMockCourseCards } from '@/lib/books/course-data';
import { getLibraryBookById } from '@/lib/books/library-server';

export default async function BookCoursesPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const book = await getLibraryBookById(bookId);
  if (!book) return notFound();

  const courses = makeMockCourseCards(book.title, 24);

  return (
    <main className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">《{book.title}》全部课程资源</h1>
          <Link href={`/books/${book.id}`} className="text-sm text-violet-600 hover:text-violet-500">
            返回图书详情
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <div key={course.id} className="rounded-xl border border-border/60 bg-background/70 p-4">
              <p className="truncate text-sm font-medium text-muted-foreground">{course.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">示例课程（暂不可点击）</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
