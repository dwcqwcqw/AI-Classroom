'use client';

import { useState, useCallback, useMemo } from 'react';
import { Volume2, Play, Loader2, CloudUpload } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { getTTSVoices } from '@/lib/audio/constants';
import { useTTSPreview } from '@/lib/audio/use-tts-preview';
import { migrateLocalAudioToR2, type AudioMigrationProgress } from '@/lib/audio/migrate-local-audio-to-r2';

/** Extract the English name from voice name format "ChineseName (English)" */
function getVoiceDisplayName(name: string, lang: string): string {
  if (lang === 'en-US') {
    const match = name.match(/\(([^)]+)\)/);
    return match ? match[1] : name;
  }
  return name;
}

export function TtsConfigPopover() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<AudioMigrationProgress | null>(null);
  const { previewing, startPreview, stopPreview } = useTTSPreview();

  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTTSEnabled = useSettingsStore((s) => s.setTTSEnabled);
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);

  const voices = getTTSVoices(ttsProviderId);
  const localizedVoices = useMemo(
    () =>
      voices.map((v) => ({
        ...v,
        displayName: getVoiceDisplayName(v.name, locale),
      })),
    [voices, locale],
  );

  const pillCls =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap border';

  const handlePreview = useCallback(async () => {
    if (previewing) {
      stopPreview();
      return;
    }
    try {
      const providerConfig = ttsProvidersConfig[ttsProviderId];
      await startPreview({
        text: t('settings.ttsTestTextDefault'),
        providerId: ttsProviderId,
        modelId: providerConfig?.modelId,
        voice: ttsVoice,
        speed: ttsSpeed,
        apiKey: providerConfig?.apiKey,
        baseUrl: providerConfig?.baseUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t('settings.ttsTestFailed');
      toast.error(message);
    }
  }, [
    previewing,
    startPreview,
    stopPreview,
    t,
    ttsProviderId,
    ttsProvidersConfig,
    ttsSpeed,
    ttsVoice,
  ]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        stopPreview();
      }
      setOpen(nextOpen);
    },
    [stopPreview],
  );

  const handleMigrateAudio = useCallback(async () => {
    if (migrating) return;
    setMigrating(true);
    setMigrationProgress(null);
    try {
      const result = await migrateLocalAudioToR2((progress) => {
        setMigrationProgress(progress);
      });
      if (result.total === 0) {
        toast.success('没有需要迁移的本地语音');
      } else if (result.failed > 0) {
        toast.warning(
          `语音迁移完成：已上传 ${result.uploaded} 个，失败 ${result.failed} 个，已回写 ${result.patchedStages} 个课堂`,
        );
      } else {
        toast.success(
          `语音迁移完成：已上传 ${result.uploaded} 个，并回写 ${result.patchedStages} 个课堂`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '迁移失败';
      toast.error(message);
    } finally {
      setMigrating(false);
    }
  }, [migrating]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                pillCls,
                ttsEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-700/50'
                  : 'border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60',
              )}
            >
              <Volume2 className="size-3.5" />
              {ttsEnabled && (
                <span className="max-w-[60px] truncate">
                  {localizedVoices.find((v) => v.id === ttsVoice)?.displayName || ttsVoice}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('toolbar.ttsHint')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-[280px] p-0">
        {/* Header with toggle */}
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border/40">
          <Volume2
            className={cn(
              'size-4 shrink-0',
              ttsEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
            )}
          />
          <span
            className={cn('flex-1 text-sm font-medium', !ttsEnabled && 'text-muted-foreground')}
          >
            {t('toolbar.ttsTitle')}
          </span>
          <Switch
            checked={ttsEnabled}
            onCheckedChange={setTTSEnabled}
            className="scale-[0.85] origin-right"
          />
        </div>

        {/* Config body */}
        {ttsEnabled && (
          <div className="px-3.5 py-3 space-y-3">
            {/* Voice + Preview row */}
            <div className="flex items-center gap-2">
              <Select value={ttsVoice} onValueChange={setTTSVoice}>
                <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {localizedVoices.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">
                      {v.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={handlePreview}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all shrink-0',
                  previewing
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {previewing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                {previewing ? t('toolbar.ttsPreviewing') : t('toolbar.ttsPreview')}
              </button>
            </div>

            <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium">历史语音迁移到云端</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    将当前浏览器里旧的本地语音缓存批量上传到 Cloudflare R2，并把课堂里的语音地址回写为云端 URL。
                  </div>
                </div>
                <button
                  onClick={handleMigrateAudio}
                  disabled={migrating}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all shrink-0',
                    migrating
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {migrating ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <CloudUpload className="size-3" />
                  )}
                  {migrating ? '迁移中' : '开始迁移'}
                </button>
              </div>

              {migrationProgress && (
                <div className="rounded-md bg-background/80 px-2 py-1.5 text-[11px] text-muted-foreground space-y-1">
                  <div>
                    进度：{migrationProgress.processed}/{migrationProgress.total}，
                    已上传 {migrationProgress.uploaded}，失败 {migrationProgress.failed}
                  </div>
                  {migrationProgress.currentMessage && <div>{migrationProgress.currentMessage}</div>}
                  {migrationProgress.currentAudioId && (
                    <div className="truncate">当前音频：{migrationProgress.currentAudioId}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
