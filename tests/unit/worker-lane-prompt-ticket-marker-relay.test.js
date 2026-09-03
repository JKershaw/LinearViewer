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
