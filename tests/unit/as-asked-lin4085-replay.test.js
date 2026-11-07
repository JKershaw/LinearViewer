/**
 * LIN-4353: the LIN-4085 replay, the deterministic part. On 1 November LIN-4085 asked for "a full guide on how to
 * properly configure" Harbour; scoping thinned it, the plan budgeted it, and review
 * approved the thin guide because "the deliverable meets the plan"
 * (docs/papers/harbour/one-feature-twice.md). Replayed through the As-asked change,
 * the filed words must reach the judging step unchanged, and review must start
 * from them before it reads the plan.
 *
 * The fixture is the request exactly as filed (tests/fixtures/lin-4085-filed-request.txt,
 * copied from docs/reviews/lin-4085-ab-run-2026-11-01.md, slips kept). The test does
 * not read that record: the fixture is its input, and the record is a doc that may
 * move, so the provenance lives here and is not re-checked at run time. The brief
 * model is a stub that thins the ask the way scoping did, so the only way the
 * phrase survives is code quoting the block. Whether a model then catches the thin
 * guide is not a CI question; it is the hand-run replay recorded in the PR.
 *
 * Run with: node --test tests/unit/as-asked-lin4085-replay.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sealAsAsked } from '../../lib/as-asked.js';
import { generateBrief } from '../../lib/brief.js';
import { generatePrompt } from '../../lib/prompt-templates.js';

const FILED = fs.readFileSync(new URL('../fixtures/lin-4085-filed-request.txt', import.meta.url), 'utf8');
const PHRASE = 'a full guide on how to properly configure';

// What LIN-4085's description looked like once sealed and worked: the block, then
// the stages' writing below it, including the plan that narrowed the ask.
const DESCRIPTION = `${sealAsAsked(FILED)}\n\n## Implementation Plan\n\nAdd a homepage prompt and a short /getting-started page that sequences the human's few clicks, within a size budget of about 4.5 KB.\n\nfits one session\n\nplan-review due: no`;
const ISSUE = { id: 'i-4085', identifier: 'LIN-4085', title: 'Homepage getting-started prompt for agents', description: DESCRIPTION, labels: [], comments: [] };
const CONTEXT = { parent: null, siblings: [], project: { name: 'Harbour' }, children: [], comments: [] };

// The stub brief model thins the ask the way scoping did on the day.
const THIN_BRIEF = '## Current\nSequence the human\'s few clicks to onboard an agent.\n\n## Constraints\n- _None._\n\n## Open questions\n- _None._\n\n## Changelog\n- _None._';

let restoreFetch = null;
function installModelStub(text) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) {
      async function* gen() {
        yield new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        yield new TextEncoder().encode('data: [DONE]\n\n');
      }
      return { ok: true, status: 200, body: gen(), text: async () => '', json: async () => ({}) };
    }
    return realFetch(url, options);
  };
  restoreFetch = () => { globalThis.fetch = realFetch; };
}

// streamChat goes through an https-proxy-agent when a proxy is configured, which
// would bypass the stub (the hermetic:proxy arm sets one); as-asked-brief.test.js
// clears and restores the same vars.
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
let savedProxy = {};
beforeEach(() => {
  savedProxy = Object.fromEntries(PROXY_VARS.map(k => [k, process.env[k]]));
  for (const k of PROXY_VARS) delete process.env[k];
});
afterEach(() => {
  if (restoreFetch) restoreFetch();
  restoreFetch = null;
  for (const [k, v] of Object.entries(savedProxy)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

/** The review prompt's Process section: from `## Process` to the first `### ` subsection. */
function processOf(prompt) {
  const start = prompt.indexOf('## Process');
  assert.ok(start > -1, 'the review prompt has a Process section');
  const rest = prompt.slice(start);
  const end = rest.indexOf('\n### ');
  return end > -1 ? rest.slice(0, end) : rest;
}

describe('the LIN-4085 replay, deterministic part (LIN-4353)', () => {
  test('the fixture carries the phrase the run lost', () => {
    assert.ok(FILED.includes(PHRASE), 'the filed request carries the phrase the run lost');
  });

  test('the brief carries the filed words verbatim, though the model thinned them', async () => {
    installModelStub(THIN_BRIEF);
    const { brief } = await generateBrief(ISSUE, CONTEXT, { apiKey: 'test-key' });
    assert.ok(!THIN_BRIEF.includes(PHRASE), 'the stub model really did drop the phrase');
    assert.ok(brief.startsWith(`## As asked\n\n${FILED}\n\n`), 'the brief opens with the filed words, byte for byte');
    assert.ok(brief.includes(PHRASE), `the brief carries "${PHRASE}" verbatim`);
  });

  // The review prompt points at the block; it does not quote it. Stage prompts never
  // copy the description (formatDiscussionReference, PR #369), and a quote would be the
  // extra copy LIN-4345 decided against. The words reach review through the brief
  // (above, quoted by code) and the description itself; review must read them first.
  test('review\'s Process starts from the As asked block, before the plan and the implementation notes', () => {
    const { prompt } = generatePrompt('review', ISSUE, CONTEXT);
    assert.ok(!prompt.includes(PHRASE), 'the review prompt points at the block rather than copying it (#369)');
    const process = processOf(prompt);
    const askedAt = process.search(/`## As asked`/);
    const planAt = process.search(/\bthe plan\b/i);
    const notesAt = process.search(/implementation notes/i);
    assert.ok(askedAt > -1, `review's Process names the \`## As asked\` block; got:\n${process}`);
    assert.ok(planAt > -1 && notesAt > -1, 'review\'s Process still reads the plan and the implementation notes');
    assert.ok(askedAt < planAt && askedAt < notesAt, `the block comes before the plan and the notes; got:\n${process}`);
  });

  // LIN-4345: arm A3's one quoted line cut at an ellipsis before the narrowed clause, so the
  // verdict now accounts for every sentence of the block. Whether a model then catches the
  // thin guide is the hand-run replay (docs/reviews/lin-4345-per-sentence-replay-2026-11-07.md).
  test('review\'s verdict must account for each sentence of the block, none skipped or cut short', () => {
    const { prompt } = generatePrompt('review', ISSUE, CONTEXT);
    const each = prompt.split(/\n/).some(s => /what was asked/i.test(s) && /each sentence of the block/i.test(s) && /none skipped or cut short/i.test(s) && /\bmee?ts?\b|\bmet\b/i.test(s));
    assert.ok(each, 'review\'s verdict takes each sentence of the block and says where the work meets it');
  });
});
