/**
 * Prompt Loader - Loads prompts from markdown files
 *
 * Supports:
 * - Loading prompts from templates/{promptId}/ directory
 * - Snippet inclusion via {{snippet:name}} syntax
 * - Variable interpolation via {{variable}} syntax
 * - Caching for performance
 */

import fs from 'fs';
import path from 'path';
import type { PromptId, LoadedPrompt, SnippetId } from './types';
import { createLogger } from '@/lib/logger';
const log = createLogger('PromptLoader');

// Cache for loaded prompts and snippets
const promptCache = new Map<string, LoadedPrompt>();
const snippetCache = new Map<string, string>();

const FALLBACK_SNIPPETS: Record<string, string> = {
  'json-output-rules': 'Return valid JSON only. Do not wrap with markdown code fences.',
  'action-types': 'Use action types: speech, highlight, point, click, showResult, wait, animation, interaction.',
  'element-types': 'Use slide element types: text, image, shape, chart, table, line, latex, video, audio.',
};

const FALLBACK_PROMPTS: Record<string, LoadedPrompt> = {
  'requirements-to-outlines': {
    id: 'requirements-to-outlines',
    systemPrompt:
      'You are an expert instructional designer. Create structured scene outlines as strict JSON array.',
    userPromptTemplate:
      'Requirement: {{requirement}}\nLanguage: {{language}}\nPDF: {{pdfContent}}\nImages: {{availableImages}}\nReturn 5-8 scene outlines with fields: id,title,type,description,script,order,language,mediaGenerations.',
  },
  'slide-content': {
    id: 'slide-content',
    systemPrompt: 'Generate slide canvas JSON content. Return strict JSON only.',
    userPromptTemplate:
      'Outline title: {{title}}\nDescription: {{description}}\nLanguage: {{language}}\nCreate slide content with a balanced layout and clear pedagogy.',
  },
  'quiz-content': {
    id: 'quiz-content',
    systemPrompt: 'Generate quiz JSON with questions and options. Return strict JSON only.',
    userPromptTemplate:
      'Outline title: {{title}}\nDescription: {{description}}\nLanguage: {{language}}\nCreate a concise formative quiz.',
  },
  'slide-actions': {
    id: 'slide-actions',
    systemPrompt: 'Generate presentation actions for slide playback. Return strict JSON array.',
    userPromptTemplate: 'Scene script: {{script}}\nContent summary: {{contentSummary}}',
  },
  'quiz-actions': {
    id: 'quiz-actions',
    systemPrompt: 'Generate quiz interaction actions. Return strict JSON array.',
    userPromptTemplate: 'Quiz content: {{contentSummary}}\nScene script: {{script}}',
  },
  'interactive-scientific-model': {
    id: 'interactive-scientific-model',
    systemPrompt: 'Design a scientific interactive model spec in JSON.',
    userPromptTemplate: 'Topic: {{title}}\nDescription: {{description}}\nLanguage: {{language}}',
  },
  'interactive-html': {
    id: 'interactive-html',
    systemPrompt: 'Generate self-contained interactive HTML. Return JSON with html field.',
    userPromptTemplate: 'Model: {{model}}\nTopic: {{title}}\nLanguage: {{language}}',
  },
  'interactive-actions': {
    id: 'interactive-actions',
    systemPrompt: 'Generate actions for interactive scene. Return strict JSON array.',
    userPromptTemplate: 'Interactive content summary: {{contentSummary}}\nScript: {{script}}',
  },
  'pbl-actions': {
    id: 'pbl-actions',
    systemPrompt: 'Generate actions for project-based learning scene. Return strict JSON array.',
    userPromptTemplate: 'PBL content summary: {{contentSummary}}\nScript: {{script}}',
  },
};

/**
 * Get the prompts directory path
 */
function getPromptsDir(): string {
  // In Next.js, use process.cwd() for the project root
  return path.join(process.cwd(), 'lib', 'generation', 'prompts');
}

/**
 * Load a snippet by ID
 */
export function loadSnippet(snippetId: SnippetId): string {
  const cached = snippetCache.get(snippetId);
  if (cached) return cached;

  const snippetPath = path.join(getPromptsDir(), 'snippets', `${snippetId}.md`);

  try {
    const content = fs.readFileSync(snippetPath, 'utf-8').trim();
    snippetCache.set(snippetId, content);
    return content;
  } catch {
    const fallback = FALLBACK_SNIPPETS[snippetId];
    if (fallback) {
      snippetCache.set(snippetId, fallback);
      log.warn(`Snippet not found on disk, using fallback: ${snippetId}`);
      return fallback;
    }
    log.warn(`Snippet not found: ${snippetId}`);
    return `{{snippet:${snippetId}}}`;
  }
}

/**
 * Process snippet includes in a template
 * Replaces {{snippet:name}} with actual snippet content
 */
function processSnippets(template: string): string {
  return template.replace(/\{\{snippet:(\w[\w-]*)\}\}/g, (_, snippetId) => {
    return loadSnippet(snippetId as SnippetId);
  });
}

/**
 * Load a prompt by ID
 */
export function loadPrompt(promptId: PromptId): LoadedPrompt | null {
  const cached = promptCache.get(promptId);
  if (cached) return cached;

  const promptDir = path.join(getPromptsDir(), 'templates', promptId);

  try {
    // Load system.md
    const systemPath = path.join(promptDir, 'system.md');
    let systemPrompt = fs.readFileSync(systemPath, 'utf-8').trim();
    systemPrompt = processSnippets(systemPrompt);

    // Load user.md (optional, may not exist)
    const userPath = path.join(promptDir, 'user.md');
    let userPromptTemplate = '';
    try {
      userPromptTemplate = fs.readFileSync(userPath, 'utf-8').trim();
      userPromptTemplate = processSnippets(userPromptTemplate);
    } catch {
      // user.md is optional
    }

    const loaded: LoadedPrompt = {
      id: promptId,
      systemPrompt,
      userPromptTemplate,
    };

    promptCache.set(promptId, loaded);
    return loaded;
  } catch (error) {
    const fallback = FALLBACK_PROMPTS[promptId];
    if (fallback) {
      promptCache.set(promptId, fallback);
      log.warn(`Prompt template not found on disk, using fallback: ${promptId}`);
      return fallback;
    }
    log.error(`Failed to load prompt ${promptId}:`, error);
    return null;
  }
}

/**
 * Interpolate variables in a template
 * Replaces {{variable}} with values from the variables object
 */
export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined) return match;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

/**
 * Build a complete prompt with variables
 */
export function buildPrompt(
  promptId: PromptId,
  variables: Record<string, unknown>,
): { system: string; user: string } | null {
  const prompt = loadPrompt(promptId);
  if (!prompt) return null;

  return {
    system: interpolateVariables(prompt.systemPrompt, variables),
    user: interpolateVariables(prompt.userPromptTemplate, variables),
  };
}

/**
 * Clear all caches (useful for development/testing)
 */
export function clearPromptCache(): void {
  promptCache.clear();
  snippetCache.clear();
}
