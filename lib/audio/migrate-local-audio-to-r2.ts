'use client';

import { db, type AudioFileRecord } from '@/lib/utils/database';
import { listStages, loadStageData, saveStageData, type StageStoreData } from '@/lib/utils/stage-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioMigration');

export interface AudioMigrationProgress {
  total: number;
  processed: number;
  uploaded: number;
  skipped: number;
  failed: number;
  patchedStages: number;
  currentAudioId?: string;
  currentStageId?: string;
  currentMessage?: string;
}

export interface AudioMigrationResult extends AudioMigrationProgress {
  updatedStageIds: string[];
}

type AudioStageReference = {
  stageId: string;
  data: StageStoreData;
};

function audioMimeFromRecord(record: AudioFileRecord): string {
  if (record.format === 'wav') return 'audio/wav';
  if (record.format === 'ogg') return 'audio/ogg';
  if (record.format === 'aac') return 'audio/aac';
  return 'audio/mpeg';
}

function isSpeechActionWithAudioId(
  action: unknown,
): action is { type: 'speech'; audioId: string; audioUrl?: string } {
  const anyAction = action as Record<string, unknown>;
  return (
    anyAction.type === 'speech' &&
    typeof anyAction.audioId === 'string' &&
    anyAction.audioId.length > 0
  );
}

async function buildAudioStageIndex(): Promise<Map<string, AudioStageReference[]>> {
  const map = new Map<string, AudioStageReference[]>();
  const stages = await listStages();

  for (const stage of stages) {
    const data = await loadStageData(stage.id);
    if (!data) continue;

    for (const scene of data.scenes) {
      for (const action of scene.actions ?? []) {
        if (!isSpeechActionWithAudioId(action)) continue;
        const list = map.get(action.audioId) ?? [];
        list.push({ stageId: stage.id, data });
        map.set(action.audioId, list);
      }
    }
  }

  return map;
}

function patchAudioUrlInStageData(data: StageStoreData, audioId: string, url: string): boolean {
  let changed = false;

  for (const scene of data.scenes) {
    let sceneChanged = false;
    const nextActions = (scene.actions ?? []).map((action) => {
      if (!isSpeechActionWithAudioId(action) || action.audioId !== audioId) {
        return action;
      }
      if (action.audioUrl === url) {
        return action;
      }
      changed = true;
      sceneChanged = true;
      return { ...action, audioUrl: url };
    });

    if (sceneChanged) {
      scene.actions = nextActions;
      scene.updatedAt = Date.now();
    }
  }

  if (changed && data.stage) {
    data.stage.updatedAt = Date.now();
  }

  return changed;
}

async function uploadAudioRecord(
  record: AudioFileRecord,
  stageId?: string,
): Promise<{ url: string; fileId: string } | null> {
  const file = new File([record.blob], `${record.id}.${record.format || 'mp3'}`, {
    type: audioMimeFromRecord(record),
  });
  const form = new FormData();
  form.append('file', file);
  form.append('kind', 'audio');
  if (stageId) {
    form.append('stageId', stageId);
  }

  const res = await fetch('/api/shared/files', {
    method: 'POST',
    body: form,
  });

  const json = (await res.json().catch(() => null)) as
    | { success: true; file: { id: string; url: string } }
    | { success: false; error?: string; details?: string }
    | null;

  if (!res.ok || !json || !json.success) {
    const details =
      json && 'details' in json && json.details
        ? json.details
        : json && 'error' in json && json.error
          ? json.error
          : `HTTP ${res.status}`;
    throw new Error(details);
  }

  return { url: json.file.url, fileId: json.file.id };
}

export async function migrateLocalAudioToR2(
  onProgress?: (progress: AudioMigrationProgress) => void,
): Promise<AudioMigrationResult> {
  const allAudio = await db.audioFiles.toArray();
  const audioStageIndex = await buildAudioStageIndex();
  const stageDataCache = new Map<string, StageStoreData>();
  const touchedStageIds = new Set<string>();

  const pending = allAudio.filter((record) => !record.ossKey);
  const result: AudioMigrationResult = {
    total: pending.length,
    processed: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    patchedStages: 0,
    updatedStageIds: [],
  };

  const emit = (extra?: Partial<AudioMigrationProgress>) => {
    onProgress?.({ ...result, ...extra });
  };

  emit({ currentMessage: pending.length > 0 ? '开始扫描本地语音缓存…' : '没有待迁移的本地语音' });

  for (const record of pending) {
    result.processed += 1;
    const refs = audioStageIndex.get(record.id) ?? [];
    const primaryStageId = refs[0]?.stageId;

    try {
      emit({
        currentAudioId: record.id,
        currentStageId: primaryStageId,
        currentMessage: `正在上传 ${record.id}`,
      });

      const uploaded = await uploadAudioRecord(record, primaryStageId);
      if (!uploaded) {
        result.skipped += 1;
        continue;
      }

      await db.audioFiles.put({
        ...record,
        ossKey: uploaded.url,
      });

      result.uploaded += 1;

      for (const ref of refs) {
        const cached = stageDataCache.get(ref.stageId) ?? structuredClone(ref.data);
        stageDataCache.set(ref.stageId, cached);
        const patched = patchAudioUrlInStageData(cached, record.id, uploaded.url);
        if (patched) {
          touchedStageIds.add(ref.stageId);
        }
      }
    } catch (error) {
      result.failed += 1;
      log.warn(`Failed to migrate audio ${record.id}:`, error);
      emit({
        currentAudioId: record.id,
        currentStageId: primaryStageId,
        currentMessage: `上传失败: ${record.id}`,
      });
    }
  }

  for (const stageId of touchedStageIds) {
    const data = stageDataCache.get(stageId);
    if (!data) continue;
    await saveStageData(stageId, data);
  }

  result.patchedStages = touchedStageIds.size;
  result.updatedStageIds = Array.from(touchedStageIds);
  emit({
    currentMessage:
      result.total === 0
        ? '没有需要迁移的本地语音'
        : `迁移完成：上传 ${result.uploaded} 个，失败 ${result.failed} 个`,
  });

  return result;
}
