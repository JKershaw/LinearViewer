// Recording stand-in for lib/render-roadmap.js (capture phase only). Snapshots
// each call's (data, options) with v8 structured serialization (Maps survive)
// BEFORE delegating to the real renderer, then writes them all at exit.
import fs from 'node:fs';
import v8 from 'node:v8';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const real = await import(pathToFileURL(path.join(process.env.REPLAY_LIB, 'render-roadmap.js')).href);
const records = [];
const perSite = new Map();

function callsite() {
  const stack = new Error().stack.split('\n');
  const frame = stack.find(l => l.includes('/tests/') && !l.includes('capture-shim'));
  const m = frame && frame.match(/\/tests\/[^\s)]*?([^/\s)]+):(\d+):\d+/);
  return m ? `${m[1]}:${m[2]}` : 'unknown';
}

export function renderRoadmapPage(data, options) {
  const site = callsite();
  const n = (perSite.get(site) || 0) + 1;
  perSite.set(site, n);
  let snapshot;
  try {
    snapshot = v8.serialize({ data, options, argc: arguments.length });
  } catch (e) {
    snapshot = null;
    records.push({ site, n, error: `not serializable: ${e.message}` });
  }
  if (snapshot) records.push({ site, n, payload: snapshot });
  return real.renderRoadmapPage.apply(this, arguments);
}

process.on('exit', () => {
  fs.writeFileSync(process.env.REPLAY_CAPTURE_OUT, v8.serialize(records));
});
