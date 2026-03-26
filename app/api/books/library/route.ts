import { apiSuccess, apiError } from '@/lib/server/api-response';
import { getLibraryBooks } from '@/lib/books/library-server';

export async function GET() {
  try {
    const books = await getLibraryBooks();
    return apiSuccess({ books });
  } catch (error) {
    return apiError('BOOK_LIBRARY_LOAD_FAILED', 500, error instanceof Error ? error.message : String(error));
  }
}
