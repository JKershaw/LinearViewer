// Per-test-file profile, joined to the kill matrix: what each file is, what it kills, and whether it is inside a chosen set.
// Usage: node classify.mjs <worktree> <cov.json> <shape.json> <set.json> <out.json> <mut.json,...>
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const [work, covP, shapeP, setP, outP, mutPs] = process.argv.slice(2);
const cov = JSON.parse(readFileSync(covP, 'utf8'));
const shape = JSON.parse(readFileSync(shapeP, 'utf8'));
const set = new Set(JSON.parse(readFileSync(setP, 'utf8')).set);
const muts = mutPs.split(',').flatMap((p) => Object.values(JSON.parse(readFileSync(p, 'utf8'))));
const kills = (m) => m.confirmedFiles || m.killFiles || [];
const isProd = (p) => /^(lib|routes|public)\//.test(p) || p === 'server.js';

const lineCount = new Map();
for (const f of Object.keys(cov)) for (const [p, ls] of Object.entries(cov[f].cov)) if (isProd(p)) for (const l of ls) { const k = `${p}:${l}`; lineCount.set(k, (lineCount.get(k) || 0) + 1); }

const HELPER = /fixture|harness|network-guard|hermetic|listen-bind|mock-|should-mock|test-routes/;
const rows = [];
for (const f of Object.keys(cov)) {
  const src = readFileSync(resolve(work, f), 'utf8');
  const tests = shape.tests.filter((t) => t.repo === 'lv' && t.file === f);
  const byCls = tests.reduce((a, t) => ((a[t.cls] = (a[t.cls] || 0) + 1), a), {});
  const pinTests = (byCls['text pin'] || 0) + (byCls.census || 0) + (byCls['source scan'] || 0);
  let covLines = 0, uniq = 0;
  for (const [p, ls] of Object.entries(cov[f].cov)) if (isProd(p)) for (const l of ls) { covLines++; if (lineCount.get(`${p}:${l}`) === 1) uniq++; }
  const killed = muts.filter((m) => kills(m).includes(f));
  const sole = killed.filter((m) => kills(m).length === 1);
  rows.push({
    file: f, inSet: set.has(f), lines: src.split('\n').length, tests: tests.length, byCls, pinShare: tests.length ? +(pinTests / tests.length).toFixed(2) : 0,
    ticketNamed: /tests\/unit\/lin-?\d/.test(f), helper: HELPER.test(f), readsSource: /readFileSync\([^)]*(lib|routes|public|server\.js)/.test(src) || /sliceServerFunction|stripComments/.test(src),
    vmSandbox: /vm\.(runIn|Script|createContext)|runInContext|runInNewContext/.test(src), covLines, uniqueLines: uniq, ms: cov[f].ms,
    kills: killed.length, soleKills: sole.map((m) => m.id),
  });
}
writeFileSync(outP, JSON.stringify(rows, null, 1));
const S = rows.filter((r) => r.inSet), R = rows.filter((r) => !r.inSet);
const sum = (a, k) => a.reduce((x, r) => x + (typeof k === 'function' ? k(r) : r[k]), 0);
const pr = (name, a) => console.log(`${name}: files ${a.length}, lines ${sum(a, 'lines')}, tests ${sum(a, 'tests')}, ticket-named ${a.filter((r) => r.ticketNamed).length}, pin-majority ${a.filter((r) => r.pinShare > 0.5).length}, reads source ${a.filter((r) => r.readsSource).length}, vm ${a.filter((r) => r.vmSandbox).length}, helper ${a.filter((r) => r.helper).length}, kill nothing ${a.filter((r) => !r.kills).length}, coverage-ms ${sum(a, 'ms')}`);
pr('in set', S); pr('rest', R);
