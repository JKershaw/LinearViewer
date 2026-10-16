// Make an arbitrary copy of render-roadmap.js importable: copy it into a
// private work dir as .mjs with every relative import specifier rewritten to an
// absolute file:// URL into a LinearViewer lib/ directory (main's by default).
// The rewrite is in-place on the import lines, so line numbers are preserved
// and coverage line numbers map 1:1 onto the original file.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_LIB = '/home/user/LinearViewer/lib';

// Matches: import ... from './x'  |  export ... from '../x'  |  import './x'  |  import('./x')
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

export function rewriteImports(src, libDir) {
  const rewritten = [];
  const missing = [];
  const out = src.replace(SPEC_RE, (m, lead, q, spec) => {
    const abs = path.resolve(libDir, spec);
    if (!fs.existsSync(abs)) missing.push(spec);
    const url = pathToFileURL(abs).href;
    rewritten.push({ spec, to: url });
    return `${lead}${q}${url}${q}`;
  });
  return { out, rewritten, missing };
}

export function prepareRenderer(srcFile, { label, workDir, libDir = DEFAULT_LIB }) {
  const src = fs.readFileSync(srcFile, 'utf8');
  const { out, rewritten, missing } = rewriteImports(src, libDir);
  if (missing.length) {
    throw new Error(`${label}: relative imports not found under ${libDir}: ${missing.join(', ')} (pass --${label}-lib <dir>)`);
  }
  if (out.split('\n').length !== src.split('\n').length) throw new Error('line count changed by rewrite');
  const hash = crypto.createHash('sha256').update(out).digest('hex').slice(0, 12);
  fs.mkdirSync(workDir, { recursive: true });
  const dest = path.join(workDir, `${label}-${hash}.mjs`);
  fs.writeFileSync(dest, out);
  return { src: path.resolve(srcFile), dest, url: pathToFileURL(dest).href, hash, rewritten, libDir };
}

export async function importRenderer(prep) {
  const mod = await import(prep.url);
  if (typeof mod.renderRoadmapPage !== 'function') {
    throw new Error(`${prep.src}: no renderRoadmapPage export (exports: ${Object.keys(mod).join(', ')})`);
  }
  return mod;
}
