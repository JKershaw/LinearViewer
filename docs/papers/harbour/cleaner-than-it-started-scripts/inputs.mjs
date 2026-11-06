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
