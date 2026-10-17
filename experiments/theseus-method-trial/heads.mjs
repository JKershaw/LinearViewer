// Targeted count for one candidate decision: the terminal feedback-head vocabulary.
// COUNTING RULE: a site is one string literal, or the FIRST quasi of a template literal, in
// production code whose text begins (after optional whitespace) with a head token that
// feedback.js's TERMINAL_MESSAGE_REGEX accepts: [done] [complete] [failed] [aborted] [blocked]
// [pending] (case-insensitive) — i.e. a place that WRITES a terminal head itself. Plus the reader
// regex itself (1 site). A call to a shared builder is not a site. Comments are never sites.
// Also reports head-shaped literals that the reader would NOT accept (e.g. [ended·unconfirmed]),
// because a writer/reader disagreement is exactly what a consolidation must sort.
import { resolveCommit, show, parse, walk, productionJs } from './lib.mjs';
const commit = resolveCommit(process.argv[2] || 'HEAD');
const HEAD_RE = /^\s*\[(done|complete|failed|aborted|blocked|pending)\]/i;
const ANY_BRACKET_HEAD = /^\s*\[([^\]]{2,40})\]/;
const sites = []; const others = new Map();
for (const f of productionJs(commit)) {
  const src = show(commit, f); const lines = src.split('\n');
  walk.full(parse(src), n => {
    let text = null;
    if (n.type === 'Literal' && typeof n.value === 'string') text = n.value;
    if (n.type === 'TemplateLiteral') text = n.quasis[0].value.cooked || '';
    if (text == null) return;
    const m = text.match(HEAD_RE);
    if (m) sites.push({ head: `[${m[1].toLowerCase()}]`, file: f, line: n.loc.start.line, text: lines[n.loc.start.line - 1].trim().slice(0, 100) });
    else { const o = text.match(ANY_BRACKET_HEAD); if (o) { const k = `[${o[1]}]`; if (!others.has(k)) others.set(k, []); others.get(k).push(`${f}:${n.loc.start.line}`); } }
  });
}
const by = (k) => sites.reduce((m, s) => (m[s[k]] = (m[s[k]] || 0) + 1, m), {});
console.log(`commit ${commit}`);
console.log(`terminal-head writer sites: ${sites.length} in ${new Set(sites.map(s => s.file)).size} files (+1 reader regex in feedback.js)`);
console.log('by head:', JSON.stringify(by('head')));
console.log('by file:', JSON.stringify(by('file')));
if (process.argv.includes('--list')) for (const s of sites) console.log(`  ${s.head.padEnd(10)} ${s.file}:${s.line}  ${s.text}`);
console.log('\nbracket heads the reader does NOT treat as terminal (file:line):');
for (const [k, v] of [...others].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${k.padEnd(34)} ${v.length}  ${[...new Set(v.map(x => x.split(':')[0]))].join(', ')}`);
