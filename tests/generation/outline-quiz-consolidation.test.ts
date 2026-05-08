import { describe, it, expect } from 'vitest';
import { consolidateConsecutiveThinQuizOutlines } from '@/lib/generation/outline-quiz-consolidation';
import type { SceneOutline } from '@/lib/types/generation';

function thinQuiz(
  id: string,
  order: number,
  title: string,
  qc?: Partial<NonNullable<SceneOutline['quizConfig']>>,
): SceneOutline {
  return {
    id,
    type: 'quiz',
    title,
    description: 'd',
    keyPoints: [`k-${id}`],
    order,
    quizConfig: {
      questionCount: qc?.questionCount ?? 1,
      difficulty: qc?.difficulty ?? 'medium',
      questionTypes: qc?.questionTypes ?? ['single'],
    },
  };
}

describe('consolidateConsecutiveThinQuizOutlines', () => {
  it('merges eight 1-question quizzes into one scene', () => {
    const input: SceneOutline[] = Array.from({ length: 8 }, (_, i) =>
      thinQuiz(`q${i}`, i + 1, `小测 ${i + 1}`),
    );
    const out = consolidateConsecutiveThinQuizOutlines(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('quiz');
    expect(out[0]!.quizConfig?.questionCount).toBe(8);
    expect(out[0]!.order).toBe(1);
  });

  it('does not merge across a multi-question quiz', () => {
    const input: SceneOutline[] = [
      thinQuiz('a', 1, 'A'),
      thinQuiz('b', 2, 'B', { questionCount: 3 }),
      thinQuiz('c', 3, 'C'),
    ];
    const out = consolidateConsecutiveThinQuizOutlines(input);
    expect(out).toHaveLength(3);
    expect(out[1]!.quizConfig?.questionCount).toBe(3);
  });

  it('merges only leading thin run then keeps slide', () => {
    const input: SceneOutline[] = [
      thinQuiz('a', 1, 'Q1'),
      thinQuiz('b', 2, 'Q2'),
      {
        id: 's',
        type: 'slide',
        title: 'S',
        description: '',
        keyPoints: ['x'],
        order: 3,
      },
      thinQuiz('c', 4, 'Q3'),
    ];
    const out = consolidateConsecutiveThinQuizOutlines(input);
    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe('quiz');
    expect(out[0]!.quizConfig?.questionCount).toBe(2);
    expect(out[1]!.type).toBe('slide');
    expect(out[2]!.quizConfig?.questionCount).toBe(1);
  });
});
