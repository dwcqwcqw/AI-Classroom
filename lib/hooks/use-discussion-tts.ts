'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { useBrowserTTS } from '@/lib/hooks/use-browser-tts';
import {
  resolveAgentVoice,
  getAvailableProvidersWithVoices,
  type ResolvedVoice,
} from '@/lib/audio/voice-resolver';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { TTSProviderId } from '@/lib/audio/types';
import type { AudioIndicatorState } from '@/components/roundtable/audio-indicator';

interface DiscussionTTSOptions {
  enabled: boolean;
  agents: AgentConfig[];
  onAudioStateChange?: (agentId: string | null, state: AudioIndicatorState) => void;
}

interface QueueItem {
  messageId: string;
  partId: string;
  text: string;
  agentId: string | null;
  providerId: TTSProviderId;
  modelId?: string;
  voiceId: string;
}

export function useDiscussionTTS({ enabled, agents, onAudioStateChange }: DiscussionTTSOptions) {
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsMuted = useSettingsStore((s) => s.ttsMuted);
  const ttsVolume = useSettingsStore((s) => s.ttsVolume);
  const playbackSpeed = useSettingsStore((s) => s.playbackSpeed);
  const globalTtsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const globalTtsVoice = useSettingsStore((s) => s.ttsVoice);

  const queueRef = useRef<QueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const pausedRef = useRef(false);
  const currentProviderRef = useRef<TTSProviderId | null>(null);
  const segmentDoneCounterRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onAudioStateChangeRef = useRef(onAudioStateChange);
  onAudioStateChangeRef.current = onAudioStateChange;
  const processQueueRef = useRef<() => void>(() => {});

  /**
   * Lookahead cache: keyed by partId, stores pre-generated audio (base64 data URL).
   * Speeds up the next queue item by skipping the API round-trip entirely.
   */
  const lookaheadCache = useRef<Map<string, { audioUrl: string; format: string }> | null>(new Map());
  /** Active lookahead fetch partIds (prevents duplicate concurrent fetches for the same item) */
  const lookaheadPending = useRef<Set<string> | null>(new Set());

  const {
    speak: browserSpeak,
    pause: browserPause,
    resume: browserResume,
    cancel: browserCancel,
  } = useBrowserTTS({
    rate: ttsSpeed,
    onEnd: () => {
      isPlayingRef.current = false;
      segmentDoneCounterRef.current++;
      onAudioStateChangeRef.current?.(null, 'idle');
      if (!pausedRef.current) processQueueRef.current();
    },
  });
  const browserCancelRef = useRef(browserCancel);
  browserCancelRef.current = browserCancel;
  const browserSpeakRef = useRef(browserSpeak);
  browserSpeakRef.current = browserSpeak;
  const browserPauseRef = useRef(browserPause);
  browserPauseRef.current = browserPause;
  const browserResumeRef = useRef(browserResume);
  browserResumeRef.current = browserResume;

  const agentIndexMap = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const map = new Map<string, number>();
    agents.forEach((agent, i) => map.set(agent.id, i));
    agentIndexMap.current = map;
  }, [agents]);

  const resolveVoiceForAgent = useCallback(
    (agentId: string | null): ResolvedVoice => {
      const providers = getAvailableProvidersWithVoices(ttsProvidersConfig);
      if (!agentId) {
        if (providers.length > 0) {
          return { providerId: providers[0].providerId, voiceId: providers[0].voices[0]?.id ?? 'default' };
        }
        return { providerId: 'browser-native-tts', voiceId: 'default' };
      }
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        if (providers.length > 0) {
          return { providerId: providers[0].providerId, voiceId: providers[0].voices[0]?.id ?? 'default', modelId: undefined };
        }
        return { providerId: 'browser-native-tts', voiceId: 'default', modelId: undefined };
      }
      if (agent.role === 'teacher') {
        return {
          providerId: globalTtsProviderId,
          voiceId: globalTtsVoice,
          modelId: ttsProvidersConfig[globalTtsProviderId]?.modelId,
        };
      }
      const index = agentIndexMap.current.get(agentId) ?? 0;
      return resolveAgentVoice(agent, index, providers);
    },
    [agents, ttsProvidersConfig, globalTtsProviderId, globalTtsVoice],
  );

  /** Kick off a background TTS fetch for the next queued item, caching the result. */
  const triggerLookahead = useCallback(
    (nextItem: QueueItem) => {
      if (nextItem.providerId === 'browser-native-tts') return;
      if (lookaheadCache.current!.has(nextItem.partId) || lookaheadPending.current!.has(nextItem.partId)) return;
      const config = ttsProvidersConfig[nextItem.providerId];
      lookaheadPending.current!.add(nextItem.partId);
      fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: nextItem.text,
          audioId: nextItem.partId,
          ttsProviderId: nextItem.providerId,
          ttsModelId: nextItem.modelId || config?.modelId,
          ttsVoice: nextItem.voiceId,
          ttsSpeed,
          ttsApiKey: config?.apiKey,
          ttsBaseUrl: config?.serverBaseUrl || config?.baseUrl,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.base64) {
            lookaheadCache.current!.set(nextItem.partId, {
              audioUrl: `data:audio/${data.format || 'mp3'};base64,${data.base64}`,
              format: data.format || 'mp3',
            });
          }
        })
        .catch(() => {})
        .finally(() => { lookaheadPending.current!.delete(nextItem.partId); });
    },
    [ttsProvidersConfig, ttsSpeed],
  );

  /** Attach standard ended/error listeners to an HTMLAudioElement and track it in audioRef. */
  const attachListeners = (audio: HTMLAudioElement, agentId: string | null) => {
    const handleDone = () => {
      audioRef.current = null;
      isPlayingRef.current = false;
      segmentDoneCounterRef.current++;
      onAudioStateChangeRef.current?.(agentId, 'idle');
      if (!pausedRef.current) queueMicrotask(() => processQueueRef.current());
    };
    audio.addEventListener('ended', handleDone);
    audio.addEventListener('error', handleDone);
  };

  const processQueue = useCallback(async () => {
    if (pausedRef.current) return;
    if (isPlayingRef.current || queueRef.current.length === 0) return;
    if (!enabled || ttsMuted) {
      queueRef.current = [];
      return;
    }

    isPlayingRef.current = true;
    const item = queueRef.current.shift()!;

    if (item.providerId === 'browser-native-tts') {
      currentProviderRef.current = item.providerId;
      onAudioStateChangeRef.current?.(item.agentId, 'playing');
      browserSpeakRef.current(item.text, item.voiceId);
      return;
    }

    currentProviderRef.current = item.providerId;
    onAudioStateChangeRef.current?.(item.agentId, 'generating');
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const config = ttsProvidersConfig[item.providerId];

      // Fast path: reuse pre-generated audio from lookahead cache (zero latency)
      const cached = lookaheadCache.current!.get(item.partId);
      if (cached) {
        lookaheadCache.current!.delete(item.partId);
        const audio = new Audio(cached.audioUrl);
        audio.playbackRate = playbackSpeed;
        audio.volume = ttsMuted ? 0 : ttsVolume;
        audioRef.current = audio;
        attachListeners(audio, item.agentId);
        if (pausedRef.current) { onAudioStateChangeRef.current?.(item.agentId, 'playing'); audio.pause(); return; }
        onAudioStateChangeRef.current?.(item.agentId, 'playing');
        await audio.play();
        if (queueRef.current.length > 0) triggerLookahead(queueRef.current[0]);
        return;
      }

      // Normal path: call TTS API
      const res = await fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.text,
          audioId: item.partId,
          ttsProviderId: item.providerId,
          ttsModelId: item.modelId || config?.modelId,
          ttsVoice: item.voiceId,
          ttsSpeed,
          ttsApiKey: config?.apiKey,
          ttsBaseUrl: config?.serverBaseUrl || config?.baseUrl,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`TTS API error: ${res.status}`);
      const data = await res.json();
      if (!data.base64) throw new Error('No audio in response');

      const audioUrl = `data:audio/${data.format || 'mp3'};base64,${data.base64}`;
      const audio = new Audio(audioUrl);
      audio.playbackRate = playbackSpeed;
      audio.volume = ttsMuted ? 0 : ttsVolume;
      audioRef.current = audio;
      attachListeners(audio, item.agentId);

      if (pausedRef.current) { onAudioStateChangeRef.current?.(item.agentId, 'playing'); audio.pause(); return; }
      onAudioStateChangeRef.current?.(item.agentId, 'playing');
      await audio.play();

      // While audio plays, pre-generate the next TTS in the background
      if (queueRef.current.length > 0) triggerLookahead(queueRef.current[0]);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[DiscussionTTS] TTS generation failed:', err);
      }
      audioRef.current = null;
      isPlayingRef.current = false;
      segmentDoneCounterRef.current++;
      onAudioStateChangeRef.current?.(item.agentId, 'idle');
      if (!pausedRef.current) queueMicrotask(() => processQueueRef.current());
    }
  }, [enabled, ttsMuted, ttsVolume, ttsProvidersConfig, ttsSpeed, playbackSpeed, triggerLookahead]);

  processQueueRef.current = processQueue;

  const handleSegmentSealed = useCallback(
    (messageId: string, partId: string, fullText: string, agentId: string | null) => {
      if (!enabled || ttsMuted || !fullText.trim()) return;

      const { providerId, modelId, voiceId } = resolveVoiceForAgent(agentId);
      queueRef.current.push({ messageId, partId, text: fullText, agentId, providerId, modelId, voiceId });

      if (!isPlayingRef.current) {
        processQueueRef.current();
      } else if (providerId !== 'browser-native-tts') {
        onAudioStateChangeRef.current?.(agentId, 'generating');
      }
    },
    [enabled, ttsMuted, resolveVoiceForAgent],
  );

  const cleanup = useCallback(() => {
    pausedRef.current = false;
    currentProviderRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    browserCancelRef.current();
    queueRef.current = [];
    lookaheadCache.current!.clear();
    lookaheadPending.current!.clear();
    isPlayingRef.current = false;
    segmentDoneCounterRef.current = 0;
    onAudioStateChangeRef.current?.(null, 'idle');
  }, []);

  const pause = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    if (currentProviderRef.current === 'browser-native-tts') {
      browserPauseRef.current();
    } else if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    if (currentProviderRef.current === 'browser-native-tts') {
      browserResumeRef.current();
    } else if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play();
    } else if (!isPlayingRef.current) {
      processQueueRef.current();
    }
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = ttsMuted ? 0 : ttsVolume;
  }, [ttsVolume, ttsMuted]);

  useEffect(() => cleanup, [cleanup]);

  const shouldHold = useCallback(() => {
    return {
      holding: isPlayingRef.current || queueRef.current.length > 0,
      segmentDone: segmentDoneCounterRef.current,
    };
  }, []);

  return { handleSegmentSealed, cleanup, pause, resume, shouldHold };
}