// Line coverage of the inventoried cost functions, from V8 block coverage that
// each side process wrote (NODE_V8_COVERAGE). Approximation, stated in the
// README: a function's lines are found by brace matching from its declaration,
// and a line counts as covered when any non-space character on it ran. Lines
// that are blank or comment-only are not counted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

/** The cost functions the floor is judged on: file (repo-relative) and declaration name. */
export const INVENTORIED = [
  ['lib/model-pricing.js', 'getModelRate'], ['lib/model-pricing.js', 'resolveWorkerModelId'],
  ['lib/model-pricing.js', 'selectRateForPrompt'], ['lib/model-pricing.js', 'computeUsageCostUsd'],
  ['lib/session-telemetry.js', 'parseUsagePayload'], ['lib/session-telemetry.js', 'parseUsage'],
  ['lib/dispatch-lineage.js', 'usageOf'], ['lib/dispatch-lineage.js', 'groupDispatchLineages'],
  ['lib/task-cost.js', 'anchorFor'], ['lib/task-cost.js', 'buildTaskCost'],
  ['lib/terminal-marked-task-cost.js', 'reduceLineageCost'], ['lib/terminal-marked-task-cost.js', 'computeTerminalMarkedTaskCost'],
  ['lib/weekly-budget.js', 'windowedSpend'], ['lib/weekly-budget.js', 'computeWeeklyBudgetGauge'],
  ['lib/llm-call-log.js', 'summarize'], ['lib/llm-call-log.js', 'summarizeByIssue'], ['lib/llm-call-log.js', 'summarizeByFeature'],
];

/** Line range [first, last] (0-based) of a function declared in `src`, by brace matching. */
export function functionLines(src, name) {
  const lines = src.split('\n');
  const decl = lines.findIndex(l => new RegExp(`(^|\\s)(export\\s+)?(async\\s+)?(function\\s+${name}\\b|${name}\\s*\\()`).test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l));
  if (decl < 0) return null;
  let depth = 0;
  let started = false;
  for (let i = decl; i < lines.length; i++) {
    const code = lines[i].replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\/.*$/g, '');
    for (const ch of code) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return [decl, i];
  }
  return null;
}

/** Per-character run counts for one file, from one process's coverage result. */
function countsFor(scriptSource, ranges) {
  const counts = new Int32Array(scriptSource.length).fill(-1);
  const sorted = [...ranges].sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of sorted) {
    for (let i = r.startOffset; i < r.endOffset && i < counts.length; i++) counts[i] = r.count;
  }
  return counts;
}

/** Coverage over every process dir's files. A line counts as run if any process ran it. */
export function coverageReport({ dir, tree = REPO } = {}) {
  const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
  const perFile = new Map(); // repo-relative file -> { src, covered: Uint8Array over lines }
  for (const f of runs) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const script of data.result) {
      if (!script.url.startsWith('file://')) continue;
      const file = fileURLToPath(script.url);
      const rel = INVENTORIED.find(([r]) => file.endsWith(r))?.[0];
      if (!rel) continue;
      const src = fs.readFileSync(file, 'utf8');
      const ranges = script.functions.flatMap(fn => fn.ranges);
      const counts = countsFor(src, ranges);
      if (!perFile.has(rel)) perFile.set(rel, { src, lineRun: new Uint8Array(src.split('\n').length) });
      const entry = perFile.get(rel);
      let line = 0;
      let lineStart = 0;
      for (let i = 0; i <= src.length; i++) {
        if (i === src.length || src[i] === '\n') {
          for (let j = lineStart; j < i; j++) if (counts[j] > 0 && src[j] !== ' ' && src[j] !== '\t') { entry.lineRun[line] = 1; break; }
          line++;
          lineStart = i + 1;
        }
      }
    }
  }
  const functions = INVENTORIED.map(([rel, name]) => {
    const entry = perFile.get(rel);
    if (!entry) return { file: rel, name, lines: 0, covered: 0, pct: 0, note: 'no coverage recorded' };
    const range = functionLines(entry.src, name);
    if (!range) return { file: rel, name, lines: 0, covered: 0, pct: null, note: 'declaration not found' };
    const srcLines = entry.src.split('\n');
    let lines = 0;
    let covered = 0;
    for (let i = range[0]; i <= range[1]; i++) {
      const t = srcLines[i].trim();
      if (!t || /^(\/\/|\*|\/\*)/.test(t)) continue;
      lines++;
      if (entry.lineRun[i]) covered++;
    }
    return { file: rel, name, lines, covered, pct: lines ? Math.round((covered / lines) * 1000) / 10 : null };
  });
  const totalLines = functions.reduce((s, f) => s + f.lines, 0);
  const totalCovered = functions.reduce((s, f) => s + f.covered, 0);
  const pct = totalLines ? Math.round((totalCovered / totalLines) * 1000) / 10 : 0;
  return {
    functions,
    summary: { pct, totalLines, totalCovered, target: 95, hardFloor: 90, meetsHardFloor: pct >= 90, meetsTarget: pct >= 95, processes: runs.length },
  };
}
