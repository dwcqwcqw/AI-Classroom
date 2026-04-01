'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSettingsStore } from '@/lib/store/settings';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';

const log = createLogger('Classroom');

const MAX_RETRIES = 3;
const LOAD_TIMEOUT_MS = 20_000; // 20 s before showing timeout diagnostic

type LoadStep =
  | 'local_storage'
  | 'server_storage'
  | 'media_tasks'
  | 'agent_registry';

interface StepStatus {
  label: string;
  status: 'pending' | 'running' | 'ok' | 'warn' | 'error';
  detail?: string;
}

const STEP_LABELS: Record<LoadStep, string> = {
  local_storage: '本地数据加载 (IndexedDB / Shared Storage)',
  server_storage: '服务端数据加载 (API)',
  media_tasks: '媒体任务恢复',
  agent_registry: 'Agent 配置加载',
};

function makeSteps(): Record<LoadStep, StepStatus> {
  return {
    local_storage: { label: STEP_LABELS.local_storage, status: 'pending' },
    server_storage: { label: STEP_LABELS.server_storage, status: 'pending' },
    media_tasks: { label: STEP_LABELS.media_tasks, status: 'pending' },
    agent_registry: { label: STEP_LABELS.agent_registry, status: 'pending' },
  };
}

const statusIcon: Record<StepStatus['status'], string> = {
  pending: '⬜',
  running: '🔄',
  ok: '✅',
  warn: '⚠️',
  error: '❌',
};

export default function ClassroomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const classroomId = params?.id as string;

  const { loadFromStorage } = useStageStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [steps, setSteps] = useState<Record<LoadStep, StepStatus>>(makeSteps);
  const [timedOut, setTimedOut] = useState(false);

  const generationStartedRef = useRef(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const setChatAreaCollapsed = useSettingsStore((s) => s.setChatAreaCollapsed);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
  });

  const updateStep = useCallback(
    (key: LoadStep, status: StepStatus['status'], detail?: string) => {
      setSteps((prev) => ({
        ...prev,
        [key]: { ...prev[key], status, detail },
      }));
    },
    [],
  );

  const loadClassroom = useCallback(
    async (attempt: number) => {
      const abort = new AbortController();
      loadAbortRef.current = abort;

      setSteps(makeSteps());
      setTimedOut(false);

      // Timeout: if still loading after LOAD_TIMEOUT_MS, mark timed-out steps and surface error
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (!abort.signal.aborted) {
          abort.abort('timeout');
          setTimedOut(true);
          setLoading(false);
          setSteps((prev) => {
            const next = { ...prev };
            (Object.keys(next) as LoadStep[]).forEach((k) => {
              if (next[k].status === 'pending' || next[k].status === 'running') {
                next[k] = { ...next[k], status: 'error', detail: '超时未响应' };
              }
            });
            return next;
          });
        }
      }, LOAD_TIMEOUT_MS);

      try {
        // ── Step 1: Local / shared storage ───────────────────────────────
        updateStep('local_storage', 'running');
        await loadFromStorage(classroomId);
        if (abort.signal.aborted) return;

        if (!useStageStore.getState().stage) {
          updateStep('local_storage', 'warn', '本地无数据，尝试服务端');
        } else {
          updateStep('local_storage', 'ok');
        }

        // ── Step 2: Server-side fallback ──────────────────────────────────
        if (!useStageStore.getState().stage) {
          updateStep('server_storage', 'running');
          try {
            const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`, {
              signal: abort.signal,
            });
            if (abort.signal.aborted) return;
            if (res.ok) {
              const json = await res.json();
              if (json.success && json.classroom) {
                const { stage, scenes } = json.classroom;
                useStageStore.getState().setStage(stage);
                useStageStore.setState({
                  scenes,
                  currentSceneId: scenes[0]?.id ?? null,
                });
                updateStep('server_storage', 'ok');
                log.info('Loaded from server-side storage:', classroomId);
              } else {
                updateStep('server_storage', 'warn', '服务端无此课堂数据');
              }
            } else {
              updateStep('server_storage', 'warn', `HTTP ${res.status}`);
            }
          } catch (fetchErr) {
            if (abort.signal.aborted) return;
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            updateStep('server_storage', 'warn', `请求失败: ${msg}`);
            log.warn('Server-side storage fetch failed:', fetchErr);
          }
        } else {
          updateStep('server_storage', 'ok', '跳过（本地已有数据）');
        }

        if (abort.signal.aborted) return;

        // ── Step 3: Media tasks ────────────────────────────────────────────
        updateStep('media_tasks', 'running');
        try {
          await useMediaGenerationStore.getState().restoreFromDB(classroomId);
          if (abort.signal.aborted) return;
          updateStep('media_tasks', 'ok');
        } catch (mediaErr) {
          if (abort.signal.aborted) return;
          const msg = mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
          updateStep('media_tasks', 'warn', `媒体任务恢复失败: ${msg}`);
          log.warn('Media tasks restore failed:', mediaErr);
        }

        // ── Step 4: Agent registry ─────────────────────────────────────────
        updateStep('agent_registry', 'running');
        try {
          const { loadGeneratedAgentsForStage, useAgentRegistry } =
            await import('@/lib/orchestration/registry/store');
          if (abort.signal.aborted) return;
          const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
          if (abort.signal.aborted) return;
          const { useSettingsStore } = await import('@/lib/store/settings');
          if (generatedAgentIds.length > 0) {
            useSettingsStore.getState().setAgentMode('auto');
            useSettingsStore.getState().setSelectedAgentIds(generatedAgentIds);
          } else {
            const stage = useStageStore.getState().stage;
            const stageAgentIds = stage?.agentIds;
            const registry = useAgentRegistry.getState();
            const cleanIds = stageAgentIds?.filter((id) => {
              const a = registry.getAgent(id);
              return a && !a.isGenerated;
            });
            useSettingsStore.getState().setAgentMode('preset');
            useSettingsStore
              .getState()
              .setSelectedAgentIds(
                cleanIds && cleanIds.length > 0
                  ? cleanIds
                  : ['default-1', 'default-2', 'default-3'],
              );
          }
          updateStep('agent_registry', 'ok');
        } catch (agentErr) {
          if (abort.signal.aborted) return;
          const msg = agentErr instanceof Error ? agentErr.message : String(agentErr);
          updateStep('agent_registry', 'error', `Agent 加载失败: ${msg}`);
          throw agentErr; // escalate — agents are required
        }

        if (abort.signal.aborted) return;

        clearTimeout(timeoutRef.current!);
        setLoading(false);
        setError(null);
      } catch (err) {
        if (abort.signal.aborted) return;
        clearTimeout(timeoutRef.current!);
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[Classroom] Load attempt ${attempt + 1} failed:`, err);

        if (attempt < MAX_RETRIES - 1) {
          // Auto-retry with backoff: 1s, 2s, 4s
          const delay = 1000 * 2 ** attempt;
          setRetryCount(attempt + 1);
          log.info(`[Classroom] Retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_RETRIES})`);
          setTimeout(() => {
            if (!abort.signal.aborted) {
              loadClassroom(attempt + 1);
            }
          }, delay);
        } else {
          setError(msg);
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classroomId, loadFromStorage, updateStep],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    setRetryCount(0);
    generationStartedRef.current = false;

    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    useWhiteboardHistoryStore.getState().clearHistory();

    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches) {
      setSidebarCollapsed(true);
      setChatAreaCollapsed(true);
    }

    loadClassroom(0);

    return () => {
      stop();
      loadAbortRef.current?.abort('unmount');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [classroomId, loadClassroom, stop, setSidebarCollapsed, setChatAreaCollapsed]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;

    const state = useStageStore.getState();
    const { outlines, scenes, stage } = state;

    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      const storageIds = (params.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      loadImageMapping(storageIds).then((imageMapping) => {
        generateRemaining({
          pdfImages: params.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            language: stage.language,
            style: stage.style,
          },
          agents: params.agents,
          userProfile: params.userProfile,
        });
      });
    } else if (outlines.length > 0 && stage) {
      generationStartedRef.current = true;
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining]);

  const handleManualRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    setRetryCount(0);
    setTimedOut(false);
    generationStartedRef.current = false;
    loadClassroom(0);
  }, [loadClassroom]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen h-[100dvh] flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
              <div className="w-full max-w-sm">
                {/* Spinner + title */}
                <div className="flex flex-col items-center mb-6">
                  <div className="relative w-12 h-12 mb-4">
                    <div className="absolute inset-0 rounded-full border-2 border-gray-200 dark:border-gray-700" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-500 dark:border-t-purple-400 animate-spin" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    正在加载课堂…
                  </p>
                  {retryCount > 0 && (
                    <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">
                      自动重试中 ({retryCount}/{MAX_RETRIES - 1})…
                    </p>
                  )}
                </div>

                {/* Step-by-step progress */}
                <div className="space-y-2">
                  {(Object.entries(steps) as [LoadStep, StepStatus][]).map(([key, step]) => (
                    <div
                      key={key}
                      className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                    >
                      <span className="text-base leading-none mt-0.5 shrink-0">
                        {step.status === 'running' ? (
                          <span className="inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin align-middle" />
                        ) : (
                          statusIcon[step.status]
                        )}
                      </span>
                      <div className="min-w-0">
                        <span
                          className={
                            step.status === 'running'
                              ? 'font-semibold text-purple-600 dark:text-purple-400'
                              : step.status === 'error'
                                ? 'font-semibold text-red-500'
                                : 'text-gray-600 dark:text-gray-400'
                          }
                        >
                          {step.label}
                        </span>
                        {step.detail && (
                          <p className="text-gray-400 dark:text-gray-500 truncate mt-0.5">
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : error || timedOut ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
              <div className="w-full max-w-sm">
                {/* Error header */}
                <div className="flex flex-col items-center mb-5">
                  <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-3">
                    <svg
                      className="w-6 h-6 text-red-500 dark:text-red-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    {timedOut ? '加载超时' : '加载失败'}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                    {timedOut
                      ? `页面加载超过 ${LOAD_TIMEOUT_MS / 1000} 秒未完成，请检查网络连接后重试。`
                      : `已自动重试 ${MAX_RETRIES} 次仍失败，以下为各步骤详情：`}
                  </p>
                </div>

                {/* Diagnostic steps */}
                <div className="space-y-2 mb-5">
                  {(Object.entries(steps) as [LoadStep, StepStatus][]).map(([key, step]) => (
                    <div
                      key={key}
                      className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                        step.status === 'error'
                          ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                          : step.status === 'warn'
                            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                            : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'
                      }`}
                    >
                      <span className="text-base leading-none mt-0.5 shrink-0">
                        {statusIcon[step.status]}
                      </span>
                      <div className="min-w-0">
                        <span
                          className={
                            step.status === 'error'
                              ? 'font-semibold text-red-600 dark:text-red-400'
                              : step.status === 'warn'
                                ? 'font-semibold text-amber-600 dark:text-amber-400'
                                : 'text-gray-600 dark:text-gray-400'
                          }
                        >
                          {step.label}
                        </span>
                        {step.detail && (
                          <p className="text-gray-500 dark:text-gray-400 break-words mt-0.5">
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Raw error message if present */}
                {error && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 break-words">
                    <span className="font-semibold text-gray-600 dark:text-gray-300">错误信息：</span>
                    {error}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={handleManualRetry}
                    className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    重新加载
                  </button>
                  <button
                    onClick={() => router.push('/')}
                    className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-colors"
                  >
                    返回首页
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <Stage onRetryOutline={retrySingleOutline} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
