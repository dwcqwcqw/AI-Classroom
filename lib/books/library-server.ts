import 'server-only';

import fs from 'fs/promises';
import path from 'path';
import { parsePDF } from '@/lib/pdf/pdf-providers';

export interface LibraryChapter {
  id: string;
  title: string;
  paragraphs: string[];
}

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  intro: string;
  cover: string;
  category: string;
  recommended: boolean;
  bestseller: boolean;
  fileName: string;
  chapters: LibraryChapter[];
  parsed?: boolean;
}

const LIBRARY_DIR = path.join(process.cwd(), '图书库');
const CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'library-books.json');

let cache: { books: LibraryBook[]; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

const toId = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');

function extractTitleAuthorFromFileName(fileName: string): { title: string; author: string } {
  const base = fileName.replace(/\.pdf$/i, '').trim();

  const separators = ['--', '——', ' - ', '｜', '|', '作者：', '作者:'];
  for (const sep of separators) {
    if (base.includes(sep)) {
      const [left, ...rest] = base.split(sep);
      const right = rest.join(sep).trim();
      const title = left.trim();
      const author = right.replace(/^作者[:：]?\s*/i, '').trim();
      if (title && author) return { title, author };
    }
  }

  const parenMatch = base.match(/(.+?)\s*[\(（]([^\)）]+)[\)）]\s*$/);
  if (parenMatch) {
    const title = parenMatch[1].trim();
    const author = parenMatch[2].replace(/^作者[:：]?\s*/i, '').trim();
    if (title && author) return { title, author };
  }

  return { title: base, author: '未知作者' };
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r/g, '\n')
    .split(/\n{2,}|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

function buildChapters(paragraphs: string[]): LibraryChapter[] {
  const chapterLine = /^第[一二三四五六七八九十百千0-9]+[章节回卷部篇]/;
  const chapters: LibraryChapter[] = [];
  let current: LibraryChapter | null = null;

  for (const p of paragraphs) {
    if (chapterLine.test(p) && p.length <= 40) {
      if (current && current.paragraphs.length > 0) chapters.push(current);
      current = { id: `ch-${chapters.length + 1}`, title: p, paragraphs: [] };
      continue;
    }
    if (!current) {
      current = { id: 'ch-1', title: '第一章', paragraphs: [] };
    }
    current.paragraphs.push(p);
  }

  if (current && current.paragraphs.length > 0) chapters.push(current);

  if (chapters.length <= 1) {
    const chunkSize = 16;
    const fallback: LibraryChapter[] = [];
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
      fallback.push({
        id: `ch-${fallback.length + 1}`,
        title: `第${fallback.length + 1}章`,
        paragraphs: paragraphs.slice(i, i + chunkSize),
      });
    }
    return fallback.length > 0 ? fallback : [{ id: 'ch-1', title: '第一章', paragraphs }];
  }

  return chapters;
}

async function readPersistentCache(): Promise<LibraryBook[] | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw) as { books: LibraryBook[] };
    return Array.isArray(data.books) ? data.books : null;
  } catch {
    return null;
  }
}

async function writePersistentCache(books: LibraryBook[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify({ books }, null, 2), 'utf-8');
  } catch {
    // ignore cache write failures
  }
}

function makeQuickBook(fileName: string, index: number): LibraryBook {
  const { title, author } = extractTitleAuthorFromFileName(fileName);
  return {
    id: toId(fileName),
    title,
    author,
    intro: `${title}（来自本地图书库）`,
    cover: '/logo-black.svg',
    category: '本地图书',
    recommended: index % 2 === 0,
    bestseller: index % 3 !== 1,
    fileName,
    chapters: [],
    parsed: false,
  };
}

async function parseBookFromFile(fileName: string, index: number): Promise<LibraryBook> {
  const quick = makeQuickBook(fileName, index);
  const filePath = path.join(LIBRARY_DIR, fileName);

  try {
    const buf = await fs.readFile(filePath);
    const parsed = await parsePDF({ providerId: 'unpdf' }, buf);
    const paragraphs = splitParagraphs(parsed.text || '');
    const chapters = buildChapters(paragraphs);
    const intro = paragraphs.slice(0, 2).join(' ').slice(0, 220) || quick.intro;
    const cover = parsed.metadata?.pdfImages?.[0]?.src || quick.cover;

    return {
      ...quick,
      intro,
      cover,
      chapters,
      parsed: true,
    };
  } catch {
    return quick;
  }
}

export async function getLibraryBooks(): Promise<LibraryBook[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.books;

  let files: string[] = [];
  try {
    files = (await fs.readdir(LIBRARY_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf'));
  } catch {
    cache = { books: [], at: Date.now() };
    return [];
  }

  const persisted = await readPersistentCache();
  const persistedById = new Map((persisted || []).map((b) => [b.id, b]));
  const books = files.map((file, idx) => {
    const id = toId(file);
    return persistedById.get(id) || makeQuickBook(file, idx);
  });

  cache = { books, at: Date.now() };
  return books;
}

export async function getLibraryBookById(bookId: string): Promise<LibraryBook | undefined> {
  const books = await getLibraryBooks();
  const current = books.find((b) => b.id === bookId);
  if (!current) return undefined;

  if (current.parsed && current.chapters.length > 0) return current;

  const index = books.findIndex((b) => b.id === bookId);
  const parsed = await parseBookFromFile(current.fileName, index < 0 ? 0 : index);

  const nextBooks = books.map((b) => (b.id === bookId ? parsed : b));
  cache = { books: nextBooks, at: Date.now() };
  await writePersistentCache(nextBooks);

  return parsed;
}
