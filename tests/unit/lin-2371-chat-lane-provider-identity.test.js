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
 * native scale, as documented at `POST /api/proxy/issues` — not a claim about
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
    assert.match(narrative('GitHub Issues'),
      /- Tasks carry their GitHub Issues identifier \(e\.g\. LIN-204\)/);
  });

  test('Linear still reads exactly as before on a Linear-backed workspace', () => {
    assert.match(narrative('Linear'),
      /- Tasks carry their Linear identifier \(e\.g\. LIN-204\)/);
  });

  test('an unresolved provider degrades to the neutral scheme, never Linear', () => {
    for (const absent of ABSENT) {
      const out = narrative(absent);
      assert.match(out, /- Tasks carry their tracker identifier \(e\.g\. LIN-204\)/,
        `${absent}: neutral identifier phrasing`);
      assert.doesNotMatch(out, /their Linear identifier/,
        `${absent}: must never fall back to Linear`);
    }
  });

  test('the surrounding instruction is untouched', () => {
    assert.match(narrative(null),
      /Cite the identifier alongside the title at least on first mention of a task/);
    // The one other identifier reference in this prompt is a literal example of a
    // string the model must not rewrite — not a provider claim. It stays.
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
