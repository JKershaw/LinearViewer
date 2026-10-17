// V8 precise coverage via node:inspector, folded per FILE across the many
// module instances (`…?inst=<id>`) a run creates. Per instance: innermost
// range wins per character; across instances and workers: a character is
// covered if ANY instance executed it. Line numbers equal the source file's
// (the import rewrite is line-preserving).
import { Session } from 'node:inspector/promises';
import fs from 'node:fs';

let session = null;
export async function startCoverage() {
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

/** acc: Map<fileUrl, {len, covered:Uint8Array, counted:Uint8Array, blocks: Map<key, hits>}> */
export async function foldSnapshot(acc, fileUrls) {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  for (const script of result) {
    const base = script.url.split('?')[0];
    if (!fileUrls.has(base)) continue;
    let a = acc.get(base);
    const len = fileUrls.get(base);
    if (!a) { a = { len, covered: new Uint8Array(len), counted: new Uint8Array(len), blocks: new Map() }; acc.set(base, a); }
    const counts = new Int32Array(len).fill(-1);
    const ranges = script.functions.flatMap(f => f.ranges).sort((x, y) => (y.endOffset - y.startOffset) - (x.endOffset - x.startOffset));
    for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, len));
    for (let i = 0; i < len; i++) { if (counts[i] >= 0) a.counted[i] = 1; if (counts[i] > 0) a.covered[i] = 1; }
    for (const r of ranges) { const k = `${r.startOffset}:${r.endOffset}`; a.blocks.set(k, (a.blocks.get(k) || 0) + r.count); }
  }
}

export function mergeAcc(into, from) {
  for (const [url, a] of from) {
    let b = into.get(url);
    if (!b) { b = { len: a.len, covered: new Uint8Array(a.len), counted: new Uint8Array(a.len), blocks: new Map() }; into.set(url, b); }
    for (let i = 0; i < a.len; i++) { if (a.covered[i]) b.covered[i] = 1; if (a.counted[i]) b.counted[i] = 1; }
    for (const [k, v] of a.blocks) b.blocks.set(k, (b.blocks.get(k) || 0) + v);
  }
}

/** Line/block coverage summary of one source file from a folded accumulator. */
export function lineCoverage(file, a) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const status = [];
  let off = 0;
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    let code = true;
    if (inBlock) { code = false; if (t.includes('*/')) { inBlock = false; code = !!t.split('*/').slice(1).join('*/').trim(); } }
    else if (t === '' || t.startsWith('//')) code = false;
    else if (t.startsWith('/*')) { code = false; if (!t.includes('*/')) inBlock = true; }
    if (!code || !a) { status.push(code && !a ? false : null); off += line.length + 1; continue; }
    let covered = false; let counted = false;
    for (let c = 0; c < line.length; c++) {
      if (/\s/.test(line[c])) continue;
      if (a.counted[off + c]) counted = true;
      if (a.covered[off + c]) { covered = true; break; }
    }
    status.push(counted ? covered : null);
    off += line.length + 1;
  }
  const codeLines = status.filter(s => s !== null);
  const uncovered = status.map((s, i) => (s === false ? i + 1 : null)).filter(Boolean);
  // A range V8 omits when its count equals its parent's, so summing counts
  // per range across snapshots under-reports; a block is hit iff the union
  // painting covered its first character (innermost range wins there).
  const blocks = a ? [...a.blocks].map(([k]) => [k, a.covered[Number(k.split(':')[0])] ? 1 : 0]) : [];
  const lineOf = (o) => src.slice(0, o).split('\n').length;
  return {
    linesTotal: codeLines.length,
    linesCovered: codeLines.filter(Boolean).length,
    pct: codeLines.length ? +(100 * codeLines.filter(Boolean).length / codeLines.length).toFixed(2) : 100,
    uncoveredLines: uncovered.map(n => ({ line: n, text: lines[n - 1].trim().slice(0, 100) })),
    blocksHit: blocks.filter(([, v]) => v > 0).length,
    blocksTotal: blocks.length,
    unhitBlocks: blocks.filter(([, v]) => v === 0).map(([k]) => { const [s, e] = k.split(':').map(Number); return { line: lineOf(s), endLine: lineOf(e), code: src.slice(s, Math.min(e, s + 70)).replace(/\s+/g, ' ') }; }).sort((x, y) => x.line - y.line),
  };
}

export function serializeAcc(acc) {
  return [...acc].map(([url, a]) => [url, { len: a.len, covered: a.covered, counted: a.counted, blocks: [...a.blocks] }]);
}
export function deserializeAcc(arr) {
  return new Map(arr.map(([url, a]) => [url, { len: a.len, covered: a.covered, counted: a.counted, blocks: new Map(a.blocks) }]));
}
