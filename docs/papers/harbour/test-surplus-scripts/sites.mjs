// Enumerate mutation sites across Harbour production code and draw a seeded uniform sample.
// Kinds: logic (test-estate's operator flips), stmt (delete one single-line statement), prose (delete one line of template-literal prose, test-estate's rule).
// Usage: node sites.mjs <worktree> <out.json> <n> <seed> [--exclude prior.json]
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const work = resolve(process.argv[2]);
const out = process.argv[3];
const n = Number(process.argv[4]);
const seed = Number(process.argv[5]);
const exIdx = process.argv.indexOf('--exclude');
const exclude = new Set();
if (exIdx > 0) for (const p of process.argv[exIdx + 1].split(',')) for (const m of JSON.parse(readFileSync(p, 'utf8'))) exclude.add(`${m.file}:${m.line}:${m.kind}`);

const OPERATORS = [
  [/ === /, ' !== '], [/ !== /, ' === '], [/ >= /, ' > '], [/ <= /, ' < '], [/ > /, ' >= '], [/ < /, ' <= '],
  [/ && /, ' || '], [/ \|\| /, ' && '], [/return true;/, 'return false;'], [/return false;/, 'return true;'],
  [/\?\? /, '|| '],
];
const files = execFileSync('git', ['ls-files', 'lib', 'routes', 'public', 'server.js'], { cwd: work, encoding: 'utf8' })
  .trim().split('\n').filter((f) => /\.(m?js)$/.test(f) && !/\.min\.js$/.test(f) && !/^public\/(vendor|fonts)\//.test(f));

const sites = [];
for (const mod of files) {
  const lines = readFileSync(resolve(work, mod), 'utf8').split('\n');
  let inTemplate = false;
  lines.forEach((line, i) => {
    const code = line.trim();
    const ticks = (line.match(/(?<!\\)`/g) || []).length;
    const wasTemplate = inTemplate;
    if (ticks % 2) inTemplate = !inTemplate;
    if (!code || /^(\/\/|\*|\/\*)/.test(code)) return;
    if (wasTemplate && inTemplate && ticks === 0 && !/\$\{/.test(line) && code.split(/\s+/).length >= 8) { sites.push({ file: mod, line: i + 1, kind: 'prose' }); return; }
    if (wasTemplate) return;
    if (/import |require\(/.test(line)) return;
    for (const [re, rep] of OPERATORS) if (re.test(line)) { sites.push({ file: mod, line: i + 1, kind: 'logic', re: re.source, rep }); return; }
    if (/;\s*(\/\/.*)?$/.test(code) && /^(await\s+)?[A-Za-z_$][\w$]*(\.|\(|\[|\s*[+\-*]?=[^=])/.test(code)
      && !/^(const|let|var|return|throw|break|continue|export|import|if|for|while|do|switch|case|default|else|try|catch|finally|function|class|async\s+function)\b/.test(code)
      && (code.match(/\(/g) || []).length === (code.match(/\)/g) || []).length
      && (code.match(/\{/g) || []).length === (code.match(/\}/g) || []).length
      && (code.match(/\[/g) || []).length === (code.match(/\]/g) || []).length) {
      sites.push({ file: mod, line: i + 1, kind: 'stmt' });
    }
  });
}
const byKind = sites.reduce((a, s) => ((a[s.kind] = (a[s.kind] || 0) + 1), a), {});
process.stderr.write(`files ${files.length} sites ${sites.length} ${JSON.stringify(byKind)}\n`);

// mulberry32
let st = seed >>> 0;
const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pool = sites.filter((s) => !exclude.has(`${s.file}:${s.line}:${s.kind}`));
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const pick = pool.slice(0, n).map((s, k) => {
  const lines = readFileSync(resolve(work, s.file), 'utf8').split('\n');
  const before = lines[s.line - 1];
  const after = s.kind === 'logic' ? before.replace(new RegExp(s.re), s.rep) : '';
  return { id: `${seed}-${k}`, file: s.file, line: s.line, kind: s.kind, before: before.trim(), after: after.trim() };
});
writeFileSync(out, JSON.stringify(pick, null, 1));
console.log('wrote', pick.length);
