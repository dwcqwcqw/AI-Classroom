import fs from 'fs/promises';
import path from 'path';
import { apiError } from '@/lib/server/api-response';
import { getLibraryBookById } from '@/lib/books/library-server';

const LIBRARY_DIR = path.join(process.cwd(), '图书库');

export async function GET(_: Request, context: { params: Promise<{ bookId: string }> }) {
  try {
    const { bookId } = await context.params;
    const book = await getLibraryBookById(bookId);
    if (!book) return apiError('BOOK_NOT_FOUND', 404, 'Book not found');

    const filePath = path.join(LIBRARY_DIR, book.fileName);
    const buf = await fs.readFile(filePath);

    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(book.fileName)}`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return apiError('BOOK_FILE_LOAD_FAILED', 500, error instanceof Error ? error.message : String(error));
  }
}
