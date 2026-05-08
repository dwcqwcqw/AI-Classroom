/**
 * Optional "internal" instructions for outline generation: PDF fidelity, deliverable
 * checklists, etc. These are merged into the **system** prompt only so they do not
 * appear in the user-facing `requirement` field and are less likely to become scene titles.
 */

export type InternalInstructionSource = {
  internalInstruction?: string;
};

/**
 * Client-provided `internalInstruction` wins over server env (for per-session overrides).
 */
export function resolveInternalGenerationInstruction(
  requirements: InternalInstructionSource,
): string | undefined {
  const fromClient = requirements.internalInstruction?.trim();
  if (fromClient) {
    return fromClient;
  }
  if (typeof process !== 'undefined') {
    const fromEnv = process.env.INTERNAL_GENERATION_INSTRUCTION?.trim();
    if (fromEnv) {
      return fromEnv;
    }
  }
  return undefined;
}

const SYSTEM_ONLY_PREAMBLE = `## Internal generation policy (system-only; not course content)

The following rules govern how you design the course. They are **not** teaching material for students:

- Do **not** create slide titles, scene titles, quiz stems, interactive widgets, or teacher lines that merely restate meta-headings such as "PDF 契约", "交付物", "核对表", "分段要求", or procedural boilerplate as if they were lesson topics.
- Do **not** dedicate entire scenes or interactives to explaining how the generation prompt was written, or to checklist-style "deliverables" pages.
- Apply these constraints silently to scope, PDF faithfulness, structure, pacing, and assessment depth.

### Operator-provided constraints (follow them; do not turn them into named lesson modules)

`;

/**
 * Appends internal instructions to the outline system prompt. No-op when empty.
 */
export function appendInternalInstructionToSystemPrompt(
  baseSystemPrompt: string,
  internalInstruction?: string | null,
): string {
  const body = internalInstruction?.trim();
  if (!body) return baseSystemPrompt;
  return `${baseSystemPrompt}\n\n---\n\n${SYSTEM_ONLY_PREAMBLE}${body}`;
}
