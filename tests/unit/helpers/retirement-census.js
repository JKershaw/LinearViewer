/**
 * The retirement censuses' one file scan (LIN-4495, shared with LIN-4502): the text files under a set of roots, minus
 * excluded path prefixes. Each census keeps its own retired words, allowances and planted-mutation proofs; this module
 * only lists what they read, so two censuses cannot drift apart on what "the tree" is.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
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
