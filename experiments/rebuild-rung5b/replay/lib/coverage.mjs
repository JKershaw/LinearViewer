// In-process V8 precise coverage (node:inspector), mapped to line coverage of
// the renderer copies. Line numbers equal the original file's (the import
// rewrite is line-preserving). takePreciseCoverage() resets counters, so a
// snapshot per phase gives per-phase coverage; phases are unioned.
import { Session } from 'node:inspector/promises';
import fs from 'node:fs';

let session = null;

export async function startCoverage() {
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

export async function snapshot(urls) {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  const out = {};
  for (const url of urls) out[url] = result.filter(s => s.url === url).flatMap(s => s.functions);
  return out;
}

export async function stopCoverage() {
  await session.post('Profiler.stopPreciseCoverage');
  await session.post('Profiler.disable');
  session.disconnect();
}

/** Per-character execution counts, innermost range wins. */
function paint(src, functions) {
  const counts = new Int32Array(src.length).fill(-1);
  const ranges = functions.flatMap(f => f.ranges).sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  for (const r of ranges) counts.fill(r.count, r.startOffset, Math.min(r.endOffset, src.length));
  return { counts, blocks: functions.flatMap(f => f.ranges) };
}

/** Classify each line: null (blank/comment-only), true covered, false uncovered. */
export function lineCoverage(file, phaseSnapshots) {
  const src = fs.readFileSync(file, 'utf8');
  const painted = phaseSnapshots.map(fns => paint(src, fns));
  const lines = src.split('\n');
  const status = [];
  let off = 0;
  let inBlockComment = false;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const t = line.trim();
    let codeLine = true;
    if (inBlockComment) { codeLine = false; if (t.includes('*/')) { inBlockComment = false; codeLine = !!t.split('*/').slice(1).join('*/').trim(); } }
    else if (t === '' || t.startsWith('//')) codeLine = false;
    else if (t.startsWith('/*')) { codeLine = false; if (!t.includes('*/')) inBlockComment = true; }
    if (!codeLine) { status.push(null); off += line.length + 1; continue; }
    let covered = false; let anyCounted = false;
    for (let c = 0; c < line.length; c++) {
      if (/\s/.test(line[c])) continue;
      for (const p of painted) {
        const v = p.counts[off + c];
        if (v >= 0) anyCounted = true;
        if (v > 0) { covered = true; break; }
      }
      if (covered) break;
    }
    status.push(anyCounted ? covered : null);
    off += line.length + 1;
  }
  const code = status.filter(s => s !== null);
  const uncovered = status.map((s, i) => (s === false ? i + 1 : null)).filter(Boolean);
  // Block ("branch-ish") coverage: distinct ranges, hit in any phase.
  const key = r => `${r.startOffset}:${r.endOffset}`;
  const hit = new Map();
  for (const p of painted) for (const r of p.blocks) hit.set(key(r), (hit.get(key(r)) || 0) + r.count);
  const blocksTotal = hit.size;
  const blocksHit = [...hit.values()].filter(c => c > 0).length;
  const lineOf = (o) => src.slice(0, o).split('\n').length;
  const unhitBlocks = [...hit].filter(([, c]) => c === 0).map(([k]) => {
    const [s, e] = k.split(':').map(Number);
    return { line: lineOf(s), endLine: lineOf(e), code: src.slice(s, Math.min(e, s + 80)).replace(/\s+/g, ' ') };
  }).sort((a, b) => a.line - b.line);
  return {
    linesTotal: code.length,
    linesCovered: code.filter(Boolean).length,
    pct: code.length ? +(100 * code.filter(Boolean).length / code.length).toFixed(2) : 100,
    uncoveredLines: uncovered.map(n => ({ line: n, text: lines[n - 1].trim().slice(0, 100) })),
    blocksHit,
    blocksTotal,
    unhitBlocks
  };
}
