/**
 * Unit tests for validateDispatchPayload (LIN-1139).
 *
 * The two MAIN dispatch handlers — POST /workspace/:urlKey/api/dispatch and its
 * proxy twin POST /api/proxy/dispatch — hand-rolled the identical block of
 * length caps, opaque model/harness validation, dangerous-char rejection, and
 * issueId/followUpTo/force/sessionId format+combination rules. That block is now
 * extracted verbatim into validateDispatchPayload so the two caller-supplied
 * paths can't re-drift. These tests pin the extracted contract: the exact error
 * messages and the exact FIRST error for a multiply-invalid payload (the check
 * order is load-bearing — both routers relied on it).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDispatchPayload,
  abortFollowUpError,
  abortToError,
  cascadeAbortError,
  dispatchKindError,
  periodicalIdError,
  isValidAutopilotVariant,
  targetError,
  followUpToError,
} from '../../lib/dispatch-validation.js';
import { DISPATCH_TARGETS, POLLED_TARGETS } from '../../lib/dispatch-targets.js';
import { DISPATCH_KINDS } from '../../lib/prompt-templates.js';
import { getPeriodicals } from '../../lib/periodicals.js';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('validateDispatchPayload — valid payloads', () => {
  test('a minimal valid payload returns null', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'do the thing' }), null);
  });

  test('an empty body is valid (prompt-required lives in the caller, not here)', () => {
    assert.strictEqual(validateDispatchPayload({}), null);
    assert.strictEqual(validateDispatchPayload(), null);
  });

  test('a fully-populated valid payload returns null', () => {
    assert.strictEqual(validateDispatchPayload({
      prompt: 'x', promptName: 'Implementation', issueIdentifier: 'LIN-1',
      issueTitle: 'Title', issueUrl: 'https://example/1', repo: 'org/repo',
      model: 'anthropic/claude-opus-4.8', harness: 'claude-code',
      issueId: UUID, followUpTo: UUID, target: 'cli', force: true, sessionId: UUID,
    }), null);
  });
});

describe('validateDispatchPayload — length caps', () => {
  test('over-length prompt', () => {
    const r = validateDispatchPayload({ prompt: 'a'.repeat(10_000_001) });
    assert.deepEqual(r, { error: 'prompt exceeds maximum length of 10000000' });
  });
  test('over-length promptName', () => {
    assert.deepEqual(validateDispatchPayload({ promptName: 'a'.repeat(1001) }),
      { error: 'promptName exceeds maximum length of 1000' });
  });
  test('over-length issueIdentifier', () => {
    assert.deepEqual(validateDispatchPayload({ issueIdentifier: 'a'.repeat(101) }),
      { error: 'issueIdentifier exceeds maximum length of 100' });
  });
  test('over-length issueTitle', () => {
    assert.deepEqual(validateDispatchPayload({ issueTitle: 'a'.repeat(1001) }),
      { error: 'issueTitle exceeds maximum length of 1000' });
  });
  test('over-length issueUrl', () => {
    assert.deepEqual(validateDispatchPayload({ issueUrl: 'a'.repeat(8001) }),
      { error: 'issueUrl exceeds maximum length of 8000' });
  });
  test('over-length repo', () => {
    assert.deepEqual(validateDispatchPayload({ repo: 'a'.repeat(1001) }),
      { error: 'repo exceeds maximum length of 1000' });
  });
});

describe('validateDispatchPayload — model/harness (opaque)', () => {
  test('non-string model rejected (the LIN-1084 stricter form)', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', model: 0 }),
      { error: 'model must be a string' });
  });
  test('non-string harness rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', harness: 42 }),
      { error: 'harness must be a string' });
  });
  test('over-length harness rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', harness: 'a'.repeat(1001) }),
      { error: 'harness exceeds maximum length of 1000' });
  });
});

describe('validateDispatchPayload — terminal (opaque, LIN-2452)', () => {
  // Same rule as model/harness: type + length + dangerous chars, never a
  // registry check — the runner owns the driver registry.
  test('a valid driver name passes', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', terminal: 'tmux' }), null);
  });
  test('an unknown driver name still passes (not registry-checked)', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', terminal: 'some-future-driver' }), null);
  });
  test('null/omitted is absent (valid)', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', terminal: null }), null);
    assert.strictEqual(validateDispatchPayload({ prompt: 'x' }), null);
  });
  test('non-string terminal rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', terminal: 42 }),
      { error: 'terminal must be a string' });
  });
  test('over-length terminal rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', terminal: 'a'.repeat(1001) }),
      { error: 'terminal exceeds maximum length of 1000' });
  });
  test('terminal with a control char rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', terminal: 'tmux\x00' }),
      { error: 'terminal contains invalid characters' });
  });
  test('terminal is checked after harness (first-error order)', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', harness: 42, terminal: 42 }),
      { error: 'harness must be a string' });
  });
});

describe('validateDispatchPayload — effort (opaque, fail-soft, LIN-2615)', () => {
  // Same opaque rule as model/harness/terminal (type + length + dangerous
  // chars), but with one addition: an out-of-set value is a server-side
  // WARNING only, never a 400 — Claude Code itself warns and runs on an
  // unknown `--effort`, so Harbour must not be stricter than the thing it
  // forwards to (acceptance #5).
  test('a known effort level passes with no warning', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
      assert.strictEqual(validateDispatchPayload({ prompt: 'x', effort: 'high' }), null);
      assert.equal(calls.length, 0, 'a known level must not warn');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('an unknown effort level is accepted (never 400) AND emits a server-side warning', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
      const result = validateDispatchPayload({ prompt: 'x', effort: 'turbo' });
      assert.strictEqual(result, null, 'an out-of-set effort level must be accepted, not rejected with a 400');
      assert.equal(calls.length, 1, 'exactly one warning must be emitted for the unknown level');
      assert.match(calls[0], /Unknown dispatch effort level: turbo/);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('null/omitted is absent (valid), no warning', () => {
    const originalWarn = console.warn;
    const calls = [];
    console.warn = (...args) => calls.push(args.join(' '));
    try {
      assert.strictEqual(validateDispatchPayload({ prompt: 'x', effort: null }), null);
      assert.strictEqual(validateDispatchPayload({ prompt: 'x' }), null);
      assert.equal(calls.length, 0);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('non-string effort rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', effort: 42 }),
      { error: 'effort must be a string' });
  });

  test('over-length effort rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', effort: 'a'.repeat(1001) }),
      { error: 'effort exceeds maximum length of 1000' });
  });

  test('effort with a control char rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', effort: 'high\x00' }),
      { error: 'effort contains invalid characters' });
  });

  test('effort is checked after terminal (first-error order)', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', terminal: 42, effort: 42 }),
      { error: 'terminal must be a string' });
  });
});

describe('validateDispatchPayload — dangerous chars', () => {
  test('prompt with a null byte', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'bad\x00prompt' }),
      { error: 'prompt contains invalid characters' });
  });
  test('promptName with a control char', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', promptName: 'a\x07b' }),
      { error: 'promptName contains invalid characters' });
  });
  test('issueTitle with a control char', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', issueTitle: 'a\x1Fb' }),
      { error: 'issueTitle contains invalid characters' });
  });
  test('repo with a control char', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', repo: 'a\x00b' }),
      { error: 'repo contains invalid characters' });
  });
});

describe('validateDispatchPayload — id / combination rules', () => {
  test('GitHub-style numeric issueId is accepted (LIN-3440)', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', issueId: '20' }), null);
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', issueId: '#20' }), null);
  });

  test('non-string issueId is rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', issueId: 20 }),
      { error: 'Invalid issueId format' });
  });

  test('malformed issueId', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', issueId: 'not a valid id!' }),
      { error: 'Invalid issueId format' });
  });
  test('malformed followUpTo', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', followUpTo: 'nope' }),
      { error: 'Invalid followUpTo format' });
  });
  test('followUpTo on a non-cli/web target', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', followUpTo: UUID, target: 'dash' }),
      { error: 'followUpTo is only supported for cli/web targets' });
  });
  test('followUpTo defaults target to cli (valid)', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', followUpTo: UUID }), null);
  });
  test('non-boolean force', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', force: 'yes' }),
      { error: 'force must be a boolean' });
  });
  test('force + cascade are mutually exclusive', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', force: true, cascade: true, abort: true, abortTo: UUID }),
      { error: 'force and cascade are mutually exclusive' });
  });
  test('force with no verb to override at all is rejected', () => {
    // No followUpTo, no abort, and no issueIdentifier: nothing has a guard for
    // `force` to beat, so the flag really would be stored inert — the original
    // reason the rule exists (LIN-559).
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', force: true }),
      { error: 'force requires followUpTo, abort, or an issueIdentifier' });
  });
  test('force is valid alongside abort', () => {
    assert.strictEqual(validateDispatchPayload({ force: true, abort: true, abortTo: UUID }), null);
  });
  // LIN-1656: the duplicate-dispatch guard reads `force` on an issue-scoped FRESH
  // dispatch, so that shape is the third verb with a guard for `force` to override
  // — and validation must let it through to the factory. Without this the owner's
  // required escape hatch is unreachable: the request 400s before the guard runs.
  test('force is valid on a fresh issue-scoped dispatch (the duplicate-guard hatch)', () => {
    assert.strictEqual(
      validateDispatchPayload({ prompt: 'x', force: true, issueIdentifier: 'LIN-42' }), null);
  });
  test('the relaxation is scoped to force — cascade exclusion still holds with an issueIdentifier', () => {
    // Deliberately NOT relaxed: `force`/`cascade` is about a cascade emitting its
    // own plain unforced aborts, which LIN-1656 does not touch.
    assert.deepEqual(
      validateDispatchPayload({
        prompt: 'x', force: true, cascade: true, abort: true, abortTo: UUID, issueIdentifier: 'LIN-42'
      }),
      { error: 'force and cascade are mutually exclusive' });
  });
  // sessionId is an OPAQUE grouping key, not a UUID (LIN-1118). These replace the
  // old 'malformed sessionId' test, whose subject ('nope') is now legitimately
  // valid — the relaxation is the point of the ticket.
  test('an existing UUID sessionId still passes (pure relaxation)', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', sessionId: UUID }), null);
  });
  test('a composite/deterministic sessionId passes', () => {
    assert.strictEqual(
      validateDispatchPayload({ prompt: 'x', sessionId: 'LIN-1117-autopilot-standalone-2026-07-07' }), null);
    // A colon is deliberately allowed: urlKey is [a-z0-9-]{1,50} and cannot
    // contain one, so the `${urlKey}:${sessionId}` doc-key prefix stays unambiguous.
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', sessionId: 'run:1' }), null);
  });
  test('a non-string sessionId is still rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: 42 }),
      { error: 'sessionId must be a string' });
  });
  test('sessionId is capped at 128 chars, not the 1000-char default', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', sessionId: 'a'.repeat(128) }), null);
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: 'a'.repeat(129) }),
      { error: 'sessionId exceeds maximum length of 128' });
  });
  test('an empty sessionId is rejected (would be silently coerced to null at the store)', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: '' }),
      { error: 'sessionId must not be empty' });
  });
  test('control characters are rejected — including \\t \\n \\r, which the prompt rule allows', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: 'a\x00b' }),
      { error: 'sessionId contains invalid characters' });
    for (const ws of ['a\nb', 'a\tb', 'a\rb']) {
      assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: ws }),
        { error: 'sessionId contains invalid characters' });
    }
  });
  test("the reserved value '__meta__' is rejected (observation backfill-marker collision)", () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: '__meta__' }),
      { error: 'sessionId must not be a reserved value' });
  });
});

describe('validateDispatchPayload — check ORDER (first error is load-bearing)', () => {
  test('a length violation is reported before a model violation', () => {
    // prompt length is checked before model, so a payload violating both surfaces
    // the prompt error first — matching the original interleaving in both handlers.
    const r = validateDispatchPayload({ prompt: 'a'.repeat(10_000_001), model: 0 });
    assert.deepEqual(r, { error: 'prompt exceeds maximum length of 10000000' });
  });
  test('a model violation is reported before a dangerous-char prompt violation', () => {
    const r = validateDispatchPayload({ prompt: 'bad\x00', model: 0 });
    assert.deepEqual(r, { error: 'model must be a string' });
  });
  test('sessionId keeps its LAST position — an earlier violation still wins', () => {
    // LIN-1118 swapped the rule, not its slot. A payload violating both issueId
    // and sessionId must still surface the issueId error first.
    const r = validateDispatchPayload({ prompt: 'x', issueId: 'no pe!', sessionId: '__meta__' });
    assert.deepEqual(r, { error: 'Invalid issueId format' });
  });
});

// LIN-3487: the entrance checks the routes used to restate, now declared once.
// Each returns the exact message the entrances always sent, or null.
describe('abortFollowUpError', () => {
  const MSG = 'abort and followUpTo are mutually exclusive';
  test('abort with a followUpTo is rejected with the exact message', () => {
    assert.equal(abortFollowUpError({ isAbort: true, followUpTo: UUID }), MSG);
  });
  test('null and undefined followUpTo are absent; no abort is never rejected', () => {
    assert.equal(abortFollowUpError({ isAbort: true, followUpTo: undefined }), null);
    assert.equal(abortFollowUpError({ isAbort: true, followUpTo: null }), null);
    assert.equal(abortFollowUpError({ isAbort: false, followUpTo: UUID }), null);
  });
});

describe('abortToError', () => {
  const REQUIRED = 'abortTo is required and must be a UUID when abort is true';
  const REQUIRES_ABORT = 'abortTo requires abort to be true';
  test('with abort: a missing or non-UUID abortTo gets the required message', () => {
    for (const bad of [undefined, null, '', 'nope', 42, `${UUID}x`]) {
      assert.equal(abortToError({ isAbort: true, abortTo: bad }), REQUIRED, String(bad));
    }
  });
  test('with abort: a UUID is accepted', () => {
    assert.equal(abortToError({ isAbort: true, abortTo: UUID }), null);
  });
  test('without abort: abortTo is rejected, but undefined and null are absent', () => {
    assert.equal(abortToError({ isAbort: false, abortTo: UUID }), REQUIRES_ABORT);
    assert.equal(abortToError({ isAbort: false, abortTo: '' }), REQUIRES_ABORT);
    assert.equal(abortToError({ isAbort: false, abortTo: undefined }), null);
    assert.equal(abortToError({ isAbort: false, abortTo: null }), null);
  });
});

describe('cascadeAbortError', () => {
  test('cascade: true without abort is rejected with the exact message', () => {
    assert.equal(cascadeAbortError({ isAbort: false, cascade: true }), 'cascade requires abort to be true');
  });
  test('cascade with abort, or not true, is accepted (the boolean type check is validateRunField)', () => {
    assert.equal(cascadeAbortError({ isAbort: true, cascade: true }), null);
    assert.equal(cascadeAbortError({ isAbort: false, cascade: false }), null);
    assert.equal(cascadeAbortError({ isAbort: false, cascade: undefined }), null);
  });
});

describe('dispatchKindError', () => {
  test('rejects an unknown kind with the exact text listing DISPATCH_KINDS', () => {
    assert.equal(dispatchKindError('nope'), `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
    assert.match(dispatchKindError('nope'), /^kind must be one of: /);
  });
  test('undefined is absent; null is rejected', () => {
    assert.equal(dispatchKindError(undefined), null);
    assert.match(dispatchKindError(null), /^kind must be one of: /);
  });
  test('every declared kind is accepted', () => {
    for (const kind of DISPATCH_KINDS) assert.equal(dispatchKindError(kind), null, kind);
  });
});

describe('periodicalIdError', () => {
  const MSG = 'periodicalId must be one of the known periodical template ids';
  test('a registered id and undefined are accepted', () => {
    assert.equal(periodicalIdError(undefined), null);
    for (const { id } of getPeriodicals()) assert.equal(periodicalIdError(id), null, id);
  });
  test('an unknown id, null and the empty string are rejected with the exact message', () => {
    for (const bad of ['no-such-periodical', null, '', 0]) {
      assert.equal(periodicalIdError(bad), MSG, String(bad));
    }
  });
});

describe('isValidAutopilotVariant', () => {
  test('accepts exactly standard and stepper', () => {
    assert.equal(isValidAutopilotVariant('standard'), true);
    assert.equal(isValidAutopilotVariant('stepper'), true);
    for (const bad of ['', 'Standard', 'other', null, undefined, 1, ['standard']]) {
      assert.equal(isValidAutopilotVariant(bad), false, String(bad));
    }
  });
});

describe('targetError', () => {
  test('DISPATCH list: local is allowed; unknown and null are rejected with the exact text', () => {
    const msg = 'target must be one of: cli, web, dash, local';
    for (const ok of ['cli', 'web', 'dash', 'local', undefined]) {
      assert.equal(targetError(ok, DISPATCH_TARGETS), null, String(ok));
    }
    for (const bad of ['nope', 'CLI', '', null, 0]) {
      assert.equal(targetError(bad, DISPATCH_TARGETS), msg, String(bad));
    }
  });
  test('POLLED list: local is rejected; the text lists cli, web, dash', () => {
    const msg = 'target must be one of: cli, web, dash';
    for (const ok of ['cli', 'web', 'dash', undefined]) {
      assert.equal(targetError(ok, POLLED_TARGETS), null, String(ok));
    }
    for (const bad of ['local', 'nope', null]) {
      assert.equal(targetError(bad, POLLED_TARGETS), msg, String(bad));
    }
  });
});

describe('followUpToError', () => {
  const BAD_FORMAT = 'Invalid followUpTo format';
  const BAD_TARGET = 'followUpTo is only supported for cli/web targets';
  test('undefined and null followUpTo are absent whatever the target', () => {
    for (const followUpTo of [undefined, null]) {
      assert.equal(followUpToError({ followUpTo, target: 'dash' }), null);
      assert.equal(followUpToError({ followUpTo, target: 'local' }), null);
    }
  });
  test('a non-UUID is the format error, checked before the target', () => {
    for (const bad of ['', 'nope', 42, `${UUID}x`, false]) {
      assert.equal(followUpToError({ followUpTo: bad, target: 'dash' }), BAD_FORMAT, String(bad));
    }
  });
  test('a UUID is accepted for cli, web and an absent or empty target (defaults to cli)', () => {
    for (const target of ['cli', 'web', undefined, null, '']) {
      assert.equal(followUpToError({ followUpTo: UUID, target }), null, String(target));
    }
  });
  test('a UUID with dash or local is the cli/web error', () => {
    for (const target of ['dash', 'local']) {
      assert.equal(followUpToError({ followUpTo: UUID, target }), BAD_TARGET, target);
    }
  });
  test('validateDispatchPayload still returns it as { error } at the same position', () => {
    assert.deepEqual(validateDispatchPayload({ followUpTo: 'nope', target: 'dash' }), { error: BAD_FORMAT });
    assert.deepEqual(validateDispatchPayload({ followUpTo: UUID, target: 'dash' }), { error: BAD_TARGET });
  });
});

describe('validateDispatchPayload — force goes through the declared rule', () => {
  test('a non-boolean force keeps its message, and null is still rejected', () => {
    for (const bad of ['true', 1, null, {}]) {
      assert.deepEqual(validateDispatchPayload({ force: bad }), { error: 'force must be a boolean' }, String(bad));
    }
  });
});
