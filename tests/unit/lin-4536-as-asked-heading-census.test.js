/**
 * LIN-4536 (moved from the As-asked marker census, LIN-4362/LIN-4502): the heading of the brief's part 1, `## As asked`,
 * has one owner, lib/records/words.js (`ASKED_HEADING`). The records brief renders part 1 under it, and the stage
 * prompts name "the `## As asked` block", so a hand spelling anywhere else in lib/ or routes/ is a copy that can drift
 * from the heading the brief prints. This census fails on it; such strings interpolate the export instead.
 *
 * The quote's end line (`*End of what was asked …*`) retired with the model-written brief it closed: the records brief's
 * next part heading ends part 1. A hand spelling of it is caught too, so it does not come back.
 *
 * What is skipped: comments. A `//` line is skipped, and so is every line inside a `/* … *\/` block. The skip is by
 * block, not by a leading `*`: the end line starts with `*`, so a blanket `^\s*\*` skip would also skip a prompt line
 * that opens with it (the last fixture below shows it is caught).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4536-as-asked-heading-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASKED_HEADING, BRIEF_HINT } from '../../lib/records/words.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { buildAutopilotKickoff } from '../../lib/prompts/autopilot-kickoff.js';
import { buildFlightCompanionKickoff } from '../../lib/prompts/flight-companion-kickoff.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED_DIRS = ['lib', 'routes'];
/** The one owner of the heading. */
const OWNER = 'lib/records/words.js';

/** A hand spelling of the heading, or of the retired end line. */
export const MARKER_SPELLING = /## As asked|\*End of what was asked/;

/**
 * The agent-facing lines of one file that spell a marker by hand: every line outside a comment that
 * matches MARKER_SPELLING. Returns [{ line, text }] with 1-based line numbers.
 */
export function markerSpellings(text) {
  const hits = [];
  let inBlock = false;
  String(text).split('\n').forEach((raw, i) => {
    const t = raw.trimStart();
    if (inBlock) {
      if (raw.includes('*/')) inBlock = false;
      return;
    }
    if (t.startsWith('//')) return;
    if (t.startsWith('/*')) {
      if (!t.includes('*/', 2)) inBlock = true;
      return;
    }
    if (MARKER_SPELLING.test(raw)) hits.push({ line: i + 1, text: raw.trim() });
  });
  return hits;
}

/** Every scanned source file as [repo-relative path, text], the owner excluded. */
function scannedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(m?js)$/.test(entry.name) && rel !== OWNER) out.push([rel, fs.readFileSync(path.join(REPO, rel), 'utf8')]);
    }
  };
  SCANNED_DIRS.forEach(walk);
  return out;
}

describe('As-asked heading census: the check itself', () => {
  test('the pattern recognises the owner\'s heading, so it tracks what the brief prints', () => {
    assert.ok(MARKER_SPELLING.test(ASKED_HEADING));
  });

  test('a string spelling the heading is caught', () => {
    const src = "const lead = 'The \"## As asked\" block holds the words as filed';\n";
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [1]);
  });

  test('a string spelling the retired end line, or its shortened form, is caught', () => {
    const src = [
      "const end = '*End of what was asked. Steps write below this line; nothing above it changes.*';",
      'const hint = \'a marker line ("*End of what was asked. …*")\';',
    ].join('\n');
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [1, 2]);
  });

  test('`//` comment lines and lines inside a /* … */ block are skipped', () => {
    const src = [
      '// Below the `## As asked` block wins.',
      '/**',
      ' * Seal the `## As asked` block onto a ticket.',
      ' * *End of what was asked.*',
      ' */',
      '/** A parent\'s `## As asked` words. */',
      '/* one-line block: ## As asked */',
      "const ok = 'nothing here';",
    ].join('\n');
    assert.deepEqual(markerSpellings(src), []);
  });

  test('a line after a closed block is read again', () => {
    const src = ['/**', ' * the `## As asked` block', ' */', "const s = 'the `## As asked` block';"].join('\n');
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [4]);
  });

  test('a template line that starts with the end line is still caught', () => {
    // Inside a template literal, outside any comment: a blanket leading-`*` skip would drop this line.
    const src = [
      'const prompt = `Write below the block.',
      '*End of what was asked.*',
      '* a bullet naming the "## As asked" block',
      '`;',
    ].join('\n');
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [2, 3]);
  });
});

describe('As-asked heading census: lib/ and routes/', () => {
  test(`no agent-facing string outside ${OWNER} spells the heading or the retired end line by hand`, () => {
    const found = scannedFiles().flatMap(([rel, text]) =>
      markerSpellings(text).map((h) => `${rel}:${h.line}: ${h.text.slice(0, 120)}`)
    );
    assert.deepEqual(found, [], `interpolate ASKED_HEADING from ${OWNER} instead:\n${found.join('\n')}`);
  });
});

describe('the brief hint names the records brief', () => {
  test('one wording, naming the heading, the task as the words\' source, and no model-written part', () => {
    assert.equal(BRIEF_HINT, "the task as filed under `## As asked`, from the task's record; no step may change it; then the records addressed to you, what stands and the previous stage");
    assert.doesNotMatch(BRIEF_HINT, /present state|distilled/, 'no summary is promised');
  });
});

describe('every surface that points an agent at the brief uses the one hint', () => {
  const BASE = 'https://h.example';
  const surfaces = {
    'proxy preamble': () => buildProxyContextPreamble({ baseUrl: BASE, token: 'tok', issueIdentifier: 'LIN-9' }),
    'proxy preamble, no issue detail': () => buildProxyContextPreamble({ baseUrl: BASE, token: 'tok', issueIdentifier: 'LIN-9', providerUi: { issueDetail: false } }),
    'proxy instructions': () => buildInstructions({ baseUrl: BASE, scope: 'read' }),
    'autopilot kickoff (scoped)': () => buildAutopilotKickoff({ baseUrl: BASE, issue: { identifier: 'LIN-42', title: 'X' } }),
    'Flight Companion kickoff': () => buildFlightCompanionKickoff({ baseUrl: BASE }),
  };
  for (const [name, render] of Object.entries(surfaces)) {
    test(name, () => assert.ok(render().includes(BRIEF_HINT), `${name} does not carry BRIEF_HINT`));
  }
});
