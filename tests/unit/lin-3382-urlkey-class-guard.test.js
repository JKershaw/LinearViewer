/**
 * LIN-3382 — the C2 class guard (and the K1 verdict table that bounds it).
 *
 * The defect class is "a bind arm derives its own workspace urlKey from the live
 * session". Fixing five instances would leave the class open, so this test fails
 * on the CLASS, not on the five known members:
 *
 *   C2a  any `derive*UrlKey` definition or `deriveUrlKey(` call outside
 *        lib/workspace-urlkey.js;
 *   C2b  any object literal carrying both `urlKey` and `addedAt` (a workspace
 *        object) whose `urlKey` is not the resolver's result;
 *   K1   any bind-arm writer (`upsertWorkspace(`, `session.workspaces.push(`,
 *        `workspaces = [workspace]`) in lib/, routes/ or server.js that is not in
 *        the verdict table below, and any table entry that does not use the
 *        resolver where its verdict says it must.
 *
 * Allow-listed BY NAME (never by pattern): lib/pat-session.js (dev-only PAT
 * session; its key is the operator's own) and routes/test.js (the e2e harness
 * mints fixed keys on purpose).
 *
 * MUTATION WITNESS: the scanners are pure functions of `{file, text}`; the last
 * describe feeds them an inline derivation and asserts they FAIL, so the guard
 * cannot go vacuous (a scanner that matches nothing would pass every real file).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESOLVER_MODULE = 'lib/workspace-urlkey.js';
const ALLOW_LISTED = Object.freeze(['lib/pat-session.js', 'routes/test.js']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}
const SOURCE_FILES = [...walk('lib'), ...walk('routes'), 'server.js'];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/**
 * Blank out comments (keeping line structure and string contents). A small
 * state machine rather than a regex, because a `/*` inside a string (a route
 * glob such as '/api/*') must not open a comment.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      i += 2;
    } else if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') { out += text[i]; i++; }
        if (i < n) { out += text[i]; i++; }
      }
      if (i < n) { out += text[i]; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

// ---- scanners (pure; the mutation witness drives them with fixtures) -------------------------

/** C2a. @returns {string[]} violations */
export function scanDerivations({ file, text }) {
  if (file === RESOLVER_MODULE || ALLOW_LISTED.includes(file)) return [];
  const code = stripComments(text);
  const found = [];
  for (const m of code.matchAll(/\bfunction\s+(derive\w*UrlKey)\b|\b(derive\w*UrlKey)\s*=|\bderive\w*UrlKey\s*\(|\bderiveUrlKey\s*\(/g)) {
    found.push(`${file}: ${m[0].trim()}`);
  }
  return found;
}

/** The object-literal source that encloses index `at`, or null. */
function enclosingLiteral(code, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = code[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        let d = 0;
        for (let j = i; j < code.length; j++) {
          if (code[j] === '{') d++;
          else if (code[j] === '}' && --d === 0) return code.slice(i, j + 1);
        }
        return null;
      }
      depth--;
    }
  }
  return null;
}

/** C2b. A workspace-shaped literal (`urlKey` + `addedAt`) must take its key from the resolver. */
export function scanWorkspaceLiterals({ file, text }) {
  if (ALLOW_LISTED.includes(file)) return [];
  const code = stripComments(text);
  const found = [];
  const seen = new Set();
  for (const m of code.matchAll(/\baddedAt\s*:/g)) {
    const literal = enclosingLiteral(code, m.index);
    if (!literal || seen.has(literal)) continue;
    seen.add(literal);
    if (!/\burlKey\b/.test(literal)) continue;
    if (/\burlKey\s*:\s*resolved\.urlKey\b/.test(literal)) continue;
    found.push(`${file}: workspace literal with a urlKey that is not the resolver's result: ${literal.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return found;
}

/** K1 members: every writer of a new workspace into session.workspaces. */
export function scanBindWriters({ file, text }) {
  const code = stripComments(text);
  const hits = [];
  for (const m of code.matchAll(/\bupsertWorkspace\(|session\.workspaces\.push\(|workspaces = \[workspace\]/g)) hits.push(m[0]);
  return hits.length ? [{ file, hits }] : [];
}

// ---- the K1 verdict table ------------------------------------------------------------------

/**
 * Every file with a K1 writer, and what it must do about the key.
 *   arm            - a bind arm: must resolve its key through `resolveKeyOrRespond`
 *   definition     - the writer itself (`upsertWorkspace`'s definition and its in-file helper use)
 *   merge-confirm  - lands a workspace an arm already resolved: the arm refuses BEFORE `pendingMerge` exists
 *   allow-listed   - by name, see ALLOW_LISTED
 */
const K1_VERDICTS = Object.freeze({
  'lib/github-install-flow.js': 'arm',
  'routes/held-connection.js': 'arm',
  'routes/jira-auth.js': 'arm',
  'routes/auth.js': 'arm',
  'routes/workspace.js': 'arm',
  'routes/account-merge.js': 'merge-confirm',
  'lib/workspace.js': 'definition',
  'lib/pat-session.js': 'allow-listed',
  'routes/test.js': 'allow-listed'
});

describe('C2 class guard over the real tree', () => {
  test('C2a: no urlKey derivation outside lib/workspace-urlkey.js', () => {
    const violations = SOURCE_FILES.flatMap(file => scanDerivations({ file, text: read(file) }));
    assert.deepEqual(violations, []);
  });

  test('C2b: every workspace literal outside the allow-list takes its urlKey from the resolver', () => {
    const violations = SOURCE_FILES.flatMap(file => scanWorkspaceLiterals({ file, text: read(file) }));
    assert.deepEqual(violations, []);
  });

  test('K1: every bind-arm writer is in the verdict table, and every table entry still has its writer', () => {
    const found = SOURCE_FILES.flatMap(file => scanBindWriters({ file, text: read(file) })).map(r => r.file).sort();
    // A writer appearing here that the table does not know is a NEW bind arm: it must be classified (and, if it is
    // an arm, must resolve its key) before this test goes green.
    const unknown = found.filter(file => !K1_VERDICTS[file]);
    assert.deepEqual(unknown, [], 'a new bind-arm writer must be added to K1_VERDICTS with a verdict');
    // Allow-listed files are exempt: routes/test.js seeds sessions through other shapes.
    const stale = Object.entries(K1_VERDICTS).filter(([file, verdict]) => verdict !== 'allow-listed' && !found.includes(file)).map(([file]) => file);
    assert.deepEqual(stale, [], 'a verdict-table entry no longer has a writer: remove it');
  });

  test('K1: every verdict-"arm" file resolves its key through resolveKeyOrRespond and names no other key source', () => {
    for (const [file, verdict] of Object.entries(K1_VERDICTS)) {
      if (verdict !== 'arm') continue;
      const code = stripComments(read(file));
      assert.match(code, /\bresolveKeyOrRespond\s*\(/, `${file} must resolve its key through the one resolver`);
      assert.match(code, /\bresolveWorkspaceUrlKey\b/, `${file} must take the injected resolver`);
    }
  });

  test('K1: merge-confirm lands only a workspace an arm already resolved (it builds no key)', () => {
    const code = stripComments(read('routes/account-merge.js'));
    assert.ok(!/urlKey\s*:/.test(code), 'routes/account-merge.js builds no urlKey of its own');
    assert.match(code, /upsertWorkspace\(req\.session, pending\.workspace\)/);
  });

  test('the resolver is not on the hop table by accident: only the documented files mention it', () => {
    const mentions = SOURCE_FILES.filter(file => /\bresolveWorkspaceUrlKey\b/.test(stripComments(read(file)))).sort();
    assert.deepEqual(mentions, [
      'lib/github-install-flow.js',
      'lib/workspace-urlkey.js',
      'routes/auth.js',
      'routes/github-auth.js',
      'routes/github-projects-auth.js',
      'routes/held-connection.js',
      'routes/jira-auth.js',
      'routes/workspace.js',
      'server.js'
    ]);
  });

  test('the allow-list is by name and both entries exist', () => {
    for (const file of ALLOW_LISTED) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  });
});

describe('mutation witness: the guard fails on a reintroduced derivation', () => {
  test('C2a fails on an inline `derive...UrlKey` definition and on a `deriveUrlKey(` call outside the resolver', () => {
    const inline = `
      function deriveFooUrlKey(name, existing) { return existing.has(name) ? name + '-2' : name }
      const key = deriveUrlKey('github-fresh', {})
    `;
    const found = scanDerivations({ file: 'routes/some-new-arm.js', text: inline });
    assert.ok(found.length >= 2, `expected the definition and the call to be flagged, got ${JSON.stringify(found)}`);
    assert.deepEqual(scanDerivations({ file: RESOLVER_MODULE, text: inline }), [], 'the resolver module itself is exempt');
    assert.deepEqual(scanDerivations({ file: 'lib/pat-session.js', text: inline }), [], 'allow-listed by name');
  });

  test('C2b fails on a workspace literal whose urlKey is derived inline, passes when it is the resolver\'s result', () => {
    const bad = `const workspace = {\n  id: crypto.randomUUID(),\n  urlKey: slug + '-' + n,\n  addedAt: Date.now(),\n}`;
    const shorthand = `const workspace = { id: 'x', urlKey, addedAt: Date.now() }`;
    const good = `const workspace = {\n  id: crypto.randomUUID(),\n  urlKey: resolved.urlKey,\n  addedAt: Date.now(),\n}`;
    assert.equal(scanWorkspaceLiterals({ file: 'routes/some-new-arm.js', text: bad }).length, 1);
    assert.equal(scanWorkspaceLiterals({ file: 'routes/some-new-arm.js', text: shorthand }).length, 1, 'shorthand `urlKey,` is not the resolver\'s result either');
    assert.deepEqual(scanWorkspaceLiterals({ file: 'routes/some-new-arm.js', text: good }), []);
    assert.deepEqual(scanWorkspaceLiterals({ file: 'routes/test.js', text: bad }), [], 'allow-listed by name');
  });

  test('a comment that mentions a derivation is not a violation', () => {
    assert.deepEqual(scanDerivations({ file: 'lib/x.js', text: '// the old deriveJiraUrlKey( is gone\n/* deriveUrlKey( */' }), []);
  });

  test('K1 flags a new writer the verdict table does not know', () => {
    const rows = scanBindWriters({ file: 'routes/brand-new-arm.js', text: 'upsertWorkspace(req.session, workspace)' });
    assert.equal(rows.length, 1);
    assert.equal(K1_VERDICTS[rows[0].file], undefined);
  });
});
