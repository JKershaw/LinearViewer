// Copy a routes file into a private work dir as .mjs, rewriting relative
// import specifiers to absolute file: URLs inside the repo, so that every copy
// (old, new, mutants) shares one instance of each lib module.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// static `import ... from '…'`, `export ... from '…'`, bare `import '…'`,
// and dynamic `import('…')` with a string literal.
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

export function rewriteRelativeImports(source, repoRoutesDir) {
  const rewrites = [];
  const out = source.replace(SPEC_RE, (m, lead, q, spec) => {
    const abs = pathToFileURL(path.resolve(repoRoutesDir, spec)).href;
    rewrites.push({ from: spec, to: abs });
    return `${lead}${q}${abs}${q}`;
  });
  return { out, rewrites };
}

/**
 * @param {string} srcFile - routes file to copy (any location)
 * @param {string} destDir - private dir for this copy
 * @param {string} repoRoot - repo whose lib/ the copy must share
 * @param {(s:string)=>string} [transform] - optional source transform (planted mutations)
 */
export function prepareCopy(srcFile, destDir, repoRoot, transform = null) {
  mkdirSync(destDir, { recursive: true });
  let source = readFileSync(srcFile, 'utf8');
  if (transform) source = transform(source);
  const { out, rewrites } = rewriteRelativeImports(source, path.join(repoRoot, 'routes'));
  const dest = path.join(destDir, 'proxy-reads.mjs');
  writeFileSync(dest, out);
  return { dest, url: pathToFileURL(dest).href, rewrites, source: out };
}
