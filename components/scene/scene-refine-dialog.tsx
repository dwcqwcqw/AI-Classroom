'use client';

/**
 * SceneRefineDialog
 *
 * A floating chat panel that lets the user refine an individual scene
 * by chatting with the AI. The AI returns an updated Scene object which
 * is then applied in-place via the stage store.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { X, Send, Loader2, Sparkles, RotateCcw, CheckCircle, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import { createLogger } from '@/lib/logger';
import type { Scene } from '@/lib/types/stage';

const log = createLogger('SceneRefineDialog');

interface SceneRefineDialogProps {
  scene: Scene;
  stageInfo: { name: string; language?: string; style?: string };
  onClose: () => void;
}

export function SceneRefineDialog({ scene, stageInfo, onClose }: SceneRefineDialogProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateScene = useStageStore((s) => s.updateScene);
  const ensureRefineSession = useStageStore((s) => s.ensureRefineSession);
  const setRefineDraft = useStageStore((s) => s.setRefineDraft);
  const appendRefineMessage = useStageStore((s) => s.appendRefineMessage);
  const replaceStreamingRefineMessage = useStageStore((s) => s.replaceStreamingRefineMessage);
  const pushRefineProgress = useStageStore((s) => s.pushRefineProgress);
  const markRefineStarted = useStageStore((s) => s.markRefineStarted);
  const markRefineFinished = useStageStore((s) => s.markRefineFinished);
  const session = useStageStore((s) => s.refineSessions[scene.id]);

  useEffect(() => {
    ensureRefineSession(scene);
  }, [ensureRefineSession, scene]);

  const messages = session?.messages ?? [];
  const input = session?.draftInput ?? '';
  const isLoading = session?.status === 'running';
  const appliedCount = session?.appliedCount ?? 0;
  const progressEvents = session?.progressEvents ?? [];
  const hasHistory = messages.length > 1 || progressEvents.length > 0;
  const statusLabel = useMemo(() => {
    if (!session) return '未开始';
    if (session.status === 'running') return '执行中';
    if (session.status === 'completed') return '已完成';
    if (session.status === 'error') return '失败';
    if (session.status === 'cancelled') return '已取消';
    return '未开始';
  }, [session]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const getApiHeaders = useCallback((): Record<string, string> => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
    const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
    return {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString || '',
      'x-api-key': modelConfig.apiKey || '',
      'x-base-url': modelConfig.baseUrl || '',
      'x-provider-type': modelConfig.providerType || '',
      'x-requires-api-key': String(modelConfig.requiresApiKey ?? false),
      'x-image-provider': settings.imageProviderId || '',
      'x-image-model': settings.imageModelId || '',
      'x-image-api-key': imageProviderConfig?.apiKey || '',
      'x-image-base-url': imageProviderConfig?.baseUrl || '',
      'x-video-provider': settings.videoProviderId || '',
      'x-video-model': settings.videoModelId || '',
      'x-video-api-key': videoProviderConfig?.apiKey || '',
      'x-video-base-url': videoProviderConfig?.baseUrl || '',
      'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
      'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
    };
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const now = Date.now();
    const history = messages.filter((m) => !m.isStreaming);

    setRefineDraft(scene.id, '');
    appendRefineMessage(scene.id, { role: 'user', content: trimmed, createdAt: now });
    appendRefineMessage(scene.id, {
      role: 'assistant',
      content: '已接收你的修改要求，正在准备执行…',
      isStreaming: true,
      createdAt: now + 1,
    });
    markRefineStarted(scene);
    pushRefineProgress(scene.id, { message: '已接收用户需求', status: 'running' });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch('/api/scene/refine', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          scene,
          instruction: trimmed,
          history: history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          stageInfo,
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      // Track whether a terminal event (done / error) has been received
      let terminalReceived = false;

      const finishStreaming = (content: string) => {
        replaceStreamingRefineMessage(scene.id, content);
        useStageStore.getState().clearRefineStreamingMessage(scene.id);
      };

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        const lines = raw.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          let event: { type: string; text?: string; message?: string; scene?: Scene; error?: string };
          try {
            event = JSON.parse(json);
          } catch {
            // Malformed SSE line — skip silently
            continue;
          }

          if (event.type === 'status' && event.message) {
            replaceStreamingRefineMessage(scene.id, event.message);
            pushRefineProgress(scene.id, { message: event.message, status: 'running' });
          } else if (event.type === 'done' && event.scene) {
            updateScene(event.scene.id, event.scene as Partial<Scene>);
            finishStreaming(
              `✅ 场景已更新！修改内容已实时应用到「${event.scene.title}」。\n\n如需进一步调整，请继续告诉我。`,
            );
            pushRefineProgress(scene.id, { message: '场景更新已应用', status: 'completed' });
            markRefineFinished(scene.id, 'completed', { appliedCountDelta: 1 });
            terminalReceived = true;
            break outer;
          } else if (event.type === 'error') {
            finishStreaming(`出错了：${event.error || '服务器返回未知错误'}`);
            pushRefineProgress(scene.id, {
              message: event.error || '服务器返回未知错误',
              status: 'error',
            });
            markRefineFinished(scene.id, 'error', {
              lastError: event.error || '服务器返回未知错误',
            });
            terminalReceived = true;
            break outer;
          }
        }
      }

      if (!terminalReceived) {
        finishStreaming('操作完成。');
        pushRefineProgress(scene.id, { message: '任务结束，等待确认结果', status: 'completed' });
        markRefineFinished(scene.id, 'completed');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        replaceStreamingRefineMessage(scene.id, '当前任务已取消。');
        useStageStore.getState().clearRefineStreamingMessage(scene.id);
        pushRefineProgress(scene.id, { message: '任务已取消', status: 'cancelled' });
        markRefineFinished(scene.id, 'cancelled');
        return;
      }
      log.error('Scene refine error:', err);
      replaceStreamingRefineMessage(scene.id, `出错了：${err instanceof Error ? err.message : String(err)}`);
      useStageStore.getState().clearRefineStreamingMessage(scene.id);
      pushRefineProgress(scene.id, {
        message: err instanceof Error ? err.message : String(err),
        status: 'error',
      });
      markRefineFinished(scene.id, 'error', {
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    appendRefineMessage,
    getApiHeaders,
    input,
    isLoading,
    markRefineFinished,
    markRefineStarted,
    messages,
    pushRefineProgress,
    replaceStreamingRefineMessage,
    scene,
    setRefineDraft,
    stageInfo,
    updateScene,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex flex-col w-full h-full bg-background border-l border-border/60"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 shrink-0">
        <div className="size-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
          <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate">AI 场景编辑</p>
          <p className="text-[11px] text-muted-foreground/60 truncate">{scene.title}</p>
        </div>
        <div
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
            session?.status === 'running' && 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
            session?.status === 'completed' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
            session?.status === 'error' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
            (!session || session.status === 'idle' || session.status === 'cancelled') &&
              'bg-muted text-muted-foreground',
          )}
        >
          {statusLabel}
        </div>
        {appliedCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle className="size-3" />
            <span>{appliedCount} 次修改</span>
          </div>
        )}
        <button
          onClick={onClose}
          className="shrink-0 size-6 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {hasHistory && (
        <div className="px-3 py-2 border-b border-border/40 bg-muted/20 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
            <Clock3 className="size-3" />
            <span>任务进度</span>
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
            {progressEvents.map((event) => (
              <div key={event.id} className="text-[11px] leading-relaxed rounded-md bg-background/80 px-2 py-1">
                <span
                  className={cn(
                    'mr-1 font-medium',
                    event.status === 'running' && 'text-violet-600 dark:text-violet-400',
                    event.status === 'completed' && 'text-emerald-600 dark:text-emerald-400',
                    event.status === 'error' && 'text-red-600 dark:text-red-400',
                    event.status === 'cancelled' && 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {event.status === 'running'
                    ? '进行中'
                    : event.status === 'completed'
                      ? '完成'
                      : event.status === 'error'
                        ? '失败'
                        : '取消'}
                </span>
                <span>{event.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            {msg.role === 'assistant' && (
              <div className="size-5 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="size-3 text-violet-600 dark:text-violet-400" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-tr-sm'
                  : 'bg-muted/60 text-foreground rounded-tl-sm',
                msg.isStreaming && 'animate-pulse',
              )}
            >
              {msg.isStreaming ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />
                  {msg.content || '思考中...'}
                </span>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion pills */}
      <div className="px-3 pb-2 flex gap-1.5 flex-wrap shrink-0">
        {[
          '精简讲解文字',
          '增加互动问题',
          '换一个更吸引人的标题',
          '调整为更轻松的风格',
        ].map((s) => (
          <button
            key={s}
            onClick={() => setRefineDraft(scene.id, s)}
            disabled={isLoading}
            className="text-[11px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="px-3 pb-3 shrink-0">
        <div className="flex items-end gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 focus-within:ring-1 focus-within:ring-violet-400/50 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setRefineDraft(scene.id, e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? '当前任务执行中，完成前不能继续提交新需求' : '告诉 AI 如何修改这个场景…'}
            rows={2}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent text-[12px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-50 min-h-[40px]"
          />
          <div className="flex items-center gap-1 shrink-0 self-end pb-0.5">
            {isLoading && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="size-6 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-muted transition-colors"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={cn(
                'size-7 rounded-full flex items-center justify-center transition-all',
                input.trim() && !isLoading
                  ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm'
                  : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
              )}
            >
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">
          {isLoading ? '任务执行中，已锁定新的输入' : '⌘↵ 发送'}
        </p>
      </div>
    </motion.div>
  );
}
