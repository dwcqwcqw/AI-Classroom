/**
 * Merge consecutive "thin" quiz outlines (typically 1 question each) into a single
 * quiz scene so playback shows one page with many questions instead of N pages × 1.
 */

import { nanoid } from 'nanoid';
import type { SceneOutline } from '@/lib/types/generation';

function questionsPerQuizScene(o: SceneOutline): number {
  if (o.type !== 'quiz') return Number.POSITIVE_INFINITY;
  const n = o.quizConfig?.questionCount;
  if (n === undefined || n === null) return 1;
  return n;
}

function mergeQuestionTypes(group: SceneOutline[]): ('single' | 'multiple' | 'text')[] {
  const seen = new Set<string>();
  for (const g of group) {
    for (const t of g.quizConfig?.questionTypes || []) {
      seen.add(t);
    }
  }
  if (seen.size === 0) return ['single', 'multiple', 'text'];
  return Array.from(seen) as ('single' | 'multiple' | 'text')[];
}

/**
 * Collapse runs of consecutive quiz outlines where each scene requests at most one
 * question into a single quiz outline with summed questionCount.
 */
export function consolidateConsecutiveThinQuizOutlines(outlines: SceneOutline[]): SceneOutline[] {
  if (outlines.length <= 1) return outlines;

  const merged: SceneOutline[] = [];
  let i = 0;

  while (i < outlines.length) {
    const cur = outlines[i];
    if (!cur) {
      i++;
      continue;
    }

    if (cur.type !== 'quiz' || questionsPerQuizScene(cur) > 1) {
      merged.push(cur);
      i++;
      continue;
    }

    const group: SceneOutline[] = [cur];
    let j = i + 1;
    while (j < outlines.length) {
      const next = outlines[j];
      if (!next || next.type !== 'quiz' || questionsPerQuizScene(next) > 1) break;
      group.push(next);
      j++;
    }

    if (group.length === 1) {
      merged.push(group[0]!);
      i = j;
      continue;
    }

    const totalQuestions = group.reduce((sum, g) => sum + (g.quizConfig?.questionCount ?? 1), 0);
    const first = group[0]!;
    const difficulties = group
      .map((g) => g.quizConfig?.difficulty)
      .filter(Boolean) as Array<'easy' | 'medium' | 'hard'>;
    let difficulty: 'easy' | 'medium' | 'hard' = 'easy';
    if (difficulties.includes('hard')) difficulty = 'hard';
    else if (difficulties.includes('medium')) difficulty = 'medium';

    const titleHasQuizCue = /测验|quiz|小测|练习|题/i.test(first.title);
    const title = titleHasQuizCue
      ? `${first.title.replace(/\s*[(（]\s*\d+\s*题\s*[)）]\s*$/i, '').trim()}（${totalQuestions}道题）`
      : `随堂测验（${totalQuestions}道题）`;

    const keyPoints = Array.from(
      new Set(group.flatMap((g) => (Array.isArray(g.keyPoints) ? g.keyPoints : []))),
    ).slice(0, 12);

    merged.push({
      ...first,
      id: first.id || nanoid(),
      title,
      description:
        group.length > 1
          ? `本测验共 ${totalQuestions} 道题，覆盖：${keyPoints.slice(0, 3).join('；') || '核心知识点'}。`
          : first.description,
      keyPoints: keyPoints.length > 0 ? keyPoints : first.keyPoints,
      quizConfig: {
        questionCount: totalQuestions,
        difficulty,
        questionTypes: mergeQuestionTypes(group),
      },
    });

    i = j;
  }

  return merged.map((o, idx) => ({ ...o, order: idx + 1 }));
}
