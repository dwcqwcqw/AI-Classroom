/**
 * Audio Player — Safari-compatible implementation using Web Audio API
 *
 * Uses AudioContext (Web Audio API) which, once unlocked by a single user gesture,
 * stays unlocked for the entire session. This avoids Safari's strict per-play()
 * autoplay policy that blocks HTMLAudioElement.play() called after async gaps
 * (e.g. after an IndexedDB read).
 *
 * Falls back to HTMLAudioElement for environments where AudioContext is unavailable.
 */

import { useSettingsStore } from '@/lib/store/settings';
import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');

// ─── Shared AudioContext (one per page, unlocked once) ───────────────────────

let sharedContext: AudioContext | null = null;

// ─── Audio Buffer Cache (in-memory, for preloading) ──────────────────────────

interface CachedBuffer {
  buffer: AudioBuffer;
  fetchedAt: number;
}

/** In-memory cache: audioId → decoded AudioBuffer
 *  Keeps up to 20 entries (≈ 20 × 1 MB = 20 MB max). */
const audioCache = new Map<string, CachedBuffer>();
const MAX_CACHE_ENTRIES = 20;

function cacheAudioBuffer(audioId: string, buffer: AudioBuffer): void {
  if (audioCache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of audioCache) {
      if (v.fetchedAt < oldestTime) {
        oldestTime = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) audioCache.delete(oldestKey);
  }
  audioCache.set(audioId, { buffer, fetchedAt: Date.now() });
}

function getCachedBuffer(audioId: string): AudioBuffer | null {
  return audioCache.get(audioId)?.buffer ?? null;
}

/** Fetch + decode a single audioId and store in cache. Returns the buffer (or null). */
async function fetchAndDecode(
  audioId: string,
  signal?: AbortSignal,
): Promise<{ id: string; buffer: AudioBuffer | null }> {
  const cached = getCachedBuffer(audioId);
  if (cached) return { id: audioId, buffer: cached };

  const record = await db.audioFiles.get(audioId).catch(() => undefined);
  if (!record?.ossKey) return { id: audioId, buffer: null };

  let bytes: ArrayBuffer;
  try {
    bytes = await fetchAudioBytes(record.ossKey, signal);
  } catch {
    return { id: audioId, buffer: null };
  }

  const ctx = getAudioContext();
  if (!ctx) return { id: audioId, buffer: null };

  try {
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    cacheAudioBuffer(audioId, buffer);
    return { id: audioId, buffer };
  } catch {
    return { id: audioId, buffer: null };
  }
}

/**
 * Preload multiple audio files in parallel with abort support and progress callback.
 * Call this as early as possible — even while scenes are still loading from server.
 *
 * @param audioIds       Array of audioId strings to prefetch. Duplicates are ignored.
 * @param options.concurrency  Max simultaneous fetches. Default 8.
 * @param options.signal       AbortSignal to cancel in-flight requests on page unload.
 * @param options.onProgress   Called each time an audio finishes: (loaded, total).
 * @returns Promise that resolves when all audio is prefetched (or aborted).
 */
export function preloadAudio(
  audioIds: string[],
  {
    concurrency = 8,
    signal,
    onProgress,
  }: {
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
  } = {},
): Promise<void> {
  const unique = [...new Set(audioIds.filter(Boolean))];
  const total = unique.length;
  if (total === 0) return Promise.resolve();

  if (signal?.aborted) return Promise.resolve();

  let loaded = 0;
  const queue = [...unique];
  const workers: Promise<void>[] = [];

  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const id = queue.shift()!;
      await fetchAndDecode(id, signal).catch(() => {});
      if (signal?.aborted) break;
      loaded++;
      onProgress?.(loaded, total);
    }
  };

  for (let i = 0; i < Math.min(concurrency, total); i++) {
    workers.push(worker());
  }

  return Promise.all(workers).then(() => {});
}

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedContext || sharedContext.state === 'closed') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (AC) sharedContext = new AC();
    } catch {
      sharedContext = null;
    }
  }
  return sharedContext;
}

/** Resume the AudioContext if it was suspended (required after page load on Safari) */
async function ensureContextRunning(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // ignore
    }
  }
}

// ─── Fetch audio bytes ────────────────────────────────────────────────────────

async function fetchAudioBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

function withTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

interface GenerateFallbackAudioOptions {
  text?: string;
  stageId?: string;
  voiceOverride?: string;
}

interface PlayAudioOptions extends GenerateFallbackAudioOptions {
  audioUrl?: string;
}

// ─── AudioContext-based player ────────────────────────────────────────────────

interface ActiveNode {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  startedAt: number;       // ctx.currentTime when started
  pausedAt: number | null; // offset within buffer when paused
  buffer: AudioBuffer;
}

export class AudioPlayer {
  private active: ActiveNode | null = null;
  private htmlAudio: HTMLAudioElement | null = null;
  private onEndedCallback: (() => void) | null = null;
  private muted: boolean = false;
  private volume: number = 1;
  private playbackRate: number = 1;

  /** Decode bytes → AudioBuffer via Web Audio API */
  private async decode(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    const ctx = getAudioContext();
    if (!ctx) return null;
    try {
      return await ctx.decodeAudioData(bytes.slice(0)); // slice to detach
    } catch (e) {
      log.warn('AudioContext decode failed, falling back to HTMLAudio:', e);
      return null;
    }
  }

  /** Start playback of an AudioBuffer from a given offset */
  private startBuffer(buffer: AudioBuffer, offset = 0): void {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Stop any current node
    this.stopActiveNode();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.playbackRate;

    const gainNode = ctx.createGain();
    gainNode.gain.value = this.muted ? 0 : this.volume;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.onended = () => {
      // Only fire if this source is still the active one (not stopped manually)
      if (this.active?.source === source) {
        this.active = null;
        this.onEndedCallback?.();
      }
    };

    source.start(0, offset);

    this.active = {
      source,
      gainNode,
      buffer,
      startedAt: ctx.currentTime - offset,
      pausedAt: null,
    };
  }

  private stopActiveNode(): void {
    if (this.active) {
      try { this.active.source.onended = null; } catch { /* ignore */ }
      try { this.active.source.stop(); } catch { /* ignore */ }
      this.active = null;
    }
  }

  private stopHtmlAudio(): void {
    if (this.htmlAudio) {
      this.htmlAudio.pause();
      this.htmlAudio.src = '';
      this.htmlAudio.removeEventListener('ended', this._htmlEndedHandler);
      this.htmlAudio.removeEventListener('error', this._htmlErrorHandler);
      this.htmlAudio = null;
    }
  }

  // Bound handlers so we can remove them reliably
  private _htmlEndedHandler = () => {
    this.htmlAudio = null;
    this.onEndedCallback?.();
  };
  private _htmlErrorHandler = () => {
    this.htmlAudio = null;
  };

  /**
   * Play audio from a URL or R2 (via ossKey in IndexedDB).
   * Returns true if audio started, false if no audio available.
   */
  public async play(audioId: string, audioUrlOrOptions?: string | PlayAudioOptions): Promise<boolean> {
    const options: PlayAudioOptions =
      typeof audioUrlOrOptions === 'string' ? { audioUrl: audioUrlOrOptions } : (audioUrlOrOptions ?? {});

    try {
      await ensureContextRunning();
      const ctx = getAudioContext();

      // ── Try Web Audio API path ──────────────────────────────────────────────
      if (ctx) {
        let bytes: ArrayBuffer | null = null;

        // 0. Check in-memory buffer cache (instant, no network)
        const cached = getCachedBuffer(audioId);
        if (cached) {
          this.startBuffer(cached);
          return true;
        }

        // Priority 1: Pre-generated audio URL from R2 (audioId via IndexedDB lookup)
        // This handles all pre-generated lecture audio stored in R2.
        // We skip audioUrl if audioId is provided (R2 takes precedence for pre-generated audio).
        if (audioId) {
          const record = await db.audioFiles.get(audioId).catch(() => undefined);
          if (record?.ossKey) {
            try {
              bytes = await fetchAudioBytes(record.ossKey);
            } catch (e) {
              log.warn('R2 audio fetch failed:', e);
            }
          }
        }

        // Priority 2: Server-generated audio URL (if no R2 audio found)
        if (!bytes && options.audioUrl) {
          try {
            bytes = await fetchAudioBytes(options.audioUrl);
          } catch (e) {
            log.warn('Audio URL fetch failed:', e);
          }
        }

        if (bytes) {
          const buffer = await this.decode(bytes);
          if (buffer) {
            this.startBuffer(buffer);
            return true;
          }
        }
      }

      // ── Fallback: HTMLAudioElement (no TTS generation for playback) ─────────
      // Only play pre-generated audio — do not generate TTS for lecture content.
      // TTS generation is reserved for real-time Q&A/discussion only.
      return this.playWithHTMLAudio(audioId, options.audioUrl);
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /** HTMLAudioElement fallback - only plays pre-generated audio (no TTS generation) */
  private async playWithHTMLAudio(audioId: string, audioUrl?: string): Promise<boolean> {
    // Stop any previously playing HTMLAudio before starting a new one
    this.stopHtmlAudio();

    let src: string | null = null;

    if (audioId) {
      const record = await db.audioFiles.get(audioId).catch(() => undefined);
      if (record?.ossKey) {
        src = record.ossKey;
      }
    }

    if (!src && audioUrl) {
      src = audioUrl;
    }

    if (!src) return false;

    return new Promise<boolean>((resolve, reject) => {
      const audio = document.createElement('audio');
      audio.setAttribute('playsinline', '');
      audio.preload = 'auto';
      audio.volume = this.muted ? 0 : this.volume;

      audio.addEventListener('ended', this._htmlEndedHandler);
      audio.addEventListener('error', this._htmlErrorHandler);

      audio.src = src!;
      this.htmlAudio = audio;

      audio.play()
        .then(() => resolve(true))
        .catch((e) => {
          this.htmlAudio = null;
          reject(e);
        });
    });
  }

  private async generateFallbackAudio(
    audioId: string,
    options: GenerateFallbackAudioOptions,
  ): Promise<ArrayBuffer | null> {
    const { text, stageId, voiceOverride } = options;
    if (!text || !stageId) return null;

    const settings = useSettingsStore.getState();
    if (!settings.ttsEnabled || settings.ttsProviderId === 'browser-native-tts') {
      return null;
    }

    const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
    const response = await fetch('/api/generate/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        audioId,
        stageId,
        ttsProviderId: settings.ttsProviderId,
        ttsModelId: ttsProviderConfig?.modelId,
        ttsVoice: voiceOverride || settings.ttsVoice,
        ttsSpeed: settings.ttsSpeed,
        ttsApiKey: ttsProviderConfig?.apiKey || undefined,
        ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
      }),
      signal: withTimeout(25_000),
    });

    const data = await response
      .json()
      .catch(() => ({ success: false, error: response.statusText || 'Invalid TTS response' }));
    if (!response.ok || !data.success || !data.base64 || !data.format) {
      log.warn('Real-time TTS fallback failed for', audioId, data.error || response.statusText);
      return null;
    }

    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Store metadata in IndexedDB (ossKey is required - audio is in R2)
    await db.audioFiles.put({
      id: audioId,
      format: data.format,
      text,
      voice: voiceOverride || settings.ttsVoice,
      createdAt: Date.now(),
      ossKey: data.url || '',
    });

    return bytes.buffer;
  }

  public pause(): void {
    // Web Audio API path
    if (this.active) {
      const ctx = getAudioContext();
      if (ctx) {
        const elapsed = ctx.currentTime - this.active.startedAt;
        this.active.pausedAt = elapsed;
        try { this.active.source.stop(); } catch { /* ignore */ }
        // Keep active so resume() knows the buffer + offset
      }
    }
    // HTMLAudioElement path
    if (this.htmlAudio) {
      try { this.htmlAudio.pause(); } catch { /* ignore */ }
    }
  }

  public resume(): void {
    // Web Audio API path
    if (this.active && this.active.pausedAt !== null) {
      const offset = this.active.pausedAt;
      const buffer = this.active.buffer;
      this.active = null;
      ensureContextRunning().then(() => {
        this.startBuffer(buffer, offset);
      });
    }
    // HTMLAudioElement path — no reliable resume without pre-buffering
  }

  public stop(): void {
    this.stopActiveNode();
    this.stopHtmlAudio();
  }

  public isPlaying(): boolean {
    if (this.active) return this.active.pausedAt === null;
    if (this.htmlAudio) {
      try { return !this.htmlAudio.paused; } catch { return false; }
    }
    return false;
  }

  public hasActiveAudio(): boolean {
    return this.active !== null || this.htmlAudio !== null;
  }

  public getCurrentTime(): number {
    if (!this.active) return 0;
    const ctx = getAudioContext();
    if (!ctx) return 0;
    if (this.active.pausedAt !== null) return this.active.pausedAt * 1000;
    return (ctx.currentTime - this.active.startedAt) * 1000;
  }

  public getDuration(): number {
    if (!this.active) return 0;
    return this.active.buffer.duration * 1000;
  }

  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.active) {
      this.active.gainNode.gain.value = muted ? 0 : this.volume;
    }
    if (this.htmlAudio) {
      this.htmlAudio.volume = muted ? 0 : this.volume;
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.active && !this.muted) {
      this.active.gainNode.gain.value = this.volume;
    }
    if (this.htmlAudio && !this.muted) {
      this.htmlAudio.volume = this.volume;
    }
  }

  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.active) {
      this.active.source.playbackRate.value = this.playbackRate;
    }
    if (this.htmlAudio) {
      this.htmlAudio.playbackRate = this.playbackRate;
    }
  }

  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
  }
}

export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}

/**
 * Unlock the shared AudioContext on first user gesture.
 *
 * Call this synchronously in a click/touch handler. Once the AudioContext
 * is resumed, all subsequent play() calls work without user-gesture restriction —
 * including calls made after async gaps (IndexedDB reads, fetch, etc.).
 *
 * This is the correct fix for Safari's audio autoplay policy.
 */
export function unlockMobileAudio(): void {
  if (typeof window === 'undefined') return;

  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  // Also play a zero-length silent buffer to fully unlock (some iOS versions require this)
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // ignore
  }
}
