// Shape of every in-scope file of a commit, with totals and a per-area rollup (LIN-3628).
// Pure: file contents in, data out. Per-file facts come from shape-core.mjs (definitions in DEFINITIONS).
import { DEFINITIONS, analyse } from './shape-core.mjs';
import { areaOf, compileGuide } from './code-shape-lib.mjs';

const emptyRollup = (name) => ({ area: name, files: 0, codeLines: 0, commentLines: 0, blankLines: 0, functions: 0, unitsOver10: 0, decisionPoints: 0, worstFunctionByCodeLines: null, maxNesting: 0 });

const addFile = (r, facts) => {
  r.files++;
  r.codeLines += facts.lines.code;
  r.commentLines += facts.lines.comment;
  r.blankLines += facts.lines.blank;
  r.functions += facts.functions.count;
  r.unitsOver10 += facts.cyclomatic.unitsOver10.length;
  r.decisionPoints += facts.cyclomatic.decisionPoints;
  const w = facts.functions.longestByCodeLines;
  if (w && (!r.worstFunctionByCodeLines || w.codeLines > r.worstFunctionByCodeLines.codeLines)) {
    r.worstFunctionByCodeLines = { file: facts.path, name: w.name, codeLines: w.codeLines, spanLines: w.spanLines, startLine: w.startLine };
  }
  r.maxNesting = Math.max(r.maxNesting, facts.maxNesting);
};

// detail: keep per-function rows, top-level declarations and exported names in each file's facts.
export function measureShape({ files, areaMap = null, detail = false }) {
  const guide = areaMap ? compileGuide(areaMap) : null;
  const rows = [];
  const parseFailures = [];
  const unmappedFiles = [];
  for (const path of Object.keys(files).sort()) {
    let facts;
    try { facts = analyse(files[path]); } catch (e) { parseFailures.push({ file: path, error: String(e.message) }); continue; }
    const claimed = guide ? guide.find((a) => a.rx.some((r) => r.test(path))) : null;
    if (guide && !claimed) unmappedFiles.push(path);
    const { perFunction, topLevelDeclarations, exportedNames, ...rest } = facts;
    rows.push({
      path, area: areaOf(guide, path), ...rest,
      ...(detail ? { topLevelDeclarations, exportedNames, perFunction } : { topLevelDeclarations: { count: topLevelDeclarations.count } }),
    });
  }
  const totals = emptyRollup('(all)');
  const byArea = new Map();
  for (const f of rows) {
    addFile(totals, f);
    if (!byArea.has(f.area)) byArea.set(f.area, emptyRollup(f.area));
    addFile(byArea.get(f.area), f);
  }
  delete totals.area;
  return {
    scope: { files: Object.keys(files).length, parsed: rows.length, parseFailures, unmappedFiles },
    files: rows,
    totals,
    areas: [...byArea.values()].sort((a, b) => (a.area < b.area ? -1 : 1)),
    definitions: DEFINITIONS,
  };
}
