// Line coverage from V8 precise (block) coverage, without c8/istanbul.
//
// Semantics follow v8-to-istanbul: a line's count is the count of the
// innermost V8 range that fully contains the line's code span. Lines with no
// code (blank / comment-only) are not executable. "Partial" lines are covered
// lines where some code character sits in a zero-count range (e.g.
// `} catch (err) {` when the catch never ran).
import { Session } from 'node:inspector/promises';

export async function startCoverage() {
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  return session;
}

export async function takeCoverage(session) {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  return result;
}

/** Blank out comments (keep newlines/offsets). Approximate JS lexer: strings, templates, comments. */
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; prevSignificant = q;
      continue;
    }
    if (c === '/' && /[=(,:;!&|?{}[\]+\-*%<>~^]|^$/.test(prevSignificant)) {
      // regex literal
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      prevSignificant = 'r';
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}

export function lineCoverage(source, scriptCoverage, { withLines = false } = {}) {
  const code = stripComments(source);
  const ranges = [];
  for (const fn of scriptCoverage.functions) for (const r of fn.ranges) ranges.push(r);
  // outer → inner
  ranges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  const charCount = new Float64Array(source.length).fill(-1);
  for (const r of ranges) charCount.fill(r.count, r.startOffset, Math.min(r.endOffset, source.length));

  const lines = [];
  let off = 0;
  const srcLines = source.split('\n');
  for (let ln = 0; ln < srcLines.length; ln++) {
    const len = srcLines[ln].length;
    const text = code.slice(off, off + len);
    const first = text.search(/\S/);
    if (first !== -1) {
      const last = len - (text.length - text.trimEnd().length);
      const s = off + first;
      const e = off + last;
      // innermost range fully containing [s, e)
      let count = null;
      let best = Infinity;
      for (const r of ranges) {
        if (r.startOffset <= s && r.endOffset >= e) {
          const size = r.endOffset - r.startOffset;
          if (size <= best) { best = size; count = r.count; }
        }
      }
      let partial = false;
      for (let k = s; k < e; k++) {
        if (!/\s/.test(code[k]) && charCount[k] === 0) { partial = true; break; }
      }
      lines.push({ line: ln + 1, count: count ?? 0, partial: (count ?? 0) > 0 && partial, text: srcLines[ln].trim().slice(0, 120) });
    }
    off += len + 1;
  }
  const executable = lines.length;
  const covered = lines.filter(l => l.count > 0).length;
  return {
    executableLines: executable,
    coveredLines: covered,
    pct: executable ? Math.round((covered / executable) * 10000) / 100 : 100,
    uncovered: lines.filter(l => l.count === 0).map(l => ({ line: l.line, text: l.text })),
    partial: lines.filter(l => l.partial).map(l => ({ line: l.line, text: l.text })),
    functions: scriptCoverage.functions.filter(f => f.functionName && f.ranges[0].count === 0).map(f => f.functionName),
    ...(withLines ? { lines } : {}),
  };
}
