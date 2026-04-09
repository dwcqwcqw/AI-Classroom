import { createLogger } from '@/lib/logger';
const log = createLogger('InteractiveFiles');

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
  // Add file_key column if it doesn't exist (migration from old schema).
  // SQLite's ADD COLUMN has no IF NOT EXISTS — swallow the two expected errors:
  //   - "duplicate column name"   → column already exists
  //   - "can not add column"      → already present (D1 restriction)
  try {
    await db.prepare(`ALTER TABLE ${INTERACTIVE_TABLE} ADD COLUMN file_key TEXT`).run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate column') || msg.includes('can not add')) {
      log.info('[InteractiveFiles] file_key 列已存在，跳过 ALTER');
    } else {
      throw err; // re-throw unrelated errors (e.g. table doesn't exist)
    }
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

  let results: Array<{
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
  }>;
  try {
    const q = await db
      .prepare(
        `SELECT id, file_key, title, title_en, description, description_en, object_key, size_bytes,
                thumbnail_key, sort_order, created_at
         FROM ${INTERACTIVE_TABLE}
         ORDER BY sort_order ASC, created_at ASC`,
      )
      .all();
    results = q.results as typeof results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no such column') && msg.includes('file_key')) {
      log.warn('[InteractiveFiles] list: file_key 列不存在，降级');
      const q = await db
        .prepare(
          `SELECT id, title, title_en, description, description_en, object_key, size_bytes,
                  thumbnail_key, sort_order, created_at
           FROM ${INTERACTIVE_TABLE}
           ORDER BY sort_order ASC, created_at ASC`,
        )
        .all();
      results = q.results as Array<{
        id: string; file_key: null; title: string; title_en: string;
        description: string; description_en: string; object_key: string;
        size_bytes: number; thumbnail_key: string | null; sort_order: number; created_at: number;
      }>;
    } else {
      throw err;
    }
  }

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

export interface InteractiveFileResult {
  html: string;
  meta: InteractiveFileMeta;
  /** 调试诊断信息 */
  _diagnostic: {
    lookupKey: string;
    dbFound: boolean;
    dbRow: { id: string; file_key: string | null | undefined; object_key: string } | null;
    r2ObjectFound: boolean;
    r2ObjectKey: string | null;
    htmlReadSuccess: boolean;
    htmlLength: number;
    exitReason: string;
  };
}

export async function getInteractiveFile(lookupKey: string): Promise<InteractiveFileResult | null> {
  const db = getD1();
  const r2 = getR2();

  log.info(`[InteractiveFiles] lookup key="${lookupKey}" db=${!!db} r2=${!!r2}`);

  if (!db || !r2) {
    log.error('[InteractiveFiles] D1 or R2 not available', { db: !!db, r2: !!r2 });
    return null;
  }

  await ensureInteractiveTables(db);

  type Row = {
    id: string;
    file_key: string | null | undefined;
    object_key: string;
    title: string;
    title_en: string;
    description: string;
    description_en: string;
    size_bytes: number;
    thumbnail_key: string | null;
    sort_order: number;
    created_at: number;
  };

/** Safe SELECT wrapper: catches "no such column: file_key" and falls back to no-file_key query */
async function d1SafeFirst(
  db: NonNullable<ReturnType<typeof getD1>>,
  sqlWithFileKey: string,
  sqlNoFileKey: string,
  bindParams: unknown[],
): Promise<Row | null> {
  try {
    return await db.prepare(sqlWithFileKey).bind(...bindParams).first<Row>() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('no such column') || !msg.includes('file_key')) throw err;
    log.warn('[InteractiveFiles] file_key 列不存在，降级查询');
    return await db.prepare(sqlNoFileKey).bind(...bindParams).first<Row>() ?? null;
  }
}

  const diagnostic: InteractiveFileResult['_diagnostic'] = {
    lookupKey,
    dbFound: false,
    dbRow: null,
    r2ObjectFound: false,
    r2ObjectKey: null,
    htmlReadSuccess: false,
    htmlLength: 0,
    exitReason: 'unknown',
  };

  // ── 路径 1：直接查 D1（id 或 file_key）─────────────────────────────────
  let row: Row | null = await d1SafeFirst(
    db,
    `SELECT id, file_key, object_key, title, title_en, description, description_en,
            size_bytes, thumbnail_key, sort_order, created_at
     FROM ${INTERACTIVE_TABLE} WHERE id = ? OR file_key = ? LIMIT 1`,
    `SELECT id, object_key, title, title_en, description, description_en,
            size_bytes, thumbnail_key, sort_order, created_at
     FROM ${INTERACTIVE_TABLE} WHERE id = ? LIMIT 1`,
    [lookupKey, lookupKey],
  );

  if (row) {
    diagnostic.dbFound = true;
    diagnostic.dbRow = { id: row.id, file_key: row.file_key, object_key: row.object_key };
    log.info(`[InteractiveFiles] D1 hit: id="${row.id}" file_key="${row.file_key ?? ''}" object_key="${row.object_key}"`);
  }

  // ── 路径 2：slug 回退（sort_order 匹配）──────────────────────────────
  const slugSort = CURATED_SLUG_SORT_ORDER[lookupKey];
  if (!row && slugSort !== undefined) {
    log.info(`[InteractiveFiles] slug 回退: sort_order=${slugSort} for "${lookupKey}"`);
    row = await d1SafeFirst(
      db,
      `SELECT id, file_key, object_key, title, title_en, description, description_en,
              size_bytes, thumbnail_key, sort_order, created_at
       FROM ${INTERACTIVE_TABLE} WHERE sort_order = ? ORDER BY created_at ASC LIMIT 1`,
      `SELECT id, object_key, title, title_en, description, description_en,
              size_bytes, thumbnail_key, sort_order, created_at
       FROM ${INTERACTIVE_TABLE} WHERE sort_order = ? ORDER BY created_at ASC LIMIT 1`,
      [slugSort],
    );
    if (row) {
      diagnostic.dbFound = true;
      diagnostic.dbRow = { id: row.id, file_key: null, object_key: row.object_key };
      log.info(`[InteractiveFiles] sort_order 回退命中: id="${row.id}" object_key="${row.object_key}"`);
    }
  }

  // ── 路径 3：UUID 直读 R2 ───────────────────────────────────────────
  if (row) {
    // 已有 D1 行，读对应 object_key
    diagnostic.r2ObjectKey = row.object_key;
    const object = await r2.get(row.object_key);
    if (!object) {
      log.error(`[InteractiveFiles] R2 对象不存在: ${row.object_key}`);
      diagnostic.exitReason = 'r2_object_not_found_by_object_key';
      return null;
    }
    diagnostic.r2ObjectFound = true;
    const html = await readHtmlFromR2Object(object);
    if (!html) {
      log.error(`[InteractiveFiles] R2 对象读取失败（text/arrayBuffer 都失败）: ${row.object_key}`);
      diagnostic.exitReason = 'r2_read_failed';
      return null;
    }
    diagnostic.htmlReadSuccess = true;
    diagnostic.htmlLength = html.length;
    diagnostic.exitReason = 'success_d1_row';
    log.info(`[InteractiveFiles] 成功: html.length=${html.length}`);
    return {
      html,
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
      },
      _diagnostic: diagnostic,
    };
  }

  // 没有 D1 行：检查是否是 UUID 格式
  if (isR2InteractiveUuid(lookupKey)) {
    const objectKey = `interactive/${lookupKey}.html`;
    diagnostic.r2ObjectKey = objectKey;
    log.info(`[InteractiveFiles] UUID 模式直接读 R2: ${objectKey}`);
    const object = await r2.get(objectKey);
    if (!object) {
      log.error(`[InteractiveFiles] UUID 直读 R2 失败，对象不存在: ${objectKey}`);
      diagnostic.exitReason = 'uuid_r2_not_found';
      return null;
    }
    diagnostic.r2ObjectFound = true;
    const html = await readHtmlFromR2Object(object);
    if (!html) {
      log.error(`[InteractiveFiles] UUID 直读 R2 文本解析失败: ${objectKey}`);
      diagnostic.exitReason = 'uuid_r2_read_failed';
      return null;
    }
    diagnostic.htmlReadSuccess = true;
    diagnostic.htmlLength = html.length;
    diagnostic.exitReason = 'success_uuid_r2_direct';
    log.info(`[InteractiveFiles] UUID 直读成功: html.length=${html.length}`);
    return {
      html,
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
      },
      _diagnostic: diagnostic,
    };
  }

  // 完全找不到
  log.error(`[InteractiveFiles] 未找到: lookupKey="${lookupKey}" 既无 D1 行也无 UUID`);
  diagnostic.exitReason = 'not_found';
  return null;
}
