/**
 * LIN-4535 (P5, plan D4, D5 and the ender): a comment's author is decided in one place, and a person's comment reaches its
 * task once, as a finding under its real author.
 *
 * The witnesses (plan §7 for P5):
 *   - a ledger write that fails after a post is retried, then counted as a gap, and the post still answers (lib/harbour-comment-post.js);
 *   - a Harbour-posted comment is never ingested (the ledger), a person's comment is ingested exactly once across two passes,
 *     an unmatched or id-less author is left out, the owner's own comment typed outside Harbour is the owner's, and a person's
 *     words that look like an agent note are still the person's (lib/comment-ingest.js);
 *   - the finding is ended by its named ender, and only the findings a run carried (lib/comment-ingest.js endCarriedPersonFindings);
 *   - the census: every provider comment post goes through the one seam, only the ingest reads a comment's author, and the
 *     retired authorship readers stay gone.
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  postHarbourComment,
  repairHarbourCommentRecord,
  HARBOUR,
  configureHarbourCommentLedger,
  harbourCommentLedgerGaps,
  resetHarbourCommentLedgerGaps,
  LEDGER_ATTEMPTS,
  commentIdOf
} from '../../lib/harbour-comment-post.js';
import {
  configureCommentIngest,
  personCommentsOf,
  ingestPersonComments,
  personFindingsOf,
  personFindingOfComment,
  endCarriedPersonFindings,
  recordPersonCommentFinding
} from '../../lib/comment-ingest.js';
import { fixedIdOf } from '../../lib/records/refs.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const T = (hm) => `2026-11-23T${hm}:00.000Z`;
const URL_KEY = 'acme';

/** A ledger that records what it is asked to, failing the first `failures` calls (or all of them with `failures: Infinity`). */
function fakeLedger({ failures = 0 } = {}) {
  const recorded = new Set();
  const calls = [];
  let n = 0;
  return {
    calls,
    recorded,
    async record({ urlKey, commentId }) {
      n += 1;
      calls.push({ urlKey, commentId });
      if (n <= failures) return null;
      recorded.add(commentId);
      return { urlKey, commentId };
    },
    async wereRecordedByHarbour(_urlKey, comments) {
      return new Set((comments || []).map((c) => c.commentId || c.id).filter((id) => recorded.has(id)));
    }
  };
}

describe('the one seam for Harbour\'s own comment posts (lib/harbour-comment-post.js)', () => {
  beforeEach(() => {
    configureHarbourCommentLedger(null);
    resetHarbourCommentLedgerGaps();
  });

  test('a post is recorded in the ledger under its workspace, after it lands, and the answer is returned as the provider gave it', async () => {
    const store = fakeLedger();
    const answer = { success: true, comment: { id: 'c-1', body: 'hi' } };
    const out = await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store, post: async () => answer });
    assert.equal(out, answer);
    assert.deepEqual(store.calls, [{ urlKey: URL_KEY, commentId: 'c-1' }]);
  });

  test('a refused post (success: false) and an answer with no id record nothing', async () => {
    const store = fakeLedger();
    await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store, post: async () => ({ success: false }) });
    await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store, post: async () => ({ success: true, comment: {} }) });
    assert.equal(store.calls.length, 0);
  });

  test('a failed record is retried LEDGER_ATTEMPTS times in all, then counted as a gap; the post still answers (it never throws on the ledger)', async () => {
    const store = fakeLedger({ failures: Infinity });
    const answer = { success: true, comment: { id: 'c-2' } };
    const out = await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store, post: async () => answer });
    assert.equal(out, answer, 'the write answers as it did before the ledger');
    assert.equal(store.calls.length, LEDGER_ATTEMPTS);
    assert.equal(harbourCommentLedgerGaps(), 1, 'the gap is counted');
  });

  test('a record that succeeds on a retry is no gap', async () => {
    const store = fakeLedger({ failures: LEDGER_ATTEMPTS - 1 });
    await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store, post: async () => ({ success: true, comment: { id: 'c-3' } }) });
    assert.equal(store.calls.length, LEDGER_ATTEMPTS);
    assert.equal(harbourCommentLedgerGaps(), 0);
    assert.ok(store.recorded.has('c-3'));
  });

  test('a post that throws propagates to its caller, and nothing is recorded', async () => {
    const store = fakeLedger();
    await assert.rejects(() => postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store, post: async () => { throw new Error('tracker down'); } }), /tracker down/);
    assert.equal(store.calls.length, 0);
  });

  test('the registered ledger is the default when a caller names none; with no ledger at all the post is not recorded and not a gap', async () => {
    const store = fakeLedger();
    configureHarbourCommentLedger(store);
    await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, post: async () => ({ success: true, comment: { id: 'c-4' } }) });
    assert.equal(store.calls.length, 1);
    configureHarbourCommentLedger(null);
    await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, post: async () => ({ success: true, comment: { id: 'c-5' } }) });
    assert.equal(harbourCommentLedgerGaps(), 0);
  });

  test('commentIdOf reads the envelope or the bare comment', () => {
    assert.equal(commentIdOf({ success: true, comment: { id: 'x' } }), 'x');
    assert.equal(commentIdOf({ id: 'y', body: 'b' }), 'y');
    assert.equal(commentIdOf(null), null);
  });
});

describe('who wrote a comment: personCommentsOf (lib/comment-ingest.js)', () => {
  const people = [
    { accountId: 'john', name: 'John', trackerUserId: 'u-john' },
    { accountId: 'mo', name: 'Mo', trackerUserId: 'u-mo' }
  ];
  const c = (commentId, authorId, createdAt = T('10:00'), body = 'words') => ({ commentId, authorId, createdAt, body });

  test('a comment by a workspace person\'s tracker user is that person\'s', () => {
    const out = personCommentsOf([c('a', 'u-mo')], { people });
    assert.deepEqual(out.map((x) => [x.commentId, x.accountId]), [['a', 'mo']]);
  });

  test('the owner\'s own comment typed outside Harbour is the owner\'s', () => {
    const out = personCommentsOf([c('own', 'u-john')], { people });
    assert.equal(out[0].accountId, 'john');
  });

  test('an unmatched author, and an id-less author, are left out, never credited to the owner', () => {
    assert.deepEqual(personCommentsOf([c('x', 'u-stranger')], { people }), []);
    assert.deepEqual(personCommentsOf([c('y', null)], { people }), []);
    assert.deepEqual(personCommentsOf([c('z', undefined)], { people }), []);
  });

  test('a comment at or before the cutover is not ingested; one after it is', () => {
    const cutoffAt = Date.parse(T('09:00'));
    const out = personCommentsOf([c('old', 'u-mo', T('09:00')), c('new', 'u-mo', T('09:01'))], { people, cutoffAt });
    assert.deepEqual(out.map((x) => x.commentId), ['new']);
  });

  test('a comment the ledger recorded as Harbour\'s is never ingested', () => {
    const out = personCommentsOf([c('harbour', 'u-john'), c('person', 'u-mo')], { people, recorded: new Set(['harbour']) });
    assert.deepEqual(out.map((x) => x.commentId), ['person']);
  });

  test('a person\'s words that look like an agent\'s note, or a summary, are still the person\'s (the words decide nothing)', () => {
    const words = ['**Autopilot step record — parked.**', '## Plan finalized — next action: breakdown', '**Close-out: PR merged.**'];
    const out = personCommentsOf(words.map((body, i) => c(`w${i}`, 'u-mo', T('10:00'), body)), { people });
    assert.equal(out.length, 3);
  });

  test('a comment with no id or no time is left out', () => {
    assert.deepEqual(personCommentsOf([{ authorId: 'u-mo', createdAt: T('10:00'), body: 'x' }], { people }), []);
    assert.deepEqual(personCommentsOf([c('t', 'u-mo', 'not a date')], { people }), []);
  });
});

describe('a person\'s comment reaches its task once, as a finding (ingestPersonComments)', () => {
  let findings;
  let ledger;
  let writes;
  let endedWith;
  const people = [{ accountId: 'mo', name: 'Mo', trackerUserId: 'u-mo' }];

  beforeEach(() => {
    findings = new Map();
    endedWith = [];
    ledger = fakeLedger();
    ledger.recorded.add('c-harbour'); // a Harbour post (the ledger's) under the same author key, in every test here
    writes = {
      async add({ urlKey, kind, input, by, via, fixedId }) {
        assert.equal(kind, 'finding');
        if (!findings.has(fixedId)) findings.set(fixedId, { id: fixedId, kind, by, via, in: input.in, to: input.to, fields: { says: input.says }, at: T('10:05'), urlKey });
        return { record: findings.get(fixedId) };
      },
      async end({ id, input, by }) {
        endedWith.push({ id, state: input.state, reason: input.reason, by });
        return { record: { id }, changed: true };
      }
    };
    configureCommentIngest({
      writes,
      listPeople: async () => people,
      cutoffOf: async () => Date.parse(T('09:00')),
      ledger,
      taskForTicket: async (_u, ticket) => (ticket === 'LIN-1' ? 'task-1' : null),
      taskOfTicket: async () => 'task-1'
    });
  });

  const comments = () => [
    { commentId: 'c-person', authorId: 'u-mo', createdAt: T('10:00'), body: 'Take the narrow path.' },
    { commentId: 'c-harbour', authorId: 'u-mo', createdAt: T('10:01'), body: 'a Harbour post under the same key' }
  ];

  test('the person\'s comment is one finding, by person:<accountId>, via comment, in and to the task, under its fixed id', async () => {
    const out = await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: comments() });
    assert.deepEqual(out, { ingested: 1, failed: 0 });
    const f = findings.get(fixedIdOf('finding', 'comment', 'c-person'));
    assert.ok(f, 'written under fixedIdOf(finding, comment, id)');
    assert.equal(f.by, 'person:mo');
    assert.equal(f.via, 'comment');
    assert.equal(f.in, 'task-1');
    assert.equal(f.to, 'task-1');
    assert.equal(f.fields.says, 'Take the narrow path.');
  });

  test('a second pass over the same comments finds the finding already there: one finding, no second', async () => {
    await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: comments() });
    await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: comments() });
    assert.equal(findings.size, 1);
  });

  test('no task yet: nothing is ingested, and the next read, with the task, takes the comment', async () => {
    const out = await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-404', comments: comments() });
    assert.deepEqual(out, { ingested: 0, failed: 0 });
    assert.equal(findings.size, 0);
  });

  test('unconfigured: no-op', async () => {
    configureCommentIngest(null);
    assert.deepEqual(await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: comments() }), { ingested: 0, failed: 0 });
  });

  test('a person\'s comment Harbour posted is filed under the same fixed id, under the person\'s own account', async () => {
    const out = await recordPersonCommentFinding({ ctx: null, urlKey: URL_KEY, ticket: 'LIN-1', accountId: 'mo', commentId: 'c-reply', body: 'Use the cache.' });
    assert.equal(out.ok, true);
    const f = findings.get(fixedIdOf('finding', 'comment', 'c-reply'));
    assert.equal(f.by, 'person:mo', 'credited to the person, never to the workspace\'s credential');
  });

  // LIN-4548: who wrote a comment Harbour posts is settled at the seam, from `by`.
  const tracker = { provider: { async issueDetail(_t, ref) { return ref === 'iss-uuid-1' ? { identifier: 'LIN-1' } : null; } }, token: 'tok' };
  const personPost = (extra = {}) => postHarbourComment({
    urlKey: URL_KEY, by: 'person:mo', store: ledger, finding: { ctx: tracker, issueRef: 'LIN-1', body: 'Ship the narrow path.' },
    post: async () => ({ success: true, comment: { id: 'c-own-token', body: 'Ship the narrow path.', createdAt: T('10:02') } }), ...extra
  });

  test('LIN-4548: a person\'s post through the seam is ledgered and filed once as their finding; the ingest then takes it no second time', async () => {
    await personPost();
    assert.ok(ledger.recorded.has('c-own-token'), 'ledgered, so the ingest never re-decides its author from the tracker');
    const f = findings.get(fixedIdOf('finding', 'comment', 'c-own-token'));
    assert.ok(f, 'the seam filed the finding');
    assert.deepEqual([f.by, f.via, f.in, f.fields.says], ['person:mo', 'comment', 'task-1', 'Ship the narrow path.']);
    // The tracker names the owner's credential (u-mo here) as its author: the ingest still files nothing new.
    await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: [{ commentId: 'c-own-token', authorId: 'u-mo', createdAt: T('10:02'), body: 'x' }] });
    assert.equal([...findings.keys()].filter((k) => k !== fixedIdOf('finding', 'comment', 'c-harbour')).length, 1, 'one finding');
  });

  test('LIN-4548: an issue ref that is not a ticket is named through the provider\'s issueDetail', async () => {
    await personPost({ finding: { ctx: tracker, issueRef: 'iss-uuid-1', body: 'By uuid.' } });
    assert.equal(findings.get(fixedIdOf('finding', 'comment', 'c-own-token'))?.in, 'task-1');
  });

  test('LIN-4548: a Harbour post files no finding, a refused post files none, and a post that does not say who wrote it throws before posting', async () => {
    await postHarbourComment({ urlKey: URL_KEY, by: HARBOUR, store: ledger, finding: { ctx: tracker, issueRef: 'LIN-1', body: 'x' }, post: async () => ({ success: true, comment: { id: 'c-run' } }) });
    await personPost({ post: async () => ({ success: false }) });
    assert.equal(findings.size, 0);
    let posted = 0;
    for (const by of [undefined, null, 'person:', 'stage:implementation', 'mo']) {
      await assert.rejects(() => postHarbourComment({ urlKey: URL_KEY, by, store: ledger, post: async () => { posted += 1; return { id: 'c-x' }; } }), TypeError);
    }
    assert.equal(posted, 0);
  });

  test('LIN-4548: a finding write that fails never fails the post (the comment is written), and the repair files it again once', async () => {
    const add = writes.add;
    writes.add = async () => { throw new Error('records down'); };
    const answer = await personPost();
    assert.equal(answer.success, true, 'the post answers as the provider gave it');
    assert.equal(findings.size, 0);
    writes.add = add;
    const comment = { id: 'c-own-token', createdAt: T('10:02') };
    const finding = { ctx: tracker, issueRef: 'LIN-1', body: 'Ship the narrow path.' };
    await repairHarbourCommentRecord({ urlKey: URL_KEY, comment, by: 'person:mo', finding, store: ledger });
    await repairHarbourCommentRecord({ urlKey: URL_KEY, comment, by: 'person:mo', finding, store: ledger });
    assert.equal(findings.size, 1, 'filed once, under its fixed id, however many repairs');
    await repairHarbourCommentRecord({ urlKey: URL_KEY, comment: { id: 'c-run-2' }, by: HARBOUR, finding, store: ledger });
    assert.equal(findings.size, 1, 'a Harbour repair files nothing');
  });

  test('the selector reads these findings by their comment: personFindingOfComment matches the fixed id, never the words', async () => {
    await ingestPersonComments({ urlKey: URL_KEY, ticket: 'LIN-1', comments: comments() });
    const list = personFindingsOf([...findings.values()]);
    assert.equal(personFindingOfComment(list, { commentId: 'c-person', body: 'anything' }).accountId, 'mo');
    assert.equal(personFindingOfComment(list, { commentId: 'c-harbour' }), null);
  });
});

describe('the ender: a run ends the person findings its brief carried (endCarriedPersonFindings)', () => {
  let writes;
  let ended;
  beforeEach(() => {
    ended = [];
    writes = {
      async end({ id, input, by }) {
        ended.push({ id, state: input.state, by });
        return { record: { id }, changed: true };
      }
    };
    configureCommentIngest({ writes, listPeople: async () => [], cutoffOf: async () => null, ledger: fakeLedger(), taskForTicket: async () => null, taskOfTicket: async () => null });
  });

  test('a finding the run\'s brief carried is ended done, by harbour; one it did not carry stays open', async () => {
    const findings = [
      { id: 'f-carried', by: 'person:mo', via: 'comment', at: T('09:30') },
      { id: 'f-not-carried', by: 'person:mo', via: 'comment', at: T('09:40') },
      { id: 'f-agent', by: 'stage:implementation', via: null, at: T('09:00') }
    ];
    const out = await endCarriedPersonFindings({ urlKey: URL_KEY, runId: 'run-1', carried: new Set(['f-carried', 'f-agent']), findings });
    assert.deepEqual(out, ['f-carried']);
    assert.deepEqual(ended, [{ id: 'f-carried', state: 'done', by: 'harbour' }]);
  });

  test('nothing carried, or no ingest configured: nothing is ended', async () => {
    const findings = [{ id: 'f', by: 'person:mo', via: 'comment', at: T('09:00') }];
    assert.deepEqual(await endCarriedPersonFindings({ urlKey: URL_KEY, runId: 'r', carried: new Set(), findings }), []);
    assert.deepEqual(await endCarriedPersonFindings({ urlKey: URL_KEY, runId: 'r', carried: null, findings }), []);
    assert.equal(ended.length, 0);
  });
});

// ---- the census -------------------------------------------------------------------------------------------------------------

const SCAN_ROOTS = ['lib', 'routes', 'server.js', 'scripts'];

/** Every .js/.mjs source file under the scanned roots, repo-relative. */
function sourceFiles(dir = ROOT, out = []) {
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const a = join(abs, name);
      const r = relative(ROOT, a);
      if (statSync(a).isDirectory()) walk(a, r);
      else if (/\.(c|m)?js$/.test(name)) out.push(r);
    }
  };
  for (const root of SCAN_ROOTS) {
    const abs = join(dir, root);
    if (root.endsWith('.js')) out.push(root);
    else walk(abs, root);
  }
  return out;
}

const readSrc = (f) => readFileSync(join(ROOT, f), 'utf8');

describe('census: the comment seam and the authorship reader (LIN-4535)', () => {
  test('every provider comment post outside lib/providers goes through postHarbourComment, in the three sites the plan names', () => {
    const sites = sourceFiles().filter((f) => !f.startsWith('lib/providers/') && /\.createComment\(/.test(readSrc(f)));
    assert.deepEqual(sites.sort(), ['lib/records-tracker.js', 'routes/proxy-writes.js', 'routes/workspace-api-issue-write.js'].sort(),
      'a new comment post site must go through the seam (lib/harbour-comment-post.js) and be named here');
    for (const f of sites) {
      assert.match(readSrc(f), /postHarbourComment\(/, `${f} posts through the seam`);
      assert.match(readSrc(f), /from ['"][./]+(lib\/)?harbour-comment-post\.js['"]/, `${f} imports the seam`);
    }
  });

  test('only the comment-ingest and the providers\' comment mappings carry a comment\'s author id, and only the workspace-people reader holds a tracker user id', () => {
    const readers = sourceFiles().filter((f) => /\bauthorId\b/.test(readSrc(f))).sort();
    assert.deepEqual(readers, ['lib/comment-ingest.js', 'lib/providers/github/index.js', 'lib/providers/jira/index.js', 'lib/providers/linear/index.js'], 'authorship is decided in one reader; the providers only map their author id onto the comment');
    const holders = sourceFiles().filter((f) => /trackerUserId/.test(readSrc(f))).sort();
    assert.deepEqual(holders, ['lib/comment-ingest.js', 'lib/workspace-people.js'].sort());
  });

  test('the retired authorship readers are gone from the source and the tests (the ruling mark stays until P7b)', () => {
    const retired = ['isPersonComment', 'isAgentActivity', 'reportsLandedWork', 'opensAsAgentNote', 'holdingComment'];
    const SPELLS_THE_WORDS = new Set(['tests/unit/lin-4535-comments-inward.test.js', 'tests/unit/lin-4529-retirement-census.test.js']);
    const testFiles = readdirSync(join(ROOT, 'tests/unit')).filter((f) => f.endsWith('.js')).map((f) => `tests/unit/${f}`);
    const hits = [];
    for (const f of [...sourceFiles(), ...testFiles]) {
      if (SPELLS_THE_WORDS.has(f)) continue; // the two censuses that name the words they forbid
      const text = readSrc(f);
      for (const word of retired) if (new RegExp(`\\b${word}\\b`).test(text)) hits.push(`${f}: ${word}`);
    }
    assert.deepEqual(hits, []);
  });
});
