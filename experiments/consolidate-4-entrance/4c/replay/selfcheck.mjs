#!/usr/bin/env node
// Self-check for the entrance replay (#4b; mutants re-targeted at 47d87055 for #4c):
//   (1) identity: the base tree vs an independently pinned copy of the same SHA,
//       on two seeds, all tiers → 0 differences, entrance-unit line coverage >= 95%;
//   (2) planted mutants on the base tree (a gate dropped in one entrance, a reply
//       field changed, a key-order swap, a store argument, a shared relay): each
//       must be detected in an expected kind on exactly its expected entrance(s);
//   (3) an equivalent mutant (a rewrite with the same bytes on the wire) → 0.
//
//   node selfcheck.mjs --base <tree> --twin <tree pinned from the same SHA>
//                      [--n 6000] [--entrance-n 3000] [--seeds 1,7]
//                      [--mutant-n 2000] [--mutant-entrance-n 1000] [--jobs 3] [--out reports/selfcheck.json]
// Mutant trees are written under work/selfcheck-<pid>/ and kept.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = path.resolve(arg('--base', ''));
const TWIN = path.resolve(arg('--twin', ''));
const N = Number(arg('--n', 6000));
const EN = Number(arg('--entrance-n', 3000));
const MN = Number(arg('--mutant-n', 2000));
const MEN = Number(arg('--mutant-entrance-n', 1000));
const SEEDS = arg('--seeds', '1,7').split(',').map(Number);
const JOBS = Number(arg('--jobs', 3));
const OUT = path.resolve(arg('--out', path.join(TOOL, 'reports', 'selfcheck.json')));
if (!existsSync(path.join(BASE, 'routes')) || !existsSync(path.join(TWIN, 'routes'))) { process.stderr.write('usage: node selfcheck.mjs --base <tree> --twin <tree>\n'); process.exit(2); }

const S = 'POST /workspace/:urlKey/api/dispatch';
const P = 'POST /api/proxy/dispatch';
const R = 'POST /api/proxy/recommend-and-dispatch';
const K = 'POST /api/proxy/autopilot/kickoff';
const ANY_KINDS = null; // any kind counts as detection

// #4c: the same planted changes, re-targeted at 47d87055, where the four POST handlers are
// forwarders and their decisions live in lib/dispatch-entrance.js (the #4b mutants, which
// targeted the 15191460 route files, are in ../../b/replay/selfcheck.mjs). Two shared
// mutants now reach more entrances than before, because the code they touch is shared:
// `shared-relay` (the attach-failure 503 is one branch for P, R and K) and `p-log` (the
// cascade expansion is one method for S and P; S has no audit log, so only P differs).
const E = 'lib/dispatch-entrance.js';
const MUTANTS = [
  { id: 's-gate', file: E, what: 'session entrance drops the LIN-3383 owner gate',
    from: "    if (await ctx.ownerGate(target ?? 'cli')) return;\n", to: '',
    expect: { kinds: ANY_KINDS, endpoints: [S] } },
  { id: 's-reply', file: E, what: 'session 201 item drops `kind`',
    from: '        kind: item.kind,\n        issueIdentifier: item.issueIdentifier,\n        target: item.target,\n        dispatchedAt: item.dispatchedAt,',
    to: '        issueIdentifier: item.issueIdentifier,\n        target: item.target,\n        dispatchedAt: item.dispatchedAt,',
    expect: { kinds: ['body', 'bodyBytes'], endpoints: [S] } },
  { id: 's-store-arg', file: E, what: 'session row stamps queueIfBusy false',
    from: 'waitForFollowUps, queueIfBusy, subscription, maxTasks, stopAt, variant, issueSource, stampsOnAbort: true }',
    to: 'waitForFollowUps, queueIfBusy: false, subscription, maxTasks, stopAt, variant, issueSource, stampsOnAbort: true }',
    expect: { kinds: ['store:dispatchQueueStore'], endpoints: [S] } },
  { id: 's-mint-label', file: E, what: "session launch attach label 'dispatch-bootstrap' → 'dispatch'",
    from: "      label: 'dispatch-bootstrap',\n      policy: proxyContextPolicy({ followUpTo, appendProxyContext: attachProxy, optIn: true, isAbort }),",
    to: "      label: 'dispatch',\n      policy: proxyContextPolicy({ followUpTo, appendProxyContext: attachProxy, optIn: true, isAbort }),",
    expect: { kinds: ['store:proxyTokenStore'], endpoints: [S] } },
  { id: 'p-gate', file: E, what: 'proxy dispatch drops the dangling-referent guard',
    from: '      const referent = { provider: providerAccess.provider, token: providerAccess.accessToken };\n      if (await kit.refuseDangling(referent, issueIdentifier)) return;',
    to: '      const referent = { provider: providerAccess.provider, token: providerAccess.accessToken };\n      if (false && await kit.refuseDangling(referent, issueIdentifier)) return;',
    expect: { kinds: ANY_KINDS, endpoints: [P] } },
  { id: 'p-reply', file: E, what: 'proxy dispatch 201 drops `cascade`',
    from: '      abortTo: item.abortTo || null,\n      cascade: item.cascade === true\n    }));',
    to: '      abortTo: item.abortTo || null\n    }));',
    expect: { kinds: ['body', 'bodyBytes'], endpoints: [P] } },
  { id: 'p-log', file: E, what: 'cascade expansion audits 201 as 200 (shared by S and P; only P audits)',
    from: '      if (logEvent) logEvent(req, endpoint, 201);\n      return res.status(201).json({ success: true, cascade: true, ...result });',
    to: '      if (logEvent) logEvent(req, endpoint, 200);\n      return res.status(201).json({ success: true, cascade: true, ...result });',
    expect: { kinds: ['logEvent', 'store:proxyEventStore'], endpoints: [P] } },
  { id: 'r-gate', file: E, what: 'recommend-and-dispatch drops the fetchRecommendationContext capability gate',
    from: "strict: true, alsoRequires: 'fetchRecommendationContext' });", to: 'strict: true });',
    expect: { kinds: ANY_KINDS, endpoints: [R] } },
  { id: 'r-reply', file: E, what: 'override arm 201 drops `override: true`',
    from: "receiptFor('proxy', item, { override: true })", to: "receiptFor('proxy', item, {})",
    expect: { kinds: ['body', 'bodyBytes', 'serverResponse'], endpoints: [R] } },
  { id: 'shared-relay', file: E, what: 'shared failure(): attach-failed 503 → 502 (P, R and K share the branch)',
    from: '          logEvent(req, endpoint, 503);\n          return reply(503, ctx.PROXY_ATTACH_FAILED_MESSAGE);',
    to: '          logEvent(req, endpoint, 502);\n          return reply(502, ctx.PROXY_ATTACH_FAILED_MESSAGE);',
    expect: { kinds: ANY_KINDS, endpoints: [P, R, K], all: true } },
  { id: 'k-gate', file: E, what: 'kickoff drops the store-missing 503',
    from: "  const kit = createKit(ctx, 'kickoff');\n  if (kit.storeMissing()) return;\n", to: "  const kit = createKit(ctx, 'kickoff');\n",
    expect: { kinds: ANY_KINDS, endpoints: [K] } },
  { id: 'k-reply', file: E, what: 'kickoff 201 drops `mode`',
    from: '      mode: extra.mode,\n', to: '',
    expect: { kinds: ['body', 'bodyBytes'], endpoints: [K] } },
  { id: 'k-keyorder', file: E, what: 'kickoff 201 key order: id/sessionId swapped (deep-equal JSON)',
    from: '      id: item._id,\n      sessionId: item._id,', to: '      sessionId: item._id,\n      id: item._id,',
    expect: { kinds: ['bodyBytes', 'header-derived:etag'], endpoints: [K], forbidKinds: ['body'] } },
  { id: 'k-order', file: E, what: 'kickoff checks target before goal (first-failure order)',
    from: "const KICKOFF_STEPS = ['mode', 'variantEnum', 'goal', 'target',", to: "const KICKOFF_STEPS = ['mode', 'variantEnum', 'target', 'goal',",
    expect: { kinds: ['body', 'bodyBytes'], endpoints: [K] } },
  { id: 'r-grant', file: 'routes/proxy-dispatch.js', what: "recommend-and-dispatch registration drops requireGrant('dispatch')",
    from: "router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async",
    to: "router.post('/api/proxy/recommend-and-dispatch', proxyLimiter, authenticateProxyToken, requireWriteScope, async",
    expect: { kinds: ['store:dispatchQueueStore'], endpoints: [R] } },
  { id: 'k-grant', file: 'routes/proxy-kickoff.js', what: "kickoff registration drops requireGrant('dispatch')",
    from: "router.post('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async",
    to: "router.post('/api/proxy/autopilot/kickoff', proxyLimiter, authenticateProxyToken, requireWriteScope, async",
    expect: { kinds: ['store:dispatchQueueStore'], endpoints: [K] } },
  // New at #4c: the declared-launch mint (M1 kickoff, M2 session autopilot) loses its grant.
  { id: 'm-declare', file: E, what: "kickoff launch (M1) mints without the dispatch grant declaration",
    from: "      declare: 'M1',", to: '      declare: null,',
    expect: { kinds: ['store:proxyTokenStore'], endpoints: [K] } },
  // New at #4c (constraints.md A1): lin-3134's text-only "mutation 1", the follow-up gate
  // rewritten to `if (prompt)`. With one shared finalizePrompt it is behaviour-visible: every
  // launch with a prompt takes the resume path, which declares nothing (M1, M2 lose the grant).
  { id: 'gate-to-prompt', file: E, what: "follow-up gate `if (isFollowUp)` → `if (prompt)` (lin-3134 mutation 1)",
    from: '          if (isFollowUp) {\n            return provisionResumeCredential({', to: '          if (prompt) {\n            return provisionResumeCredential({',
    expect: { kinds: ANY_KINDS, endpoints: [S, P, R, K] } },
  { id: 'eq-dispatchedAt', file: E, what: 'EQUIVALENT: kickoff dispatchedAt without the toISOString step (same JSON bytes)',
    from: '      dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,\n      maxTasks: item.maxTasks,', to: '      dispatchedAt: item.dispatchedAt,\n      maxTasks: item.maxTasks,',
    expect: { equivalent: true } },
  // New at #4c: the census-only shape lin-3134 C2 (ii) asks for (an inline, spread-free `fields`)
  // is behaviour-neutral: `fields: row` sends the factory the same keys (it drops the
  // undefined ones), so the store sees the same row.
  { id: 'eq-fields-row', file: E, what: 'EQUIVALENT: createDispatchItem takes `fields: row` instead of the inline 22-key literal',
    fromRe: '        fields: \\{\\n(?:          \\w+: row\\.\\w+,?\\n)+        \\}\\n', to: '        fields: row\n',
    expect: { equivalent: true } },
];

const dir = path.join(TOOL, 'work', `selfcheck-${process.pid}`);
mkdirSync(dir, { recursive: true });
// A mutant tree: routes/, lib/, server.js, package.json copied; everything else symlinked.
function mutantTree(m) {
  const out = path.join(dir, m.id);
  mkdirSync(out, { recursive: true });
  for (const e of readdirSync(BASE)) {
    const src = path.join(BASE, e);
    if (['routes', 'lib', 'server.js', 'package.json', '.replay-sha'].includes(e)) cpSync(src, path.join(out, e), { recursive: true });
    else symlinkSync(src, path.join(out, e));
  }
  const f = path.join(out, m.file);
  const text = readFileSync(f, 'utf8');
  writeFileSync(f, m.fromRe ? text.replace(new RegExp(m.fromRe), m.to) : text.replace(m.from, m.to));
  return out;
}

const ONLY = arg('--mutants', null)?.split(',');
const SKIP_IDENTITY = process.argv.includes('--skip-identity');
const jobs = [];
for (const seed of SKIP_IDENTITY ? [] : SEEDS) jobs.push({ label: `identity-seed${seed}`, a: BASE, b: TWIN, seed, n: N, en: EN, coverage: true });
const meta = {};
for (const m of MUTANTS.filter(x => !ONLY || ONLY.includes(x.id))) {
  const baseText = readFileSync(path.join(BASE, m.file), 'utf8');
  const occ = m.fromRe ? (baseText.match(new RegExp(m.fromRe, 'g')) || []).length : baseText.split(m.from).length - 1;
  meta[m.id] = { m, occ };
  if (occ !== 1) continue;
  jobs.push({ label: m.id, a: BASE, b: mutantTree(m), seed: SEEDS[0], n: MN, en: MEN });
}

const run = (j) => new Promise((resolve) => {
  const rep = path.join(dir, `${j.label}.json`);
  const args = [path.join(TOOL, 'replay.mjs'), '--old', j.a, '--new', j.b, '--seed', String(j.seed), '--n', String(j.n), '--entrance-n', String(j.en), '--out', rep, '--quiet', ...(j.coverage ? ['--coverage'] : [])];
  const t0 = Date.now();
  const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stdout.on('data', () => {}); p.stderr.on('data', (c) => { err += c; });
  p.on('close', (code) => resolve({ ...j, code, ms: Date.now() - t0, report: existsSync(rep) ? JSON.parse(readFileSync(rep, 'utf8')) : null, err: err.slice(-1500) }));
});
process.stdout.write(`self-check: ${jobs.length} replay runs (${JOBS} at a time); identity n=${N}+entrance ${EN} (+edge+test) on seeds ${SEEDS.join(',')}; mutants n=${MN}+entrance ${MEN}\n`);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: JOBS }, async () => { while (next < jobs.length) results.push(await run(jobs[next++])); }));
const by = Object.fromEntries(results.map(r => [r.label, r]));

const summary = { base: BASE, twin: TWIN, baseSha: readSha(BASE), twinSha: readSha(TWIN), n: N, entranceN: EN, mutantN: MN, mutantEntranceN: MEN, seeds: SEEDS, checks: [], coverage: {} };
function readSha(t) { try { return readFileSync(path.join(t, '.replay-sha'), 'utf8').trim(); } catch { return null; } }
for (const seed of SKIP_IDENTITY ? [] : SEEDS) {
  const r = by[`identity-seed${seed}`];
  const rep = r.report;
  const ok = rep && !rep.fatal && rep.summary.differingRequests === 0 && Object.values(rep.exportsDiff).every(d => d.length === 0);
  summary.checks.push({ id: `identity-seed${seed}`, what: 'base vs an independently pinned twin of the same SHA', pass: !!ok, requests: rep?.summary?.requests, perTier: rep?.summary?.perTier, perEntrance: rep?.perEntrance, differing: rep?.summary?.differingRequests, groups: (rep?.differences || []).map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: r.ms, error: rep?.fatal || (rep ? undefined : r.err) });
  if (rep?.entranceCoverage) summary.coverage[`seed${seed}`] = rep.entranceCoverage.old;
}
for (const [id, { m, occ }] of Object.entries(meta)) {
  if (occ !== 1) { summary.checks.push({ id, what: m.what, pass: false, error: `mutation site found ${occ} times (need 1)` }); continue; }
  const r = by[id];
  const rep = r.report;
  if (!rep || rep.fatal) { summary.checks.push({ id, what: m.what, pass: false, error: rep?.fatal || r.err }); continue; }
  const groups = rep.differences.map(g => ({ endpoint: g.endpoint, kind: g.kind, count: g.count }));
  if (m.expect.equivalent) {
    summary.checks.push({ id, what: m.what, pass: groups.length === 0, differing: rep.summary.differingRequests, groups: groups.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: r.ms });
    continue;
  }
  const kindOk = (g) => !m.expect.kinds || m.expect.kinds.includes(g.kind);
  const detected = groups.filter(g => kindOk(g) && m.expect.endpoints.includes(g.endpoint));
  const offTarget = groups.filter(g => !m.expect.endpoints.includes(g.endpoint));
  const forbidden = groups.filter(g => (m.expect.forbidKinds || []).includes(g.kind));
  const everyEndpoint = !m.expect.all || m.expect.endpoints.every(e => detected.some(g => g.endpoint === e));
  summary.checks.push({ id, what: m.what, pass: detected.length > 0 && offTarget.length === 0 && forbidden.length === 0 && everyEndpoint, differing: rep.summary.differingRequests, detectedIn: detected.map(g => `${g.endpoint.split(' ')[1]} ${g.kind} x${g.count}`), groups: groups.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), offTarget: offTarget.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: r.ms });
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2));
for (const c of summary.checks) {
  process.stdout.write(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(18)} ${c.what}  differing=${c.differing ?? '-'}${c.detectedIn ? `  detected: ${c.detectedIn.join(', ')}` : ''}${c.error ? `  error: ${String(c.error).split('\n').slice(-3).join(' | ')}` : ''}\n`);
  if (!c.pass) for (const g of c.groups || []) process.stdout.write(`        ${g}\n`);
}
for (const [seed, c] of Object.entries(summary.coverage)) process.stdout.write(`entrance-unit coverage ${seed}: ${c.pct}% (${c.coveredLines}/${c.executableLines}); uncovered: ${c.uncovered.join(', ') || 'none'}\n`);
process.stdout.write(`self-check report: ${OUT}\n`);
process.exit(summary.checks.every(c => c.pass) && Object.values(summary.coverage).every(c => c.pct >= 95) ? 0 : 1);
