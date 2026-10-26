/**
 * LIN-3975 (PR 2): the task page's moments and its summary.
 *
 *   - the moment piece: the relative words, the ISO `datetime`, the UTC fallback in `title`, tap-to-exact (`tap`);
 *   - the client toggle (public/common.js): a tap or Enter flips a `tap` time between its words and its local
 *     exact time, with the zone named, and a re-run never re-binds it;
 *   - the brief panel never repeats the header's `## Current` paragraph;
 *   - the description shows without a fold, cut when long, and the empty brief-and-recap state is one quiet line.
 *
 * Run with: node --test tests/unit/lin-3975-summary-and-time.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { timeHtml } from '../../lib/components/time.js';
import { briefWithoutCurrent, briefCurrentSection, relativeAgo } from '../../lib/task-page-loader.js';
import { renderTaskDocs, renderTaskPage } from '../../lib/render-task-page.js';
import { buildPromptOpts } from '../../lib/render-prompt-opts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 3600_000).toISOString();

// ─── the moment piece ────────────────────────────────────────────────────────

describe('LIN-3975 — a moment reads as relative words, and taps to its exact time', () => {
  test('the relative words, the ISO datetime, the UTC text as the fallback, and the tap mode', () => {
    const html = timeHtml(TWO_HOURS_AGO, { now: NOW, testid: 'x-time' });
    assert.equal(html, '<time class="task-time" data-testid="x-time" datetime="2026-10-26T10:00:00.000Z" data-local-time="tap" title="26 Oct, 10:00 UTC">2 hours ago</time>');
  });

  test('a Date is read as the same moment, and a missing or unparseable time draws nothing', () => {
    assert.match(timeHtml(new Date(TWO_HOURS_AGO), { now: NOW }), />2 hours ago<\/time>$/);
    assert.equal(timeHtml(null, { now: NOW }), '');
    assert.equal(timeHtml('not a date', { now: NOW }), '');
  });

  test('the server never writes the reader\'s local time: that is the tap', () => {
    assert.doesNotMatch(timeHtml(TWO_HOURS_AGO, { now: NOW }), /GMT|BST|UTC\s*<|timeZone/);
  });

  test('the component is used by the renderers the page owns (no bare fmtWhen moments left in the detail and comment rows)', () => {
    const src = read('lib/render-task-page.js');
    assert.match(src, /import \{ timeHtml \} from '\.\/components\/time\.js'/);
    assert.match(src, /kv\('created', timeHtml\(d\.createdAt/);
    assert.match(src, /timeHtml\(c\.createdAt, \{ now, className: 'task-comment-time'/);
  });
});

describe('LIN-3975 — the share list\'s words are the server\'s relativeAgo words', () => {
  test('the client relativeWords equals relativeAgo at every span the page shows', () => {
    const src = read('public/task-page.js');
    const fn = src.slice(src.indexOf('  function relativeWords(value) {'), src.indexOf('  /** A share\'s created time'));
    assert.ok(fn.length > 100, 'relativeWords is found');
    class FixedDate extends Date { static now() { return NOW.getTime(); } }
    const sandbox = { Date: FixedDate };
    vm.createContext(sandbox);
    vm.runInContext(`${fn}\nthis.relativeWords = relativeWords;`, sandbox);
    const spans = [0, 59_000, 60_000, 59 * 60_000, 60 * 60_000, 23 * 3600_000, 24 * 3600_000, 3 * 86_400_000];
    for (const ago of spans) {
      const iso = new Date(NOW.getTime() - ago).toISOString();
      assert.equal(sandbox.relativeWords(iso), relativeAgo(iso, NOW), `${ago} ms`);
    }
  });
});

describe('LIN-3975 — the client toggles a tap time between its words and its exact local time', () => {
  /** The three functions from public/common.js, run in a sandbox. Only the element API they use is faked. */
  function clientTime() {
    const src = read('public/common.js');
    const grab = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
    const code = [
      grab('function formatLocalTime(iso, opts) {', '/**\n * Rewrite'),
      grab('function initLocalTimes(root) {', "if (typeof window !== 'undefined') {\n  window.formatLocalTime"),
    ].join('\n');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`${code}\nthis.initLocalTimes = initLocalTimes; this.toggleExactTime = toggleExactTime;`, sandbox);
    return sandbox;
  }

  /** A `<time>` as the browser sees it: attributes and text, with the calls the functions make. */
  function timeEl(datetime, text) {
    const attrs = { datetime, 'data-local-time': 'tap' };
    const listeners = {};
    return {
      textContent: text,
      getAttribute(name) { return name in attrs ? attrs[name] : null; },
      setAttribute(name, value) { attrs[name] = String(value); },
      hasAttribute(name) { return name in attrs; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      /** A reader's tap, or a key press, on this element. */
      fire(type, event = {}) { for (const fn of listeners[type] || []) fn({ preventDefault() {}, ...event }); },
      attrs,
    };
  }

  test('init keeps the words, stores the exact local time with its zone, and marks the piece as a button', () => {
    const { initLocalTimes } = clientTime();
    const el = timeEl(TWO_HOURS_AGO, '2 hours ago');
    initLocalTimes({ querySelectorAll: () => [el] });
    assert.equal(el.textContent, '2 hours ago', 'the words stay on the page');
    assert.match(el.attrs['data-time-exact'], /\d{2}:\d{2}/, 'the exact local time is kept');
    assert.match(el.attrs['data-time-exact'], /[A-Z]{2,}|GMT|UTC|[+-]\d/, 'the zone is named');
    assert.equal(el.attrs['data-time-relative'], '2 hours ago');
    assert.equal(el.attrs.role, 'button');
    assert.equal(el.attrs.tabindex, '0');
    assert.equal(el.attrs['aria-expanded'], 'false');
  });

  test('a tap flips it to the exact time and back; a second init does not re-bind it', () => {
    const { initLocalTimes } = clientTime();
    const el = timeEl(TWO_HOURS_AGO, '2 hours ago');
    initLocalTimes({ querySelectorAll: () => [el] });
    const exact = el.attrs['data-time-exact'];
    initLocalTimes({ querySelectorAll: () => [el] });
    assert.equal(el.attrs['data-time-exact'], exact, 'the exact text is not recomputed or duplicated');
    el.fire('click');
    assert.equal(el.textContent, exact);
    assert.equal(el.attrs['aria-expanded'], 'true');
    el.fire('click');
    assert.equal(el.textContent, '2 hours ago');
    assert.equal(el.attrs['aria-expanded'], 'false');
  });

  test('Enter and Space flip it; another key does nothing', () => {
    const { initLocalTimes } = clientTime();
    const el = timeEl(TWO_HOURS_AGO, '2 hours ago');
    initLocalTimes({ querySelectorAll: () => [el] });
    el.fire('keydown', { key: 'a' });
    assert.equal(el.textContent, '2 hours ago');
    el.fire('keydown', { key: 'Enter' });
    assert.notEqual(el.textContent, '2 hours ago');
    el.fire('keydown', { key: ' ' });
    assert.equal(el.textContent, '2 hours ago');
  });

  test('a time whose datetime does not parse is left as the server wrote it', () => {
    const { initLocalTimes } = clientTime();
    const el = timeEl('not a date', 'sometime');
    initLocalTimes({ querySelectorAll: () => [el] });
    assert.equal(el.attrs['data-time-exact'], undefined);
    assert.equal(el.textContent, 'sometime');
  });

  test('a tap time binds on its own element, so a repaint that writes one binds it too; no document-level listener', () => {
    const src = read('public/common.js');
    assert.match(src, /el\.addEventListener\('click', function \(\) \{ toggleExactTime\(el\); \}\);/);
    assert.match(src, /el\.addEventListener\('keydown'/);
    const tapBinding = src.slice(src.indexOf('function initLocalTimes(root) {'), src.indexOf('function toggleExactTime(el) {'));
    assert.doesNotMatch(tapBinding, /document\.addEventListener/, 'the LIN-3401 rule: the tap time adds no page-wide listener');
  });

  test('the track repaint re-runs the time binding, and the Read-all control is bound on its own section', () => {
    const src = read('public/task-page.js');
    assert.match(src, /trackMount\.innerHTML = state\.trackHtml;\n\s+\/\/[^\n]*\n\s+if \(typeof window\.initLocalTimes === 'function'\) window\.initLocalTimes\(trackMount\);/);
    assert.match(src, /doc\.querySelector\('\[data-testid="task-page-description"\] > \[data-testid="task-page-description-more"\]'\)/);
  });
});

// ─── the summary ─────────────────────────────────────────────────────────────

describe('LIN-3975 — the brief never repeats the header\'s ## Current paragraph', () => {
  const BRIEF = [
    '## Current',
    'Build is running on the shared run control.',
    '',
    '## Done',
    '- the viewer split',
    '',
    '## Next',
    '- the time piece',
  ].join('\n');

  test('the Current section is removed and the rest is kept', () => {
    const kept = briefWithoutCurrent(BRIEF);
    assert.doesNotMatch(kept, /Build is running/);
    assert.doesNotMatch(kept, /## Current/);
    assert.match(kept, /## Done\n- the viewer split/);
    assert.match(kept, /## Next/);
  });

  test('the header\'s paragraph and the brief\'s rest are the whole brief, with nothing shown twice', () => {
    assert.equal(briefCurrentSection(BRIEF), 'Build is running on the shared run control.');
    const html = renderTaskDocs({ identifier: 'LIN-1', description: null, comments: [] });
    assert.equal(html, '');
  });

  test('a brief that is only its Current section keeps a pointer, not an empty miss', () => {
    assert.equal(briefWithoutCurrent('## Current\nOnly this.'), '_Its current state is at the top of the page._');
  });

  test('a brief without a Current section is unchanged', () => {
    assert.equal(briefWithoutCurrent('## Done\n- x'), '## Done\n- x');
  });

  test('the page shows the header paragraph once, and the brief panel without it', () => {
    const html = renderTaskPage(model({
      summary: 'Build is running on the shared run control.',
      brief: { body: BRIEF, model: null, generatedAt: null },
    }), { viewer: 'owner', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {}, promptOpts: PROMPT_OPTS });
    const count = html.split('Build is running on the shared run control.').length - 1;
    assert.equal(count, 1, 'the paragraph is printed once');
    assert.match(html, /task-summary/, 'the header carries it');
  });
});

describe('LIN-3975 — the description shows without a fold, and the empty brief and recap is one quiet line', () => {
  test('a short description is shown, not cut, and not in a disclosure', () => {
    const html = renderTaskDocs({ identifier: 'LIN-1', description: 'Short.', comments: [] }, NOW);
    assert.match(html, /<section class="task-description" data-testid="task-page-description">/);
    assert.match(html, /<div class="task-md" data-md="description" data-testid="task-page-description-body">Short\.<\/div>/);
    assert.doesNotMatch(html, /task-md--cut|task-page-description-more|<details/);
  });

  test('a long description is cut with a "Read all of it" control', () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const html = renderTaskDocs({ identifier: 'LIN-1', description: long, comments: [] }, NOW);
    assert.match(html, /class="task-md task-md--cut" data-md="description"/);
    assert.match(html, /data-testid="task-page-description-more"[^>]*>Read all of it</);
  });

  test('a long single paragraph is cut too, by its length', () => {
    const html = renderTaskDocs({ identifier: 'LIN-1', description: 'word '.repeat(200), comments: [] }, NOW);
    assert.match(html, /task-md--cut/);
  });

  test('neither brief nor recap: one quiet section with no heading and no column, the same text for every viewer', () => {
    const owner = renderTaskPage(model(), { viewer: 'owner', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {}, promptOpts: PROMPT_OPTS });
    assert.match(owner, /data-testid="task-page-context-quiet"/);
    assert.match(owner, /○ no brief yet/);
    assert.match(owner, /○ no recap yet/);
    assert.doesNotMatch(owner, /Brief and recap/, 'no heading');
    const guest = renderTaskPage(model(), { viewer: 'guest', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {} });
    assert.match(guest, /data-testid="task-page-context-quiet"/);
    assert.match(guest, /○ no brief yet/);
  });

  test('the quiet line takes no grid column on a desktop page', () => {
    assert.match(read('public/task-page.css'), /\.task-context-section--quiet \{ grid-area: auto; \}/);
  });

  test('the Read-all control is wired in the task page client before its first Markdown render', () => {
    const src = read('public/task-page.js');
    const init = src.slice(src.indexOf('  function init(doc) {'), src.indexOf('    function toggle(row) {'));
    const wire = init.indexOf('[data-testid="task-page-description-more"]');
    const markdown = init.search(/enhanceContextMarkdown\(|enhanceMarkdown\(/);
    assert.ok(wire > 0, 'the control is wired in init');
    assert.ok(markdown > wire, 'and that is before the first Markdown render in init');
  });
});

describe('LIN-3975 — the PR\'s state is said once, with Merge beside it', () => {
  const PR_URL = 'https://github.com/acme/widget/pull/12';
  const readyEvidence = () => ({
    closeOut: { owner: true, status: 'ready', variant: 'standard', pr: { number: 12, url: PR_URL, headSha: 'abc' }, stopAt: 'pr', urlKey: 'acme', issueIdentifier: 'LIN-50' },
    state: { pr: { number: 12, url: PR_URL } },
    evidence: { checked: {} },
    ledger: null,
    closeOutSummary: null,
  });

  test('a ready PR: the lead says it once; the owner box keeps the press and drops its own state line', () => {
    const html = renderTaskPage(model({ evidence: readyEvidence() }), { viewer: 'owner', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {}, promptOpts: PROMPT_OPTS });
    assert.equal(html.split('is approved and ready to merge').length - 1, 1, 'the lead sentence');
    assert.doesNotMatch(html, /PR ready for close-out/, 'the box does not repeat it');
    assert.match(html, /data-testid="run-evidence-closeout-press"/, 'Merge is still there for the owner');
  });

  test('a guest sees the same single sentence and no press', () => {
    const html = renderTaskPage(model({ evidence: readyEvidence() }), { viewer: 'guest', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {} });
    assert.equal(html.split('is approved and ready to merge').length - 1, 1);
    assert.doesNotMatch(html, /run-evidence-closeout-press/);
  });

  test('the run page keeps its own close-out line (the default is unchanged)', () => {
    const src = read('lib/render-run-evidence.js');
    assert.match(src, /sayState = true/);
    assert.match(src, /sayState \? '<p class="rev-closeout-ready"/);
  });
});

// ─── fixtures ────────────────────────────────────────────────────────────────

const PROMPT_OPTS = buildPromptOpts({ openRouterSource: 'env', featureFlags: { runControls: true }, isLocalhost: false });

function model(over = {}) {
  return {
    identifier: 'LIN-50',
    title: 'Build the task page',
    issueId: '11111111-2222-3333-4444-555555555555',
    tracker: { state: { name: 'In Progress', type: 'started' }, url: null, parent: null, subtasks: [], blockedBy: [] },
    status: 'idle',
    sentence: 'Nothing has run yet.',
    sentenceAt: null,
    readyHeader: null,
    live: false,
    finished: false,
    question: null,
    sessions: [],
    guesses: ['plan'],
    nextStep: { kind: 'plan', label: 'Plan', why: 'usual', failed: false },
    stages: [],
    summary: null,
    brief: null,
    recap: null,
    contextMiss: null,
    evidence: null,
    description: null,
    comments: [],
    details: null,
    ...over,
  };
}
