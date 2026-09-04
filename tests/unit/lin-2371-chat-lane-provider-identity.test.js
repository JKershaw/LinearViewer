/**
 * LIN-2371 — the chat/narrative prompt templates and the declared provider identity.
 *
 * LIN-2354 neutralised the AGENT-facing prose; these two HUMAN-facing templates
 * were explicitly deferred and still asserted Linear to every workspace:
 *
 *   - lib/prompts/task-chat-template.js   "You ARE a single Linear task…"
 *     — the persona sentence the whole Task Chat conversation is built on.
 *   - lib/prompts/roadmap-narrative-template.js
 *     "Tasks carry their Linear identifier (e.g. LIN-204)"
 *     — the identifier scheme is the provider's, not Linear's.
 *
 * Both now take the DECLARED provider display name and degrade to a neutral
 * phrasing when it is absent, per LIN-2354's contract. The degrade cases are the
 * load-bearing assertions: a fallback to Linear is the defect itself, and
 * asserting only the declared case would not catch it.
 *
 * ALSO PINNED HERE (a deliberate non-change): `PRIORITY_WORDS` in
 * roadmap-narrative-template.js is documented as "Linear numeric priority → word".
 * That is an internal note about the STORED SCALE — the descending 1..4 Linear
 * native scale, as documented at docs/proxy-integration.md — not a claim about
 * which provider backs the workspace. LIN-2354's trap T2 forbids renaming a
 * Linear-specific storage quirk onto another provider, and LIN-2371's own
 * acceptance repeats it, so that comment must stay put. The test below fails if
 * a later pass "helpfully" neutralises it.
 *
 * Run with: node --test tests/unit/lin-2371-chat-lane-provider-identity.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTaskChatMessages } from '../../lib/prompts/task-chat-template.js';
import { buildRoadmapNarrativeMessages } from '../../lib/prompts/roadmap-narrative-template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ISSUE = { identifier: 'ENG-42', title: 'Ship the thing', description: 'Do it.' };
const CONTEXT = { comments: [], children: [], parent: null, siblings: [], project: null };

const systemPrompt = (providerDisplayName) =>
  buildTaskChatMessages(ISSUE, CONTEXT, 'where do you stand?', [], providerDisplayName)
    .find(m => m.role === 'system').content;

const narrative = (providerDisplayName) =>
  buildRoadmapNarrativeMessages({ projects: [], milestones: [], criticalPaths: {}, risks: [] },
    providerDisplayName)
    .find(m => m.role === 'system').content;

// The two absent-provider shapes a caller can produce: an explicitly undeclared
// workspace (null) and a caller that has not been threaded at all (undefined,
// i.e. the parameter default).
const ABSENT = [null, undefined];

describe('LIN-2371 — task-chat persona names the declared provider', () => {
  test('a declared provider is named', () => {
    assert.match(systemPrompt('Jira'), /^You ARE a single Jira task, speaking for yourself/);
  });

  test('Linear still reads exactly as before on a Linear-backed workspace', () => {
    assert.match(systemPrompt('Linear'), /^You ARE a single Linear task, speaking for yourself/);
  });

  test('an unresolved provider degrades to the neutral persona, never Linear', () => {
    for (const absent of ABSENT) {
      const out = systemPrompt(absent);
      assert.match(out, /^You ARE a single task, speaking for yourself/,
        `${absent}: neutral persona`);
      assert.doesNotMatch(out, /single Linear task/,
        `${absent}: must never fall back to Linear`);
      // Neutral, not hedged — no "unknown"/"your provider" placeholder leaks in.
      assert.doesNotMatch(out, /unknown provider|your tracker's/i);
    }
  });

  test('the rest of the persona sentence is untouched', () => {
    // The identity label and the ownership framing are load-bearing for the
    // conversation and are not part of this change.
    assert.match(systemPrompt(null), /You are ENG-42 — Ship the thing\./);
    assert.match(systemPrompt(null), /in a conversation with the person who owns you/);
  });
});

describe('LIN-2371 — roadmap narrative names the declared identifier scheme', () => {
  test('a declared provider is named', () => {
    assert.match(narrative('GitHub Issues'), /- Tasks carry their GitHub Issues identifier where one exists\./);
  });

  test('Linear still reads the same on a Linear-backed workspace', () => {
    assert.match(narrative('Linear'), /- Tasks carry their Linear identifier where one exists\./);
  });

  test('an unresolved provider degrades to the neutral scheme, never Linear', () => {
    for (const absent of ABSENT) {
      const out = narrative(absent);
      assert.match(out, /- Tasks carry their tracker identifier where one exists\./,
        `${absent}: neutral identifier phrasing`);
      assert.doesNotMatch(out, /their Linear identifier/,
        `${absent}: must never fall back to Linear`);
    }
  });

  test('the LIN-204 example is gone — it contradicted the provider it qualified', () => {
    // Found by review: naming the scheme from the real provider turned this
    // sentence into "their Jira identifier (e.g. LIN-204)" — self-contradictory
    // on exactly the non-Linear workspaces the fix exists for. An earlier draft
    // of this very test PINNED that contradiction.
    for (const name of ['Jira', 'GitHub Issues', 'Linear', null]) {
      assert.doesNotMatch(narrative(name), /identifier \(e\.g\./,
        `${name}: no provider-specific example may qualify the identifier phrase`);
    }
  });

  test('the surrounding instruction is untouched', () => {
    assert.match(narrative(null),
      /Cite the identifier alongside the title at least on first mention of a task/);
    // The one other identifier reference is a literal example of a string the
    // model must not REWRITE — a don't-alter rule, not a claim about the
    // scheme. It stays.
    assert.match(narrative(null), /never alter identifiers like LIN-123/);
  });
});

describe('LIN-2371 — the stored-scale note is deliberately NOT neutralised (trap T2)', () => {
  const SRC = readFileSync(
    join(__dirname, '../../lib/prompts/roadmap-narrative-template.js'), 'utf8');

  test('PRIORITY_WORDS keeps its Linear-scale note', () => {
    // LIN-2354 trap T2 / LIN-2371 acceptance: this documents the DESCENDING 1..4
    // scale the values are actually stored in (Linear's native scale), not which
    // provider backs the workspace. Renaming it onto another provider would make
    // it false; deleting "Linear" would make it ambiguous about whose scale it is.
    assert.match(SRC, /Linear numeric priority → word/,
      'the stored-scale note must survive a provider-neutrality pass');
  });

  test('no unconditional provider claim survives in either template', () => {
    // The scale note above is the ONLY permitted "Linear" in this file: it is a
    // comment about storage, never emitted into the prompt.
    const promptText = narrative(null) + '\n' + narrative('Jira');
    assert.doesNotMatch(promptText, /their Linear identifier/);

    const chatSrc = readFileSync(
      join(__dirname, '../../lib/prompts/task-chat-template.js'), 'utf8');
    assert.doesNotMatch(chatSrc, /You ARE a single Linear task/,
      'the hardcoded persona this ticket exists to remove');
  });
});


/**
 * B1 (found by review) — pin the ROUTE wiring, not just the templates.
 *
 * Mutation-proved before this block existed: deleting BOTH new arguments at the
 * two call sites — i.e. reverting the entire user-visible effect of this change —
 * left the full 9173-test suite green, as did swapping the roadmap route's
 * fallback-free derivation for the legacy-defaulting `getProviderForWorkspace`,
 * which reintroduces LIN-2354's exact defect.
 *
 * This is the same discharge `tests/unit/lin-2354-session-lane-no-provider.test.js`
 * exists to provide for LIN-2354's four session-lane sites; LIN-2371 adds two more
 * of the same kind. Source assertions are the established in-repo convention for
 * it (tests/unit/task-chat-route.test.js) and are used here because both routes'
 * test-mode paths short-circuit BEFORE the prompt builders — `runLayer` returns
 * `emitMockLayer`, and the task-chat `mockAi` branch returns before
 * `buildTaskChatMessages` — so a driven-route assertion cannot reach them.
 */
describe('LIN-2371 — the route derivations are pinned', () => {
  const src = (rel) => readFileSync(join(__dirname, '../../', rel), 'utf8');

  test('routes/task-chat.js derives the name fallback-free and passes it to the builder', () => {
    const ROUTE = src('routes/task-chat.js');
    assert.match(ROUTE, /const providerDisplayName = getProvider\(declaredSource\)\?\.ui\?\.displayName \?\? null;/,
      'must use the bare registry lookup, never the legacy-defaulting one');
    assert.match(ROUTE, /buildTaskChatMessages\(.*, providerDisplayName\);/,
      'the derived name must actually reach the persona builder');
  });

  test('routes/task-chat.js honours ?source= only when it matches a REAL binding', () => {
    const ROUTE = src('routes/task-chat.js');
    // Reading `workspace.bindings` directly is load-bearing:
    // `getBindingsForWorkspace` SYNTHESIZES a `provider || 'linear'` binding for a
    // legacy workspace, which would smuggle the Linear default straight back in.
    assert.match(ROUTE, /\(workspace\.bindings \|\| \[\]\)\.some\(b => b\.provider === requestedSource\)/,
      'an unmatched client-supplied source must not reach the prose');
    // Match a CALL, not a prose mention — the comment at the derivation
    // explains precisely why that helper is avoided, and a bare name match
    // would fail on its own explanation. (This file already has one such
    // wire: tests/unit/task-chat-route.test.js's LIN-2047 guard matches
    // `getProviderForWorkspace` anywhere, comments included.)
    assert.doesNotMatch(ROUTE, /getBindingsForWorkspace\(/,
      'that helper synthesizes a linear-defaulted binding — never call it for identity');
  });

  test('routes/workspace-api-roadmap.js derives the name fallback-free and passes it to the builder', () => {
    const ROUTE = src('routes/workspace-api-roadmap.js');
    assert.match(ROUTE, /const declaredProviderDisplayName = getProvider\(req\.workspace\?\.provider\)\?\.ui\?\.displayName \?\? null;/,
      'must use the bare registry lookup, never the legacy-defaulting one');
    assert.match(ROUTE, /buildRoadmapNarrativeMessages\(roadmapModel, declaredProviderDisplayName\)/,
      'the derived name must actually reach the narrative builder');
    // This file legitimately imports getProviderForWorkspace for capability
    // shaping, so a bare doesNotMatch on the file would be wrong. Pin instead
    // that the NARRATIVE derivation is not the defaulting one.
    assert.doesNotMatch(ROUTE, /const declaredProviderDisplayName = getProviderForWorkspace/,
      'the identity derivation must not be the legacy-defaulting helper');
  });
});
