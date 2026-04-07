'use client';

/**
 * SceneRefineDialog
 *
 * A floating chat panel that lets the user refine an individual scene
 * by chatting with the AI. The AI returns an updated Scene object which
 * is then applied in-place via the stage store.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2, Sparkles, RotateCcw, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import { createLogger } from '@/lib/logger';
import type { Scene } from '@/lib/types/stage';

const log = createLogger('SceneRefineDialog');

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

interface SceneRefineDialogProps {
  scene: Scene;
  stageInfo: { name: string; language?: string; style?: string };
  onClose: () => void;
}

export function SceneRefineDialog({ scene, stageInfo, onClose }: SceneRefineDialogProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `我是你的 AI 课程编辑助手。\n\n当前场景：**${scene.title}**（${scene.type}）\n\n你可以告诉我如何修改这个场景，例如：\n- 调整内容或重点\n- 修改讲解文字\n- 更改视觉风格\n- 增减幻灯片元素`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateScene = useStageStore((s) => s.updateScene);

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

    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const history = messages.filter((m) => !m.isStreaming);

    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '', isStreaming: true }]);
    setIsLoading(true);

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
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.isStreaming) {
            next[next.length - 1] = { role: 'assistant', content, isStreaming: false };
          }
          return next;
        });
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
            // Progress update — show in the streaming bubble
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.isStreaming) {
                next[next.length - 1] = { ...last, content: event.message! };
              }
              return next;
            });
          } else if (event.type === 'done' && event.scene) {
            updateScene(event.scene.id, event.scene as Partial<Scene>);
            setAppliedCount((c) => c + 1);
            finishStreaming(
              `✅ 场景已更新！修改内容已实时应用到「${event.scene.title}」。\n\n如需进一步调整，请继续告诉我。`,
            );
            terminalReceived = true;
            break outer;
          } else if (event.type === 'error') {
            // Application-level error from the server — surface it to the user
            finishStreaming(`出错了：${event.error || '服务器返回未知错误'}`);
            terminalReceived = true;
            break outer;
          }
        }
      }

      // Fallback: stream ended without a terminal event
      if (!terminalReceived) {
        finishStreaming('操作完成。');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      log.error('Scene refine error:', err);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.isStreaming) {
          next[next.length - 1] = {
            role: 'assistant',
            content: `出错了：${err instanceof Error ? err.message : String(err)}`,
            isStreaming: false,
          };
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, scene, stageInfo, getApiHeaders, updateScene]);

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
            onClick={() => setInput(s)}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="告诉 AI 如何修改这个场景…"
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
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-right">⌘↵ 发送</p>
      </div>
    </motion.div>
  );
}
