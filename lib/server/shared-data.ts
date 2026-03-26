import { getD1, ensureSharedTables } from '@/lib/server/cloudflare-d1';
import type { StageStoreData, StageListItem } from '@/lib/utils/stage-storage';

interface SharedStageRow {
  id: string;
  name: string;
  description: string | null;
  scene_count: number;
  created_at: number;
  updated_at: number;
  stage_json: string;
  scenes_json: string;
  chats_json: string;
  current_scene_id: string | null;
}

export async function listSharedStages(): Promise<StageListItem[]> {
  const db = getD1();
  if (!db) return [];
  await ensureSharedTables(db);

  const { results } = await db
    .prepare(
      `SELECT id, name, description, scene_count, created_at, updated_at
       FROM shared_stages
       ORDER BY updated_at DESC`,
    )
    .all<Pick<SharedStageRow, 'id' | 'name' | 'description' | 'scene_count' | 'created_at' | 'updated_at'>>();

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    sceneCount: Number(r.scene_count ?? 0),
    createdAt: Number(r.created_at ?? Date.now()),
    updatedAt: Number(r.updated_at ?? Date.now()),
  }));
}

export async function getSharedStage(stageId: string): Promise<StageStoreData | null> {
  const db = getD1();
  if (!db) return null;
  await ensureSharedTables(db);

  const row = await db
    .prepare(
      `SELECT stage_json, scenes_json, chats_json, current_scene_id
       FROM shared_stages
       WHERE id = ?`,
    )
    .bind(stageId)
    .first<Pick<SharedStageRow, 'stage_json' | 'scenes_json' | 'chats_json' | 'current_scene_id'>>();

  if (!row) return null;

  return {
    stage: JSON.parse(row.stage_json),
    scenes: JSON.parse(row.scenes_json),
    chats: JSON.parse(row.chats_json),
    currentSceneId: row.current_scene_id ?? null,
  } as StageStoreData;
}

export async function saveSharedStage(stageId: string, data: StageStoreData): Promise<void> {
  const db = getD1();
  if (!db) return;
  await ensureSharedTables(db);

  const now = Date.now();
  const sceneCount = data.scenes?.length ?? 0;
  const stageName = data.stage?.name || 'Untitled Stage';
  const createdAt = data.stage?.createdAt || now;

  await db
    .prepare(
      `INSERT INTO shared_stages (
        id, name, description, scene_count, created_at, updated_at,
        stage_json, scenes_json, chats_json, current_scene_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        scene_count = excluded.scene_count,
        updated_at = excluded.updated_at,
        stage_json = excluded.stage_json,
        scenes_json = excluded.scenes_json,
        chats_json = excluded.chats_json,
        current_scene_id = excluded.current_scene_id`,
    )
    .bind(
      stageId,
      stageName,
      data.stage?.description ?? null,
      sceneCount,
      createdAt,
      now,
      JSON.stringify(data.stage),
      JSON.stringify(data.scenes ?? []),
      JSON.stringify(data.chats ?? []),
      data.currentSceneId ?? null,
    )
    .run();
}

export async function deleteSharedStage(stageId: string): Promise<void> {
  const db = getD1();
  if (!db) return;
  await ensureSharedTables(db);

  await db.prepare('DELETE FROM shared_stages WHERE id = ?').bind(stageId).run();
}

export async function readSharedSetting<T>(key: string): Promise<T | null> {
  const db = getD1();
  if (!db) return null;
  await ensureSharedTables(db);

  const row = await db
    .prepare('SELECT value_json FROM shared_settings WHERE key = ?')
    .bind(key)
    .first<{ value_json: string }>();

  return row ? (JSON.parse(row.value_json) as T) : null;
}

export async function writeSharedSetting<T>(key: string, value: T): Promise<void> {
  const db = getD1();
  if (!db) return;
  await ensureSharedTables(db);

  await db
    .prepare(
      `INSERT INTO shared_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), Date.now())
    .run();
}
