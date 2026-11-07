/**
 * The As-asked block's marker words have one owner: lib/as-asked.js (`AS_ASKED_HEADING`, `AS_ASKED_END`
 * and the forms built from them). An agent-facing string anywhere else in lib/ or routes/ that spells the
 * heading or the end sentence by hand is a copy that can drift from the words the seal writes and the
 * guard refuses, so this census fails on it. Such strings interpolate the export instead (LIN-4362).
 *
 * What counts as a spelling: `## As asked` (the heading, and the parent heading that starts with it) and
 * `*End of what was asked` (the full end sentence, its shortened `*End of what was asked. …*` form in the
 * proxy instructions, and the parent end line).
 *
 * What is skipped: comments. Comments and docs keep the literal text, because a reader of the code needs
 * to see the words. A `//` line is skipped, and so is every line inside a `/* … *\/` block. The skip is by
 * block, not by a leading `*`: the end sentence itself starts with `*`, so a blanket `^\s*\*` skip would
 * also skip a prompt line that opens with the end sentence (the last fixture below shows it is caught).
 *
 * Modelled on cost-read-census.test.js: the check is a pure function over (path, text) pairs, and the
 * synthetic cases prove it fails on the spellings it names.
 *
 * Run with: node --test tests/unit/as-asked-marker-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AS_ASKED_HEADING, AS_ASKED_END, AS_ASKED_END_SHORT, BRIEF_HINT, hasMarkerLine } from '../../lib/as-asked.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { CHAT_TOOL_SCHEMAS } from '../../lib/chat-tools.js';
import { buildAutopilotKickoff } from '../../lib/prompts/autopilot-kickoff.js';
import { buildFlightCompanionKickoff } from '../../lib/prompts/flight-companion-kickoff.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED_DIRS = ['lib', 'routes'];
/** The one owner of the words. */
const OWNER = 'lib/as-asked.js';

/** A hand spelling of the heading or of the end sentence (any of its forms). */
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

describe('As-asked marker census: the check itself', () => {
  test('the pattern recognises the owner\'s own words, so it tracks what the seal writes', () => {
    assert.ok(MARKER_SPELLING.test(AS_ASKED_HEADING));
    assert.ok(MARKER_SPELLING.test(AS_ASKED_END));
  });

  test('a string spelling the heading is caught', () => {
    const src = "const lead = 'The \"## As asked\" block holds the words as filed';\n";
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [1]);
  });

  test('a string spelling the end sentence, or its shortened form, is caught', () => {
    const src = [
      `const end = '${AS_ASKED_END}';`,
      'const hint = \'a marker line ("*End of what was asked. …*")\';',
    ].join('\n');
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [1, 2]);
  });

  test('`//` comment lines and lines inside a /* … */ block are skipped', () => {
    const src = [
      '// Below the `## As asked` block wins.',
      '/**',
      ' * Seal the `## As asked` block onto a ticket.',
      ` * ${AS_ASKED_END}`,
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

  test('a template line that starts with the end sentence is still caught', () => {
    // Inside a template literal, outside any comment: a blanket leading-`*` skip would drop this line.
    const src = [
      'const prompt = `Write below the block.',
      `${AS_ASKED_END}`,
      '* a bullet naming the "## As asked" block',
      '`;',
    ].join('\n');
    assert.deepEqual(markerSpellings(src).map((h) => h.line), [2, 3]);
  });
});

describe('As-asked marker census: lib/ and routes/', () => {
  test(`no agent-facing string outside ${OWNER} spells the heading or the end sentence by hand`, () => {
    const found = scannedFiles().flatMap(([rel, text]) =>
      markerSpellings(text).map((h) => `${rel}:${h.line}: ${h.text.slice(0, 120)}`)
    );
    assert.deepEqual(found, [], `interpolate AS_ASKED_HEADING / AS_ASKED_END from ${OWNER} instead:\n${found.join('\n')}`);
  });
});

describe('the forms built from the owner\'s words keep their bytes', () => {
  test('the short end form is the end sentence\'s first clause and an ellipsis, and is not a marker line', () => {
    assert.equal(AS_ASKED_END_SHORT, '*End of what was asked. …*');
    assert.ok(AS_ASKED_END.startsWith(AS_ASKED_END_SHORT.slice(0, -' …*'.length)));
    // It only names the sentence in prose; a description holding it is not refused as a marker.
    assert.equal(hasMarkerLine(AS_ASKED_END_SHORT), false);
  });

  test('the brief hint is one wording, naming the heading', () => {
    assert.equal(BRIEF_HINT, "the person's words, quoted from the description's `## As asked` block; no step may change them; the rest is the present state");
  });
});

describe('every surface that points an agent at the brief uses the one hint', () => {
  const BASE = 'https://h.example';
  const surfaces = {
    'proxy preamble': () => buildProxyContextPreamble({ baseUrl: BASE, token: 'tok', issueIdentifier: 'LIN-9' }),
    'proxy preamble, no issue detail': () => buildProxyContextPreamble({ baseUrl: BASE, token: 'tok', issueIdentifier: 'LIN-9', providerUi: { issueDetail: false } }),
    'proxy instructions': () => buildInstructions({ baseUrl: BASE, scope: 'read' }),
    'chat get_brief tool': () => CHAT_TOOL_SCHEMAS.find((t) => t.function.name === 'get_brief').function.description,
    'autopilot kickoff (scoped)': () => buildAutopilotKickoff({ baseUrl: BASE, issue: { identifier: 'LIN-42', title: 'X' } }),
    'Flight Companion kickoff': () => buildFlightCompanionKickoff({ baseUrl: BASE }),
  };
  for (const [name, render] of Object.entries(surfaces)) {
    test(name, () => assert.ok(render().includes(BRIEF_HINT), `${name} does not carry BRIEF_HINT`));
  }
});
