'use client';

/**
 * Live TTS Hook — sentence-streaming approach
 *
 * Generates TTS per sentence as text streams in, so audio starts playing
 * while the agent is still typing. Each agent uses its own configured voice.
 *
 * How it works:
 * - `onLiveSpeech(text, agentId)` is called on every tick with the ACCUMULATED
 *   text so far for the current agent segment (grows character by character).
 * - We track `processedIdx`: how many characters we've already sent to TTS.
 * - When sentence boundaries appear in the new characters, we extract complete
 *   sentences and immediately queue them for TTS generation + playback.
 * - When the segment ends (text → null), we flush any remaining text.
 *
 * Audio queue plays items sequentially to avoid overlap.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { createLogger } from '@/lib/logger';
import { getAudioContext } from '@/lib/utils/audio-player';

const log = createLogger('LiveTTS');

// Sentence boundary: Chinese/English punctuation that ends a sentence
const SENTENCE_END_RE = /[.。!！?？\n]+/;

/** Split text at sentence boundaries; returns [sentences[], remainder] */
function extractSentences(text: string): [string[], string] {
  const sentences: string[] = [];
  let remaining = text;

  while (true) {
    const match = SENTENCE_END_RE.exec(remaining);
    if (!match) break;
    const end = match.index + match[0].length;
    const sentence = remaining.slice(0, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    remaining = remaining.slice(end);
  }

  return [sentences, remaining];
}

interface QueueItem {
  text: string;
  voice: string;
}

interface UseLiveTTSOptions {
  /** Whether to process speech at all. Defaults to true. */
  enabled?: boolean;
  /** Called when the audio queue becomes empty and playback has stopped. */
  onQueueEmpty?: () => void;
}

export function useLiveTTS(options: UseLiveTTSOptions = {}) {
  const onQueueEmptyRef = useRef(options.onQueueEmpty);
  const enabledRef = useRef(options.enabled ?? true);
  useEffect(() => {
    onQueueEmptyRef.current = options.onQueueEmpty;
  }, [options.onQueueEmpty]);
  useEffect(() => {
    enabledRef.current = options.enabled ?? true;
  }, [options.enabled]);
  // Per-segment tracking
  const processedIdxRef = useRef(0);      // chars already extracted into sentences
  const pendingAgentIdRef = useRef<string | null>(null);
  const remainderRef = useRef('');        // text after last sentence boundary

  // Audio queue
  const queueRef = useRef<QueueItem[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      currentAudioRef.current?.pause();
      currentAudioRef.current = null;
    };
  }, []);

  /** Resolve a voice for the given agent, falling back to global setting */
  const resolveVoice = useCallback((agentId: string | null): string => {
    const settings = useSettingsStore.getState();
    if (agentId) {
      const agent = useAgentRegistry.getState().getAgent(agentId);
      if (agent?.ttsVoice) return agent.ttsVoice;
    }
    return settings.ttsVoice;
  }, []);

  const playNext = useCallback(async () => {
    if (isPlayingRef.current || queueRef.current.length === 0 || !mountedRef.current) return;

    const item = queueRef.current.shift();
    if (!item) return;

    const settings = useSettingsStore.getState();
    if (settings.ttsMuted || !settings.ttsEnabled) return;

    isPlayingRef.current = true;

    try {
      const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
      const response = await fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.text,
          audioId: `live_tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ttsProviderId: settings.ttsProviderId,
          ttsVoice: item.voice,
          ttsSpeed: settings.ttsSpeed,
          ttsApiKey: ttsProviderConfig?.apiKey || undefined,
          ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
        }),
      });

      if (!response.ok || !mountedRef.current) {
        isPlayingRef.current = false;
        playNext();
        return;
      }

      const data = await response.json().catch(() => null);
      if (!data?.success || !data.base64 || !mountedRef.current) {
        log.warn('Live TTS failed:', data?.error);
        isPlayingRef.current = false;
        playNext();
        return;
      }

      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const afterPlay = () => {
        currentAudioRef.current = null;
        isPlayingRef.current = false;
        if (!mountedRef.current) return;
        if (queueRef.current.length === 0) {
          onQueueEmptyRef.current?.();
        }
        playNext();
      };

      // Try Web Audio API path using the shared AudioContext from audio-player.
      // That context is already unlocked when the user clicks Play (via unlockMobileAudio).
      // Using it here avoids Safari's per-play() autoplay restriction.
      const ctx = getAudioContext();
      if (ctx) {
        try {
          if (ctx.state === 'suspended') await ctx.resume();
          const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));

          await new Promise<void>((resolve) => {
            const gainNode = ctx.createGain();
            gainNode.gain.value = settings.ttsVolume ?? 1;
            gainNode.connect(ctx.destination);

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            source.onended = () => {
              resolve();
              afterPlay();
            };
            source.start(0);
          });
          return;
        } catch (audioCtxErr) {
          log.warn('AudioContext playback failed, falling back to HTMLAudio:', audioCtxErr);
        }
      }

      // HTMLAudioElement fallback
      const blob = new Blob([bytes], { type: `audio/${data.format}` });
      const url = URL.createObjectURL(blob);

      const audio = new Audio();
      audio.setAttribute("playsinline", "");
      audio.preload = 'auto';
      audio.volume = settings.ttsVolume ?? 1;
      currentAudioRef.current = audio;

      const cleanupHtml = () => {
        URL.revokeObjectURL(url);
        afterPlay();
      };
      audio.addEventListener('ended', cleanupHtml);
      audio.addEventListener('error', cleanupHtml);
      audio.src = url;
      await audio.play();
    } catch (err) {
      log.warn('Live TTS error:', err);
      isPlayingRef.current = false;
      if (mountedRef.current) playNext();
    }
  }, []);

  /** Enqueue a text chunk for TTS with the agent's voice */
  const enqueue = useCallback(
    (text: string, agentId: string | null) => {
      const t = text.trim();
      if (!t) return;
      const voice = resolveVoice(agentId);
      queueRef.current.push({ text: t, voice });
      playNext();
    },
    [resolveVoice, playNext],
  );

  /** Reset per-segment state */
  const resetSegment = useCallback(() => {
    processedIdxRef.current = 0;
    pendingAgentIdRef.current = null;
    remainderRef.current = '';
  }, []);

  /** Stop all playback and clear queue */
  const stopAll = useCallback(() => {
    queueRef.current = [];
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    isPlayingRef.current = false;
    resetSegment();
  }, [resetSegment]);

  /**
   * Called by stage.tsx onLiveSpeech on every tick.
   *
   * text  — accumulated text for current agent segment (grows each tick), or null when segment ends.
   * agentId — current speaking agent, or null when all done.
   */
  const onLiveSpeech = useCallback(
    (text: string | null, agentId: string | null | undefined) => {
      const settings = useSettingsStore.getState();
      if (!enabledRef.current || !settings.ttsEnabled || settings.ttsMuted) return;
      if (settings.ttsProviderId === 'browser-native-tts') return;

      if (text !== null) {
        const resolvedAgent = agentId ?? null;

        // Agent switched mid-stream → flush remainder for previous agent
        if (resolvedAgent !== pendingAgentIdRef.current && pendingAgentIdRef.current !== null) {
          enqueue(remainderRef.current, pendingAgentIdRef.current);
          resetSegment();
        }

        pendingAgentIdRef.current = resolvedAgent;

        // Delta: characters added since last call
        const newChars = text.slice(processedIdxRef.current);
        if (!newChars) return;
        processedIdxRef.current = text.length;

        // Append to remainder and extract complete sentences
        const combined = remainderRef.current + newChars;
        const [sentences, leftover] = extractSentences(combined);
        remainderRef.current = leftover;

        for (const sentence of sentences) {
          enqueue(sentence, resolvedAgent);
        }
      } else {
        // Segment ended — flush remainder
        if (remainderRef.current.trim()) {
          enqueue(remainderRef.current, pendingAgentIdRef.current);
        }
        resetSegment();
      }
    },
    [enqueue, resetSegment],
  );

  /** Returns true if audio is currently playing or queued. */
  const isActive = useCallback(
    () => isPlayingRef.current || queueRef.current.length > 0,
    [],
  );

  return { onLiveSpeech, stopAll, isActive };
}
