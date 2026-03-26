import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getLibraryBookById } from '@/lib/books/library-server';

export async function GET(_: Request, context: { params: Promise<{ bookId: string }> }) {
  try {
    const { bookId } = await context.params;
    const book = await getLibraryBookById(bookId);
    if (!book) return apiError('BOOK_NOT_FOUND', 404, 'Book not found');
    return apiSuccess({ book });
  } catch (error) {
    return apiError('BOOK_LOAD_FAILED', 500, error instanceof Error ? error.message : String(error));
  }
}
