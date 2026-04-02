/**
 * Audio Player - Audio player interface
 *
 * Handles audio playback, pause, stop, and other operations
 * Loads pre-generated TTS audio files from IndexedDB
 *
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');

/**
 * Safari-compatible audio play helper.
 *
 * Safari (desktop and iOS) requires:
 * 1. The audio element is fully loaded (readyState >= HAVE_ENOUGH_DATA) before play()
 * 2. play() is called within a user-gesture context OR from a previously unlocked context
 * 3. On iOS, the audio element must have `playsInline` set
 *
 * This helper waits for `canplaythrough` if the element isn't ready yet, with a
 * reasonable timeout so it doesn't hang forever.
 */
async function safariCompatiblePlay(audio: HTMLAudioElement): Promise<void> {
  audio.playsInline = true;

  // If already loaded enough, just play
  if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
    await audio.play();
    return;
  }

  // Wait for canplaythrough (or error) before playing, with a 10 s guard
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      // Try playing anyway — some Safari versions never fire canplaythrough for blobs
      audio.play().then(resolve).catch(reject);
    }, 10_000);

    const onCanPlay = () => {
      cleanup();
      audio.play().then(resolve).catch(reject);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Audio load error: ${audio.error?.message ?? 'unknown'}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('error', onError);
    };

    audio.addEventListener('canplaythrough', onCanPlay);
    audio.addEventListener('error', onError);
    // Trigger load if not already started
    audio.load();
  });
}

/**
 * Audio player implementation
 */
export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private onEndedCallback: (() => void) | null = null;
  private muted: boolean = false;
  private volume: number = 1;
  private playbackRate: number = 1;

  /**
   * Play audio (from URL or IndexedDB pre-generated cache)
   * @param audioId Audio ID
   * @param audioUrl Optional server-generated audio URL (takes priority over IndexedDB)
   * @returns true if audio started playing, false if no audio (TTS disabled or not generated)
   */
  public async play(audioId: string, audioUrl?: string): Promise<boolean> {
    try {
      // 1. Try audioUrl first (server-generated TTS)
      if (audioUrl) {
        this.stop();
        const audio = new Audio();
        audio.playsInline = true;
        audio.preload = 'auto';
        if (this.muted) audio.volume = 0;
        else audio.volume = this.volume;
        audio.defaultPlaybackRate = this.playbackRate;
        audio.playbackRate = this.playbackRate;
        audio.addEventListener('ended', () => {
          this.onEndedCallback?.();
        });
        // Set src after attaching listeners (Safari requirement)
        audio.src = audioUrl;
        this.audio = audio;
        await safariCompatiblePlay(audio);
        audio.playbackRate = this.playbackRate;
        return true;
      }

      // 2. Fall back to IndexedDB (client-generated TTS)
      const audioRecord = await db.audioFiles.get(audioId);

      if (!audioRecord) {
        // Pre-generated audio does not exist (generation failed), skip silently
        return false;
      }

      // Stop current playback
      this.stop();

      const audio = new Audio();
      audio.playsInline = true;
      audio.preload = 'auto';

      const blobUrl = URL.createObjectURL(audioRecord.blob);

      if (this.muted) audio.volume = 0;
      else audio.volume = this.volume;

      audio.defaultPlaybackRate = this.playbackRate;
      audio.playbackRate = this.playbackRate;

      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(blobUrl);
        this.onEndedCallback?.();
      });

      // Set src after attaching listeners (Safari requirement)
      audio.src = blobUrl;
      this.audio = audio;

      await safariCompatiblePlay(audio);
      // Re-apply after play() — some browsers reset during load
      audio.playbackRate = this.playbackRate;
      return true;
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Pause playback
   */
  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  /**
   * Stop playback
   */
  public stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    // Note: onEndedCallback intentionally NOT cleared here because play()
    // calls stop() internally — clearing would break the callback chain.
    // Stale callbacks are harmless: engine mode check prevents processNext().
  }

  /**
   * Resume playback
   */
  public resume(): void {
    if (this.audio?.paused) {
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch((error) => {
        log.error('Failed to resume audio:', error);
      });
    }
  }

  /**
   * Get current playback status (actively playing, not paused)
   */
  public isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  /**
   * Whether there is active audio (playing or paused, but not ended)
   * Used to decide whether to resume playback or skip to the next line
   */
  public hasActiveAudio(): boolean {
    return this.audio !== null;
  }

  /**
   * Get current playback time (milliseconds)
   */
  public getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  /**
   * Get audio duration (milliseconds)
   */
  public getDuration(): number {
    return this.audio && !isNaN(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  /**
   * Set playback ended callback
   */
  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  /**
   * Set mute state (takes effect immediately on currently playing audio)
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
  }

  /**
   * Set volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * Set playback speed (takes effect immediately on currently playing audio)
   */
  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.audio) {
      this.audio.playbackRate = this.playbackRate;
    }
  }

  /**
   * Destroy the player
   */
  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
  }
}

/**
 * Create an audio player instance
 */
export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}

/**
 * Unlock audio playback on mobile/Safari browsers.
 *
 * iOS Safari and some Android browsers block audio until a direct user gesture
 * triggers playback. Call this synchronously inside a touch/click handler before
 * any async work so the browser grants audio permission for subsequent plays.
 *
 * Uses a minimal silent WAV (universally supported, including Safari) rather than
 * MP3 to ensure the audio element actually decodes on all platforms.
 */
export function unlockMobileAudio(): void {
  if (typeof window === 'undefined') return;

  try {
    // Minimal valid silent WAV (44-byte header + 0 samples)
    // WAV is universally supported including iOS Safari, whereas MP3 data URIs
    // can fail to decode on some Safari versions.
    const silentWav =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    const audio = new Audio();
    audio.playsInline = true;
    audio.src = silentWav;
    audio.volume = 0;
    audio.play().catch(() => {});
  } catch {
    // Ignore — best-effort unlock
  }
}
