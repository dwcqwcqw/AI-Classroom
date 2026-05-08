import { describe, test, expect } from 'vitest';
import {
  ttsSceneConcurrencyForProvider,
  isLikelyTtsRateLimitError,
} from '@/lib/audio/tts-utils';

describe('ttsSceneConcurrencyForProvider', () => {
  test('qwen-tts is strictly sequential', () => {
    expect(ttsSceneConcurrencyForProvider('qwen-tts')).toBe(1);
  });

  test('other providers allow limited parallelism', () => {
    expect(ttsSceneConcurrencyForProvider('minimax-tts')).toBe(3);
  });
});

describe('isLikelyTtsRateLimitError', () => {
  test('detects DashScope throttling JSON', () => {
    expect(
      isLikelyTtsRateLimitError(
        'Qwen TTS API error: {"code":"Throttling.RateQuota","message":"Requests rate limit exceeded"}',
      ),
    ).toBe(true);
  });

  test('false for unrelated errors', () => {
    expect(isLikelyTtsRateLimitError('Invalid API key')).toBe(false);
  });
});
