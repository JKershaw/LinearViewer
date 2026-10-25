// Visual replay judge for the Settings untangle series (LIN-3886 / LIN-3887).
//
//   node tests/judge/visual-replay.mjs --base <rev> --head <rev> [--self-check] [--control]
//
//   (default)      base against head. Expected for a docs/tests-only move: zero differences.
//   --self-check   base against base (two exports, two ports, two data dirs). Must be zero.
//   --control [name]  positive controls (all, or those whose name contains [name]): a painted 1px line
//                  is planted on the HEAD export only (never the tree you are editing), once on
//                  .settings-row and once on .field. The pages that differ must be exactly the pages
//                  whose base render shows that selector outside any mask, computed from the DOM.
//
// Each side is `git archive` of its own commit in its own temp dir, with its own port and its own
// HARBOUR_DATA_DIR, and runs `node server.js` with the same env as playwright.visual.config.js.
// Servers are always killed. Test-side only: not part of `npm test`, no committed reference images.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NORMALISE, NOT_COVERED, PAGES, THEMES, VIEWPORTS, coverageOfChange, renderersOf } from './pages.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const git = (args, opts = {}) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };

// One painted pixel row on the piece. A layout-only +1px (a margin) is not a safe control: on desktop
// Sources and the Settings index the lone `.settings-row` sits in `.line.provider-binding`, which
// absorbs a 1px margin without moving one pixel (found in the first control run: same hash before
// and after). A painted line shows wherever the piece does.
const CONTROLS = [
  { name: '1px line on .settings-row', file: 'public/settings.css', css: '\n.settings-row { box-shadow: inset 0 1px 0 #f0f; }\n', probe: '.settings-row' },
  { name: '1px line on .field', file: 'public/style.css', css: '\n.field { box-shadow: inset 0 1px 0 #f0f; }\n', probe: '.field' },
];

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

const exportRev = (rev, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const tar = spawnSync('sh', ['-c', `git -C "${REPO}" archive ${rev} | tar -x -C "${dir}"`], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(`export of ${rev} failed: ${tar.stderr}`);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
};

const servers = [];
const killAll = () => { for (const s of servers.splice(0)) { try { process.kill(-s.pid, 'SIGKILL'); } catch { /* gone */ } } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killAll(); process.exit(130); });
process.on('exit', killAll);

async function startServer(dir, dataDir) {
  const port = await freePort();
  const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  const child = spawn('node', ['server.js'], {
    cwd: dir, detached: true, stdio: ['ignore', log, log],
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), SESSION_SECRET: 'test-secret-for-playwright',
      LINEAR_ACCESS_TOKEN: '', OPENROUTER_API_KEY: '', OPENROUTER_FREE_TIER_KEY: '', MONGODB_URI: '',
      HARBOUR_DATA_DIR: path.join(dataDir, 'data'),
      // The same email env as playwright.config.js: the capture transport, so `account-home` can sign in (LIN-3956).
      EMAIL_TRANSPORT: 'capture', EMAIL_LINK_ORIGIN: '', PUBLIC_ORIGIN: '',
    },
  });
  servers.push(child);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${url}/styleguide`)).ok) return url; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`server in ${dir} exited early; see ${dataDir}/server.log`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server in ${dir} did not start; see ${dataDir}/server.log`);
}

// One comparison: base export vs head export (optionally patched), returns the rows.
async function runPair({ baseRev, headRev, patch = null, probe = '' }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'harbour-judge-'));
  let keep = false;
  try {
    const sides = {};
    for (const [side, rev] of [['base', baseRev], ['head', headRev]]) {
      const dir = path.join(work, side);
      exportRev(rev, dir);
      if (side === 'head' && patch) fs.appendFileSync(path.join(dir, patch.file), patch.css);
      const dataDir = path.join(work, `${side}-run`);
      fs.mkdirSync(dataDir, { recursive: true });
      sides[side] = await startServer(dir, dataDir);
    }
    const results = path.join(work, 'results.jsonl');
    fs.writeFileSync(results, '');
    const run = spawnSync('npx', ['playwright', 'test', '--config', 'tests/judge/playwright.judge.config.js'], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28,
      env: {
        ...process.env, JUDGE_BASE_URL: sides.base, JUDGE_HEAD_URL: sides.head, JUDGE_RESULTS: results,
        JUDGE_SNAP_DIR: path.join(work, 'snaps'), JUDGE_PROBE_SELECTOR: probe,
      },
    });
    const rows = fs.readFileSync(results, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (!rows.length) throw new Error(`the judge produced no rows:\n${run.stdout}\n${run.stderr}`);
    // A run that stopped early (a crash, a killed server) must never read as "zero differences".
    const only = process.env.JUDGE_ONLY ? new RegExp(process.env.JUDGE_ONLY) : null;
    const expected = new Set(PAGES.filter((p) => !only || only.test(p.id)).flatMap((p) => VIEWPORTS.flatMap((v) => THEMES.map((t) => `${p.id} ${v.name} ${t}`))));
    const got = new Set(rows.map(key));
    const missing = [...expected].filter((k) => !got.has(k));
    if (missing.length) throw new Error(`INCOMPLETE: ${missing.length} of ${expected.size} comparisons never ran (first: ${missing[0]}):\n${run.stdout.slice(-1500)}\n${run.stderr.slice(-1500)}`);
    return { rows, playwrightStatus: run.status };
  } catch (err) {
    // The error cites server.log inside the work dir, so a failed run keeps it.
    keep = true;
    err.message += `\n(work dir kept: ${work})`;
    throw err;
  } finally {
    killAll();
    if (!keep) fs.rmSync(work, { recursive: true, force: true });
  }
}

const key = (r) => `${r.page} ${r.viewport} ${r.theme}`;

function printSummary(title, rows) {
  const byPage = new Map();
  for (const r of rows) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }
  console.log(`\n## ${title}`);
  console.log('page | combos | byte-equal | differ | differing pixels (viewport/theme: n, class) | retried | masked');
  for (const [page, rs] of byPage) {
    const bad = rs.filter((r) => r.result !== 'byte-equal');
    const detail = bad.map((r) => `${r.viewport}/${r.theme}: ${r.result === 'differs' ? `${r.pixels ?? '?'} (${r.class})` : r.result}`).join('; ') || '-';
    const masked = [...new Set(rs.flatMap((r) => r.masked))].join('; ') || '-';
    const retried = rs.filter((r) => r.attempts > 1).map((r) => `${r.viewport}/${r.theme} x${r.attempts}`).join('; ') || '-';
    console.log(`${page} | ${rs.length} | ${rs.length - bad.length} | ${bad.length} | ${detail} | ${retried} | ${masked}`);
  }
  const bad = rows.filter((r) => r.result !== 'byte-equal');
  const retried = rows.filter((r) => r.attempts > 1).length;
  console.log(`total: ${rows.length} comparisons, ${rows.length - bad.length} byte-equal, ${bad.length} not; ${retried} needed a retake (all attempts at zero tolerance)`);
  return bad;
}

const baseRev = opt('base');
const headRev = opt('head') || baseRev;
if (!baseRev) {
  console.error('usage: node tests/judge/visual-replay.mjs --base <rev> --head <rev> [--self-check] [--control]');
  process.exit(2);
}
const base = git(['rev-parse', '--verify', `${baseRev}^{commit}`]).trim();
const head = git(['rev-parse', '--verify', `${headRev}^{commit}`]).trim();
const lock = (rev) => { try { return git(['show', `${rev}:package-lock.json`]); } catch { return ''; } };
if (lock(base) !== lock(head)) {
  console.error('package-lock.json differs between base and head: the shared node_modules would not match one side. Refusing.');
  process.exit(2);
}

let failed = false;
const selfCheck = flag('self-check');
const control = flag('control');

if (selfCheck) {
  const { rows } = await runPair({ baseRev: base, headRev: base });
  const bad = printSummary(`self-check: base ${base.slice(0, 8)} against base`, rows);
  if (bad.length) failed = true;
  console.log(bad.length ? 'SELF-CHECK FAILED: noise between two identical exports; find the source and mask it.' : 'self-check: zero differences');
}

if (control) {
  const named = opt('control');
  const only = named && !named.startsWith('--') ? named : null;
  for (const c of CONTROLS.filter((x) => !only || x.name.includes(only))) {
    const { rows } = await runPair({ baseRev: base, headRev: base, patch: c, probe: c.probe });
    printSummary(`positive control (${c.name}, planted on the head export only)`, rows);
    const differing = new Set(rows.filter((r) => r.result !== 'byte-equal').map(key));
    const expected = new Set(rows.filter((r) => r.probe > 0).map(key));
    const missed = [...expected].filter((k) => !differing.has(k));
    const extra = [...differing].filter((k) => !expected.has(k));
    // A planted margin on a masked row can hide inside a mask but still moves everything below it, so
    // a combination whose probe is only inside a mask is reported, not failed.
    console.log(`control ${c.name}: ${differing.size} differing, ${expected.size} expected from the DOM (${c.probe} shown)`);
    if (missed.length) { failed = true; console.log(`  MISSED (selector shown, no difference): ${missed.join(', ')}`); }
    if (extra.length) { failed = true; console.log(`  UNEXPECTED (difference where selector is not shown): ${extra.join(', ')}`); }
    // With the probe shown on no page, both sets are empty and the control would pass on nothing.
    if (!expected.size) { failed = true; console.log(`  VACUOUS: ${c.probe} is shown on no page, so this control proves nothing`); }
    else if (!missed.length && !extra.length) console.log('  caught on exactly the pages that show the piece');
  }
}

if (!selfCheck && !control) {
  const changed = git(['diff', '--name-only', '--no-renames', base, head]).split('\n').filter(Boolean);
  const coverage = coverageOfChange(changed, (css) => renderersOf(REPO, head, css));
  const { rows } = await runPair({ baseRev: base, headRev: head });
  const bad = printSummary(`base ${base.slice(0, 8)} against head ${head.slice(0, 8)}`, rows);
  console.log(`changed stylesheets: ${coverage.changed.join(', ') || 'none'}`);
  if (coverage.uncovered.length) {
    failed = true;
    console.log('NOT ZERO-CLAIMABLE: a changed stylesheet is linked by a renderer on no listed page:');
    for (const u of coverage.uncovered) console.log(`  ${u.css}: ${u.renderers.join(', ')}`);
  }
  if (bad.length) failed = true;
  console.log(!failed ? 'RESULT: zero differences on the full page list' : 'RESULT: not zero (see above)');
}

console.log('\nnormalised text (rewritten identically on both sides):');
for (const n of NORMALISE) console.log(`  - /${n.pattern}/ -> ${n.replacement}: ${n.reason}`);
console.log('\nnot covered:');
for (const n of NOT_COVERED) console.log(`  - ${n}`);
process.exit(failed ? 1 : 0);
