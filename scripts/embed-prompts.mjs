import fs from 'fs';
import path from 'path';

const base = path.join(process.cwd(), 'lib/generation/prompts');
const promptIds = [
  'requirements-to-outlines',
  'slide-content',
  'quiz-content',
  'slide-actions',
  'quiz-actions',
  'interactive-scientific-model',
  'interactive-html',
  'interactive-actions',
  'pbl-actions',
];
const snippetIds = ['json-output-rules', 'element-types', 'action-types'];

const escapeTemplateLiteral = (s) => s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

let out = "import type { LoadedPrompt, PromptId, SnippetId } from './types';\n\n";
out += 'export const EMBEDDED_SNIPPETS: Record<SnippetId, string> = {\n';
for (const id of snippetIds) {
  const p = path.join(base, 'snippets', `${id}.md`);
  const c = fs.readFileSync(p, 'utf8').trim();
  out += `  '${id}': \`${escapeTemplateLiteral(c)}\`,\n`;
}
out += '};\n\n';

out += 'export const EMBEDDED_PROMPTS: Record<PromptId, LoadedPrompt> = {\n';
for (const id of promptIds) {
  const sp = fs.readFileSync(path.join(base, 'templates', id, 'system.md'), 'utf8').trim();
  let up = '';
  const upath = path.join(base, 'templates', id, 'user.md');
  if (fs.existsSync(upath)) up = fs.readFileSync(upath, 'utf8').trim();

  out += `  '${id}': {\n`;
  out += `    id: '${id}',\n`;
  out += `    systemPrompt: \`${escapeTemplateLiteral(sp)}\`,\n`;
  out += `    userPromptTemplate: \`${escapeTemplateLiteral(up)}\`,\n`;
  out += '  },\n';
}
out += '};\n';

fs.writeFileSync(path.join(base, 'embedded-prompts.ts'), out);
console.log('generated embedded-prompts.ts');
