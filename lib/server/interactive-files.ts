import { randomUUID } from 'crypto';
import { getD1 } from '@/lib/server/cloudflare-d1';
import { getR2 } from '@/lib/server/cloudflare-r2';

export interface InteractiveFileMeta {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  objectKey: string;
  sizeBytes: number;
  thumbnailKey: string | null;
  sortOrder: number;
  createdAt: number;
}

const INTERACTIVE_TABLE = 'interactive_files';

export async function ensureInteractiveTables(db: ReturnType<typeof getD1>) {
  if (!db) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${INTERACTIVE_TABLE} (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_en TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        description_en TEXT NOT NULL DEFAULT '',
        object_key TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        thumbnail_key TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
}

export async function putInteractiveFile(input: {
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  htmlContent: string;
  thumbnailKey?: string | null;
  sortOrder?: number;
}): Promise<{ id: string; objectKey: string; url: string }> {
  const r2 = getR2();
  const db = getD1();
  if (!r2 || !db) {
    throw new Error('R2_OR_D1_NOT_BOUND');
  }
  await ensureInteractiveTables(db);

  const id = randomUUID();
  const objectKey = `interactive/${id}.html`;
  const now = Date.now();
  const data = new TextEncoder().encode(input.htmlContent).buffer as ArrayBuffer;

  await r2.put(objectKey, data, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: {
      title: input.title,
      titleEn: input.titleEn,
    },
  });

  await db
    .prepare(
      `INSERT OR REPLACE INTO ${INTERACTIVE_TABLE}
       (id, title, title_en, description, description_en, object_key, size_bytes, thumbnail_key, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.titleEn,
      input.description,
      input.descriptionEn,
      objectKey,
      data.byteLength,
      input.thumbnailKey ?? null,
      input.sortOrder ?? 0,
      now,
    )
    .run();

  return { id, objectKey, url: `/api/interactive/files/${encodeURIComponent(id)}` };
}

export async function listInteractiveFiles(): Promise<InteractiveFileMeta[]> {
  const db = getD1();
  if (!db) return [];
  await ensureInteractiveTables(db);

  const { results } = await db
    .prepare(
      `SELECT id, title, title_en, description, description_en, object_key, size_bytes,
              thumbnail_key, sort_order, created_at
       FROM ${INTERACTIVE_TABLE}
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all<{
      id: string;
      title: string;
      title_en: string;
      description: string;
      description_en: string;
      object_key: string;
      size_bytes: number;
      thumbnail_key: string | null;
      sort_order: number;
      created_at: number;
    }>();

  return results.map((r) => ({
    id: r.id,
    title: r.title,
    titleEn: r.title_en,
    description: r.description,
    descriptionEn: r.description_en,
    objectKey: r.object_key,
    sizeBytes: Number(r.size_bytes),
    thumbnailKey: r.thumbnail_key,
    sortOrder: Number(r.sort_order),
    createdAt: Number(r.created_at),
  }));
}

export async function getInteractiveFile(id: string) {
  const db = getD1();
  const r2 = getR2();
  if (!db || !r2) return null;
  await ensureInteractiveTables(db);

  const row = await db
    .prepare(`SELECT * FROM ${INTERACTIVE_TABLE} WHERE id = ?`)
    .bind(id)
    .first<{
      id: string;
      title: string;
      title_en: string;
      description: string;
      description_en: string;
      object_key: string;
      size_bytes: number;
      thumbnail_key: string | null;
      sort_order: number;
      created_at: number;
    }>();

  if (!row) return null;

  const object = await r2.get(row.object_key);
  if (!object) return null;

  return {
    meta: {
      id: row.id,
      title: row.title,
      titleEn: row.title_en,
      description: row.description,
      descriptionEn: row.description_en,
      objectKey: row.object_key,
      sizeBytes: Number(row.size_bytes),
      thumbnailKey: row.thumbnail_key,
      sortOrder: Number(row.sort_order),
      createdAt: Number(row.created_at),
    } as InteractiveFileMeta,
    html: await object.arrayBuffer(),
  };
}
