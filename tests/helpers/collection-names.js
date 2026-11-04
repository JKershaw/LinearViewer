/**
 * LIN-4234: the ONE source of collection names for the guards that must not miss one.
 *
 * "Which collections does the app open?" used to be written down by hand in three places: the
 * account-erasure completeness guard, the urlkey-holders class guard, and INVENTORY's own strings.
 * This helper derives it from code instead:
 *
 *   - literals:  every `collection('name')` call in server.js, lib/** and routes/**;
 *   - constants: the value of every `export const X_COLLECTION = '…'` under lib/** (recursive).
 *
 * scripts/ is deliberately NOT scanned: funnel-events lives there and must stay outside the universe.
 *
 * Both collections a constant can name are read through this one function, so a collection opened
 * through a constant cannot be missed by one guard and seen by the other.
 *
 * The sources are a parameter (`sources`) so a test can hand it a synthetic file and witness the rule.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const LITERAL_RE = /collection\(\s*['"]([A-Za-z0-9_.-]+)['"]\s*\)/g;
const CONSTANT_RE = /^\s*export\s+const\s+([A-Za-z_$][\w$]*_COLLECTION)\s*=\s*['"]([^'"]+)['"]/gm;

/**
 * Drop comments before scanning, so a commented-out or JSDoc example of `export const X_COLLECTION` is
 * not a collection. A `//` counts only at the start of a line or after whitespace, so `'https://…'` survives.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** Collection names written as literals in one file's text. */
export function literalNames(text) {
  return [...text.matchAll(LITERAL_RE)].map((m) => m[1]);
}

/** `export const X_COLLECTION = 'name'` declarations in one file's text, as { constant, collection }. */
export function constantDeclarations(text) {
  return [...stripComments(text).matchAll(CONSTANT_RE)].map((m) => ({ constant: m[1], collection: m[2] }));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.m?js$/.test(name)) out.push(path);
  }
  return out;
}

/** The text the repo's guards scan: server.js + lib/** + routes/** for literals; lib/** for constants. */
export function readRepoSources(root = REPO_ROOT) {
  const literalTexts = [join(root, 'server.js'), ...walk(join(root, 'lib')), ...walk(join(root, 'routes'))]
    .map((f) => readFileSync(f, 'utf8'));
  const constantTexts = walk(join(root, 'lib')).map((f) => readFileSync(f, 'utf8'));
  return { literalTexts, constantTexts };
}

/**
 * The derived collection names.
 * @param {{ sources?: { literalTexts: string[], constantTexts: string[] } }} [options]
 * @returns {{ literals: string[], constants: { constant: string, collection: string }[], names: Set<string> }}
 *   `names` is literals ∪ constant values: the universe every guard reads.
 */
export function collectionNames({ sources = readRepoSources() } = {}) {
  const literals = [...new Set(sources.literalTexts.flatMap(literalNames))].sort();
  const constants = sources.constantTexts.flatMap(constantDeclarations);
  const names = new Set([...literals, ...constants.map((c) => c.collection)]);
  return { literals, constants, names };
}

/** Local names a file imports from any module (`import { A, B as C } from …` gives A and C). */
export function importedNames(text) {
  const out = new Set();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * The census (LIN-4234): every `collection(<arg>)` whose argument is not a string literal, that is, whose
 * collection name the literal scan cannot read. Each one is allowed only when its argument is an identifier
 * that the file imports AND that is a known `*_COLLECTION` constant. A local `const` or an inline expression
 * is returned as offending.
 * @returns {string[]} the offending argument texts (empty when the file is clean)
 */
export function unnamedOpenings(text, knownConstants) {
  const imported = importedNames(text);
  const offending = [];
  for (const m of stripComments(text).matchAll(/\bcollection\(\s*([^)]*?)\s*\)/g)) {
    const arg = m[1];
    if (/^['"][^'"]*['"]$/.test(arg)) continue; // a string literal: the literal scan reads it
    const ok = /^[A-Za-z_$][\w$]*$/.test(arg) && imported.has(arg) && knownConstants.has(arg);
    if (!ok) offending.push(arg);
  }
  return offending;
}

/** Name -> collection for every `*_COLLECTION` constant, from the repo's lib/** (for the census). */
export function knownConstantNames(sources = readRepoSources()) {
  return new Set(sources.constantTexts.flatMap(constantDeclarations).map((c) => c.constant));
}
