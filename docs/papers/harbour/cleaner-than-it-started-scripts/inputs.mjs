// inputs.mjs — LIN-4333. The one reader of `--inputs <file>` for the four scripts in this folder
// (freeze.mjs, code-blind.mjs, analyse.mjs, census-by-merge.mjs). Everything that differs between
// versions of the paper is data in an inputs file. The scripts are not copied per version.
//
// Why v1's inputs file (inputs-v1.json) lives in this folder and not in v1's evidence folder: the v1
// evidence, cleaner-than-it-started-evidence/2026-11-06/, is a frozen record that must stay
// byte-identical, so no file may be added to or changed in it. The inputs are configuration of the
// script set, so they sit beside the scripts that read them. A later version's inputs sit in that
// version's own evidence folder instead, beside its roles.json, where its record needs them.
//
// Inputs files are JSON (JSON has no comments, which is why the reasons are written here). A key that is
// missing throws, naming it, so no script runs on a datum that silently went absent.

import { readFileSync } from 'node:fs';
import path from 'node:path';

// argv is process.argv.slice(2). Returns the parsed inputs, the path they were read from, and the
// positional arguments with `--inputs <file>` removed. Exits 2 with the usage line when --inputs is absent.
export function takeInputs(argv, usage) {
  const at = argv.indexOf('--inputs');
  const file = at >= 0 ? argv[at + 1] : undefined;
  if (!file || file.startsWith('--')) {
    console.error(`usage: ${usage} --inputs <file.json>`);
    process.exit(2);
  }
  const inputsPath = path.resolve(file);
  let inputs;
  try {
    inputs = JSON.parse(readFileSync(inputsPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read inputs file ${inputsPath}: ${err.message}`);
  }
  const positional = argv.filter((_, i) => i !== at && i !== at + 1);
  return { inputs, inputsPath, positional };
}

// The value at a dotted key (e.g. 'blind.ticket'), or a throw that names the key.
export function need(inputs, key) {
  const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), inputs);
  if (v === undefined) throw new Error(`inputs file is missing "${key}"`);
  return v;
}

// The optional blind-ticket comment cutoff (LIN-4333, v2). Absent from v1's inputs, so v1 reads no cutoff.
// Returns the cutoff as epoch ms, or null when the inputs name none. A cutoff that is not a time throws.
export function blindCutoff(inputs) {
  const raw = inputs?.blind?.comment_cutoff;
  if (raw === undefined) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new Error(`inputs blind.comment_cutoff is not a UTC time: ${JSON.stringify(raw)}`);
  return ms;
}

// True when a comment was posted after the cutoff. Comments after it are kept in the raw files but are
// excluded from every count and reading. A null cutoff excludes nothing.
export function postsAfter(createdAt, cutoffMs) {
  return cutoffMs !== null && Date.parse(createdAt) > cutoffMs;
}
