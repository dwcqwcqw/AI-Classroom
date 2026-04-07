/**
 * Scene Refinement API
 *
 * Accepts an existing Scene + user instruction and streams an LLM response
 * that produces an updated Scene (partial patch). The patch is merged
 * back into the original scene on the client side.
 *
 * POST /api/scene/refine
 * Body: { scene, instruction, history, stageInfo }
 * Returns: SSE stream with { type: 'chunk'|'done'|'error', ... }
 */

import { NextRequest } from 'next/server';
import { streamLLM } from '@/lib/ai/llm';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import type { Scene } from '@/lib/types/stage';

const log = createLogger('scene-refine');

export const maxDuration = 120;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  scene: Scene;
  instruction: string;
  history: ChatMessage[];
  stageInfo: { name: string; language?: string };
}

/** Convert scene content to a compact readable summary for the LLM */
function describeScene(scene: Scene): string {
  const lines: string[] = [`Title: ${scene.title}`, `Type: ${scene.type}`];

  const contentAny = scene.content as unknown as Record<string, unknown>;

  if (scene.type === 'slide') {
    const canvas = contentAny?.canvas as Record<string, unknown> | undefined;
    const elements = (canvas?.elements as unknown[]) ?? [];
    lines.push(`Slide elements (${elements.length}):`);
    for (const raw of elements) {
      const el = raw as Record<string, unknown>;
      if (el.type === 'text') {
        const text = String(el.content || '').replace(/<[^>]*>/g, '').substring(0, 100);
        lines.push(`  - [text] "${text}"`);
      } else if (el.type === 'image') {
        lines.push(`  - [image]`);
      } else {
        lines.push(`  - [${el.type}]`);
      }
    }
  } else if (scene.type === 'quiz') {
    const questions = (contentAny?.questions as { question: string }[]) ?? [];
    lines.push(`Quiz (${questions.length} questions):`);
    questions.forEach((q, i) => lines.push(`  ${i + 1}. ${q.question}`));
  } else if (scene.type === 'interactive') {
    lines.push('Interactive HTML simulation');
  } else if (scene.type === 'pbl') {
    lines.push('Project-Based Learning scene');
  }

  const speeches = (scene.actions ?? [])
    .filter((a) => {
      const any = a as unknown as Record<string, unknown>;
      return a.type === 'speech' && any.text;
    })
    .slice(0, 3)
    .map((a) => String((a as unknown as Record<string, unknown>).text).substring(0, 80));
  if (speeches.length) {
    lines.push('Lecture speeches (sample):');
    speeches.forEach((s) => lines.push(`  - "${s}"`));
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const { scene, instruction, history, stageInfo } = body;

    if (!scene || !instruction?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'scene and instruction are required');
    }

    const { model: languageModel, modelInfo } = resolveModelFromHeaders(req);
    const lang = stageInfo?.language ?? 'zh-CN';

    const historyText =
      history.length > 0
        ? history
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n') + '\n---\n'
        : '';

    const systemPrompt = `You are an AI course-slide editor. The teacher wants to modify one scene in their course.
Your task: analyse the current scene data and the user's instruction, then output the FULL updated scene as JSON.

Course name: "${stageInfo.name}"
Language: ${lang}

## Current scene
${describeScene(scene)}

## Output format (strict JSON, no markdown fences)
Return a JSON object that is a PARTIAL update — include only the fields you want to change:
{
  "title": "...",          // optional — new title
  "content": { ... },      // optional — updated content object (same shape as original)
  "actions": [ ... ]       // optional — updated actions array
}

Rules:
- Keep the scene type: ${scene.type}
- Keep all speech text in ${lang}
- For slides: "content.canvas.elements" is the array of PPT elements
- For quizzes: "content.questions" is the array of { question, options, answer, explanation }
- Only modify what the user asks; preserve everything else
- Return ONLY valid JSON, no explanation`;

    const userMessage = `${historyText}Instruction: ${instruction}`;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (data: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

        try {
          const result = streamLLM(
            {
              model: languageModel,
              system: systemPrompt,
              prompt: userMessage,
              maxOutputTokens: modelInfo?.outputWindow,
            },
            'scene-refine',
          );

          let fullText = '';
          for await (const chunk of result.textStream) {
            fullText += chunk;
            enqueue({ type: 'chunk', text: chunk });
          }

          const patch = parseJsonResponse<{
            title?: string;
            content?: Record<string, unknown>;
            actions?: unknown[];
          }>(fullText);

          if (!patch) {
            enqueue({ type: 'error', error: 'LLM did not return valid JSON' });
            controller.close();
            return;
          }

          // Deep-merge the patch into the original scene
          const originalContent = scene.content as unknown as Record<string, unknown>;
          const updatedScene: Scene = {
            ...scene,
            ...(patch.title ? { title: patch.title } : {}),
            content: patch.content
              ? ({ ...originalContent, ...patch.content } as unknown as Scene['content'])
              : scene.content,
            actions: patch.actions
              ? (patch.actions as unknown as Scene['actions'])
              : scene.actions,
            updatedAt: Date.now(),
          };

          enqueue({ type: 'done', scene: updatedScene });
        } catch (err) {
          log.error('Scene refine stream error:', err);
          enqueue({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Scene refine request error:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
