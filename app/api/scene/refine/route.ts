/**
 * Scene Refinement API
 *
 * Accepts an existing Scene + user instruction, then:
 *  1. Streams an immediate acknowledgment to the client so the user knows
 *     the AI understood and is working.
 *  2. Reconstructs a SceneOutline from the existing scene with the user
 *     instruction injected as additional context.
 *  3. Calls the exact same generateSceneContent + generateSceneActions
 *     pipeline that generates scenes during normal course creation.
 *  4. Streams the completed updated Scene back.
 *
 * Using the existing pipeline guarantees structurally valid canvas/quiz JSON
 * and avoids the LLM producing malformed raw slide structures.
 *
 * POST /api/scene/refine
 * Body: { scene, instruction, history, stageInfo }
 * Returns: SSE  { type:'status'|'done'|'error', ... }
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { generateSceneContent, generateSceneActions } from '@/lib/generation/scene-generator';
import { applyOutlineFallbacks } from '@/lib/generation/outline-generator';
import { buildCompleteScene } from '@/lib/generation/scene-builder';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import type { Scene, SlideContent, QuizContent } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';
import type { AgentInfo } from '@/lib/generation/pipeline-types';

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
  stageInfo: { name: string; language?: string; style?: string };
  agents?: AgentInfo[];
}

/** Build a SceneOutline from an existing scene, injecting the user instruction */
function buildOutlineFromScene(
  scene: Scene,
  instruction: string,
  history: ChatMessage[],
  stageInfo: { name?: string; language?: string },
): SceneOutline {
  const lang = (stageInfo?.language ?? 'zh-CN') as 'zh-CN' | 'en-US';

  // Gather existing key points from slide text content
  const keyPoints: string[] = [];
  if (scene.type === 'slide') {
    const canvas = (scene.content as SlideContent).canvas;
    for (const el of canvas?.elements ?? []) {
      const e = el as unknown as Record<string, unknown>;
      if (e.type === 'text') {
        const text = String(e.content ?? '').replace(/<[^>]*>/g, '').trim().substring(0, 80);
        if (text) keyPoints.push(text);
      }
    }
  } else if (scene.type === 'quiz') {
    const questions = (scene.content as QuizContent).questions ?? [];
    questions.forEach((q) => keyPoints.push(q.question.substring(0, 80)));
  }

  // Build history context string
  const historyCtx = history.length > 0
    ? history
        .slice(-4)
        .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
        .join('\n')
    : '';

  // Inject the user instruction into the description so the generator knows what to change
  const instructionBlock = historyCtx
    ? `Previous edits:\n${historyCtx}\nNew instruction: ${instruction}`
    : `User instruction: ${instruction}`;

  return {
    id: scene.id,
    type: scene.type,
    title: scene.title,
    description: `${instructionBlock}\n\n(Refining existing scene — keep all correct content, only apply the changes requested above)`,
    keyPoints: keyPoints.slice(0, 8),
    order: scene.order,
    language: lang,
    // Preserve interactiveConfig if present
    ...(scene.type === 'interactive' && (scene.content as unknown as Record<string, unknown>).interactiveConfig
      ? { interactiveConfig: (scene.content as unknown as Record<string, unknown>).interactiveConfig as SceneOutline['interactiveConfig'] }
      : {}),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const { scene, instruction, history, stageInfo, agents } = body;

    if (!scene || !instruction?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'scene and instruction are required');
    }

    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req);
    log.info(`Scene refine: scene="${scene.title}" type=${scene.type} model=${modelString}`);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (data: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

        try {
          // ── Step 1: Stream an immediate status so the user sees instant feedback ──
          enqueue({ type: 'status', message: `好的，我来根据你的指令修改「${scene.title}」，请稍候…` });

          // ── Step 2: Build a modified outline from the existing scene ──
          const rawOutline = buildOutlineFromScene(scene, instruction, history, stageInfo ?? {});
          const outline = applyOutlineFallbacks(rawOutline, !!languageModel);

          // ── Step 3: AI call wrapper (same pattern as scene-content route) ──
          const aiCall = async (systemPrompt: string, userPrompt: string): Promise<string> => {
            const result = await callLLM(
              {
                model: languageModel,
                system: systemPrompt,
                prompt: userPrompt,
                maxOutputTokens: modelInfo?.outputWindow,
              },
              'scene-refine',
            );
            return result.text;
          };

          // ── Step 4: Regenerate content using the proven pipeline ──
          enqueue({ type: 'status', message: '正在重新生成场景内容…' });

          const newContent = await generateSceneContent(
            outline,
            aiCall,
            undefined,  // no PDF images for refinement
            undefined,  // no imageMapping
            undefined,  // no languageModel override (PBL path)
            false,      // visionEnabled = false for refinement
            {},         // generatedMediaMapping
            agents,
          );

          if (!newContent) {
            enqueue({ type: 'error', error: `内容生成失败，请重试。(model=${modelString})` });
            controller.close();
            return;
          }

          // ── Step 5: Regenerate actions (speech, spotlight, etc.) ──
          enqueue({ type: 'status', message: '正在生成讲解脚本…' });

          const previousSpeeches: string[] = (scene.actions ?? [])
            .filter((a) => {
              const any = a as unknown as Record<string, unknown>;
              return a.type === 'speech' && any.text;
            })
            .slice(0, 2)
            .map((a) => String((a as unknown as Record<string, unknown>).text).substring(0, 60));

          const ctx: import('@/lib/generation/pipeline-types').SceneGenerationContext = {
            pageIndex: scene.order,
            totalPages: 1,
            allTitles: [scene.title],
            previousSpeeches,
          };

          const newActions = await generateSceneActions(
            outline,
            newContent,
            aiCall,
            ctx,
            agents,
          );

          // ── Step 6: Build the complete Scene object ──
          const builtScene = buildCompleteScene(outline, newContent, newActions ?? [], scene.stageId);

          if (!builtScene) {
            enqueue({ type: 'error', error: '场景构建失败，请重试。' });
            controller.close();
            return;
          }

          // Preserve original scene ID so the store update is an in-place replace
          builtScene.id = scene.id;

          enqueue({ type: 'done', scene: builtScene });
        } catch (err) {
          log.error('Scene refine error:', err);
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
