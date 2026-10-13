// Re-draw test-estate's mutant sample at HEAD by its own rule (survey-tests-mutate.mjs lvMutants): evenly spaced operator flips
// over its four logic modules, and evenly spaced one-line prose deletions over the three prompt producers it names.
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
const work = resolve(process.argv[2]);
const OPERATORS = [[/ === /, ' !== '], [/ !== /, ' === '], [/ >= /, ' > '], [/ <= /, ' < '], [/ > /, ' >= '], [/ < /, ' <= '],
  [/ && /, ' || '], [/ \|\| /, ' && '], [/return true;/, 'return false;'], [/return false;/, 'return true;'], [/\?\? /, '|| ']];
const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, k) => arr[Math.floor((k + 0.5) * arr.length / n)]));
function scan(mod) {
  const lines = readFileSync(resolve(work, mod), 'utf8').split('\n'); const logic = [], prose = []; let inT = false;
  lines.forEach((line, i) => { const code = line.trim(); const ticks = (line.match(/(?<!\\)`/g) || []).length; const was = inT; if (ticks % 2) inT = !inT;
    if (!code || /^(\/\/|\*|\/\*)/.test(code)) return;
    if (was && inT && ticks === 0 && !/\$\{/.test(line) && code.split(/\s+/).length >= 8) { prose.push(i); return; }
    if (was) return;
    for (const [re, rep] of OPERATORS) if (re.test(line) && !/import |require\(/.test(line)) { logic.push([i, re, rep]); break; } });
  return { lines, logic, prose };
}
const out = []; let k = 0;
for (const mod of ['lib/dispatch-validation.js', 'lib/credential-state.js', 'lib/completion-signals.js', 'lib/prompts/autopilot-kickoff.js']) {
  const { lines, logic } = scan(mod);
  for (const [i, re, rep] of pick(logic, 8)) out.push({ id: `te-${k++}`, file: mod, line: i + 1, kind: 'logic', before: lines[i].trim(), after: lines[i].replace(re, rep).trim() });
}
for (const [mod, n] of [['lib/prompts/autopilot-kickoff.js', 7], ['lib/prompts/runner-kickoff.js', 6], ['lib/prompt-template-defs.js', 6]]) {
  const { lines, prose } = scan(mod);
  for (const i of pick(prose, n)) out.push({ id: `te-${k++}`, file: mod, line: i + 1, kind: 'prose', before: lines[i].trim(), after: '' });
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1)); console.log(out.length, out.filter(m=>m.kind==='prose').length);
