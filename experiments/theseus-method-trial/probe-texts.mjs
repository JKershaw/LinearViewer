// Builds the text-only variants the probes serve to tests that read source (imports still load
// the real code).  node probe-texts.mjs <commit> <outdir> <move|blank-comments>
//  move            T1 modelled: every terminal-head writer site has its head token replaced by
//                  `${TERMINAL_HEADS.<kind>}` (string literals become template literals), and
//                  feedback.js gains the TERMINAL_HEADS table. Text only: not meant to execute.
//  blank-comments  every comment in every production file replaced by spaces (newlines kept).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCommit, show, parse, walk, productionJs } from './lib.mjs';

const [, , ref, outDir, mode] = process.argv;
const commit = resolveCommit(ref);
mkdirSync(outDir, { recursive: true });
const HEAD_RE = /^(\s*)\[(done|complete|failed|aborted|blocked|pending)\]/i;
let changed = 0, sites = 0;
for (const f of productionJs(commit)) {
  const src = show(commit, f);
  const edits = [];
  if (mode === 'blank-comments') {
    parse(src, (block, text, start, end) => edits.push([start, end, src.slice(start, end).replace(/[^\n]/g, ' ')]));
  } else if (mode === 'move') {
    walk.full(parse(src), n => {
      if (n.type === 'Literal' && typeof n.value === 'string' && HEAD_RE.test(n.value)) {
        const m = n.value.match(HEAD_RE);
        const rest = n.value.slice(m[0].length).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
        edits.push([n.start, n.end, '`' + m[1] + '${TERMINAL_HEADS.' + m[2].toLowerCase() + '}' + rest.replace(/\n/g, '\\n') + '`']);
      }
      if (n.type === 'TemplateLiteral') {
        const q = n.quasis[0]; const m = (q.value.cooked || '').match(HEAD_RE);
        if (m) { const raw = src.slice(q.start, q.end); const i = raw.indexOf('['); const j = raw.indexOf(']', i);
          edits.push([q.start + i, q.start + j + 1, '${TERMINAL_HEADS.' + m[2].toLowerCase() + '}']); }
      }
    });
    if (f === 'feedback.js') {
      const at = src.indexOf('const TERMINAL_MESSAGE_REGEX');
      edits.push([at, at, "const TERMINAL_HEADS = Object.freeze({ done: '[done]', failed: '[failed]', aborted: '[aborted]', blocked: '[blocked]', pending: '[pending]' });\n"]);
    }
  }
  if (!edits.length) continue;
  edits.sort((a, b) => b[0] - a[0]);
  let out = src; for (const [s, e, t] of edits) out = out.slice(0, s) + t + out.slice(e);
  writeFileSync(path.join(outDir, f), out); changed++; sites += edits.length;
}
console.log(`${mode}: ${changed} files rewritten, ${sites} edits -> ${outDir}`);
