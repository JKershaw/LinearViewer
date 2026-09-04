/**
 * LIN-2543 — shared DI-witness helper for the LIN-679 proxy sub-router
 * corpus.
 *
 * Every `LIN-679` stage converts closure deps into `createXRoutes({...})`
 * factory params, mounted via `router.use(createXRoutes({ ... }))` in
 * routes/proxy.js. Deleting a key from that mount object produces a runtime
 * 500 with no static guard (the repo has no linter/AST parser) — see the
 * research on LIN-2543 for the measured evidence. This module is Half A of
 * the two-mechanism fix: a filesystem-derived, source-text census that
 * asserts every dep a `routes/proxy-*.js` factory declares is actually
 * present in its `routes/proxy.js` mount literal.
 *
 * Deliberately plain source-text parsing (regex + brace-matching), not an
 * AST library — the repo has no static-analysis dependency today and this
 * matches the house pattern already used by
 * tests/unit/proxy-credential-fingerprint-stamping.test.js and
 * tests/unit/lin-2533-agent-status-extraction.test.js.
 *
 * Not itself a `.test.js` file — imported by tests/unit/proxy-di-witness.test.js
 * (this ticket) and intended for reuse by later LIN-679 stages (H/LIN-2539,
 * I/LIN-2540) so each stage extends the corpus instead of hand-rolling its
 * own witness.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Discover the proxy sub-router corpus from the filesystem — never a
 * hand-maintained list (LIN-2557 records that exact failure for a sibling
 * census). Excludes `proxy.js` itself (the composer being parsed against,
 * not a corpus member) and `proxy-*.test.js`-shaped names by construction,
 * since routesDir is the production `routes/` directory, not a test dir.
 */
export function discoverProxySubRouterFiles(routesDir) {
  return readdirSync(routesDir)
    .filter((name) => /^proxy-.*\.js$/.test(name))
    .sort();
}

/** Index of the `}` matching the `{` at `openIndex`, or -1 if unbalanced. */
function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on top-level `,` only — depth-aware, so a nested default value's
 * own commas/braces don't fracture the entry. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Index of the first top-level occurrence of `char` in `entry` (depth-aware,
 * so a default value's own nested punctuation is never mistaken for it). */
function findTopLevelChar(entry, char) {
  let depth = 0;
  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i];
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (depth === 0 && ch === char) return i;
  }
  return -1;
}

/** A destructured param entry has a default iff it carries a top-level `=`
 * that isn't part of `=>` or `==`. */
function findDefaultEquals(entry) {
  let searchFrom = 0;
  for (;;) {
    const idx = findTopLevelChar(entry.slice(searchFrom), '=');
    if (idx === -1) return -1;
    const absolute = searchFrom + idx;
    const next = entry[absolute + 1];
    const prev = entry[absolute - 1];
    if (next !== '=' && next !== '>' && prev !== '=' && prev !== '!' && prev !== '<' && prev !== '>') {
      return absolute;
    }
    searchFrom = absolute + 1;
  }
}

function classifyParams(paramsText) {
  const required = [];
  const optional = [];
  const entries = splitTopLevel(paramsText).map((e) => e.trim()).filter(Boolean);
  for (const entry of entries) {
    const eqIndex = findDefaultEquals(entry);
    if (eqIndex === -1) {
      required.push(entry);
    } else {
      optional.push(entry.slice(0, eqIndex).trim());
    }
  }
  return { required, optional };
}

/**
 * Parse a sub-router factory's declared params out of its source text.
 *
 * Throws (never silently returns an empty/partial result) if no
 * `export function create...Routes({ ... })` declaration is found — a parse
 * failure must fail loudly, not be treated as "this file has zero deps".
 */
export function parseFactoryDecl(source, filePath) {
  const match = source.match(/export function (create\w+Routes)\(\{/);
  if (!match) {
    throw new Error(
      `proxy-di-witness: no "export function create...Routes({" factory declaration found in ${filePath}`
    );
  }
  const factoryName = match[1];
  const openBraceIndex = match.index + match[0].length - 1;
  const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
  if (closeBraceIndex === -1) {
    throw new Error(`proxy-di-witness: unbalanced braces parsing ${factoryName}'s params in ${filePath}`);
  }
  const paramsText = source.slice(openBraceIndex + 1, closeBraceIndex);
  const { required, optional } = classifyParams(paramsText);
  return { factoryName, required, optional };
}

/**
 * Parse the mounted dep keys for `factoryName` out of `router.use(<factoryName>({ ... }))`
 * in the given `routes/proxy.js` source text. Brace-matched, not line-anchored
 * — mount line numbers move every LIN-679 stage.
 *
 * Throws if the mount literal for a discovered factory can't be found — a
 * factory with no matching mount is exactly the "nothing wires this
 * sub-router in at all" class of bug, and must fail loudly rather than be
 * read as "zero mounted deps".
 */
export function parseMountDeps(proxySource, factoryName) {
  const mountMatch = proxySource.match(new RegExp(`router\\.use\\(${factoryName}\\(\\{`));
  if (!mountMatch) {
    throw new Error(
      `proxy-di-witness: no "router.use(${factoryName}({" mount literal found in the given proxy source`
    );
  }
  const openBraceIndex = mountMatch.index + mountMatch[0].length - 1;
  const closeBraceIndex = findMatchingBrace(proxySource, openBraceIndex);
  if (closeBraceIndex === -1) {
    throw new Error(`proxy-di-witness: unbalanced braces parsing ${factoryName}'s mount literal`);
  }
  const mountText = proxySource.slice(openBraceIndex + 1, closeBraceIndex);
  return splitTopLevel(mountText)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Mount entries are shorthand (`foo`) in every case in this repo today,
      // but `key: value` is also legal object-literal syntax — the KEY is
      // what set-equality against the factory's declared param names needs.
      const colonIndex = findTopLevelChar(entry, ':');
      return (colonIndex === -1 ? entry : entry.slice(0, colonIndex)).trim();
    });
}

/**
 * Set-difference between what a factory declares and what its mount
 * actually carries:
 *
 * - `missingFromMount`: a required dep the mount doesn't carry — this is
 *   the LIN-2543 bug (mechanism (i): mount-only omission).
 * - `extraInMount`: a mounted key the factory doesn't declare (required or
 *   optional) — the LIN-2541 dead-dep class. Computed and reported, but its
 *   policy (fail the build? warn?) is explicitly LIN-2541's, not this
 *   ticket's — see the integration test in proxy-di-witness.test.js for the
 *   "asserted empty today" scope.
 *
 * Pulled out as its own pure function (rather than inlined in
 * `censusMountCompleteness`) so Half A's fixture-based unit tests can drive
 * it directly, without touching disk.
 */
export function diffMountAgainstFactory({ required, optional, mounted }) {
  const mountedSet = new Set(mounted);
  const declaredSet = new Set([...required, ...optional]);
  const missingFromMount = required.filter((dep) => !mountedSet.has(dep));
  const extraInMount = mounted.filter((dep) => !declaredSet.has(dep));
  return { missingFromMount, extraInMount };
}

/**
 * Half A — the mount-completeness census. For each discovered
 * `routes/proxy-*.js` file: parse its factory's declared params, parse the
 * matching mount literal in `routes/proxy.js`, and diff them.
 *
 * Never silently drops a file it couldn't parse: `parseFactoryDecl`/
 * `parseMountDeps` throw on a parse failure, which propagates out of this
 * function too.
 */
export function censusMountCompleteness({ routesDir, proxySourcePath }) {
  const proxySource = readFileSync(proxySourcePath, 'utf8');
  const files = discoverProxySubRouterFiles(routesDir);
  return files.map((file) => {
    const filePath = join(routesDir, file);
    const source = readFileSync(filePath, 'utf8');
    const { factoryName, required, optional } = parseFactoryDecl(source, filePath);
    const mounted = parseMountDeps(proxySource, factoryName);
    const { missingFromMount, extraInMount } = diffMountAgainstFactory({ required, optional, mounted });
    return { file, factoryName, required, optional, mounted, missingFromMount, extraInMount };
  });
}
