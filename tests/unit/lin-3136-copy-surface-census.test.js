/**
 * LIN-3136 C5 — the copy-surface census (acceptance 13, client side).
 *
 * A forced copy (`maybeAppend(..., { force })`) mints the owner's DRIVER copy,
 * which holds the dispatch grant; an unforced one is the grant-less toggle
 * path. This census keeps that class closed:
 *  C5a every `maybeAppend(` / `maybeAppendProxyBlock(` caller in public/ is
 *      listed; `driver-forced` sites pass the literal `true`,
 *      `driver-conditional` sites pass a variable whose derivation is pinned
 *      right above the call, and no listed site passes `false`;
 *  C5b `getOrCreateToken(` has exactly one caller, inside `maybeAppend`;
 *  C5c the forced-container emitters (`data-proxy-force="true"`,
 *      `proxyForce: true`, the `"runner"` rung) are listed;
 *  C5d every browser POST to `/api/proxy/tokens` is listed (the three common.js
 *      mints, plus the two Settings mints, which are out: grant-less);
 *  C5e the dispatch-forced sites, which mint server-side (M2), are pinned.
 *
 * The scanners are pure functions over `{file, src}`, so the mutation witnesses
 * plant a change in a synthetic copy and assert the scan fails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

function jsFiles(dir) {
  return readdirSync(join(REPO, dir), { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => `${dir}/${e.name}`);
}

const SOURCES = [...jsFiles('public'), ...jsFiles('lib')]
  .map(file => ({ file, src: readFileSync(join(REPO, file), 'utf8') }));

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** Non-comment lines of every file, with their 0-based index. */
function codeLines(files) {
  const out = [];
  for (const { file, src } of files) {
    const lines = src.split('\n');
    lines.forEach((line, i) => { if (!isComment(line)) out.push({ file, i, line, text: line.trim(), lines }); });
  }
  return out;
}

// ── C5a — copy callers ──────────────────────────────────────────────────────

const COPY_SITES = [
  {
    file: 'public/app.js', class: 'driver-conditional', count: 1,
    call: 'textToCopy = await maybeAppendProxyBlock(textToCopy, urlKey, { force: forceProxy })',
    derivation: "const forceProxy = promptContainer.dataset.proxyForce === 'true'",
    reason: 'home/issue Autopilot and periodical "+ Autopilot" copy (render.js data-proxy-force containers)'
  },
  {
    file: 'public/app.js', class: 'driver-conditional', count: 1,
    call: 'textToDownload = await maybeAppendProxyBlock(textToDownload, urlKey, { force: forceProxy })',
    derivation: "const forceProxy = promptContainer.dataset.proxyForce === 'true'",
    reason: 'the same containers, download'
  },
  {
    file: 'public/prompt-section.js', class: 'driver-conditional', count: 2,
    call: 'const text = await window.ProxyToggle.maybeAppend(raw, opts.urlKey, { force });',
    derivation: 'const force = !!(state.result && state.result.proxyForce);',
    reason: 'prompt-section Autopilot result copy and download (proxyForce set only on the autopilot entry)'
  },
  {
    file: 'public/flight-companion.js', class: 'driver-forced', count: 1,
    call: 'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: true });',
    reason: 'Flight Companion copy (behind the proxy feature gate)'
  },
  {
    file: 'public/passage-planner.js', class: 'driver-forced', count: 1,
    call: 'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: true });',
    reason: 'Passage Planner copy (behind the proxy feature gate)'
  }
];

const COPY_CALL = /\bmaybeAppend(ProxyBlock)?\(/;
const COPY_EXCLUDED = ['async function maybeAppend(', 'window.maybeAppendProxyBlock = ('];

function forceExpr(text) {
  const m = text.match(/\{\s*force(?:\s*:\s*([^}]+?))?\s*\}/);
  if (!m) return null;
  return m[1] === undefined ? 'force' : m[1].trim();
}

function scanCopyCallers(files, table = COPY_SITES) {
  const offenders = [];
  const seen = new Map();
  for (const row of codeLines(files)) {
    if (!COPY_CALL.test(row.line) || COPY_EXCLUDED.some(x => row.text.startsWith(x))) continue;
    const site = table.find(s => s.file === row.file && s.call === row.text);
    if (!site) { offenders.push({ kind: 'unlisted', file: row.file, line: row.i + 1, text: row.text }); continue; }
    seen.set(site, (seen.get(site) || 0) + 1);
    const expr = forceExpr(row.text);
    if (expr === null || expr === 'false') {
      offenders.push({ kind: 'force-false', file: row.file, line: row.i + 1, text: row.text });
      continue;
    }
    if (site.class === 'driver-forced' && expr !== 'true') {
      offenders.push({ kind: 'forced-not-literal-true', file: row.file, line: row.i + 1, text: row.text });
    }
    if (site.class === 'driver-conditional') {
      const above = row.lines.slice(Math.max(0, row.i - 4), row.i).map(l => l.trim());
      if (!above.includes(site.derivation)) {
        offenders.push({ kind: 'derivation-moved', file: row.file, line: row.i + 1, text: row.text });
      }
    }
  }
  for (const site of table) {
    if ((seen.get(site) || 0) !== site.count) {
      offenders.push({ kind: 'stale', file: site.file, text: site.call, expected: site.count, found: seen.get(site) || 0 });
    }
  }
  return offenders;
}

// ── C5b — the one mint caller ───────────────────────────────────────────────

function scanMintCallers(files) {
  const calls = codeLines(files).filter(r => /\bgetOrCreateToken\(/.test(r.line) && !r.text.includes('function getOrCreateToken('));
  const offenders = [];
  if (calls.length !== 1) offenders.push({ kind: 'caller-count', found: calls.map(c => `${c.file}:${c.i + 1}`) });
  for (const c of calls) {
    const src = c.lines.join('\n');
    const start = src.indexOf('async function maybeAppend(');
    const end = src.indexOf('\n  }\n', start);
    const at = c.lines.slice(0, c.i).join('\n').length;
    if (c.file !== 'public/common.js' || start < 0 || at < start || at > end) {
      offenders.push({ kind: 'caller-outside-maybeAppend', file: c.file, line: c.i + 1 });
    }
  }
  return offenders;
}

// ── C5c — forced emitters ───────────────────────────────────────────────────

const EMITTERS = [
  { file: 'lib/render.js', snippet: `const proxyForceAttr = proxyForce ? ' data-proxy-force="true"' : ''`, class: 'copy-container', reason: 'the attribute write, gated by the proxyForce option' },
  { file: 'lib/render.js', snippet: 'proxyForce: true', class: 'copy-container', reason: 'its sole proxyForce:true caller: the periodical "+ Autopilot" variant' },
  { file: 'public/prompt-section.js', snippet: "kind: result.kind || 'autopilot', raw: result.prompt, html, proxyForce: true", class: 'copy-container', reason: 'the Autopilot result entry' },
  { file: 'public/prompt-section.js', snippet: `' data-proxy-force="runner"'`, class: 'dispatch-rung', reason: 'LIN-3098 N3 run-step rung: dispatch only, never reaches maybeAppend' },
  { file: 'public/next-run.js', snippet: 'proxyForce: true,', class: 'dispatch', reason: 'next-run autopilot dispatch: server-side mint' }
];
const EMITTER_TOKENS = ['data-proxy-force="true"', 'proxyForce: true', 'data-proxy-force="runner"'];

function scanEmitters(files, table = EMITTERS) {
  const offenders = [];
  const seen = new Set();
  for (const row of codeLines(files)) {
    if (!EMITTER_TOKENS.some(t => row.line.includes(t))) continue;
    const hit = table.find(e => e.file === row.file && row.line.includes(e.snippet));
    if (!hit) offenders.push({ kind: 'unlisted', file: row.file, line: row.i + 1, text: row.text.slice(0, 120) });
    else seen.add(hit);
  }
  for (const e of table) if (!seen.has(e)) offenders.push({ kind: 'stale', file: e.file, snippet: e.snippet });
  return offenders;
}

// ── C5d — browser token-mint POSTs ──────────────────────────────────────────

const MINT_POSTS = [
  { file: 'public/common.js', body: "body: JSON.stringify({ label: 'prompt-proxy', scope: 'readWrite', bootstrap: true }),", class: 'toggle', reason: 'grant-less prompt-proxy (unforced copies)' },
  { file: 'public/common.js', body: 'body: JSON.stringify({ runner: true }),', class: 'runner', reason: 'owner-checked runner copy (LIN-3131)' },
  { file: 'public/common.js', body: "body: JSON.stringify({ purpose: 'driver' }),", class: 'driver', reason: 'owner-checked driver copy (forced copies, M5)' },
  { file: 'public/proxy.js', body: 'body: JSON.stringify({', class: 'settings-out', reason: 'Settings "Generate agent prompt" (agent-prompt, grant-less)' },
  { file: 'public/proxy.js', body: 'body: JSON.stringify({ label, scope }),', class: 'settings-out', reason: 'Settings manual token create (grant-less)' }
];

function scanMintPosts(files, table = MINT_POSTS) {
  const offenders = [];
  const seen = new Set();
  for (const row of codeLines(files)) {
    if (!/window\.api\(.*\/tokens`/.test(row.line)) continue;
    const next = row.lines.slice(row.i + 1, row.i + 4).map(l => l.trim());
    if (!next.includes("method: 'POST',")) continue;
    const bodyLine = row.lines.slice(row.i + 1, row.i + 10).map(l => l.trim()).find(l => l.startsWith('body: JSON.stringify('));
    const hit = table.find(p => p.file === row.file && p.body === bodyLine && !seen.has(p));
    if (!hit) offenders.push({ kind: 'unlisted', file: row.file, line: row.i + 1, body: bodyLine });
    else seen.add(hit);
  }
  for (const p of table) if (!seen.has(p)) offenders.push({ kind: 'stale', file: p.file, body: p.body });
  return offenders;
}

// ── C5e — dispatch-forced sites (server mint, M2) ───────────────────────────

const DISPATCH_FORCED = [
  { file: 'public/app.js', snippet: "const proxyForce = promptContainer.dataset.proxyForce === 'true'" },
  { file: 'public/dispatch.js', snippet: "proxyForce: kind === 'autopilot'" },
  { file: 'public/next-run.js', snippet: 'proxyForce: true,' },
  { file: 'public/prompt-section.js', snippet: "proxyForce: !!(state.result && state.result.proxyForce) || btn.dataset.proxyForce === 'runner'" }
];

// ─────────────────────────────────────────────────────────────────────────────

const replaceIn = (files, file, from, to) => files.map(f => (f.file === file ? { file, src: f.src.replace(from, to) } : f));

describe('LIN-3136 C5a — every copy caller is listed and forced correctly', () => {
  test('the live tree matches the table', () => {
    assert.deepEqual(scanCopyCallers(SOURCES), []);
  });

  test('mutation: an unlisted maybeAppend caller fails', () => {
    const planted = [...SOURCES, { file: 'public/new-surface.js', src: 'const t = await window.ProxyToggle.maybeAppend(raw, urlKey, { force: true });\n' }];
    assert.ok(scanCopyCallers(planted).some(o => o.kind === 'unlisted'));
  });

  test('mutation: a stale entry (the site removed) fails', () => {
    const removed = replaceIn(SOURCES, 'public/passage-planner.js', 'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: true });', 'text = text;');
    assert.ok(scanCopyCallers(removed).some(o => o.kind === 'stale' && o.file === 'public/passage-planner.js'));
  });

  test('mutation: { force: false } at a listed site fails', () => {
    const table = COPY_SITES.map(s => (s.file === 'public/flight-companion.js' ? { ...s, call: 'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: false });' } : s));
    const flipped = replaceIn(SOURCES, 'public/flight-companion.js',
      'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: true });',
      'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: false });');
    assert.ok(scanCopyCallers(flipped, table).some(o => o.kind === 'force-false'));
  });

  test('mutation: a driver-forced site passing a variable fails', () => {
    const table = COPY_SITES.map(s => (s.file === 'public/passage-planner.js' ? { ...s, call: 'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: maybe });' } : s));
    const changed = replaceIn(SOURCES, 'public/passage-planner.js',
      'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: true });',
      'text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: maybe });');
    assert.ok(scanCopyCallers(changed, table).some(o => o.kind === 'forced-not-literal-true'));
  });

  test('mutation: a conditional site whose derivation changed fails', () => {
    const changed = replaceIn(SOURCES, 'public/app.js', "const forceProxy = promptContainer.dataset.proxyForce === 'true'", 'const forceProxy = false');
    assert.ok(scanCopyCallers(changed).some(o => o.kind === 'derivation-moved'));
  });
});

describe('LIN-3136 C5b — getOrCreateToken has exactly one caller, in maybeAppend', () => {
  test('the live tree', () => {
    assert.deepEqual(scanMintCallers(SOURCES), []);
  });

  test('mutation: a second caller fails', () => {
    const planted = [...SOURCES, { file: 'public/other.js', src: 'const x = await window.ProxyToggle.getOrCreateToken(urlKey);\n' }];
    assert.ok(scanMintCallers(planted).some(o => o.kind === 'caller-count'));
  });
});

describe('LIN-3136 C5c — forced emitters are listed', () => {
  test('the live tree', () => {
    assert.deepEqual(scanEmitters(SOURCES), []);
  });

  test('mutation: an unlisted data-proxy-force="true" emitter fails', () => {
    const planted = [...SOURCES, { file: 'lib/render-new.js', src: "html += '<div data-proxy-force=\"true\">';\n" }];
    assert.ok(scanEmitters(planted).some(o => o.kind === 'unlisted'));
  });
});

describe('LIN-3136 C5d — browser token-mint POSTs are listed', () => {
  test('the live tree', () => {
    assert.deepEqual(scanMintPosts(SOURCES), []);
  });

  test('mutation: a new mint POST fails', () => {
    const planted = [...SOURCES, {
      file: 'public/rogue.js',
      src: "const d = await window.api(`/workspace/${k}/api/proxy/tokens`, {\n  method: 'POST',\n  body: JSON.stringify({ purpose: 'driver' }),\n});\n"
    }];
    assert.ok(scanMintPosts(planted).some(o => o.kind === 'unlisted'));
  });
});

describe('LIN-3136 C5e — dispatch-forced sites mint server-side', () => {
  for (const site of DISPATCH_FORCED) {
    test(`${site.file}: ${site.snippet}`, () => {
      const { src } = SOURCES.find(s => s.file === site.file);
      assert.ok(src.includes(site.snippet), 'the dispatch-forced site is where the census says');
    });
  }

  test('the dispatch choke point decides intent only and never mints in the browser', () => {
    const { src } = SOURCES.find(s => s.file === 'public/common.js');
    const start = src.indexOf('function shouldAppend(');
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    assert.ok(start > -1);
    assert.doesNotMatch(body, /getOrCreateToken|api\/proxy\/tokens/);
  });
});
