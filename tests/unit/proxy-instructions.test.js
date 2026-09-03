// Unit tests for lib/proxy-instructions.js (LIN-2245).
//
// buildInstructions is the pure Markdown template construction extracted
// verbatim out of routes/proxy.js's GET /api/proxy/instructions handler. It
// captures none of createProxyRoutes's injected dependencies and does no
// IO — a pure function of its five inputs. These exercise the builder
// DIRECTLY (proxy-preamble.test.js style): no express, no server.
//
// The `read` branch's exclusion of the write-only sections had no unit
// witness anywhere before this ticket (see tests/unit/lin-2354-instructions-
// provider-identity.test.js for the HTTP-level wiring half of the same seam).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstructions } from '../../lib/proxy-instructions.js';

const BASE_URL = 'https://example.test';

describe('buildInstructions — scope gates Write Endpoints + Shell Tip', () => {
  test('readWrite scope includes the write-only sections', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite' });
    assert.match(text, /## Write Endpoints/);
    assert.match(text, /## Shell Tip/);
    assert.match(text, /\(Read-write — you can query and modify data\)/);
  });

  test('read scope omits the write-only sections (no witness before this ticket)', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'read' });
    assert.doesNotMatch(text, /## Write Endpoints/);
    assert.doesNotMatch(text, /## Shell Tip/);
    assert.match(text, /\(Read-only — you can query but not modify data\)/);
  });

  test('every read endpoint reference embeds baseUrl in both scopes', () => {
    for (const scope of ['read', 'readWrite']) {
      const text = buildInstructions({ baseUrl: BASE_URL, scope });
      assert.match(text, new RegExp(`GET ${BASE_URL}/api/proxy/me`));
    }
  });
});

describe('buildInstructions — declaredDisplayName (LIN-2354)', () => {
  test('omitted/null drops the "currently backed by X" clause entirely, never guessing', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite' });
    assert.doesNotMatch(text, /currently backed by/);
  });

  test('a resolved display name is stated verbatim', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite', declaredDisplayName: 'GitHub Issues' });
    assert.match(text, /this workspace is currently backed by GitHub Issues\./);
  });
});

describe('buildInstructions — isDeclaredLinear (LIN-2354)', () => {
  test('false (default) drops the Linear-only priority-scale and markdown-escaping notes', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite' });
    assert.doesNotMatch(text, /Linear's NATIVE scale/);
    assert.doesNotMatch(text, /Linear stores markdown punctuation backslash-escaped/);
  });

  test('true includes the Linear-only priority-scale and markdown-escaping notes', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite', isDeclaredLinear: true });
    assert.match(text, /Linear's NATIVE scale/);
    assert.match(text, /Linear stores markdown punctuation backslash-escaped/);
  });
});

describe('buildInstructions — requiresTeam (LIN-2352)', () => {
  test('false (default) states the conditional-refusal teamId policy, not a hard requirement', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite' });
    assert.match(
      text,
      /teamId is required only when your workspace's provider declares team support; an explicit value on a provider that doesn't is refused with 400\./
    );
    assert.doesNotMatch(text, /teamId is required for this workspace\./);
    assert.doesNotMatch(text, /teamId accepts a team key/);
  });

  test('true states teamId is required and documents symbolic teamId support', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite', requiresTeam: true });
    assert.match(text, /teamId is required for this workspace\./);
    assert.match(text, /teamId accepts a team key \(e\.g\. LIN\) or name as well as a UUID\./);
  });
});
