// Recorder shared by the generated shims: snapshot each call's arguments
// (transport-encoded, then v8-serialized) BEFORE delegating, dedupe, cap per
// export, and write everything at exit.
import fs from 'node:fs';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { toTransport } from './encode.mjs';

const CANON = new Set(['LinearProvider', 'GitHubProvider', 'GitHubProjectsProvider', 'JiraProvider', 'LocalProvider']);
const providerIds = {
  has(o) { return !!(o && typeof o === 'object' && CANON.has(o.constructor?.name) && typeof o.name === 'string'); },
  get(o) { return o.name; }
};
const records = [];
const seen = new Set();
const perExport = new Map();
const CAP = Number(process.env.REPLAY_CAP || 80);

function callsite() {
  const lines = new Error().stack.split('\n');
  const f = lines.find(l => l.includes('/tests/unit/'));
  const m = f && f.match(/\/tests\/unit\/([^\s):]+):(\d+):\d+/);
  if (m) return `${m[1]}:${m[2]}`;
  const g = lines.slice(3).find(l => /\/(routes|lib|server)/.test(l) && !l.includes('capture-'));
  const m2 = g && g.match(/\/((?:routes|lib)\/[^\s):]+|server\.js):(\d+):\d+/);
  return m2 ? `via ${m2[1]}:${m2[2]}` : 'unknown';
}

export function record(mod, name, args) {
  const key = `${mod}.${name}`;
  const n = perExport.get(key) || 0;
  if (n >= CAP) return;
  let payload;
  try {
    payload = v8.serialize(toTransport(Array.from(args), providerIds));
  } catch (e) {
    records.push({ mod, name, site: callsite(), error: `not serializable: ${e.message}` });
    return;
  }
  const h = crypto.createHash('sha1').update(key).update(payload).digest('hex');
  if (seen.has(h)) return;
  seen.add(h);
  perExport.set(key, n + 1);
  records.push({ mod, name, site: callsite(), argc: args.length, payload });
}

process.on('exit', () => {
  try { fs.writeFileSync(process.env.REPLAY_CAPTURE_OUT, v8.serialize(records)); } catch { /* ignore */ }
});
