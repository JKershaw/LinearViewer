// Gate 3 helper: V8 precise block coverage -> list of executable blocks and their hit counts.
//
// V8's `detailed` precise coverage reports every function and every sub-function block range
// whose count differs from its parent (if/else arms, catch blocks, the continuation after a
// return/throw, short-circuit RHS, loop bodies...). A range with count < MIN is an executable
// block that the replay did not reach often enough. The pinned coverage.mjs supplies the
// session plumbing and the line-level report; this adds the per-block view the gate needs.
import { stripComments } from './coverage.mjs';

export function blockReport(source, scriptCoverage, { min = 5 } = {}) {
  const code = stripComments(source);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (off) => { let lo = 0; let hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
  const blocks = [];
  for (const fn of scriptCoverage.functions) {
    fn.ranges.forEach((r, i) => {
      const text = code.slice(r.startOffset, r.endOffset);
      if (!/\S/.test(text)) return;                       // comment/blank-only range: not executable
      blocks.push({
        fn: fn.functionName || '(anonymous)', isFunctionRange: i === 0,
        startLine: lineOf(r.startOffset), endLine: lineOf(Math.max(r.startOffset, r.endOffset - 1)),
        startOffset: r.startOffset, endOffset: r.endOffset, count: r.count,
        snippet: source.slice(r.startOffset, r.endOffset).replace(/\s+/g, ' ').trim().slice(0, 110),
      });
    });
  }
  blocks.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  return {
    totalBlocks: blocks.length,
    underMin: blocks.filter(b => b.count < min),
    zero: blocks.filter(b => b.count === 0),
    min,
  };
}
