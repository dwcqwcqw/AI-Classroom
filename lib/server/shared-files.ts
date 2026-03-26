import { randomUUID } from 'crypto';
import { getD1, ensureSharedTables } from '@/lib/server/cloudflare-d1';
import { getR2 } from '@/lib/server/cloudflare-r2';

export type SharedFileKind = 'ppt' | 'image' | 'audio' | 'video' | 'pdf' | 'other';

export interface SharedFileMeta {
  id: string;
  stageId: string | null;
  fileName: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  kind: SharedFileKind;
  createdAt: number;
}

function normalizeKind(mimeType: string): SharedFileKind {
  if (mimeType.includes('presentation') || mimeType.includes('ppt')) return 'ppt';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('pdf')) return 'pdf';
  return 'other';
}

export async function putSharedFile(input: {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  stageId?: string;
  kind?: SharedFileKind;
}) {
  const r2 = getR2();
  const db = getD1();
  if (!r2 || !db) {
    throw new Error('R2_OR_D1_NOT_BOUND');
  }
  await ensureSharedTables(db);

  const id = randomUUID();
  const ext = input.fileName.includes('.') ? input.fileName.split('.').pop() : undefined;
  const objectKey = `shared/${input.stageId || 'global'}/${id}${ext ? `.${ext}` : ''}`;
  const now = Date.now();
  const sizeBytes = input.data.byteLength;
  const kind = input.kind ?? normalizeKind(input.mimeType);

  await r2.put(objectKey, input.data, {
    httpMetadata: { contentType: input.mimeType },
    customMetadata: {
      originalName: input.fileName,
      stageId: input.stageId || '',
      kind,
    },
  });

  await db
    .prepare(
      `INSERT INTO shared_files (id, stage_id, file_name, object_key, mime_type, size_bytes, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.stageId ?? null, input.fileName, objectKey, input.mimeType, sizeBytes, kind, now)
    .run();

  return {
    id,
    objectKey,
    sizeBytes,
    kind,
    url: `/api/shared/files/${encodeURIComponent(id)}`,
  };
}

export async function listSharedFiles(stageId?: string): Promise<SharedFileMeta[]> {
  const db = getD1();
  if (!db) return [];
  await ensureSharedTables(db);

  if (stageId) {
    const { results } = await db
      .prepare(
        `SELECT id, stage_id, file_name, object_key, mime_type, size_bytes, kind, created_at
         FROM shared_files
         WHERE stage_id = ?
         ORDER BY created_at DESC`,
      )
      .bind(stageId)
      .all<{
        id: string;
        stage_id: string | null;
        file_name: string;
        object_key: string;
        mime_type: string;
        size_bytes: number;
        kind: SharedFileKind;
        created_at: number;
      }>();

    return results.map((r) => ({
      id: r.id,
      stageId: r.stage_id,
      fileName: r.file_name,
      objectKey: r.object_key,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      kind: r.kind,
      createdAt: Number(r.created_at),
    }));
  }

  const { results } = await db
    .prepare(
      `SELECT id, stage_id, file_name, object_key, mime_type, size_bytes, kind, created_at
       FROM shared_files
       ORDER BY created_at DESC`,
    )
    .all<{
      id: string;
      stage_id: string | null;
      file_name: string;
      object_key: string;
      mime_type: string;
      size_bytes: number;
      kind: SharedFileKind;
      created_at: number;
    }>();

  return results.map((r) => ({
    id: r.id,
    stageId: r.stage_id,
    fileName: r.file_name,
    objectKey: r.object_key,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    kind: r.kind,
    createdAt: Number(r.created_at),
  }));
}

export async function getSharedFileById(fileId: string) {
  const db = getD1();
  const r2 = getR2();
  if (!db || !r2) return null;
  await ensureSharedTables(db);

  const row = await db
    .prepare(
      `SELECT id, stage_id, file_name, object_key, mime_type, size_bytes, kind, created_at
       FROM shared_files
       WHERE id = ?`,
    )
    .bind(fileId)
    .first<{
      id: string;
      stage_id: string | null;
      file_name: string;
      object_key: string;
      mime_type: string;
      size_bytes: number;
      kind: SharedFileKind;
      created_at: number;
    }>();

  if (!row) return null;

  const object = await r2.get(row.object_key);
  if (!object?.body) return null;

  return {
    meta: {
      id: row.id,
      stageId: row.stage_id,
      fileName: row.file_name,
      objectKey: row.object_key,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      kind: row.kind,
      createdAt: Number(row.created_at),
    } as SharedFileMeta,
    object,
  };
}
