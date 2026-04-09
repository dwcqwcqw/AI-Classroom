import { getCloudflareContext } from '@opennextjs/cloudflare';

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
};

export function getD1(): D1DatabaseLike | null {
  try {
    const cf = getCloudflareContext({ async: false });
    const db = (cf.env as { DB?: D1DatabaseLike }).DB;
    if (db) return db;
  } catch {
    // Not in Cloudflare runtime
  }

  const db = (globalThis as { DB?: D1DatabaseLike }).DB;
  return db ?? null;
}

export async function ensureSharedTables(db: D1DatabaseLike) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS shared_stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        scene_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        stage_json TEXT NOT NULL,
        scenes_json TEXT NOT NULL,
        chats_json TEXT NOT NULL,
        current_scene_id TEXT,
        is_starred INTEGER NOT NULL DEFAULT 0
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS shared_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS shared_files (
        id TEXT PRIMARY KEY,
        stage_id TEXT,
        file_name TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();

  // Migration: Add is_starred column if it doesn't exist (for existing tables)
  try {
    await db.prepare('SELECT is_starred FROM shared_stages LIMIT 1').first();
  } catch {
    try {
      await db.prepare('ALTER TABLE shared_stages ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0').run();
    } catch {
      // Column already exists, ignore
    }
  }
}
