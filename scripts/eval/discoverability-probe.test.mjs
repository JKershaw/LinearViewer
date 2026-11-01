// LIN-4086 — pure-function tests for the discoverability probe. No network, no files.
//   node --test scripts/eval/discoverability-probe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenQuestions, expandJobs, buildAnswerRequest, extractCitations, parseJudge,
  tally, rowLabel, sortedEntries, pickNotable, citedDomains, sumCost, renderReport, buildJudgeMessages,
  TIERS, MODES,
} from './discoverability-probe.mjs';

const QFILE = {
  tiers: {
    named: [{ id: 'n1', question: 'What is harbour.cat?' }],
    ambiguous: [{ id: 'a1', question: 'What is Harbour, the AI software development tool?' }],
    category: [{ id: 'c1', question: 'What tools dispatch tasks from my Linear backlog to AI coding agents?' }],
  },
};

const row = (o) => ({
  questionId: 'n1', tier: 'named', question: 'What is harbour.cat?', model: 'a/m1', mode: 'off', repeat: 1,
  answer: 'An answer.', citations: [], urlsInText: [], error: null, judgeError: null,
  label: 'unknown', confusedWith: null, harbourMentioned: false, reason: 'r', answerCost: 0.001, judgeCost: 0.002, ...o,
});

const FIXTURE = [
  row({ label: 'confused', confusedWith: 'cncf-harbor', harbourMentioned: true, answer: 'Harbor is a CNCF registry.', reason: 'registry' }),
  row({ repeat: 2, label: 'unknown' }),
  row({ repeat: 3, error: 'HTTP 500: boom', label: null, answer: null, answerCost: null, judgeCost: null }),
  row({ mode: 'web', label: 'correct', harbourMentioned: true, answer: 'Harbour (harbour.cat) reads your Linear backlog and verifies on CI.', citations: ['https://harbour.cat/', 'https://www.github.com/x'] }),
  row({ mode: 'web', repeat: 2, label: 'hallucinated', harbourMentioned: true, answer: 'harbour.cat is a cat adoption site.' }),
  row({ model: 'b/m2', tier: 'category', questionId: 'c1', label: 'unknown', harbourMentioned: false }),
  row({ model: 'b/m2', tier: 'category', questionId: 'c1', repeat: 2, label: 'confused', confusedWith: 'terminal-bench-harbor', harbourMentioned: true }),
  row({ model: 'b/m2', tier: 'category', questionId: 'c1', repeat: 3, judgeError: 'bad json', label: null }),
];

test('flattenQuestions keeps tier order and rejects duplicates / unknown tiers', () => {
  const qs = flattenQuestions(QFILE);
  assert.deepEqual(qs.map((q) => [q.id, q.tier]), [['n1', 'named'], ['a1', 'ambiguous'], ['c1', 'category']]);
  assert.throws(() => flattenQuestions({ tiers: { named: [{ id: 'x', question: 'q' }, { id: 'x', question: 'q2' }] } }), /duplicate/);
  assert.throws(() => flattenQuestions({ tiers: { bogus: [] } }), /unknown tier/);
});

test('expandJobs is the full cartesian product in stable order', () => {
  const jobs = expandJobs(flattenQuestions(QFILE), ['a/m1', 'b/m2'], MODES, 3);
  assert.equal(jobs.length, 3 * 2 * 2 * 3);
  assert.deepEqual(jobs.slice(0, 4).map((j) => [j.questionId, j.model, j.mode, j.repeat]),
    [['n1', 'a/m1', 'off', 1], ['n1', 'a/m1', 'off', 2], ['n1', 'a/m1', 'off', 3], ['n1', 'a/m1', 'web', 1]]);
});

test('buildAnswerRequest sends only the bare question; web mode adds the web plugin', () => {
  const off = buildAnswerRequest({ model: 'a/m1', mode: 'off', question: 'What is harbour.cat?' });
  assert.deepEqual(off.messages, [{ role: 'user', content: 'What is harbour.cat?' }]);
  assert.equal(off.plugins, undefined);
  const web = buildAnswerRequest({ model: 'a/m1', mode: 'web', question: 'q' });
  assert.deepEqual(web.plugins, [{ id: 'web' }]);
  assert.equal(web.messages.length, 1, 'no system prompt');
});

test('judge prompt carries the rubric as system and never leaks into the answer request', () => {
  const msgs = buildJudgeMessages(row({ tier: 'category' }));
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /goharbor\.io/);
  assert.match(msgs[1].content, /did NOT name Harbour/);
});

test('extractCitations reads url_citation annotations and bare URLs, deduped', () => {
  const c = extractCitations({
    content: 'See https://harbour.cat/docs. And [x](https://goharbor.io/) and https://harbour.cat/docs',
    annotations: [{ type: 'url_citation', url_citation: { url: 'https://harbour.cat/' } }, { type: 'url_citation', url_citation: { url: 'https://harbour.cat/' } }],
  });
  assert.deepEqual(c.citations, ['https://harbour.cat/']);
  assert.deepEqual(c.urlsInText, ['https://harbour.cat/docs', 'https://goharbor.io/']);
});

test('parseJudge validates the label and normalises confused_with', () => {
  assert.deepEqual(parseJudge('```json\n{"label":"confused","confused_with":"weird","harbour_mentioned":true,"reason":" CNCF\\n  registry "}\n```'),
    { label: 'confused', confusedWith: 'other', harbourMentioned: true, reason: 'CNCF registry' });
  assert.equal(parseJudge('{"label":"correct","confused_with":"cncf-harbor","harbour_mentioned":true,"reason":"x"}').confusedWith, null);
  assert.throws(() => parseJudge('{"label":"maybe"}'), /out of vocabulary/);
  assert.throws(() => parseJudge('no json here'), /no JSON/);
});

test('tally counts labels, errors and mentions by tier × mode and model × mode', () => {
  const t = tally(FIXTURE);
  const tm = Object.fromEntries(sortedEntries(t.byTierMode, [TIERS, MODES]).map((e) => [e.key.join('/'), e.counts]));
  assert.deepEqual(tm['named/off'], { correct: 0, confused: 1, unknown: 1, hallucinated: 0, error: 1, n: 3, mentioned: 1 });
  assert.deepEqual(tm['named/web'], { correct: 1, confused: 0, unknown: 0, hallucinated: 1, error: 0, n: 2, mentioned: 2 });
  assert.deepEqual(tm['category/off'], { correct: 0, confused: 1, unknown: 1, hallucinated: 0, error: 1, n: 3, mentioned: 1 });
  const mm = Object.fromEntries([...t.byModelMode.values()].map((e) => [e.key.join('/'), e.counts.n]));
  assert.deepEqual(mm, { 'a/m1/off': 3, 'a/m1/web': 2, 'b/m2/off': 3 });
  const conf = Object.fromEntries([...t.confusions.values()].map((e) => [e.key[0], e.counts.n]));
  assert.deepEqual(conf, { 'cncf-harbor': 1, 'terminal-bench-harbor': 1 });
  assert.equal(rowLabel(FIXTURE[2]), 'error');
  assert.equal(rowLabel(FIXTURE[7]), 'error');
});

test('sumCost, citedDomains and pickNotable are deterministic', () => {
  const c = sumCost(FIXTURE);
  assert.equal(c.answerKnown, 7);
  assert.ok(Math.abs(c.total - (7 * 0.001 + 7 * 0.002)) < 1e-12);
  assert.deepEqual(citedDomains(FIXTURE.filter((r) => r.mode === 'web')), [['github.com', 1], ['harbour.cat', 1]]);
  const picks = pickNotable(FIXTURE).map((p) => [p.label, p.row.model, p.row.mode, p.row.repeat]);
  assert.deepEqual(picks, [
    ['correct', 'a/m1', 'web', 1],
    ['confused', 'a/m1', 'off', 1], ['confused', 'b/m2', 'off', 2],
    ['hallucinated', 'a/m1', 'web', 2],
    ['unknown', 'a/m1', 'off', 2], ['unknown', 'b/m2', 'off', 1],
  ]);
});

test('renderReport renders the headline tables, citations, quotes and errors', () => {
  const md = renderReport({
    date: '2026-11-01', models: ['a/m1', 'b/m2'], modes: MODES, repeats: 3, judgeModel: 'j/judge',
    questions: flattenQuestions(QFILE), rows: FIXTURE, notes: ['`b/m2` / web: skipped'],
  });
  assert.match(md, /^# LIN-4086 — AI discoverability baseline \(2026-11-01\)/);
  assert.match(md, /BEFORE baseline/);
  assert.match(md, /\| named \| off \| 0 \| 1 \| 1 \| 0 \| 1 \| 3 \| 1\/3 \|/);
  assert.match(md, /\| named \| web \| 1 \| 0 \| 0 \| 1 \| 0 \| 2 \| 2\/2 \|/);
  assert.match(md, /\| `a\/m1` \| off \| 0 \| 1 \| 1 \| 0 \| 1 \| 3 \|/);
  assert.match(md, /\| category \| `b\/m2` \| off \| 0 \| 1 \| 1 \| 0 \| 1 \| 3 \| 1 \|/);
  assert.match(md, /- cncf-harbor: 1/);
  assert.match(md, /Web answers citing harbour\.cat: 1\/2/);
  assert.match(md, /\*\*hallucinated\*\* — `a\/m1` \/ web \/ n1 #2: “harbour\.cat is a cat adoption site\.”/);
  assert.match(md, /`a\/m1` \/ off — 1× answer: HTTP 500: boom/);
  assert.match(md, /`b\/m2` \/ off — 1× judge: bad json/);
  assert.match(md, /`b\/m2` \/ web: skipped/);
  assert.match(md, /OpenRouter-reported cost: \$0\.0210/);
  // Table order follows TIERS then MODES, not insertion order.
  assert.ok(md.indexOf('| named | off |') < md.indexOf('| named | web |'));
  assert.ok(md.indexOf('| named | web |') < md.indexOf('| category | off |'));
});
