import { create } from 'zustand';
import type {
  Stage,
  Scene,
  StageMode,
  SceneRefineSession,
  SceneRefineMessage,
  SceneRefineProgressEvent,
} from '@/lib/types/stage';
import { createSelectors } from '@/lib/utils/create-selectors';
import { loadBookmarksFromLocal } from '@/lib/utils/stage-storage';
import type { ChatSession } from '@/lib/types/chat';
import type { SceneOutline } from '@/lib/types/generation';

export type FailedPhase = 'content' | 'actions' | 'tts' | 'unknown';

export interface FailedOutlineInfo {
  outline: SceneOutline;
  phase: FailedPhase;
  reason: string;
  failedAt: number;
}
import { createLogger } from '@/lib/logger';

const log = createLogger('StageStore');

/** Virtual scene ID used when the user navigates to a page still being generated */
export const PENDING_SCENE_ID = '__pending__';

type RefineSessionMap = Record<string, SceneRefineSession>;

function createRefineIntroMessage(scene: Scene): SceneRefineMessage {
  return {
    role: 'assistant',
    content:
      `我是你的 AI 课程编辑助手。\n\n当前场景：**${scene.title}**（${scene.type}）\n\n` +
      `你可以告诉我如何修改这个场景，例如：\n` +
      `- 调整内容或重点\n- 修改讲解文字\n- 更改视觉风格\n- 增减幻灯片元素`,
    createdAt: Date.now(),
  };
}

function ensureRefineSession(
  sessions: RefineSessionMap,
  scene: Scene,
): { sessions: RefineSessionMap; session: SceneRefineSession } {
  const existing = sessions[scene.id];
  if (existing) {
    const nextSession: SceneRefineSession = {
      ...existing,
      sceneTitle: scene.title,
      updatedAt: Date.now(),
    };
    return {
      sessions: { ...sessions, [scene.id]: nextSession },
      session: nextSession,
    };
  }

  const session: SceneRefineSession = {
    sceneId: scene.id,
    sceneTitle: scene.title,
    draftInput: '',
    messages: [createRefineIntroMessage(scene)],
    progressEvents: [],
    status: 'idle',
    appliedCount: 0,
    updatedAt: Date.now(),
  };
  return {
    sessions: { ...sessions, [scene.id]: session },
    session,
  };
}

// ==================== Debounce Helper ====================

/**
 * Debounce function to limit how often a function is called
 * @param func Function to debounce
 * @param delay Delay in milliseconds
 */
function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

type ToolbarState = 'design' | 'ai';

interface StageState {
  // Stage info
  stage: Stage | null;

  // Scenes
  scenes: Scene[];
  currentSceneId: string | null;

  // Chats
  chats: ChatSession[];

  // Mode
  mode: StageMode;

  // UI state
  toolbarState: ToolbarState;

  // Transient generation state (not persisted)
  generatingOutlines: SceneOutline[];

  // Persisted outlines for resume-on-refresh
  outlines: SceneOutline[];

  // Transient generation tracking (not persisted)
  generationEpoch: number;
  generationStatus: 'idle' | 'generating' | 'paused' | 'completed' | 'error';
  currentGeneratingOrder: number;
  failedOutlines: FailedOutlineInfo[];

  // Per-outline generation timeout tracking
  outlineGenerationStartTime: number | null; // timestamp when current outline started generating
  outlineGenerationTimeoutMs: number; // timeout in ms (default 10 minutes)
  refineSessions: RefineSessionMap;

  // Actions
  setStage: (stage: Stage) => void;
  setScenes: (scenes: Scene[]) => void;
  addScene: (scene: Scene) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  deleteScene: (sceneId: string) => void;
  setCurrentSceneId: (sceneId: string | null) => void;
  setChats: (chats: ChatSession[]) => void;
  setMode: (mode: StageMode) => void;
  setToolbarState: (state: ToolbarState) => void;
  setGeneratingOutlines: (outlines: SceneOutline[]) => void;
  removeGeneratingOutline: (outlineId: string) => void;
  setOutlines: (outlines: SceneOutline[]) => void;
  setGenerationStatus: (status: 'idle' | 'generating' | 'paused' | 'completed' | 'error') => void;
  setCurrentGeneratingOrder: (order: number) => void;
  bumpGenerationEpoch: () => void;
  addFailedOutline: (outline: SceneOutline, phase?: FailedPhase, reason?: string) => void;
  clearFailedOutlines: () => void;
  retryFailedOutline: (outlineId: string) => void;
  // Timeout tracking
  setOutlineGenerationStartTime: (time: number | null) => void;
  setOutlineGenerationTimeout: (ms: number) => void;
  ensureRefineSession: (scene: Scene) => void;
  setRefineDraft: (sceneId: string, draftInput: string) => void;
  appendRefineMessage: (sceneId: string, message: SceneRefineMessage) => void;
  replaceStreamingRefineMessage: (sceneId: string, content: string) => void;
  pushRefineProgress: (
    sceneId: string,
    event: Omit<SceneRefineProgressEvent, 'id' | 'createdAt'>,
  ) => void;
  markRefineStarted: (scene: Scene) => void;
  markRefineFinished: (
    sceneId: string,
    status: 'completed' | 'error' | 'cancelled',
    options?: { lastError?: string; appliedCountDelta?: number },
  ) => void;
  clearRefineStreamingMessage: (sceneId: string) => void;
  getRefineSession: (sceneId: string) => SceneRefineSession | null;

  // Getters
  getCurrentScene: () => Scene | null;
  getSceneById: (sceneId: string) => Scene | null;
  getSceneIndex: (sceneId: string) => number;

  // Storage
  saveToStorage: () => Promise<void>;
  loadFromStorage: (stageId: string) => Promise<void>;
  clearStore: () => void;
}

const useStageStoreBase = create<StageState>()((set, get) => ({
  // Initial state
  stage: null,
  scenes: [],
  currentSceneId: null,
  chats: [],
  mode: 'playback',
  toolbarState: 'ai',
  generatingOutlines: [],
  outlines: [],
  generationEpoch: 0,
  generationStatus: 'idle' as const,
  currentGeneratingOrder: -1,
  failedOutlines: [],
  outlineGenerationStartTime: null,
  outlineGenerationTimeoutMs: 10 * 60 * 1000, // 10 minutes default
  refineSessions: {},

  // Actions
  setStage: (stage) => {
    set((s) => ({
      stage,
      scenes: [],
      currentSceneId: null,
      chats: [],
      refineSessions: {},
      generationEpoch: s.generationEpoch + 1,
    }));
    debouncedSave();
  },

  setScenes: (scenes) => {
    set({ scenes });
    // Auto-select first scene if no current scene
    if (!get().currentSceneId && scenes.length > 0) {
      set({ currentSceneId: scenes[0].id });
    }
    debouncedSave();
  },

  addScene: (scene) => {
    const currentStage = get().stage;
    // Ignore scenes from different stages (prevents race condition during generation)
    if (!currentStage || scene.stageId !== currentStage.id) {
      log.warn(
        `Ignoring scene "${scene.title}" - stageId mismatch (scene: ${scene.stageId}, current: ${currentStage?.id})`,
      );
      return;
    }
    const scenes = [...get().scenes, scene];
    // Remove the matching outline from generatingOutlines (match by order)
    const generatingOutlines = get().generatingOutlines.filter((o) => o.order !== scene.order);
    // Auto-switch from pending page to the newly generated scene
    const shouldSwitch = get().currentSceneId === PENDING_SCENE_ID;
    set({
      scenes,
      generatingOutlines,
      ...(shouldSwitch ? { currentSceneId: scene.id } : {}),
    });
    debouncedSave();
  },

  updateScene: (sceneId, updates) => {
    const scenes = get().scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, ...updates } : scene,
    );
    set({ scenes });
    debouncedSave();
  },

  deleteScene: (sceneId) => {
    const scenes = get().scenes.filter((scene) => scene.id !== sceneId);
    const currentSceneId = get().currentSceneId;
    const refineSessions = { ...get().refineSessions };
    delete refineSessions[sceneId];

    // If deleted scene was current, select next or previous
    if (currentSceneId === sceneId) {
      const index = get().getSceneIndex(sceneId);
      const newIndex = index < scenes.length ? index : scenes.length - 1;
      set({
        scenes,
        refineSessions,
        currentSceneId: scenes[newIndex]?.id || null,
      });
    } else {
      set({ scenes, refineSessions });
    }
    debouncedSave();
  },

  setCurrentSceneId: (sceneId) => {
    set({ currentSceneId: sceneId });
    debouncedSave();
  },

  setChats: (chats) => {
    set({ chats });
    debouncedSave();
  },

  setMode: (mode) => set({ mode }),

  setToolbarState: (toolbarState) => set({ toolbarState }),

  setGeneratingOutlines: (generatingOutlines) => set({ generatingOutlines }),

  removeGeneratingOutline: (outlineId: string) => {
    const current = get().generatingOutlines;
    if (!current.some((o) => o.id === outlineId)) return;
    set({ generatingOutlines: current.filter((o) => o.id !== outlineId) });
    debouncedSave();
  },

  setOutlines: (outlines) => {
    set({ outlines });
    // Persist outlines to IndexedDB
    const stageId = get().stage?.id;
    if (stageId) {
      import('@/lib/utils/database').then(({ db }) => {
        db.stageOutlines.put({
          stageId,
          outlines,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
    }
  },

  setGenerationStatus: (generationStatus) => set({ generationStatus }),

  setCurrentGeneratingOrder: (currentGeneratingOrder) => set({ currentGeneratingOrder }),

  bumpGenerationEpoch: () => set((s) => ({ generationEpoch: s.generationEpoch + 1 })),

  addFailedOutline: (outline, phase = 'unknown', reason = '') => {
    const existed = get().failedOutlines.some((o) => o.outline.id === outline.id);
    if (existed) {
      set({
        failedOutlines: get().failedOutlines.map((o) =>
          o.outline.id === outline.id
            ? {
                ...o,
                phase,
                reason: reason || o.reason,
                failedAt: Date.now(),
              }
            : o,
        ),
      });
      return;
    }
    set({
      failedOutlines: [
        ...get().failedOutlines,
        {
          outline,
          phase,
          reason,
          failedAt: Date.now(),
        },
      ],
    });
  },

  clearFailedOutlines: () => set({ failedOutlines: [] }),

  retryFailedOutline: (outlineId) => {
    set({
      failedOutlines: get().failedOutlines.filter((o) => o.outline.id !== outlineId),
    });
  },

  setOutlineGenerationStartTime: (time) => set({ outlineGenerationStartTime: time }),

  setOutlineGenerationTimeout: (ms) => set({ outlineGenerationTimeoutMs: ms }),

  ensureRefineSession: (scene) => {
    set((state) => {
      const { sessions } = ensureRefineSession(state.refineSessions, scene);
      return { refineSessions: sessions };
    });
    debouncedSave();
  },

  setRefineDraft: (sceneId, draftInput) => {
    const currentScene = get().getSceneById(sceneId);
    if (!currentScene) return;
    set((state) => {
      const { sessions, session } = ensureRefineSession(state.refineSessions, currentScene);
      return {
        refineSessions: {
          ...sessions,
          [sceneId]: {
            ...session,
            draftInput,
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  appendRefineMessage: (sceneId, message) => {
    const currentScene = get().getSceneById(sceneId);
    if (!currentScene) return;
    set((state) => {
      const { sessions, session } = ensureRefineSession(state.refineSessions, currentScene);
      return {
        refineSessions: {
          ...sessions,
          [sceneId]: {
            ...session,
            messages: [...session.messages, message],
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  replaceStreamingRefineMessage: (sceneId, content) => {
    set((state) => {
      const session = state.refineSessions[sceneId];
      if (!session) return {};
      const messages = [...session.messages];
      const last = messages[messages.length - 1];
      if (last?.isStreaming) {
        messages[messages.length - 1] = { ...last, content };
      }
      return {
        refineSessions: {
          ...state.refineSessions,
          [sceneId]: {
            ...session,
            messages,
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  pushRefineProgress: (sceneId, event) => {
    set((state) => {
      const session = state.refineSessions[sceneId];
      if (!session) return {};
      return {
        refineSessions: {
          ...state.refineSessions,
          [sceneId]: {
            ...session,
            progressEvents: [
              ...session.progressEvents,
              {
                ...event,
                id: `${sceneId}:${Date.now()}:${session.progressEvents.length}`,
                createdAt: Date.now(),
              },
            ],
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  markRefineStarted: (scene) => {
    set((state) => {
      const { sessions, session } = ensureRefineSession(state.refineSessions, scene);
      return {
        refineSessions: {
          ...sessions,
          [scene.id]: {
            ...session,
            status: 'running',
            lastError: undefined,
            startedAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  markRefineFinished: (sceneId, status, options) => {
    set((state) => {
      const session = state.refineSessions[sceneId];
      if (!session) return {};
      return {
        refineSessions: {
          ...state.refineSessions,
          [sceneId]: {
            ...session,
            status,
            lastError: options?.lastError,
            appliedCount: session.appliedCount + (options?.appliedCountDelta ?? 0),
            finishedAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  clearRefineStreamingMessage: (sceneId) => {
    set((state) => {
      const session = state.refineSessions[sceneId];
      if (!session) return {};
      const messages = [...session.messages];
      const last = messages[messages.length - 1];
      if (last?.isStreaming) {
        messages[messages.length - 1] = { ...last, isStreaming: false };
      }
      return {
        refineSessions: {
          ...state.refineSessions,
          [sceneId]: {
            ...session,
            messages,
            updatedAt: Date.now(),
          },
        },
      };
    });
    debouncedSave();
  },

  // Getters
  getCurrentScene: () => {
    const { scenes, currentSceneId } = get();
    if (!currentSceneId) return null;
    return scenes.find((s) => s.id === currentSceneId) || null;
  },

  getSceneById: (sceneId) => {
    return get().scenes.find((s) => s.id === sceneId) || null;
  },

  getSceneIndex: (sceneId) => {
    return get().scenes.findIndex((s) => s.id === sceneId);
  },

  getRefineSession: (sceneId) => {
    return get().refineSessions[sceneId] ?? null;
  },

  // Storage methods
  saveToStorage: async () => {
    const { stage, scenes, currentSceneId, chats, refineSessions } = get();
    if (!stage?.id) {
      log.warn('Cannot save: stage.id is required');
      return;
    }

    // Load current bookmark state from local cache so it gets synced to the server.
    // This ensures the star status is preserved across saves and visible on other devices.
    const localBookmarks = loadBookmarksFromLocal();
    const isStarred = localBookmarks[stage.id] ?? false;

    try {
      const { saveStageData } = await import('@/lib/utils/stage-storage');
      await saveStageData(stage.id, {
        stage,
        scenes,
        currentSceneId,
        chats,
        refineSessions,
        isStarred,
      });
    } catch (error) {
      log.error('Failed to save to storage:', error);
    }
  },

  loadFromStorage: async (stageId: string) => {
    try {
      // Skip IndexedDB load if the store already has this stage with scenes
      // (e.g. navigated from generation-preview with fresh in-memory data)
      const currentState = get();
      if (currentState.stage?.id === stageId && currentState.scenes.length > 0) {
        log.info('Stage already loaded in memory, skipping IndexedDB load:', stageId);
        return;
      }

      const { loadStageData } = await import('@/lib/utils/stage-storage');
      const data = await loadStageData(stageId);

      // Load outlines for resume-on-refresh
      const { db } = await import('@/lib/utils/database');
      const outlinesRecord = await db.stageOutlines.get(stageId);
      const outlines = outlinesRecord?.outlines || [];

      if (data) {
        set({
          stage: data.stage,
          scenes: data.scenes,
          currentSceneId: data.currentSceneId,
          chats: data.chats,
          refineSessions: data.refineSessions ?? {},
          outlines,
          failedOutlines: [],
          // Compute generatingOutlines from persisted outlines minus completed scenes
          generatingOutlines: outlines.filter((o) => !data.scenes.some((s) => s.order === o.order)),
        });
        log.info('Loaded from storage:', stageId);
      } else {
        log.warn('No data found for stage:', stageId);
      }
    } catch (error) {
      log.error('Failed to load from storage:', error);
      throw error;
    }
  },

  clearStore: () => {
    set((s) => ({
      stage: null,
      scenes: [],
      currentSceneId: null,
      chats: [],
      refineSessions: {},
      outlines: [],
      generationEpoch: s.generationEpoch + 1,
      generationStatus: 'idle' as const,
      currentGeneratingOrder: -1,
      failedOutlines: [],
      generatingOutlines: [],
      outlineGenerationStartTime: null,
    }));
    log.info('Store cleared');
  },
}));

export const useStageStore = createSelectors(useStageStoreBase);

// ==================== Debounced Save ====================

/**
 * Debounced version of saveToStorage to prevent excessive writes
 * Waits 500ms after the last change before saving
 */
const debouncedSave = debounce(() => {
  useStageStore.getState().saveToStorage();
}, 500);
