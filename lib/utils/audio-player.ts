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

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');

// ─── Shared AudioContext (one per page, unlocked once) ───────────────────────

let sharedContext: AudioContext | null = null;

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

async function fetchAudioBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
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

  /**
   * Play audio from a URL or IndexedDB cache.
   * Returns true if audio started, false if no audio available.
   */
  public async play(audioId: string, audioUrl?: string): Promise<boolean> {
    try {
      await ensureContextRunning();
      const ctx = getAudioContext();

      // ── Try Web Audio API path ──────────────────────────────────────────────
      if (ctx) {
        let bytes: ArrayBuffer | null = null;

        if (audioUrl) {
          // Server-generated audio URL
          try {
            bytes = await fetchAudioBytes(audioUrl);
          } catch (e) {
            log.warn('Audio URL fetch failed, will try HTMLAudio fallback:', e);
          }
        } else {
          // IndexedDB blob
          const record = await db.audioFiles.get(audioId);
          if (!record) return false;
          try {
            bytes = await blobToArrayBuffer(record.blob);
          } catch (e) {
            log.warn('Blob→ArrayBuffer failed, will try HTMLAudio fallback:', e);
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

      // ── HTMLAudioElement fallback ───────────────────────────────────────────
      return this.playWithHTMLAudio(audioId, audioUrl);
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /** HTMLAudioElement fallback for environments without Web Audio support */
  private async playWithHTMLAudio(audioId: string, audioUrl?: string): Promise<boolean> {
    let src: string | null = null;
    let needsRevoke = false;

    if (audioUrl) {
      src = audioUrl;
    } else {
      const record = await db.audioFiles.get(audioId);
      if (!record) return false;
      src = URL.createObjectURL(record.blob);
      needsRevoke = true;
    }

    return new Promise<boolean>((resolve, reject) => {
      const audio = document.createElement('audio');
      audio.setAttribute('playsinline', '');
      audio.preload = 'auto';

      const cleanup = () => {
        if (needsRevoke && src) URL.revokeObjectURL(src);
      };

      audio.addEventListener('ended', () => {
        cleanup();
        this.onEndedCallback?.();
      });
      audio.addEventListener('error', () => {
        cleanup();
        reject(new Error('HTMLAudio playback error'));
      });

      audio.src = src!;
      audio.volume = this.muted ? 0 : this.volume;

      audio.play()
        .then(() => resolve(true))
        .catch((e) => {
          cleanup();
          reject(e);
        });
    });
  }

  public pause(): void {
    if (!this.active) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const elapsed = ctx.currentTime - this.active.startedAt;
    this.active.pausedAt = elapsed;
    try { this.active.source.stop(); } catch { /* ignore */ }
    // Keep active so resume() knows the buffer + offset
  }

  public resume(): void {
    if (!this.active || this.active.pausedAt === null) return;
    const offset = this.active.pausedAt;
    const buffer = this.active.buffer;
    // Clear active first so startBuffer doesn't try to stop a stopped source
    this.active = null;
    ensureContextRunning().then(() => {
      this.startBuffer(buffer, offset);
    });
  }

  public stop(): void {
    this.stopActiveNode();
  }

  public isPlaying(): boolean {
    if (!this.active) return false;
    return this.active.pausedAt === null;
  }

  public hasActiveAudio(): boolean {
    return this.active !== null;
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
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.active && !this.muted) {
      this.active.gainNode.gain.value = this.volume;
    }
  }

  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.active) {
      this.active.source.playbackRate.value = this.playbackRate;
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
