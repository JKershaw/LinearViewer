/**
 * Enforcement test for the pinned-bind convention (LIN-2023).
 *
 * A hostless `app.listen(0)` binds IPv6 dual-stack (`::`). SO_REUSEADDR then
 * lets that coexist with an unrelated IPv4-only process already holding the
 * same port number, which macOS would otherwise refuse — so a test's own
 * `http://127.0.0.1:${port}` request can be delivered to that OTHER process
 * instead of the server the test just started. Pinning the bind to IPv4
 * (`app.listen(0, '127.0.0.1')`) removes the overlap: an explicit IPv4 bind is
 * refused against a live IPv4 squatter, so the port the OS hands back is
 * collision-free by construction.
 *
 * This test is a PURE STATIC SOURCE SCAN — it starts no server, opens no port,
 * and touches no network, so it cannot inherit the very flake it guards
 * against. It is scoped to `tests/` and to port `0`, which puts the production
 * listener (`server.js:3354`, `app.listen(PORT, …)`) out of scope on two
 * independent axes: wrong directory, and no literal `0`.
 *
 * The scan strips comments before matching (length- and line-preserving, so
 * reported line numbers stay true) but deliberately leaves string and template
 * literals intact — an earlier draft blanked string literals to dodge comment
 * false-positives and thereby blanked the very `'127.0.0.1'` the pin check
 * needs to see, turning correctly-pinned call sites into false failures.
 *
 * Known, accepted residual: a string literal whose CONTENTS contain an
 * unpinned `.listen(0)` would be flagged. No such literal exists in the tree,
 * and the failure message points straight at the harmless string if one is
 * ever added.
 *
 * Run with: node --test tests/unit/test-server-listen-bind.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const SELF = fileURLToPath(import.meta.url);

/** Any ephemeral port-0 listen call, pinned or not. `\s` spans newlines, so a
 *  call written across several lines is caught too. */
const LISTEN_PORT_ZERO = /\.listen\(\s*0\s*[,)]/g;
/** The same call, pinned to IPv4 as its second argument. Sticky: tested at the
 *  exact index the match above started, never scanned for elsewhere. */
const PINNED = /\.listen\(\s*0\s*,\s*'127\.0\.0\.1'/y;

/**
 * Blank out `//` line comments and block comments, replacing their characters
 * with spaces and keeping newlines, so every index and line number in the
 * result still matches the original source. String and template literals are
 * left exactly as they are — the scanner only needs to RECOGNISE them so a
 * `//` inside a URL literal is not mistaken for a comment.
 */
export function stripComments(source) {
  const out = source.split('');
  let i = 0;
  const blank = (at) => {
    if (out[at] !== '\n') out[at] = ' ';
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '/' && next === '*') {
      blank(i++);
      blank(i++);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) blank(i++);
      if (i < source.length) {
        blank(i++);
        blank(i++);
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }

  return out.join('');
}

/**
 * Every unpinned ephemeral bind in one file's source, as `{ line, text }`.
 * Line numbers are 1-indexed and refer to the ORIGINAL source.
 */
export function findUnpinnedListenSites(source) {
  const scannable = stripComments(source);
  const sites = [];

  LISTEN_PORT_ZERO.lastIndex = 0;
  let match;
  while ((match = LISTEN_PORT_ZERO.exec(scannable)) !== null) {
    PINNED.lastIndex = match.index;
    if (PINNED.test(scannable)) continue;

    const line = scannable.slice(0, match.index).split('\n').length;
    sites.push({ line, text: source.split('\n')[line - 1].trim() });
  }

  return sites;
}

function jsFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...jsFilesUnder(full));
    } else if (entry.isFile() && entry.name.endsWith('.js') && full !== SELF) {
      found.push(full);
    }
  }
  return found;
}

describe('LIN-2023 — ephemeral test binds are pinned to IPv4', () => {
  test('no hostless .listen(0) anywhere under tests/', () => {
    const offenders = [];

    for (const file of jsFilesUnder(TESTS_DIR)) {
      const relative = path.relative(REPO_ROOT, file);
      for (const site of findUnpinnedListenSites(readFileSync(file, 'utf8'))) {
        offenders.push(`  ${relative}:${site.line}    ${site.text}`);
      }
    }

    assert.equal(
      offenders.length,
      0,
      'Hostless ephemeral test listen() found outside the pinned-bind convention (LIN-2023):\n' +
        `${offenders.join('\n')}\n` +
        "Pin it: .listen(0, '127.0.0.1'[, callback]). See CLAUDE.md → Unit Testing Pattern."
    );
  });

  test('the production listener (server.js) is out of scope', () => {
    const serverSource = readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
    assert.deepEqual(findUnpinnedListenSites(serverSource), []);
  });
});

describe('LIN-2023 — the scan itself, against known-tricky sources', () => {
  const flagged = (source) => findUnpinnedListenSites(source).length;

  test('flags a bare hostless bind', () => {
    assert.equal(flagged('const s = app.listen(0);'), 1);
  });

  test('flags a hostless bind with a callback', () => {
    assert.equal(flagged('const s = app.listen(0, resolve);'), 1);
  });

  test('flags a hostless bind written across several lines', () => {
    assert.equal(flagged('app.listen(\n  0,\n  cb\n);'), 1);
  });

  test('passes a pinned bind', () => {
    assert.equal(flagged("const s = app.listen(0, '127.0.0.1');"), 0);
  });

  test('passes a pinned bind with a callback', () => {
    assert.equal(flagged("const s = app.listen(0, '127.0.0.1', resolve);"), 0);
  });

  test('passes a pinned bind written across several lines', () => {
    assert.equal(flagged("app.listen(\n  0,\n  '127.0.0.1',\n  cb\n);"), 0);
  });

  test('ignores a line comment mentioning an unpinned bind', () => {
    assert.equal(flagged('// legacy code used app.listen(0) here'), 0);
  });

  test('ignores a block comment mentioning an unpinned bind', () => {
    assert.equal(flagged('/*\n * it called app.listen(0) at module load\n */'), 0);
  });

  test('a URL literal containing // does not swallow the rest of the line', () => {
    assert.equal(flagged("const url = `http://127.0.0.1:${p}`; app.listen(0);"), 1);
  });

  test('reports the true line number of a violation', () => {
    const sites = findUnpinnedListenSites('a\nb\nconst s = app.listen(0);\nc');
    assert.equal(sites.length, 1);
    assert.equal(sites[0].line, 3);
  });

  test('comment stripping preserves length and line count', () => {
    const source = 'a // comment\n/* block\nspans */ b\n';
    const stripped = stripComments(source);
    assert.equal(stripped.length, source.length);
    assert.equal(stripped.split('\n').length, source.split('\n').length);
  });
});
