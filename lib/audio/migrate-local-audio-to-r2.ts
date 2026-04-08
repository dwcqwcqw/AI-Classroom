'use client';

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

async function uploadAudioFromUrl(
  audioId: string,
  audioUrl: string,
  stageId?: string,
): Promise<{ url: string; fileId: string } | null> {
  // Fetch audio from existing URL
  const res = await fetch(audioUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch audio: ${res.status}`);
  }
  const blob = await res.blob();
  const file = new File([blob], `${audioId}.mp3`, { type: blob.type || 'audio/mpeg' });

  const form = new FormData();
  form.append('file', file);
  form.append('kind', 'audio');
  if (stageId) {
    form.append('stageId', stageId);
  }

  const uploadRes = await fetch('/api/shared/files', {
    method: 'POST',
    body: form,
  });

  const json = (await uploadRes.json().catch(() => null)) as
    | { success: true; file: { id: string; url: string } }
    | { success: false; error?: string; details?: string }
    | null;

  if (!uploadRes.ok || !json || !json.success) {
    const details =
      json && 'details' in json && json.details
        ? json.details
        : json && 'error' in json && json.error
          ? json.error
          : `HTTP ${uploadRes.status}`;
    throw new Error(details);
  }

  return { url: json.file.url, fileId: json.file.id };
}

export async function migrateLocalAudioToR2(
  onProgress?: (progress: AudioMigrationProgress) => void,
): Promise<AudioMigrationResult> {
  const audioStageIndex = await buildAudioStageIndex();
  const stageDataCache = new Map<string, StageStoreData>();
  const touchedStageIds = new Set<string>();

  // Collect all audio URLs that need migration (have audioId but no audioUrl or need re-upload)
  const pendingActions: Array<{ audioId: string; audioUrl?: string; stageId: string; data: StageStoreData }> = [];
  for (const [audioId, refs] of audioStageIndex.entries()) {
    for (const ref of refs) {
      for (const scene of ref.data.scenes) {
        for (const action of scene.actions ?? []) {
          if (!isSpeechActionWithAudioId(action)) continue;
          if (action.audioId === audioId) {
            pendingActions.push({
              audioId,
              audioUrl: action.audioUrl,
              stageId: ref.stageId,
              data: ref.data,
            });
          }
        }
      }
    }
  }

  const uniqueAudios = new Map<string, { audioId: string; audioUrl?: string; stageId: string }>();
  for (const item of pendingActions) {
    if (!uniqueAudios.has(item.audioId)) {
      uniqueAudios.set(item.audioId, { audioId: item.audioId, audioUrl: item.audioUrl, stageId: item.stageId });
    }
  }

  const result: AudioMigrationProgress = {
    total: uniqueAudios.size,
    processed: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    patchedStages: 0,
  };

  const emit = (extra?: Partial<AudioMigrationProgress>) => {
    onProgress?.({ ...result, ...extra });
  };

  emit({ currentMessage: result.total > 0 ? '开始扫描本地语音缓存…' : '没有待迁移的本地语音' });

  for (const [audioId, { audioUrl, stageId }] of uniqueAudios) {
    result.processed += 1;

    try {
      emit({
        currentAudioId: audioId,
        currentStageId: stageId,
        currentMessage: `正在上传 ${audioId}`,
      });

      if (!audioUrl) {
        result.skipped += 1;
        continue;
      }

      const uploaded = await uploadAudioFromUrl(audioId, audioUrl, stageId);
      if (!uploaded) {
        result.skipped += 1;
        continue;
      }

      result.uploaded += 1;

      // Update all stage data that references this audio
      const refs = audioStageIndex.get(audioId) ?? [];
      for (const ref of refs) {
        const cached = stageDataCache.get(ref.stageId) ?? structuredClone(ref.data);
        stageDataCache.set(ref.stageId, cached);
        const patched = patchAudioUrlInStageData(cached, audioId, uploaded.url);
        if (patched) {
          touchedStageIds.add(ref.stageId);
        }
      }
    } catch (error) {
      result.failed += 1;
      log.warn(`Failed to migrate audio ${audioId}:`, error);
      emit({
        currentAudioId: audioId,
        currentStageId: stageId,
        currentMessage: `上传失败: ${audioId}`,
      });
    }
  }

  for (const stageId of touchedStageIds) {
    const data = stageDataCache.get(stageId);
    if (!data) continue;
    await saveStageData(stageId, data);
  }

  result.patchedStages = touchedStageIds.size;
  emit({
    currentMessage:
      result.total === 0
        ? '没有需要迁移的本地语音'
        : `迁移完成：上传 ${result.uploaded} 个，失败 ${result.failed} 个`,
  });

  return {
    ...result,
    updatedStageIds: Array.from(touchedStageIds),
  };
}
