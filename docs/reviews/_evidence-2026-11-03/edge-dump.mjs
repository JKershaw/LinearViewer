#!/usr/bin/env node
// File-level import edges for LIN-4152 run 4, so hub figures (importers, cross-area imports) can be re-checked.
// Usage (from the repo root): node docs/reviews/_evidence-2026-11-03/edge-dump.mjs . <commit> <guide.json>
// Reads committed git objects only. Uses seams.mjs's own scope (`inScope`) and the same acorn parse and
// specifier rules as seams.mjs. Witness: the cross-area edges here must number the seams.mjs `links` total
// (sum of `imports`) for the same commit and guide.
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { posix } from 'node:path';
import { readCommit, compileGuide } from '../../../scripts/code-shape/code-shape-lib.mjs';
import { inScope } from '../../../scripts/code-shape/seams.mjs';

const [repoArg, commitArg, guideArg] = process.argv.slice(2);
if (!repoArg || !commitArg || !guideArg) {
  console.error('usage: node edge-dump.mjs <repoDir> <commit> <guide.json>');
  process.exit(2);
}

const parseSource = (text) => {
  for (const sourceType of ['module', 'script']) {
    try {
      return parse(text, {
        ecmaVersion: 'latest', sourceType, allowHashBang: true,
        allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
      });
    } catch { /* next */ }
  }
  return null;
};

// Same rules as seams.mjs extractSpecs: static import/export-from specifiers and literal dynamic imports.
const specsOf = (ast) => {
  const specs = [];
  for (const node of ast.body) {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      specs.push(node.source.value);
    }
  }
  simple(ast, {
    ImportExpression(node) {
      if (node.source?.type === 'Literal' && typeof node.source.value === 'string') specs.push(node.source.value);
    },
  });
  return specs;
};

const repo = resolve(repoArg);
const guideJson = JSON.parse(readFileSync(guideArg, 'utf8'));
const guide = compileGuide(guideJson);
const areaOf = (p) => guide.find((a) => a.rx.some((r) => r.test(p)))?.name ?? null;

const { sha, files } = readCommit(repo, commitArg, inScope);
const known = new Set(Object.keys(files));
const edges = [];
for (const p of [...known].sort()) {
  const ast = parseSource(files[p]);
  if (!ast) continue;
  const targets = new Set();
  for (const s of specsOf(ast)) {
    if (typeof s !== 'string' || !s.startsWith('.')) continue;
    const t = posix.normalize(posix.join(posix.dirname(p), s));
    if (known.has(t)) targets.add(t);
  }
  for (const t of [...targets].sort()) edges.push({ from: p, fromArea: areaOf(p), to: t, toArea: areaOf(t) });
}

const cross = edges.filter((e) => e.fromArea !== e.toArea);
const out = {
  commit: sha,
  guide: guideArg,
  files: known.size,
  edges: edges.length,
  crossAreaEdges: cross.length,
  edgeList: edges,
};
process.stdout.write(`${JSON.stringify(out)}\n`);
console.error(`edge-dump ${sha.slice(0, 8)}: ${known.size} files, ${edges.length} edges, ${cross.length} cross-area`);
