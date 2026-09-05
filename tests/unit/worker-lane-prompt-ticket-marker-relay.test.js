/**
 * Unit tests for LIN-2450: docs/worker-lane-prompt.md's Step 5 must teach a
 * `[ticket]` marker shape that `simple-dispatcher/transcript.js`'s
 * `walkTicketMarkers` actually relays, not one its isolation/fenced-code
 * guard silently drops.
 *
 * `walkTicketMarkers` lives in a sibling repo (`simple-dispatcher`), so it
 * cannot be imported here. This file instead carries a small, deliberately
 * byte-faithful MIRROR of its guard (`TICKET_MARKER_LINE` / `blankFencedCodeLines`
 * / the isolation check), copied from `simple-dispatcher/transcript.js` HEAD
 * `63a56da` — never modified for this ticket, per LIN-2450's constraint not to
 * touch the real guard. The mirror's own correctness is pinned first, against
 * the exact test vectors from LIN-2450's problem statement, before it is used
 * to grade the doc's examples.
 *
 * Run with: node --test tests/unit/worker-lane-prompt-ticket-marker-relay.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildWorkerLaneKickoff } from '../../lib/prompts/worker-lane-kickoff.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─── Mirror of simple-dispatcher/transcript.js's relay guard (HEAD 63a56da) ───

const TICKET_MARKER_LINE = /^\s*\[ticket\]\s*(LIN-\d+)\s+(started|done|blocked|refused|dissolved|trimmed)\b\s*(?:[—-]\s*(.*))?$/i;

function blankFencedCodeLines(paraLines) {
  const out = [];
  let fenceChar = null;
  for (const line of paraLines) {
    const trimmed = line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!fenceChar) { fenceChar = ch; out.push(''); continue; }
      if (ch === fenceChar) { fenceChar = null; out.push(''); continue; }
    }
    out.push(fenceChar ? '' : line);
  }
  return out;
}

// Mirrors walkTicketMarkers' per-turn inner loop (the JSONL/entry walk is not
// relevant here — a doc example is graded as a single turn's text).
function relayableMarkers(turnText) {
  const out = [];
  const paraLines = blankFencedCodeLines(turnText.split('\n'));
  for (let j = 0; j < paraLines.length; j++) {
    const raw = paraLines[j].trim();
    if (!TICKET_MARKER_LINE.test(raw)) continue;
    const isolatedBefore = j === 0 || paraLines[j - 1].trim() === '';
    const isolatedAfter = j === paraLines.length - 1 || paraLines[j + 1].trim() === '';
    if (!isolatedBefore || !isolatedAfter) continue;
    out.push(raw);
  }
  return out;
}

describe('relayableMarkers mirror — pinned against LIN-2450/LIN-2423\'s own test vectors', () => {
  test('two markers on adjacent lines: both dropped', () => {
    const text = 'Closing both:\n\n[ticket] LIN-1 done\n[ticket] LIN-2 done\n\nDone.';
    assert.deepStrictEqual(relayableMarkers(text), []);
  });

  test('two markers each isolated by blank lines: both relayed', () => {
    const text = 'x\n\n[ticket] LIN-1 done\n\n[ticket] LIN-2 done\n\ny';
    assert.deepStrictEqual(relayableMarkers(text), ['[ticket] LIN-1 done', '[ticket] LIN-2 done']);
  });

  test('marker prefixed with list-item text: dropped (not isolated)', () => {
    const text = '- [ticket] LIN-1 done';
    assert.deepStrictEqual(relayableMarkers(text), []);
  });

  test('marker inside a fenced code block: dropped even when it looks isolated inside the fence', () => {
    const text = '```\n[ticket] LIN-1 done\n```';
    assert.deepStrictEqual(relayableMarkers(text), []);
  });
});

// The doc's examples use `LIN-XXXX`/`LIN-YYYY` as fill-in-the-real-ticket-id placeholders —
// `TICKET_MARKER_LINE` requires `LIN-\d+`, so `XXXX` itself never matches (same as it never
// would in a real worker's turn, who fills in a real numbered ticket). Substitute real digits
// before grading, exactly as a worker would when actually emitting the marker.
const withRealTicketIds = (text) => text.replace(/LIN-XXXX/g, 'LIN-2450').replace(/LIN-YYYY/g, 'LIN-2451');

describe('docs/worker-lane-prompt.md Step 5 — the example must actually be relayable', () => {
  const prompt = buildWorkerLaneKickoff();

  test('acceptance witness: the PRE-FIX Step 5 shape (fenced, three adjacent marker lines) relays zero markers', () => {
    // This is byte-for-byte the example this ticket replaces (docs/worker-lane-prompt.md
    // lines 163-167 before the fix, with LIN-XXXX substituted for a real id — see
    // withRealTicketIds above — so this proves the drop is caused by fencing/adjacency,
    // not by the placeholder text). Kept here as a literal, not read from git history, so
    // this test independently proves the bug this ticket fixes, and stands as a permanent
    // regression guard against the doc's example ever reverting to this shape.
    const preFixExample = withRealTicketIds([
      '```',
      '[ticket] LIN-XXXX done',
      '[ticket] LIN-XXXX blocked — <specific reason>',
      '[ticket] LIN-XXXX refused — <what acceptance was unmet>',
      '```',
    ].join('\n'));
    assert.deepStrictEqual(relayableMarkers(preFixExample), []);
  });

  test('acceptance witness: adjacency alone (unfenced) still drops both — a blank-lines-only fix would not have been enough', () => {
    const unfencedButAdjacent = withRealTicketIds('[ticket] LIN-XXXX done\n[ticket] LIN-YYYY done');
    assert.deepStrictEqual(relayableMarkers(unfencedButAdjacent), []);
  });

  test('acceptance witness: fencing alone (isolated inside the fence) still drops it — the fence has to go too', () => {
    const isolatedButFenced = withRealTicketIds('prose\n\n```\n[ticket] LIN-XXXX done\n```\n\nmore prose');
    assert.deepStrictEqual(relayableMarkers(isolatedButFenced), []);
  });

  test('the corrected single-ticket example (extracted from the generated prompt) relays its marker', () => {
    const marker = /A turn closing one ticket, written correctly, looks like this in your own message text:\n\n([\s\S]*?)\n\nIf you are closing/;
    const match = marker.exec(prompt);
    assert.ok(match, 'expected to find the single-ticket example block in the generated prompt');
    const relayed = relayableMarkers(withRealTicketIds(match[1]));
    assert.deepStrictEqual(relayed, ['[ticket] LIN-2450 done']);
  });

  test('the corrected multi-ticket example (extracted from the generated prompt) relays both markers', () => {
    const marker = /never stack them on consecutive lines:\n\n([\s\S]*?)\n\nThis is a lightweight/;
    const match = marker.exec(prompt);
    assert.ok(match, 'expected to find the multi-ticket example block in the generated prompt');
    const relayed = relayableMarkers(withRealTicketIds(match[1]));
    assert.deepStrictEqual(relayed, ['[ticket] LIN-2450 done', '[ticket] LIN-2451 blocked — <specific reason>']);
  });

  test('the doc no longer shows the marker inside a fenced code block anywhere', () => {
    // The old Step 5 wrapped its example in a ``` fence; the fix removes fencing from
    // every marker example (fenced text is guard-blanked before relay, so any fenced
    // occurrence in the doc would be teaching a shape that cannot ever relay).
    assert.ok(!/```[\s\S]*?\[ticket\][\s\S]*?```/.test(prompt), 'no [ticket] marker should appear inside a fenced code block in the generated prompt');
  });

  test('still preserves the pinned [ticket] LIN-XXXX done literal (tests/unit/worker-lane-kickoff.test.js:31)', () => {
    assert.ok(prompt.includes('[ticket] LIN-XXXX done'));
  });
});


// ─── LIN-2503: the same guard, applied to docs/dispatch-integration.md ───
//
// `docs/worker-lane-prompt.md` (graded above, through buildWorkerLaneKickoff)
// is READ INTO a generated prompt, so a wrong example there is fed to every
// lane automatically. `docs/dispatch-integration.md` has no generator — it is
// a linked integration guide — so this suite grades its RAW FILE CONTENT.
//
// That is a weaker altitude than the tests above and is called out rather than
// glossed: nothing here proves a running consumer relays anything, only that
// the canonical vocabulary reference does not teach a shape the relay drops.
// It is worth having anyway, because worker-lane-prompt.md links to this file
// as the vocabulary reference — so it is the next place a human or agent
// implementing a consumer copies the shape from, which is exactly how
// LIN-2450's defect reached a second file in the first place.
const DISPATCH_INTEGRATION_MD = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../docs/dispatch-integration.md'),
  'utf8'
);

// The `[ticket]` section only — grading the whole file would let an unrelated
// fenced block elsewhere in a 700-line document fail this suite.
function ticketMarkerSection(doc) {
  const start = doc.indexOf('### The `[ticket]` marker');
  assert.notEqual(start, -1, 'expected the [ticket] marker section in docs/dispatch-integration.md');
  const end = doc.indexOf('\n### ', start + 1);
  return doc.slice(start, end === -1 ? doc.length : end);
}

describe('LIN-2503 — docs/dispatch-integration.md teaches a relayable [ticket] shape', () => {
  const section = ticketMarkerSection(DISPATCH_INTEGRATION_MD);

  test('acceptance witness: the PRE-FIX block (fenced, five adjacent marker lines) relays zero markers', () => {
    // Byte-for-byte the block this ticket replaces (docs/dispatch-integration.md
    // lines 290-296 before the fix). Kept as a literal rather than read from git
    // history, so this test proves the defect independently and stands as a
    // permanent guard against the doc reverting to this shape. Two independent
    // causes, either sufficient: the fence, and the mutual adjacency.
    const preFix = withRealTicketIds([
      '```',
      '[ticket] LIN-XXXX started',
      '[ticket] LIN-XXXX done — <one line>',
      '[ticket] LIN-XXXX blocked — <reason>',
      '[ticket] LIN-XXXX refused — <reason>',
      '[ticket] LIN-XXXX dissolved — <reason>',
      '```',
    ].join('\n'));
    assert.deepStrictEqual(relayableMarkers(preFix), []);
  });

  test('no [ticket] marker appears inside a fenced code block in this section', () => {
    assert.ok(
      !/```[\s\S]*?\[ticket\][\s\S]*?```/.test(section),
      'a fenced [ticket] example teaches a shape the relay blanks before it ever looks for a marker'
    );
  });

  test('the section carries at least one worked example that actually relays', () => {
    // The point of the fix: the reader must be able to copy something that
    // works, not just be told what not to do.
    const relayed = relayableMarkers(withRealTicketIds(section));
    assert.ok(relayed.length > 0, 'expected at least one relayable [ticket] marker in the section');
  });

  test('the multi-ticket example relays BOTH markers — the adjacency trap is shown correctly, not just described', () => {
    const match = /never stacking them on consecutive lines:\n\n([\s\S]*?)\n\nNote that/.exec(section);
    assert.ok(match, 'expected the multi-ticket example block in docs/dispatch-integration.md');
    assert.deepStrictEqual(
      relayableMarkers(withRealTicketIds(match[1])),
      ['[ticket] LIN-2450 done', '[ticket] LIN-2451 blocked — <specific reason>']
    );
  });

  test('every standalone marker line in the section is relayable — none is stranded by adjacency', () => {
    // Catches the subtler half of the defect class: a future edit that unfences
    // an example but leaves two marker lines back to back would satisfy the
    // fenced-block check above while still teaching a shape that drops both.
    const graded = withRealTicketIds(section).split('\n');
    const standalone = graded.filter(line => TICKET_MARKER_LINE.test(line.trim()));
    const relayed = relayableMarkers(withRealTicketIds(section));
    assert.equal(
      standalone.length,
      relayed.length,
      `every standalone marker line must relay; ${standalone.length} present, ${relayed.length} relayable`
    );
  });

  test('the six-state vocabulary is listed INLINE in backticks, which is why it does not need a fence', () => {
    // Inline backticked references (`[ticket] LIN-XXXX done` inside a sentence)
    // are deliberately NOT graded as emitted lines — they are prose, not an
    // example to copy, and LIN-2450 kept the same form in worker-lane-prompt.md.
    // This pins that the vocabulary is presented that way rather than as a
    // fenced block, which is the choice that made the fence unnecessary.
    for (const state of ['started', 'done', 'blocked', 'refused', 'dissolved', 'trimmed']) {
      assert.ok(
        section.includes(`\`[ticket] LIN-XXXX ${state}`),
        `expected the \`${state}\` state listed inline in backticks`
      );
    }
  });
});
