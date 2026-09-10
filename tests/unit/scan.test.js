/**
 * Unit tests for lib/scan.js (LIN-2197 Phase 4)
 *
 * Run with: node --test tests/unit/scan.test.js
 *
 * Covers: fail-closed behaviour when the Principle 0 gate is unavailable,
 * the has_decision / isClaimedDecisionValid / parseDecision ordering (a
 * claimed decision cannot be silently downgraded into a zero-finding), the
 * fenced/prose extraction shape shared with parseRecapResponse, canonical
 * decision_id construction, and that a genuinely malformed claimed decision
 * is an error rather than a zero-finding or a silently-corrupted record.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildScanMessages, generateScan, isClaimedDecisionValid, parseScanResponse, extractScanPayload, isExplicitRetirementSignal } from '../../lib/scan.js';
import { extractPrincipleZeroSection } from '../../lib/prompts/autopilot-manual.js';

const ISSUE_ID = '11111111-2222-3333-4444-555555555555';
const HASH = 'a'.repeat(64);

describe('buildScanMessages — fail-closed Principle 0 gate', () => {
  test('returns null when the Principle 0 section is unavailable, never builds a gate-less prompt', () => {
    const messages = buildScanMessages(
      { identifier: 'LIN-1', description: 'x' },
      { issue: { identifier: 'LIN-1' }, comments: [], children: [] },
      { principleZeroSection: null }
    );
    assert.equal(messages, null);
  });

  test('with a real extraction, composes the verbatim section into the system prompt (no restatement)', () => {
    const section = extractPrincipleZeroSection();
    const messages = buildScanMessages(
      { identifier: 'LIN-1', description: 'x' },
      { issue: { identifier: 'LIN-1' }, comments: [], children: [] }
    );
    assert.ok(messages, 'a real extraction composes a prompt');
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes(section), 'the rubric is embedded verbatim, not paraphrased');
  });
});

describe('isClaimedDecisionValid', () => {
  test('valid: non-empty question + well-formed options', () => {
    assert.equal(isClaimedDecisionValid({
      question: 'Which auth strategy?',
      options: [{ id: 'a', label: 'OAuth' }, { id: 'b', label: 'API key' }]
    }), true);
  });

  test('valid: non-empty question + free_text: true, no options required', () => {
    assert.equal(isClaimedDecisionValid({ question: 'What should the copy say?', free_text: true }), true);
  });

  test('invalid: question missing', () => {
    assert.equal(isClaimedDecisionValid({ options: [{ id: 'a', label: 'OAuth' }] }), false);
  });

  test('invalid: question blank', () => {
    assert.equal(isClaimedDecisionValid({ question: '   ', options: [{ id: 'a', label: 'OAuth' }] }), false);
  });

  test('invalid: non-string question (e.g. 42) — the exact G1 regression case', () => {
    assert.equal(isClaimedDecisionValid({ question: 42, options: 'urgent' }), false);
  });

  test('invalid: malformed options and free_text not true', () => {
    assert.equal(isClaimedDecisionValid({ question: 'Pick one', options: 'urgent' }), false);
    assert.equal(isClaimedDecisionValid({ question: 'Pick one', options: [] }), false);
    assert.equal(isClaimedDecisionValid({ question: 'Pick one', options: [{ id: 'a' }] }), false); // missing label
  });
});

describe('parseScanResponse — outcome ordering', () => {
  test('has_decision: true + valid free-text-only payload (no options) → persisted decision', () => {
    const raw = JSON.stringify({ has_decision: true, question: 'How should copy read?', free_text: true });
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'decision');
    assert.equal(result.decision.decision_id, 'scan_11111111_aaaaaaaaaaaa');
    assert.equal(result.decision.question, 'How should copy read?');
    assert.equal(result.decision.free_text, true);
  });

  test('has_decision: true + valid options payload → persisted decision', () => {
    const raw = JSON.stringify({
      has_decision: true,
      question: 'Which auth strategy?',
      options: [{ id: 'oauth', label: 'OAuth' }, { id: 'key', label: 'API key' }],
      recommended: 'oauth'
    });
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'decision');
    assert.equal(result.decision.options.length, 2);
    assert.equal(result.decision.recommended, 'oauth');
  });

  test('has_decision: true + question missing/blank → error, not zero-finding', () => {
    const raw = JSON.stringify({ has_decision: true, options: [{ id: 'a', label: 'A' }] });
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'error');
    assert.equal(result.decision, null);
  });

  test('has_decision: true + non-string question (42) → error (G1 regression, end to end)', () => {
    const raw = JSON.stringify({ has_decision: true, question: 42, options: 'urgent' });
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'error');
    assert.equal(result.decision, null, 'a claimed decision must never silently downgrade into a persisted zero-finding');
  });

  test('has_decision: true + malformed options and free_text not true → error', () => {
    const raw = JSON.stringify({ has_decision: true, question: 'Pick one', options: 'urgent' });
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'error');
  });

  test('has_decision: false → zero-finding', () => {
    const result = parseScanResponse(JSON.stringify({ has_decision: false }), { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'zero-finding');
    assert.equal(result.decision, null);
  });

  test('has_decision missing or non-boolean → zero-finding (fail closed toward "found nothing", never a false positive)', () => {
    assert.equal(parseScanResponse(JSON.stringify({}), { issueId: ISSUE_ID, inputHash: HASH }).outcome, 'zero-finding');
    assert.equal(parseScanResponse(JSON.stringify({ has_decision: 'yes' }), { issueId: ISSUE_ID, inputHash: HASH }).outcome, 'zero-finding');
  });

  test('fenced response (```json ... ```) parses correctly (G5)', () => {
    const raw = '```json\n' + JSON.stringify({ has_decision: true, question: 'Q?', free_text: true }) + '\n```';
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'decision');
  });

  test('unfenced prose-wrapped response parses correctly (G5)', () => {
    const raw = `Sure, here is the JSON:\n${JSON.stringify({ has_decision: false })}\nLet me know if you need anything else.`;
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'zero-finding');
  });

  test('genuinely invalid JSON → error, never zero-finding', () => {
    const result = parseScanResponse('{not: valid json', { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.outcome, 'error');
  });

  test('empty/non-string input → error', () => {
    assert.equal(parseScanResponse('', { issueId: ISSUE_ID, inputHash: HASH }).outcome, 'error');
    assert.equal(parseScanResponse(null, { issueId: ISSUE_ID, inputHash: HASH }).outcome, 'error');
  });

  test('decision_id matches TaskDecisionsStore.buildId\'s own formula (agreement between the two Phase 2/4 modules)', async () => {
    const { TaskDecisionsStore } = await import('../../lib/task-decisions-store.js');
    const raw = JSON.stringify({ has_decision: true, question: 'Q?', free_text: true });
    const result = parseScanResponse(raw, { issueId: ISSUE_ID, inputHash: HASH });
    assert.equal(result.decision.decision_id, TaskDecisionsStore.buildId(ISSUE_ID, HASH));
  });
});

describe('generateScan — fail-closed at the generateScan level (LIN-2197 Phase 4 close-out ledger item L5)', () => {
  test('overriding principleZeroSection to null fails closed without ever calling the model', async () => {
    // No streamChat mock is installed here on purpose: if generateScan reached
    // streamChat despite the null override, this call would throw on the
    // unmocked OpenRouter network call instead of resolving — that failure
    // mode is itself proof the gate was bypassed.
    const result = await generateScan(
      { identifier: 'LIN-1', description: 'x' },
      { issue: { identifier: 'LIN-1' }, comments: [], children: [] },
      { issueId: ISSUE_ID, inputHash: HASH, principleZeroSection: null }
    );
    assert.deepEqual(result, { outcome: 'fail-closed', decision: null, model: null });
  });

  test('omitting principleZeroSection falls back to a real extraction (default behaviour unchanged)', () => {
    // buildScanMessages is the unit already covering the real-extraction path
    // end to end (see the top describe block); this just pins that
    // generateScan's threading doesn't shadow the default with `undefined`.
    const messages = buildScanMessages(
      { identifier: 'LIN-1', description: 'x' },
      { issue: { identifier: 'LIN-1' }, comments: [], children: [] },
      { principleZeroSection: undefined }
    );
    assert.ok(messages, 'an explicit undefined still falls through to the default extraction');
  });
});

// LIN-2650 WS4 §1/§3: isExplicitRetirementSignal is a NARROWER predicate than
// parseScanResponse's has_decision !== true check — only a well-formed,
// literal `has_decision: false` retires. Every other shape (a live decision,
// absent/malformed input, or a genuine parse/model error) must leave the
// ruling standing, matching the ticket's fail-standing default. Tested here,
// not through HTTP/the AI mock — the mock can only ever emit a clean
// {has_decision:true}/{has_decision:false} shape (routes/workspace-api.js's
// buildMockScanText), so the malformed/absent/error cases are untestable
// through the mock or the route at all; this mirrors this codebase's own
// established pattern for parseScanResponse's three-way split above.
describe('isExplicitRetirementSignal — the RETIREMENT discriminator (LIN-2650 WS4)', () => {
  test('an explicit, well-formed has_decision: false is retirement-eligible', () => {
    assert.equal(isExplicitRetirementSignal('{"has_decision": false}'), true);
  });

  test('a live decision (has_decision: true) is NOT retirement-eligible — never retire on a "yes" answer', () => {
    assert.equal(isExplicitRetirementSignal('{"has_decision": true, "question": "Which approach?"}'), false);
  });

  test('an absent has_decision is NOT retirement-eligible', () => {
    assert.equal(isExplicitRetirementSignal('{}'), false);
  });

  test('a malformed has_decision (string, not boolean) is NOT retirement-eligible', () => {
    assert.equal(isExplicitRetirementSignal('{"has_decision": "false"}'), false);
  });

  test('a genuine parse failure is NOT retirement-eligible', () => {
    assert.equal(isExplicitRetirementSignal('not json at all'), false);
  });

  test('empty or non-string input is NOT retirement-eligible, mirroring parseScanResponse\'s own guard', () => {
    assert.equal(isExplicitRetirementSignal(''), false);
    assert.equal(isExplicitRetirementSignal(null), false);
  });

  test('other falsy has_decision values (0, empty string, null) are NOT retirement-eligible — only strict === false counts', () => {
    assert.equal(isExplicitRetirementSignal('{"has_decision": 0}'), false);
    assert.equal(isExplicitRetirementSignal('{"has_decision": ""}'), false);
    assert.equal(isExplicitRetirementSignal('{"has_decision": null}'), false);
  });
});

// LIN-2650 WS4 §1: extractScanPayload is the shared plumbing both
// parseScanResponse and isExplicitRetirementSignal build on — a pure
// refactor, so its own behaviour is exhaustively pinned by the EXISTING
// parseScanResponse suite above (passing unmodified). This block only pins
// its own directly-callable contract: null vs. an actual payload object.
describe('extractScanPayload — shared extraction plumbing (LIN-2650 WS4)', () => {
  test('returns the parsed payload object for well-formed JSON', () => {
    assert.deepEqual(extractScanPayload('{"has_decision": false}'), { payload: { has_decision: false } });
  });

  test('returns { payload: null } for anything unparseable, never throws', () => {
    assert.deepEqual(extractScanPayload('not json'), { payload: null });
    assert.deepEqual(extractScanPayload(''), { payload: null });
    assert.deepEqual(extractScanPayload(null), { payload: null });
    assert.deepEqual(extractScanPayload('[]'), { payload: null }, 'an array is not a plain object');
  });

  test('extracts a fenced/prose-wrapped payload the same way parseScanResponse does', () => {
    assert.deepEqual(extractScanPayload('```json\n{"has_decision": false}\n```'), { payload: { has_decision: false } });
    assert.deepEqual(extractScanPayload('Sure, here you go: {"has_decision": false} — done.'), { payload: { has_decision: false } });
  });
});
