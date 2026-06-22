#!/usr/bin/env node
/**
 * Build the real-scale HAR-697 "red moment" fixture for the routing eval.
 *
 * The fixture (scripts/eval/fixtures/HAR-697-red.json) is GITIGNORED on purpose —
 * it carries real Harbour task text, and this is a public repo (see .gitignore:6).
 * So the fixture is regenerated locally from the proxy rather than committed; THIS
 * script is the committed, reproducible recipe (it holds no body text itself).
 *
 * "Red moment" = the divergence state the HAR-697 field report is about: AFTER the
 * HAR-705 live capture refuted the static module-load-stall root cause, but BEFORE
 * the review verdict filed HAR-707 as the fix. At that moment the honest next action
 * is to run the decisive experiment / re-investigate — yet the engine routes to
 * `implement` (fix-before-validate). We freeze it by keeping the first N comments
 * (default 3: investigation + HAR-705 refutation + addendum) and dropping the later
 * override note + review verdict that would otherwise hand the model "implement HAR-707".
 *
 * Output shape matches the routing harness's fixtures loader (a graded leaf case):
 *   { identifier, state, labels, createdAt, title, description, comments[],
 *     expect[], loop, avoid, scale, why }
 *
 * Usage:
 *   HARBOUR_PROXY_TOKEN=<read token> node scripts/eval/build-har697-red.mjs
 *
 * Env knobs:
 *   HARBOUR_PROXY_TOKEN / PROXY_TOKEN   proxy READ token for the Harbour workspace (required)
 *   HARBOUR_PROXY_BASE  / PROXY_BASE    proxy base URL (default https://projects.jkershaw.com/api/proxy)
 *   ISSUE        issue identifier        (default HAR-697)
 *   KEEP         comments to keep        (default 3 — the red moment, pre-HAR-707-filing)
 *
 * Context hygiene: prints only a metadata line (no body text) to stdout, matching
 * fetch-proxy-tasks.mjs — the bulk text goes to the fixture file only.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.HARBOUR_PROXY_TOKEN || process.env.PROXY_TOKEN;
if (!TOKEN) { console.error('Set HARBOUR_PROXY_TOKEN (proxy READ token for the Harbour workspace)'); process.exit(1); }
const BASE = process.env.HARBOUR_PROXY_BASE || process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy';
const ISSUE = process.env.ISSUE || 'HAR-697';
const KEEP = Number(process.env.KEEP) || 3;

const r = await fetch(`${BASE}/issues/${ISSUE}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
if (!r.ok) { console.error(`proxy ${r.status} on /issues/${ISSUE}`); process.exit(1); }
const d = await r.json();
if (d.error) { console.error(`proxy error: ${d.error} (${d.code || ''})`); process.exit(1); }

const comments = (d.comments || [])
  .slice(0, KEEP)
  .map(c => ({ user: (c.user || {}).name || 'agent', createdAt: c.createdAt, body: c.body }));

const fixture = {
  identifier: d.identifier,
  state: { name: 'In Progress', type: 'started' },
  labels: ['bug'],
  createdAt: d.createdAt,
  title: d.title,
  description: d.description,
  comments,
  // grading sidecar (read by eval-research-routing.mjs fixtures loader)
  expect: ['bug', 'research'],
  loop: true,
  avoid: 'implement',
  scale: 'real (frozen at the red moment: cause refuted, HAR-707 not yet filed)',
  why: 'REAL full-scale HAR-697 frozen after HAR-705 refuted the module-load-stall cause and '
    + 'before the review filed HAR-707. The refutation is buried after a multi-thousand-char '
    + 'investigation that ends "ready to hand to an implementation task", so the trail is dense '
    + 'with fix-oriented prose around a refuted, unvalidated cause whose decisive live experiment '
    + 'never passed. Correct: re-investigate / run the decisive experiment; advancing to implement '
    + 'is the fix-before-validate trap. Real-scale counterpart to the forgiving synthetic SYN-21.'
};

const OUT = join(HERE, 'fixtures');
mkdirSync(OUT, { recursive: true });
const path = join(OUT, 'HAR-697-red.json');
writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');

// Metadata only — no body text to stdout.
const descLen = (fixture.description || '').length;
const cmtChars = comments.reduce((n, c) => n + (c.body || '').length, 0);
console.log(`wrote ${path}`);
console.log(`${fixture.identifier}  kept ${comments.length}/${(d.comments || []).length} comments  `
  + `desc ${descLen} + comments ${cmtChars} = ${descLen + cmtChars} chars (~${Math.round((descLen + cmtChars) / 4)} tokens)`);
