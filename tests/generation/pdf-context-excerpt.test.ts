import { describe, test, expect } from 'vitest';
import { excerptPdfTextForPrompt } from '@/lib/generation/pdf-context-excerpt';
import { getMaxPdfContextChars } from '@/lib/constants/generation';

describe('excerptPdfTextForPrompt', () => {
  test('returns full text when under max', () => {
    const t = 'short';
    expect(excerptPdfTextForPrompt(t, 100)).toBe(t);
  });

  test('uses anchor window when 图的遍历 appears in long text', () => {
    const prefix = 'a'.repeat(8000);
    const anchor = '图的遍历与深度优先';
    const suffix = 'b'.repeat(8000);
    const full = prefix + anchor + suffix;
    const max = 2000;
    const out = excerptPdfTextForPrompt(full, max, '讲解5.3');
    expect(out).toContain(anchor);
    expect(out.length).toBeLessThanOrEqual(max + 400);
    expect(out).toMatch(/PDF 节选/);
  });

  test('uses head+tail when no anchor matches', () => {
    const full = 'START' + 'x'.repeat(12000) + 'END_UNIQUE_MARKER';
    const max = 3000;
    const out = excerptPdfTextForPrompt(full, max);
    expect(out).toContain('START');
    expect(out).toContain('END_UNIQUE_MARKER');
    expect(out).toMatch(/中间省略/);
  });
});

describe('getMaxPdfContextChars', () => {
  test('returns default when env unset', () => {
    const prev = process.env.PDF_CONTEXT_MAX_CHARS;
    delete process.env.PDF_CONTEXT_MAX_CHARS;
    const n = getMaxPdfContextChars();
    expect(n).toBeGreaterThan(0);
    if (prev !== undefined) process.env.PDF_CONTEXT_MAX_CHARS = prev;
  });
});
