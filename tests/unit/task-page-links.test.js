/**
 * LIN-3331 — the guard that keeps task-page links on the shared helper.
 *
 * Enumerated at `7613ee47` (main HEAD) with the parent plan's bounding grep
 * (LIN-3324 "Classes", Class 1):
 *
 *   git grep -l -E 'identifier|issueIdentifier|seedIssue|issueTitle' \
 *     -- 'lib/render-*.js' 'lib/components/*.js' 'public/*.js' lib/render.js
 *
 * → 37 files. The value-level scan over them (an `href` whose VALUE contains an
 * identifier expression — either `href="..."` or a `.href = ...` assignment)
 * yields these hits, each mapped to its verdict:
 *
 *   lib/render-session.js:665   chat deep-link (a different page)      allow-list
 *   public/swim.js:2449         Swim popover link (out of scope)        allow-list
 *   public/swipe.js:290,304     Swipe blocking links (out of scope)     allow-list
 *   public/swipe.js:321,336     Swipe relation links (out of scope)     allow-list
 *
 * The rule: a flagged href must be built with `taskPageHref(` or be an explicit,
 * reasoned allow-list entry. The allow-list is checked for rot: an entry that
 * matches nothing fails, as does an entry with no reason. Re-run the grep to
 * re-derive the file set when the tree moves.
 *
 * The value-level scan alone is not enough: it only sees an `href` whose value
 * literally names an identifier variable, so a hand-built template literal
 * (`` `/workspace/${ws}/task/${id}` `` — the exact form this ticket removed from
 * `render-task-page.js`) slips through. A SECOND scan below catches that form
 * directly: any `/task/${…}` template literal anywhere under lib/, public/ or
 * routes/ must be the shared helper, its client twin, or an allow-listed
 * different endpoint (the task-edit page, the stored-data state endpoint).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const IDENTIFIER_RE = /(identifier|issueIdentifier|seedIssue)/;
const HREF_VALUE_RE = /href="([^"]*)"/g;
const HREF_ASSIGN_RE = /\.href\s*=\s*(.+)/;

/** The exact parent-plan bounding grep, run against the working tree. */
const CLASS1_GREP = "git grep -l -E 'identifier|issueIdentifier|seedIssue|issueTitle' -- 'lib/render-*.js' 'lib/components/*.js' 'public/*.js' lib/render.js";

/** The value-level scan's file set (the parent plan's bounding grep). */
const ALLOW_LIST = [
  {
    file: 'lib/render-session.js',
    snippet: 'task-chat?task=',
    reason: 'LIN-3254 run-chat deep-link — links to task chat, a different page from the task page',
  },
  {
    file: 'public/swim.js',
    snippet: 'idEl.href = issue.identifier',
    reason: 'Swim popover identifier link — out of scope per LIN-3324 (Class 1 verdict)',
  },
  {
    file: 'public/swipe.js',
    snippet: 'href="${swipeBase}/${encodeURIComponent(',
    reason: 'Swipe deck navigation links (blocks/relations) — out of scope per LIN-3324',
  },
];

// The template-literal scan's exempt homes and allow-list. The two helper homes
// are exempt by path; every other `/task/${…}` literal needs a reasoned entry.
const LITERAL_EXEMPT_FILES = ['lib/task-page-href.js', 'public/common.js'];
const LITERAL_ALLOW_LIST = [
  {
    file: 'lib/render.js',
    snippet: '/edit',
    reason: 'the task-EDIT page /task/:id/edit — a different page from the task page',
  },
  {
    file: 'routes/task-page.js',
    snippet: '/api/task/',
    reason: 'the stored-data repaint endpoint /api/task/:id/state — not the page',
  },
];

function class1Files() {
  let out;
  try {
    out = execSync(CLASS1_GREP, { cwd: ROOT, encoding: 'utf8' });
  } catch (error) {
    assert.fail(`the bounding grep failed (is this a git checkout?): ${error.message}`);
  }
  const files = out.split('\n').map(s => s.trim()).filter(Boolean);
  assert.ok(files.length > 0, 'the bounding grep returned no files');
  return files;
}

/** Every line whose href value carries an identifier expression. */
function scan(files) {
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    lines.forEach((text, idx) => {
      let flagged = false;
      HREF_VALUE_RE.lastIndex = 0;
      let m;
      while ((m = HREF_VALUE_RE.exec(text))) {
        if (IDENTIFIER_RE.test(m[1])) flagged = true;
      }
      const assign = HREF_ASSIGN_RE.exec(text);
      if (assign && IDENTIFIER_RE.test(assign[1])) flagged = true;
      if (flagged) hits.push({ file, line: idx + 1, text });
    });
  }
  return hits;
}

/**
 * Git-tracked `.js` files under lib/, public/ and routes/ whose source contains
 * a hand-built `/task/${…}` template literal — the form the value-level scan
 * cannot see. Enumerated by `git grep` so a NEW file is covered without an edit.
 */
function scanTaskPathLiterals() {
  let out = '';
  try {
    out = execSync("git grep -nF '/task/${' -- 'lib' 'public' 'routes'", { cwd: ROOT, encoding: 'utf8' });
  } catch (error) {
    // `git grep` exits 1 when there are no matches.
    if (error.status === 1) return [];
    assert.fail(`the /task/\${…} scan failed (is this a git checkout?): ${error.message}`);
  }
  const hits = [];
  for (const raw of out.split('\n')) {
    if (!raw) continue;
    const m = /^([^:]+):(\d+):(.*)$/.exec(raw);
    if (!m) continue;
    const [, file, line, text] = m;
    if (!file.endsWith('.js')) continue;
    hits.push({ file, line: Number(line), text });
  }
  return hits;
}

describe('task-page link guard (LIN-3331)', () => {
  test('a hand-built identifier href uses taskPageHref or is allow-listed', () => {
    const hits = scan(class1Files());
    const violations = [];
    for (const h of hits) {
      if (h.text.includes('taskPageHref(')) continue;
      const allowed = ALLOW_LIST.some(a => a.file === h.file && h.text.includes(a.snippet));
      if (!allowed) violations.push(`${h.file}:${h.line}: ${h.text.trim()}`);
    }
    assert.deepEqual(
      violations,
      [],
      `hand-built href(s) carrying an identifier — build them with taskPageHref (lib/task-page-href.js / window.taskPageHref) or add a reasoned allow-list entry:\n${violations.join('\n')}`
    );
  });

  test('the allow-list cannot rot: each entry matches a real hit and states a reason', () => {
    const hits = scan(class1Files());
    for (const a of ALLOW_LIST) {
      assert.ok(typeof a.reason === 'string' && a.reason.trim().length > 0, `allow-list entry needs a reason: ${JSON.stringify(a)}`);
      const matched = hits.some(h => h.file === a.file && h.text.includes(a.snippet));
      assert.ok(matched, `stale allow-list entry (matches no flagged line): ${a.file} :: ${a.snippet}`);
    }
  });

  test('the enumeration is the real Class 1 set (a known member is present)', () => {
    const files = class1Files();
    assert.ok(files.includes('lib/render.js'), 'the Home renderer is in the enumerated set');
    assert.ok(files.includes('lib/render-session.js'), 'the run page renderer is in the enumerated set');
  });

  // The value-level scan misses a hand-built template literal
  // (`` `/workspace/${ws}/task/${id}` ``). This second scan catches it directly.
  test('a hand-built `/task/${…}` template literal uses the shared helper or is allow-listed', () => {
    const violations = scanTaskPathLiterals().filter(h => {
      if (LITERAL_EXEMPT_FILES.includes(h.file)) return false;
      return !LITERAL_ALLOW_LIST.some(a => a.file === h.file && h.text.includes(a.snippet));
    });
    const detail = violations.map(h => `${h.file}:${h.line}: ${h.text.trim()}`).join('\n');
    assert.deepEqual(
      violations,
      [],
      `hand-built task-page path(s) — build them with taskPageHref (lib/task-page-href.js / window.taskPageHref) or add a reasoned allow-list entry:\n${detail}`
    );
  });

  test('the template-literal allow-list cannot rot: each entry matches a real hit and states a reason', () => {
    const hits = scanTaskPathLiterals();
    for (const a of LITERAL_ALLOW_LIST) {
      assert.ok(typeof a.reason === 'string' && a.reason.trim().length > 0, `allow-list entry needs a reason: ${JSON.stringify(a)}`);
      assert.ok(hits.some(h => h.file === a.file && h.text.includes(a.snippet)), `stale template-literal allow-list entry (matches nothing): ${a.file} :: ${a.snippet}`);
    }
  });

  test('the template-literal scan sees both the helper and the allow-listed endpoint (non-vacuous)', () => {
    const files = scanTaskPathLiterals().map(h => h.file);
    assert.ok(files.includes('lib/task-page-href.js'), 'the shared helper is seen by the scan');
    assert.ok(files.includes('routes/task-page.js'), 'the stored-data state endpoint is seen by the scan');
  });
});
