/**
 * Prompt and context building utilities for the generation pipeline.
 */

import type { PdfImage, UserRequirements } from '@/lib/types/generation';
import type { AgentInfo, SceneGenerationContext } from './pipeline-types';

/**
 * Rich block for slide/quiz/interactive/PBL *action* prompts so speech JSON matches
 * the course language (outline LLM `languageDirective`), not English examples.
 */
export function formatLanguageDirectiveBlock(languageDirective?: string): string {
  const t = (languageDirective || '').trim();
  if (t) {
    return `${t}\n\nEvery speech line you output (\`type:"text"\`, field \`content\`) MUST follow this directive. Do not switch to English unless the directive explicitly allows bilingual or English output.`;
  }
  return `The slide title and key points define the teaching language. If they are in Chinese, write ALL speech in Simplified Chinese. Do not default to English narration when the slide context is Chinese.`;
}

/** Build a course context string for injection into action prompts */
export function buildCourseContext(ctx?: SceneGenerationContext): string {
  if (!ctx) return '';

  const lines: string[] = [];

  // Course outline with position marker
  lines.push('Course Outline:');
  ctx.allTitles.forEach((t, i) => {
    const marker = i === ctx.pageIndex - 1 ? ' ← current' : '';
    lines.push(`  ${i + 1}. ${t}${marker}`);
  });

  // Position information
  lines.push('');
  lines.push(
    'IMPORTANT: All pages belong to the SAME class session. Do NOT greet again after the first page. When referencing content from earlier pages, say "we just covered" or "as mentioned on page N" — NEVER say "last class" or "previous session" because there is no previous session.',
  );
  lines.push('');
  if (ctx.pageIndex === 1) {
    lines.push('Position: This is the FIRST page. Open with a greeting and course introduction.');
  } else if (ctx.pageIndex === ctx.totalPages) {
    lines.push('Position: This is the LAST page. Conclude the course with a summary and closing.');
    lines.push(
      'Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.',
    );
  } else {
    lines.push(`Position: Page ${ctx.pageIndex} of ${ctx.totalPages} (middle of the course).`);
    lines.push(
      'Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.',
    );
  }

  // Previous page speech for transition reference
  if (ctx.previousSpeeches.length > 0) {
    lines.push('');
    lines.push('Previous page speech (for transition reference):');
    const lastSpeech = ctx.previousSpeeches[ctx.previousSpeeches.length - 1];
    lines.push(`  "...${lastSpeech.slice(-150)}"`);
  }

  return lines.join('\n');
}

/** Format agent list for injection into action prompts */
export function formatAgentsForPrompt(agents?: AgentInfo[]): string {
  if (!agents || agents.length === 0) return '';

  const lines = ['Classroom Agents:'];
  for (const a of agents) {
    const personaPart = a.persona ? ` — ${a.persona}` : '';
    lines.push(`- id: "${a.id}", name: "${a.name}", role: ${a.role}${personaPart}`);
  }
  return lines.join('\n');
}

/** Extract the teacher agent's persona for injection into outline/content prompts */
export function formatTeacherPersonaForPrompt(agents?: AgentInfo[]): string {
  if (!agents || agents.length === 0) return '';

  const teacher = agents.find((a) => a.role === 'teacher');
  if (!teacher?.persona) return '';

  return `Teacher Persona:\nName: ${teacher.name}\n${teacher.persona}\n\nAdapt the content style and tone to match this teacher's personality. IMPORTANT: The teacher's name and identity must NOT appear on the slides — no "Teacher ${teacher.name}'s tips", no "Teacher's message", etc. Slides should read as neutral, professional visual aids.`;
}

/**
 * Format a single PdfImage description for prompt inclusion.
 * Includes dimension/aspect-ratio info when available.
 */
export function formatImageDescription(img: PdfImage): string {
  let dimInfo = '';
  if (img.width && img.height) {
    const ratio = (img.width / img.height).toFixed(2);
    dimInfo = ` | size: ${img.width}×${img.height} (aspect ratio ${ratio})`;
  }
  const desc = img.description ? ` | ${img.description}` : '';
  return `- **${img.id}**: from PDF page ${img.pageNumber}${dimInfo}${desc}`;
}

/**
 * Format a short image placeholder for vision mode.
 * Only ID + page + dimensions + aspect ratio (no description), since the model can see the actual image.
 */
export function formatImagePlaceholder(img: PdfImage): string {
  let dimInfo = '';
  if (img.width && img.height) {
    const ratio = (img.width / img.height).toFixed(2);
    dimInfo = ` | size: ${img.width}×${img.height} (aspect ratio ${ratio})`;
  }
  return `- **${img.id}**: image from PDF page ${img.pageNumber}${dimInfo} [see attached]`;
}

/**
 * Build a multimodal user content array for the AI SDK.
 * Interleaves text and images so the model can associate img_id with actual image.
 * Each image label includes dimensions when available so the model knows the size
 * before seeing the image (important for layout decisions).
 */
export function buildVisionUserContent(
  userPrompt: string,
  images: Array<{ id: string; src: string; width?: number; height?: number }>,
): Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }> {
  const parts: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }
  > = [{ type: 'text', text: userPrompt }];
  if (images.length > 0) {
    parts.push({ type: 'text', text: '\n\n--- Attached Images ---' });
    for (const img of images) {
      let dimInfo = '';
      if (img.width && img.height) {
        const ratio = (img.width / img.height).toFixed(2);
        dimInfo = ` (${img.width}×${img.height}, aspect ratio ${ratio})`;
      }
      parts.push({ type: 'text', text: `\n**${img.id}**${dimInfo}:` });
      // Strip data URI prefix — AI SDK only accepts http(s) URLs or raw base64
      const dataUriMatch = img.src.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        parts.push({
          type: 'image',
          image: dataUriMatch[2],
          mimeType: dataUriMatch[1],
        });
      } else {
        parts.push({ type: 'image', image: img.src });
      }
    }
  }
  return parts;
}

/**
 * Build language instruction text from course-level directive and optional per-scene note.
 * Used by scene content and action generators to inject into prompt templates.
 */
export function buildLanguageText(directive?: string, sceneNote?: string): string {
  if (!directive && !sceneNote) return '';
  let text = directive || '';
  if (sceneNote) {
    text += (text ? '\n\n' : '') + `Additional language note for this scene: ${sceneNote}`;
  }
  return text;
}

/**
 * Appends optional scene-count constraints (same wording as scene-outlines-stream)
 * so outline generation matches the streaming API when users set exact counts.
 */
export function effectiveRequirementTextForOutlines(requirements: UserRequirements): string {
  const sc = requirements.sceneCounts;
  const base = requirements.requirement;
  if (!sc) return base;
  const lines: string[] = [];
  if ((sc.slideCount ?? 0) > 0) lines.push(`- 幻灯片 (slide) 场景数量：恰好 ${sc.slideCount} 个`);

  const quizScenes = sc.quizCount ?? 0;
  const perQuizQs = sc.questionsPerQuiz ?? 0;
  if (quizScenes > 0 && perQuizQs > 0) {
    lines.push(`- 测验 (quiz) 场景数量：恰好 ${quizScenes} 个`);
    lines.push(
      `- 每个测验的题目数量：恰好 ${perQuizQs} 题（在 quizConfig.questionCount 中体现）`,
    );
  } else if (quizScenes > 0 && perQuizQs === 0) {
    const total = quizScenes;
    const maxQuizPages = Math.min(4, Math.max(1, Math.ceil(total / 5)));
    lines.push(
      `- 测验总题数：至少 ${total} 题。用户将「测验」设为 ${total} 且「每测验题目数」为自动：此数字表示**希望的总题目数量**，不是 ${total} 个测验页。请使用 **1～${maxQuizPages}** 个 type 为 quiz 的场景，使各场景 \`quizConfig.questionCount\` 之和 ≥ ${total}；单场景建议 **4～10** 题（考研/刷题可多题同页）。**禁止**生成 ${total} 个每场景仅 1 题的 quiz。`,
    );
  } else if (quizScenes === 0 && perQuizQs > 0) {
    lines.push(
      `- 每个测验场景的题目数量：恰好 ${perQuizQs} 题（在 quizConfig.questionCount 中体现）；测验场景个数由 AI 根据课程节奏决定，但每个 quiz 必须满足该题数。`,
    );
  }
  if ((sc.interactiveCount ?? 0) > 0) {
    lines.push(`- 交互仿真 (interactive) 场景数量：恰好 ${sc.interactiveCount} 个`);
  }
  if ((sc.pblCount ?? 0) > 0) lines.push(`- 项目式学习 (pbl) 场景数量：恰好 ${sc.pblCount} 个`);
  if (lines.length === 0) return base;
  return `${base}\n\n## 用户指定的场景数量约束（必须严格遵守）\n\n${lines.join('\n')}\n\n以上约束优先级高于根据课程时长自动推断，请严格按照要求生成指定数量的场景。`;
}

/** Label for interactive-outlines user template "Course Language" section */
export function courseLanguagePromptLabel(language: 'zh-CN' | 'en-US'): string {
  return language === 'zh-CN' ? 'zh-CN（简体中文）' : 'en-US（English）';
}
