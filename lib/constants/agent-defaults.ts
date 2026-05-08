/**
 * Shared constants for agent profile generation.
 *
 * Used by both the client-side agent-profiles API route and the
 * server-side classroom-generation pipeline to keep colors / avatars in sync.
 */

/** Color palette cycled for generated agents */
export const AGENT_COLOR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#6366f1',
  '#84cc16',
  '#a855f7',
] as const;

/**
 * Default avatar paths cycled for generated agents.
 *
 * Every entry MUST correspond to a file that exists under `public/avatars/`.
 */
export const AGENT_DEFAULT_AVATARS = [
  '/avatars/teacher.png',
  '/avatars/assist.png',
  '/avatars/curious.png',
  '/avatars/thinker.png',
  '/avatars/note-taker.png',
  '/avatars/teacher-2.png',
  '/avatars/assist-2.png',
  '/avatars/curious-2.png',
  '/avatars/thinker-2.png',
  '/avatars/note-taker-2.png',
] as const;

/**
 * When agent profiles are generated before scene outlines exist, there is no
 * LLM-produced `languageDirective` yet. Map the course locale to a short
 * instruction the agent-profiles API expects.
 */
export function languageDirectiveFromCourseLocale(locale: string): string {
  const raw = (locale || 'zh-CN').trim() || 'zh-CN';
  let human: string;
  if (raw === 'zh-CN') human = 'Chinese (Simplified)';
  else if (raw === 'zh-TW') human = 'Chinese (Traditional)';
  else if (raw === 'en-US') human = 'English (US)';
  else if (raw.startsWith('en')) human = 'English';
  else if (raw.startsWith('ja')) human = 'Japanese';
  else if (raw.startsWith('ko')) human = 'Korean';
  else human = `the primary language associated with locale "${raw}"`;
  return (
    `Course locale is ${raw}. Write every agent name and persona in ${human}, the way real teachers and students would speak in that language. ` +
    `Keep standard technical or proper nouns (e.g. Python, API, DFS) in their usual form for that language community.`
  );
}
