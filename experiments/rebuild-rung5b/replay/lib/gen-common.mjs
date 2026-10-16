// Seeded generator plumbing + shared string/Markdown pools.
import { mulberry32 } from './hermetic.mjs';

export const DAY = 86400000;
export const HOUR = 3600000;

export class Rng {
  constructor(seed) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  chance(p) { return this.r() < p; }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = this.r() * total;
    for (const [v, w] of pairs) { if ((x -= w) < 0) return typeof v === 'function' ? v() : v; }
    const v = pairs[pairs.length - 1][0];
    return typeof v === 'function' ? v() : v;
  }
  subset(arr, p) { return arr.filter(() => this.r() < p); }
  shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  hex(n) { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[this.int(0, 15)]; return s; }
  uuid() { return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-a${this.hex(3)}-${this.hex(12)}`; }
  maybe(p, f) { return this.chance(p) ? (typeof f === 'function' ? f() : f) : undefined; }
}

export function caseSeed(seed, tier, i) {
  let h = 2166136261 ^ seed;
  for (const ch of `${tier}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Drop keys whose value is undefined (generated objects then look like real ones). */
export function clean(o) {
  if (Array.isArray(o)) return o;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// The full HTML escape set, in every string family.
export const ESC = `<b>&"x'</b>`;
export const HAZARD = [
  ESC, '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' onmouseover='x", '&amp;&lt;&#39;',
  '${template}', ' line sep', '</script><script>x</script>', '`backtick`', '\\back\\slash'
];
export const UNICODE = ['Ünïcødé — 日本語 ✓ 🚀', 'RTL ‮evil‬ mark', 'zero​width', 'emoji 👩‍💻 cluster', 'tab\there', 'Ω≈ç√∫', '中文项目', 'Données — été', "O'Brien's", '"Quoted"'];
export function text(rng, { empty = 0.05, hazard = 0.15, uni = 0.1, long = 0.03, base } = {}) {
  return rng.weighted([
    [() => '', empty],
    [() => rng.pick(HAZARD), hazard],
    [() => rng.pick(UNICODE), uni],
    [() => 'x'.repeat(rng.int(150, 400)), long],
    [() => base ? rng.pick(base) : `Item ${rng.int(1, 999)}`, 1 - empty - hazard - uni - long]
  ]);
}

export const PEOPLE = ['Alice', 'Bob', 'Zoë', `Eve ${ESC}`, '李雷', '', 'Dana Scully'];
export const TITLES = [
  'Add pagination to user list', 'Fix flaky login test', 'Refactor auth module', 'Ship the thing',
  'Ünïcødé — 日本語のタイトル ✓ 🚀', `Escape ${ESC} title`, '<script>alert("x")</script>', 'Tom & Jerry\'s "quoted" <tag>',
  'a'.repeat(300), '', '   ', 'Line one\nline two', 'RTL ‮evil‬', 'emoji 👩‍💻', 'tab\there', '&amp; already escaped', 'UPPER Case Search'
];

// ---------------------------------------------------------------------------
// Markdown descriptions: every block form a tracker description carries, plus
// the escaping hazards. Used for issue descriptions and the --descriptions hook.
// ---------------------------------------------------------------------------
const INLINE = [
  r => `**bold ${r.int(1, 9)}**`, () => '_em_', () => '`code <x>`', () => '~~strike~~',
  r => `[link ${r.int(1, 9)}](https://example.com/p?q=${r.int(1, 9)}&x="y")`, () => '<https://auto.example/link>',
  () => 'https://bare.example.com/path', () => '![img](https://uploads.linear.app/a/b.png)', () => '![](https://cdn.example.org/pic.jpg "title")',
  () => '<span onclick="x()">inline html</span>', () => '&amp; &lt;not a tag&gt; &#x27;', () => 'a < b > c & d', () => 'trailing\\', () => '@mention #123 LIN-42',
  r => r.pick(UNICODE), r => r.pick(HAZARD)
];
function inline(r, n = r.int(1, 6)) {
  const words = [];
  for (let i = 0; i < n; i++) words.push(r.chance(0.35) ? r.pick(INLINE)(r) : r.pick(['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'the', 'quick', 'fox', 'Ship', 'it']));
  return words.join(' ');
}
function list(r, depth = 0) {
  const ordered = r.chance(0.4);
  const n = r.int(1, 4);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const bullet = ordered ? `${i + 1}.` : r.pick(['-', '*', '+']);
    const task = !ordered && r.chance(0.2) ? (r.chance(0.5) ? '[ ] ' : '[x] ') : '';
    lines.push(`${'  '.repeat(depth)}${bullet} ${task}${inline(r)}`);
    if (depth < 3 && r.chance(0.3)) lines.push(...list(r, depth + 1));
  }
  return lines;
}
const BLOCKS = [
  r => [inline(r, r.int(3, 20))],
  r => [`${'#'.repeat(r.int(1, 6))} ${inline(r, 3)}`],
  r => list(r),
  r => ['```' + r.pick(['', 'js', 'html', 'sh']), r.pick(['const x = "<script>";', '<div class="x">&amp;</div>', 'echo $HOME && rm -rf /tmp/x', '  indented\n\ttabbed']), '```'],
  r => [`> ${inline(r)}`, r.chance(0.5) ? `> > ${inline(r)}` : '>'],
  () => ['| a | b |', '|---|---|', '| <i>1</i> | 2 & 3 |'],
  () => ['---'],
  () => ['<details><summary>raw html</summary>', 'body <b>bold</b>', '</details>'],
  () => ['<!-- comment -->'],
  r => [r.pick(UNICODE)],
  r => [`    indented code ${r.pick(HAZARD)}`],
  r => ['line with trailing spaces  ', 'hard break above'],
  r => ['w '.repeat(r.int(100, 200)).trim()]
];
export function markdown(rng, { blocks } = {}) {
  const shape = rng.weighted([
    [() => 'one-line', 3], [() => 'few', 4], [() => 'many', 3], [() => 'prompt-block', 1], [() => 'crlf', 0.5], [() => 'blank-lead', 0.5], [() => 'exact-3', 1], [() => 'exactly-300', 0.5]
  ]);
  if (shape === 'one-line') return inline(rng, rng.int(1, 12));
  if (shape === 'exact-3') return [inline(rng), inline(rng), inline(rng)].join('\n');
  if (shape === 'exactly-300') { const s = inline(rng, 30).padEnd(300, 'z'); return rng.chance(0.5) ? s.slice(0, 300) : s.slice(0, 301); }
  if (shape === 'prompt-block') return `${inline(rng)}\n${rng.chance(0.5) ? inline(rng) + '\n' : ''}---\n${inline(rng, 8)}\n${rng.chance(0.5) ? inline(rng) + '\n' : ''}---${rng.chance(0.6) ? '\n' + inline(rng) + (rng.chance(0.5) ? '\n' + inline(rng) + '\n' + inline(rng) : '') : ''}`;
  const n = blocks ?? (shape === 'few' ? rng.int(1, 3) : rng.int(4, 9));
  const out = [];
  for (let i = 0; i < n; i++) { out.push(...rng.pick(BLOCKS)(rng)); if (rng.chance(0.6)) out.push(''); }
  let s = out.join('\n');
  if (shape === 'crlf') s = s.replace(/\n/g, '\r\n');
  if (shape === 'blank-lead') s = '\n\n  ' + s + '\n\n';
  return s;
}
