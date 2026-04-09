import { randomUUID } from 'crypto';
import { getD1 } from '@/lib/server/cloudflare-d1';
import { getR2 } from '@/lib/server/cloudflare-r2';

export interface InteractiveFileMeta {
  id: string;
  fileKey: string;
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
        file_key TEXT UNIQUE,
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
  // Add file_key column if it doesn't exist (migration from old schema)
  try {
    await db
      .prepare(`ALTER TABLE ${INTERACTIVE_TABLE} ADD COLUMN file_key TEXT UNIQUE`)
      .run();
  } catch {
    // column already exists
  }
}

export async function putInteractiveFile(input: {
  fileKey?: string;
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
       (id, file_key, title, title_en, description, description_en, object_key, size_bytes, thumbnail_key, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.fileKey ?? null,
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
    fileKey: r.file_key ?? '',
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

/**
 * Reads bytes from an R2 object regardless of which R2 API shape is returned.
 * Handles: object.arrayBuffer(), object.body.arrayBuffer(), object.body.getReader()
 */
async function readR2ObjectBytes(object: unknown): Promise<ArrayBuffer> {
  const anyObject = object as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    body?: {
      arrayBuffer?: () => Promise<ArrayBuffer>;
      getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
    } | null;
  };

  if (typeof anyObject.arrayBuffer === 'function') {
    return anyObject.arrayBuffer();
  }

  if (anyObject.body && typeof anyObject.body.arrayBuffer === 'function') {
    return anyObject.body.arrayBuffer();
  }

  if (anyObject.body && typeof anyObject.body.getReader === 'function') {
    const reader = anyObject.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // Normalize to Uint8Array — handle ArrayBuffer, typed-array views, and plain buffers
        const buf =
          value instanceof Uint8Array
            ? value
            : typeof (value as unknown as ArrayBuffer).byteLength === 'number'
              ? new Uint8Array(value as unknown as ArrayBuffer)
              : new Uint8Array(
                  (value as unknown as { buffer?: ArrayBuffer }).buffer ??
                    (value as unknown as ArrayBuffer),
                );
        chunks.push(buf);
        total += buf.byteLength;
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer.slice(0);
  }

  throw new Error('R2 object body is not readable');
}

export async function getInteractiveFile(lookupKey: string) {
  const db = getD1();
  const r2 = getR2();
  if (!db || !r2) return null;
  await ensureInteractiveTables(db);

  // Try UUID lookup first, then file_key lookup
  const row = await db
    .prepare(`SELECT * FROM ${INTERACTIVE_TABLE} WHERE id = ? OR file_key = ? LIMIT 1`)
    .bind(lookupKey, lookupKey)
    .first<{
      id: string;
      file_key: string | null;
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

  let html: ArrayBuffer;
  try {
    html = await readR2ObjectBytes(object);
  } catch {
    return null;
  }

  return {
    meta: {
      id: row.id,
      fileKey: row.file_key ?? '',
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
    html,
  };
}
