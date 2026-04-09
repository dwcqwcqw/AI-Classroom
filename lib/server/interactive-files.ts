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

/**
 * Curated demo interactives: homepage and `/interactive` use stable slugs, while R2 stores
 * `interactive/{uuid}.html`. Legacy migrations omitted `file_key`, so slug lookup failed.
 * sort_order matches `workers/migrate-interactive` / `scripts/migrate-interactive.ts`.
 */
const CURATED_SLUG_SORT_ORDER: Record<string, number> = {
  satellite: 1,
  'typhoon-structure': 2,
  'pressure-wind': 3,
  'typhoon-config': 4,
  'lightning-hail': 5,
  coriolis: 6,
};

function isR2InteractiveUuid(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.trim());
}

async function readHtmlFromR2Object(object: unknown): Promise<string | null> {
  try {
    const o = object as {
      body: { text?: () => Promise<string> } | null;
      text?: () => Promise<string>;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };
    if (o.body && typeof o.body.text === 'function') {
      return await o.body.text();
    }
    if (typeof o.text === 'function') {
      return await o.text();
    }
    if (typeof o.arrayBuffer === 'function') {
      const buf = await o.arrayBuffer();
      return new TextDecoder('utf-8').decode(buf);
    }
    return null;
  } catch {
    return null;
  }
}

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
      `SELECT id, file_key, title, title_en, description, description_en, object_key, size_bytes,
              thumbnail_key, sort_order, created_at
       FROM ${INTERACTIVE_TABLE}
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all<{
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

export async function getInteractiveFile(lookupKey: string) {
  const db = getD1();
  const r2 = getR2();
  if (!db || !r2) return null;
  await ensureInteractiveTables(db);

  type Row = {
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
  };

  // id, then stable slug (file_key)
  let row = await db
    .prepare(`SELECT * FROM ${INTERACTIVE_TABLE} WHERE id = ? OR file_key = ? LIMIT 1`)
    .bind(lookupKey, lookupKey)
    .first<Row>();

  // Legacy rows: slug was never written to file_key; match curated sort_order from migration order
  const slugSort = CURATED_SLUG_SORT_ORDER[lookupKey];
  if (!row && slugSort !== undefined) {
    row = await db
      .prepare(
        `SELECT * FROM ${INTERACTIVE_TABLE} WHERE sort_order = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .bind(slugSort)
      .first<Row>();
  }

  if (row) {
    const object = await r2.get(row.object_key);
    if (!object) return null;
    const html = await readHtmlFromR2Object(object);
    if (!html) return null;
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

  // R2-only or D1 row missing: object key is always interactive/{uuid}.html
  if (isR2InteractiveUuid(lookupKey)) {
    const objectKey = `interactive/${lookupKey}.html`;
    const object = await r2.get(objectKey);
    if (!object) return null;
    const html = await readHtmlFromR2Object(object);
    if (!html) return null;
    return {
      meta: {
        id: lookupKey,
        fileKey: '',
        title: 'Interactive',
        titleEn: 'Interactive',
        description: '',
        descriptionEn: '',
        objectKey,
        sizeBytes: 0,
        thumbnailKey: null,
        sortOrder: 0,
        createdAt: 0,
      } as InteractiveFileMeta,
      html,
    };
  }

  return null;
}
