/**
 * Sync `lib/prompts/templates/code-content/*.md` into `EMBEDDED_PROMPTS['code-content']`
 * in `lib/prompts/embedded-prompts.ts`. Runtime `loadPrompt()` only reads embedded data.
 *
 * Run after editing the markdown templates: `node scripts/embed-code-content-prompt.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function escForTsTemplate(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const sys = fs.readFileSync(
  path.join(root, 'lib/prompts/templates/code-content/system.md'),
  'utf8',
);
const usr = fs.readFileSync(
  path.join(root, 'lib/prompts/templates/code-content/user.md'),
  'utf8',
);

const fragment =
  `  'code-content': {\n` +
  `    id: 'code-content',\n` +
  `    systemPrompt: \`${escForTsTemplate(sys)}\`,\n` +
  `    userPromptTemplate: \`${escForTsTemplate(usr)}\`,\n` +
  `  },`;

const out = path.join(root, 'lib/prompts/_code-content-embedded-fragment.ts.txt');
fs.writeFileSync(out, fragment, 'utf8');
console.log('Wrote', out, fragment.length);

const embPath = path.join(root, 'lib/prompts/embedded-prompts.ts');
let emb = fs.readFileSync(embPath, 'utf8');
const stubStart = emb.indexOf("\n  'code-content':");
const stubEnd = emb.indexOf("\n  'game-content':", stubStart);
if (stubStart === -1 || stubEnd === -1) {
  console.error('embedded-prompts.ts: could not find code-content / game-content anchors');
  process.exit(1);
}
emb = emb.slice(0, stubStart) + `\n${fragment.trimEnd()}\n` + emb.slice(stubEnd);
fs.writeFileSync(embPath, emb, 'utf8');
console.log('Patched', embPath, 'replaced bytes', stubEnd - stubStart);
