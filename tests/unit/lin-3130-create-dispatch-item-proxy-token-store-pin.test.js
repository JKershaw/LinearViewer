/**
 * LIN-3130 S2a — L2 source pin (review 77428f9f / R1; originally f444705e L2).
 *
 * What this guards: the consumer-recency fix relies on EVERY `createDispatchItem`
 * call threading `proxyTokenStore` as a DIRECT key of the call's argument object
 * literal, so the enqueue stamp can fold the runner's take-grant token into
 * `consumerLastSeenAt`.
 *
 * A NESTED mention does not count. The first cut of this pin matched the raw
 * call text for `\bproxyTokenStore\b`, but every call also contains a nested
 * `attachProxyContext({ proxyTokenStore, … })`, so it survived deleting the
 * top-level key at one or all sites (review R1 — vacuous). It also silently
 * `continue`d past a call whose argument was not an object literal.
 *
 * This pin therefore:
 *   (a) blanks comments (the definition and any comment mention are excluded);
 *   (b) requires every remaining call's argument to be an OBJECT LITERAL — a
 *       non-object argument FAILS the pin rather than being skipped;
 *   (c) extracts the argument object's DEPTH-1 keys (string- and nesting-aware,
 *       so a nested `{ proxyTokenStore }` never satisfies it) and asserts
 *       `proxyTokenStore` is one of them;
 *   (d) counts every call site so the `=== 10` check covers the whole surface.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Index of the closing quote of a string/template starting at `start`. */
function skipString(src, start) {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === quote) return i;
  }
  return src.length - 1;
}

/**
 * Replaces every line/block comment with spaces (newlines preserved, length
 * preserved, strings untouched), so comment mentions of `createDispatchItem`
 * cannot be counted as call sites. Regex literals are safe here: this repo's
 * URL regexes escape their slashes (`\/\/`), so no adjacent `//` occurs in
 * code.
 */
function blankComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(src, i);
      out += src.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      i--; // let the for-loop increment land on the newline
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      out += '  ';
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) { out += '  '; i += 1; } // now at '/', loop ++ moves past
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Index of the bracket matching `src[openIndex]` (`{`, `(` or `[`), tracking a
 * stack so interleaved bracket types stay balanced and skipping strings. `-1`
 * when unbalanced.
 */
function matchBracket(src, openIndex) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const closers = new Set(Object.values(pairs));
  const stack = [];
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (pairs[ch]) { stack.push(ch); continue; }
    if (closers.has(ch)) {
      const top = stack.pop();
      if (pairs[top] !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * The set of DEPTH-1 property names of an object literal's interior text.
 * Nesting (`{…}`, `(…)`, `[…]`) is tracked so a nested `proxyTokenStore` is
 * never reported; entries are split on depth-0 commas and each entry's leading
 * `key`/`key:` name is collected.
 */
function topLevelKeys(interior) {
  const entries = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < interior.length; i++) {
    const ch = interior[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(interior, i);
      cur += interior.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; cur += ch; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { entries.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) entries.push(cur);

  const keys = [];
  for (const entry of entries) {
    const m = entry.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('LIN-3130 L2 — every createDispatchItem call threads proxyTokenStore as a direct key', () => {
  test('all call sites pass proxyTokenStore at depth 1 of the argument object literal', () => {
    const files = [...walk(join(REPO, 'routes')), ...walk(join(REPO, 'lib'))];
    const calls = [];

    for (const file of files) {
      const code = blankComments(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(/createDispatchItem\s*\(/g)) {
        // Exclude the factory definition (preceded by `function`).
        if (/function\s+$/.test(code.slice(Math.max(0, m.index - 40), m.index))) continue;

        const openParen = m.index + m[0].length - 1;
        const closeParen = matchBracket(code, openParen);
        assert.ok(closeParen !== -1, `${file}: unbalanced parens at a createDispatchItem call`);

        const argText = code.slice(openParen + 1, closeParen);
        const firstNonSpace = argText.search(/\S/);
        assert.ok(
          firstNonSpace !== -1 && argText[firstNonSpace] === '{',
          `${file}: createDispatchItem argument must be an object literal, got "${argText.trim().slice(0, 50)}"`
        );

        const openBrace = openParen + 1 + firstNonSpace;
        const closeBrace = matchBracket(code, openBrace);
        assert.ok(closeBrace !== -1, `${file}: unbalanced braces in a createDispatchItem argument`);

        const keys = topLevelKeys(code.slice(openBrace + 1, closeBrace));
        calls.push({ file: file.slice(REPO.length + 1), hasProxyTokenStore: keys.includes('proxyTokenStore') });
      }
    }

    const missing = calls.filter((c) => !c.hasProxyTokenStore).map((c) => c.file);
    assert.deepEqual(missing, [], `createDispatchItem call sites missing a depth-1 proxyTokenStore key: ${missing.join(', ')}`);
    // LIN-3436: 10 -> 11 for lib/ticket-close-abort.js (the one ifParked enqueue helper).
    assert.equal(calls.length, 11, `expected 11 createDispatchItem call sites (definition excluded), found ${calls.length}`);
  });
});
