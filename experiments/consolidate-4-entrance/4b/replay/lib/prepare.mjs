// Resolve `--old/--new <tree>` into a side: a complete source tree (routes/,
// lib/, server.js) pinned by pin-side.mjs (or any checkout / git archive).
import { statSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SLOT_FILES = {
  session: { file: 'routes/dispatch.js', factory: 'createDispatchRoutes' },
  proxyDispatch: { file: 'routes/proxy-dispatch.js', factory: 'createDispatchRoutes' },
  kickoff: { file: 'routes/proxy-kickoff.js', factory: 'createKickoffRoutes' },
};

// The entrance handlers whose line coverage the self-check holds to >= 95%.
export const ENTRANCE_ROUTES = [
  { slot: 'session', file: 'routes/dispatch.js', marker: "router.post('/workspace/:urlKey/api/dispatch'," },
  { slot: 'proxyDispatch', file: 'routes/proxy-dispatch.js', marker: "router.post('/api/proxy/dispatch'," },
  { slot: 'proxyDispatch', file: 'routes/proxy-dispatch.js', marker: "router.post('/api/proxy/recommend-and-dispatch'," },
  { slot: 'kickoff', file: 'routes/proxy-kickoff.js', marker: "router.post('/api/proxy/autopilot/kickoff'," },
];

/** @returns {{label, root, sha, files: Record<slot, {path, url}>}} */
export function resolveSide(label, spec) {
  const root = path.resolve(spec);
  let st;
  try { st = statSync(root); } catch { throw new Error(`no such folder: ${root}`); }
  if (!st.isDirectory()) throw new Error(`--old/--new take a tree folder (routes/ + lib/), got a file: ${root}`);
  const files = {};
  for (const [slot, def] of Object.entries(SLOT_FILES)) {
    const p = path.join(root, def.file);
    if (!existsSync(p)) throw new Error(`${label}: ${def.file} missing under ${root}`);
    files[slot] = { path: p, url: `${pathToFileURL(p).href}?side=${label}` };
  }
  for (const need of ['lib/dispatch-factory.js', 'lib/errors.js']) if (!existsSync(path.join(root, need))) throw new Error(`${label}: ${need} missing under ${root} (not a full tree?)`);
  let sha = null;
  try { sha = readFileSync(path.join(root, '.replay-sha'), 'utf8').trim(); } catch { /* not pinned by pin-side.mjs */ }
  return { label, root, sha, files };
}

/** 1-based [start, end] line span of the registration that begins at `marker` (balanced parens). */
export function handlerSpan(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = src.indexOf('(', at);
  let depth = 0;
  let i = open;
  let q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) break; }
  }
  const line = (off) => src.slice(0, off).split('\n').length;
  return [line(at), line(i)];
}
