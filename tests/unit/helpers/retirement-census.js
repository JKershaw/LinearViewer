/**
 * The retirement censuses' one file scan (LIN-4495, shared with LIN-4502): the text files under a set of roots, minus
 * excluded path prefixes. Each census keeps its own retired words, allowances and planted-mutation proofs; this module
 * only lists what they read, so two censuses cannot drift apart on what "the tree" is.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** The roots the census reads: the code, the live docs, the fixtures and the public pages. */
export const CENSUS_ROOTS = Object.freeze(['lib', 'routes', 'server.js', 'scripts', 'docs', 'tests/fixtures', 'public']);

/**
 * Paths out of the census, by prefix, each with its reason. A prefix is a directory (ending in `/`) or a file.
 * Short on purpose: a new entry needs a reason here.
 */
export const EXCLUDED_PREFIXES = Object.freeze({
  'lib/runner-kit/runner.mjs': 'the runner\'s own kit: its local ledger is the runner\'s, not this one',
  'docs/papers/': 'research papers: dated records of the method as it was, quoting the retired words as history',
  'docs/plans/': 'plans and designs of record: the LIN-4491 design quotes the retired words it retires',
  'docs/reviews/': 'dated review records, including the stability readings from before the cutover',
  'tests/fixtures/walk-8/': 'the walk-8 stores (LIN-4496), ported to today\'s kinds: the historical records the replay writes through the proxy, and their retired words (Retires: lines, the retired flags) are the walk\'s record, as the walk wrote them',
});

/** Text extensions a census reads; binary assets (fonts, images) are not text and are not scanned. */
export const TEXT_EXT = /\.(m?js|cjs|md|txt|json|html|css|ya?ml)$/;

function textFilesUnder(root, rel, out = []) {
  const full = join(root, rel);
  if (!existsSync(full)) return out;
  if (!statSync(full).isDirectory()) {
    if (TEXT_EXT.test(rel)) out.push(rel.split(sep).join('/'));
    return out;
  }
  for (const name of readdirSync(full)) textFilesUnder(root, join(rel, name), out);
  return out;
}

/**
 * The census's file list: the text under `roots` (repo-relative), minus any path starting with an excluded prefix.
 * @param {string} root - the repo root
 * @param {readonly string[]} roots
 * @param {Record<string, string>} excludedPrefixes - prefix → reason
 * @returns {string[]} sorted repo-relative paths
 */
export function scanFiles(root, roots, excludedPrefixes) {
  return roots.flatMap((r) => textFilesUnder(root, r))
    .filter((f) => !Object.keys(excludedPrefixes).some((p) => f.startsWith(p)))
    .sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// The shared RETAINED table (LIN-4524, piece A). Every file a retired word still hits is one row here, or is converted
// or deleted, so the three censuses read one table over the whole tests root. The schema is pinned by
// tests/unit/retirement-census-table.test.js.

/** The three kinds a row may have: the closed set. */
export const KINDS = Object.freeze(['temporary', 'live', 'record']);

/** The roots a row may name: the census roots and the whole tests root. A row outside them is never read, so it is refused. */
export const WHOLE_ROOTS = Object.freeze([...CENSUS_ROOTS, 'tests']);

/**
 * The census files themselves, by path, each with its reason. They name the words as their own lists, so the scan must
 * skip them. A SELF path may never also be a row.
 */
export const SELF = Object.freeze({
  'tests/unit/lin-4495-retirement-census.test.js': 'the LIN-4495 census: its RETIRED list names every word it reads',
  'tests/unit/lin-4502-retirement-census.test.js': 'the LIN-4502 census: its RETIRED list and planted files name every word it reads',
  'tests/unit/lin-4504-plan-text-census.test.js': 'the LIN-4504 census: its RETIRED list and planted files name every word it reads',
  'tests/unit/helpers/retirement-census.js': 'the census scan and this table: their comments and names carry the words they describe',
  'tests/unit/retirement-census-table.test.js': 'the table\'s own tests: their planted bad rows name the words the table refuses',
});

/**
 * The rows. Each is `{ kind, file, words, reason, ... }`:
 *   - temporary: `owner` (a ticket, slice or operator run) and `exit` (what removes the hit);
 *   - live: `rule: { path, symbol }`, the rule that keeps the word, which must exist;
 *   - record: nothing more; the reason says why the dated or recorded text stays.
 * `file` is a repo-relative path, or a directory ending in `/`. Empty until piece A's sort (beat 3) fills it.
 */
export const RETAINED = Object.freeze([]);

/**
 * Every problem with the rows, as readable strings (`[]` when the table is valid). Pure over the environment: `env`
 * gives `exists(rel)`, `holds(rel, label)`, `ruleHas(path, symbol)`, `knownWord(label)` and `roots`.
 * @param {readonly object[]} rows
 * @param {Record<string, string>} self - SELF: path → reason
 * @param {object} env
 * @returns {string[]}
 */
export function retainedProblems(rows, self, env) {
  const problems = [];
  const blank = (v) => typeof v !== 'string' || v.trim() === '';
  const inScope = (rel) => env.roots.some((r) => rel === r || rel.startsWith(r.endsWith('/') ? r : `${r}/`));
  const selfPaths = new Set(Object.keys(self));
  const firstRowOf = new Map(); // `${file}|${word}` → index of the row that first holds it

  rows.forEach((row, i) => {
    const at = `row ${i} (${row?.file ?? 'no file'})`;
    if (!KINDS.includes(row.kind)) problems.push(`${at}: unknown kind "${row.kind}"; the kinds are ${KINDS.join(', ')}`);
    if (blank(row.reason)) problems.push(`${at}: no reason`);
    if (row.kind === 'temporary') {
      if (blank(row.owner)) problems.push(`${at}: temporary row has no owner`);
      if (blank(row.exit)) problems.push(`${at}: temporary row has no exit`);
    }
    if (row.kind === 'live') {
      if (!row.rule || blank(row.rule.path) || blank(row.rule.symbol)) {
        problems.push(`${at}: live row names no rule (a path and a symbol)`);
      } else if (!env.ruleHas(row.rule.path, row.rule.symbol)) {
        problems.push(`${at}: live rule ${row.rule.path} has no ${row.rule.symbol}`);
      }
    }
    if (blank(row.file)) {
      problems.push(`${at}: no file`);
      return;
    }
    if (selfPaths.has(row.file)) problems.push(`${at}: ${row.file} is in SELF and also a row`);
    if (!inScope(row.file)) problems.push(`${at}: ${row.file} is outside the scanned roots, so no census reads it`);
    const exists = env.exists(row.file);
    if (!exists) problems.push(`${at}: file ${row.file} does not exist`);
    if (!Array.isArray(row.words) || row.words.length === 0) problems.push(`${at}: names no words`);
    for (const word of Array.isArray(row.words) ? row.words : []) {
      if (!env.knownWord(word)) {
        problems.push(`${at}: word "${word}" is not a census word`);
      } else if (exists && !env.holds(row.file, word)) {
        problems.push(`${at}: ${row.file} no longer holds "${word}" (a stale row)`);
      }
      const key = `${row.file}|${word}`;
      if (firstRowOf.has(key)) problems.push(`${at}: duplicate of row ${firstRowOf.get(key)} (${row.file}, "${word}")`);
      else firstRowOf.set(key, i);
    }
  });

  for (const [path, reason] of Object.entries(self)) {
    if (blank(reason)) problems.push(`SELF ${path}: no reason`);
    if (!env.exists(path)) problems.push(`SELF ${path}: file does not exist`);
  }
  return problems;
}

/**
 * The environment `retainedProblems` reads, over the real tree at `root`. `patterns` maps a word label to the RegExp that
 * matches it in a file's text. Beat 3 supplies the three censuses' merged words.
 * @param {string} root
 * @param {Map<string, RegExp>} patterns
 * @param {readonly string[]} roots
 */
export function fsEnv(root, patterns, roots) {
  const under = (rel) => {
    const full = join(root, rel);
    if (!existsSync(full)) return [];
    return statSync(full).isDirectory() ? textFilesUnder(root, rel) : [rel];
  };
  return {
    roots,
    exists: (rel) => existsSync(join(root, rel)),
    holds: (rel, label) => {
      const pattern = patterns.get(label);
      return Boolean(pattern) && under(rel).some((f) => pattern.test(readFileSync(join(root, f), 'utf8')));
    },
    ruleHas: (path, symbol) => existsSync(join(root, path))
      && new RegExp(`\\b${symbol}\\b`).test(readFileSync(join(root, path), 'utf8')),
    knownWord: (label) => patterns.has(label),
  };
}
