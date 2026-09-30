// LIN-3151: which unit tests kill a mutant — apply one small source mutation at a time in a throwaway worktree, run the whole unit suite, and record every test that fails beyond the unmutated baseline.
// Usage: node scripts/survey-tests-mutate.mjs lv --work <LinearViewer worktree> [--modules lib/a.js,lib/b.js] [--per-module 10] [--out data/survey-tests/mutants-lv.json]
//        node scripts/survey-tests-mutate.mjs sd --work <simple-dispatcher worktree> [--out data/survey-tests/mutants-sd.json]   (sd: simple-dispatcher's own curated mutants, run against its unit suite)
// --dry lists the mutants without running them; --prose-only draws only prompt-prose deletions. The worktree must not be this checkout: every mutant edits a source file in place and restores it afterwards.
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, realpathSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const flag = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const which = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const work = realpathSync(resolve(flag('--work', '')));
if (work === realpathSync(resolve(here, '..')) || work === realpathSync(resolve(here, '..', '..', 'simple-dispatcher'))) throw new Error('--work must be a throwaway worktree, not a working checkout');
const out = resolve(flag('--out', resolve(here, '..', 'data', 'survey-tests', `mutants-${which}.json`)));
const reporter = resolve(here, 'survey-tests-reporter.mjs');
const SUITE = {
  lv: { args: ['--test'], glob: 'tests/unit/*.test.js' },
  sd: { args: ['--require', './test/isolate-local-halt.js', '--test'], glob: 'test/*.test.js' },
}[which];

function runSuite() {
  const dest = resolve(dirname(out), `.mutant-${which}.jsonl`);
  if (existsSync(dest)) rmSync(dest);
  const files = execFileSync('bash', ['-c', `ls ${SUITE.glob}`], { cwd: work, encoding: 'utf8' }).trim().split('\n');
  const args = [...SUITE.args, `--test-reporter=${reporter}`, `--test-reporter-destination=${dest}`, ...files];
  spawnSync(process.execPath, args, { cwd: work, encoding: 'utf8', timeout: 900_000, env: { ...process.env, HARBOUR_LOCAL_BASE: '' } });
  const rows = existsSync(dest) ? readFileSync(dest, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  // A failing test's enclosing suite fails too; both are kept and told apart by nesting.
  return new Set(rows.filter((r) => r.name !== undefined && !r.ok).map((r) => `${r.file.replace(work + '/', '')}::${r.nesting}::${r.name}`));
}

// Syntax-safe operator swaps, one site at a time.
const OPERATORS = [
  [/ === /, ' !== '], [/ !== /, ' === '], [/ >= /, ' > '], [/ <= /, ' < '], [/ > /, ' >= '], [/ < /, ' <= '],
  [/ && /, ' || '], [/ \|\| /, ' && '], [/return true;/, 'return false;'], [/return false;/, 'return true;'],
  [/\?\? /, '|| '],
];

function lvMutants(modules, perModule) {
  const mutants = [];
  for (const mod of modules) {
    const lines = readFileSync(resolve(work, mod), 'utf8').split('\n');
    const logic = [], prose = [];
    let inTemplate = false;
    lines.forEach((line, i) => {
      const code = line.trim();
      const ticks = (line.match(/(?<!\\)`/g) || []).length;
      const wasTemplate = inTemplate;
      if (ticks % 2) inTemplate = !inTemplate;
      if (!code || /^(\/\/|\*|\/\*)/.test(code)) return;
      // A prose mutant deletes one whole line of prompt text inside a template literal.
      if (wasTemplate && inTemplate && ticks === 0 && !/\$\{/.test(line) && code.split(/\s+/).length >= 8) { prose.push({ i, kind: 'prose' }); return; }
      if (wasTemplate) return;
      for (const [re, rep] of OPERATORS) if (re.test(line) && !/import |require\(/.test(line)) { logic.push({ i, kind: 'logic', re, rep }); break; }
    });
    // Evenly spaced picks; a module with prompt prose gives a third of its draw to prose mutants.
    const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, k) => arr[Math.floor((k + 0.5) * arr.length / n)]));
    const nProse = !prose.length ? 0 : process.argv.includes('--prose-only') ? perModule : Math.round(perModule / 3);
    for (const m of [...pick(logic, perModule - nProse), ...pick(prose, nProse)]) {
      const before = lines[m.i];
      const after = m.kind === 'prose' ? '' : before.replace(m.re, m.rep);
      mutants.push({ file: mod, line: m.i + 1, kind: m.kind, before: before.trim(), after: after.trim(), find: before, replace: after });
    }
  }
  return mutants;
}

function sdMutants() {
  const src = readFileSync(resolve(work, 'test/system/mutation/run-mutations.js'), 'utf8');
  const arr = src.slice(src.indexOf('const MUTANTS = [') + 'const MUTANTS = '.length, src.indexOf('\n];', src.indexOf('const MUTANTS = [')) + 2);
  const list = new Function('HARBOUR', `return ${arr};`)('HARBOUR');
  return list.filter((m) => m.dir !== 'HARBOUR').map((m) => ({ file: m.file, name: m.name, kind: 'curated', killer: m.killer, find: m.find, replace: m.replace }));
}

const mutants = which === 'lv'
  ? lvMutants(flag('--modules', 'lib/dispatch-validation.js,lib/credential-state.js,lib/prompts/autopilot-kickoff.js').split(','), Number(flag('--per-module', 10)))
  : sdMutants();

if (process.argv.includes('--dry')) { for (const m of mutants) console.log(`${m.file}:${m.line || ''} ${m.kind} ${m.name || `${m.before} → ${m.after}`}`); process.exit(0); }
mkdirSync(dirname(out), { recursive: true });
const baseline = runSuite();
process.stderr.write(`baseline: ${baseline.size} failing\n`);
const results = [];
for (const [n, m] of mutants.entries()) {
  const path = resolve(work, m.file);
  const orig = readFileSync(path, 'utf8');
  if (!orig.includes(m.find)) { results.push({ ...m, outcome: 'not applied' }); continue; }
  writeFileSync(path, orig.replace(m.find, m.replace));
  let killers;
  try { killers = [...runSuite()].filter((k) => !baseline.has(k)); } finally { writeFileSync(path, orig); }
  results.push({ ...m, find: undefined, replace: undefined, outcome: killers.length ? 'killed' : 'survived', killers });
  process.stderr.write(`${n + 1}/${mutants.length} ${m.file}:${m.line || m.name} ${killers.length ? `killed by ${killers.length}` : 'SURVIVED'}\n`);
}
writeFileSync(out, JSON.stringify({ repo: which, head: execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim(), baseline: [...baseline], results }, null, 1));
console.log(`${which}: ${results.filter((r) => r.outcome === 'killed').length}/${results.length} mutants killed by the unit suite`);
