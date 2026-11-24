/**
 * LIN-3975 (PR 2): the task page's moments and its summary.
 *
 *   - the moment piece: the relative words, the ISO `datetime`, the UTC fallback in `title`, tap-to-exact (`tap`);
 *   - the client toggle (public/common.js): a tap or Enter flips a `tap` time between its words and its local
 *     exact time, with the zone named, and a re-run never re-binds it;
 *   - the description shows without a fold, cut when long.
 * LIN-4537 retired the brief and recap, so the header's `## Current` paragraph, the panel that dropped it and the quiet
 * brief-and-recap line went with them; one test below pins that none is drawn and the grid keeps no column for them.
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
import { relativeAgo } from '../../lib/time-words.js';
import { renderTaskDocs, renderTaskPage } from '../../lib/render-task-page.js';
import { buildPromptOpts } from '../../lib/render-prompt-opts.js';
import { readSheets, declOf } from '../helpers/css-rules.js';
import { createFakeDom } from './helpers/fake-dom.js';
import { shareTime } from '../../public/task-page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8');
// The task page's sheets, in its order (LIN-4015: the grid is asked of the helper, not matched as text).
const TASK_PAGE = readSheets(['/style.css', '/stage-track.css', '/run-control.css', '/task-page.css']);
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

describe('LIN-3975 — the share list is wired to relativeAgo (wiring check; the words themselves are pinned in lin-4472-time-words.test.js)', () => {
  test('the share list paints relativeAgo\'s words at every span the page shows', () => {
    const { document } = createFakeDom();
    const spans = [0, 59_000, 60_000, 59 * 60_000, 60 * 60_000, 23 * 3600_000, 24 * 3600_000, 3 * 86_400_000];
    for (const ago of spans) {
      const iso = new Date(NOW.getTime() - ago).toISOString();
      assert.equal(shareTime(document, iso, NOW).textContent, relativeAgo(iso, NOW), `${ago} ms`);
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

describe('LIN-3975 — the description shows without a fold', () => {
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

  test('LIN-4537: no brief, recap, summary or write offer is drawn for any viewer, and the grid keeps no column for them', () => {
    for (const viewer of ['owner', 'member', 'guest']) {
      const html = renderTaskPage(model(), { viewer, urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {}, promptOpts: viewer === 'owner' ? PROMPT_OPTS : null });
      assert.doesNotMatch(html, /task-page-context|task-page-summary|task-page-write-(brief|recap)|Brief and recap|no brief or recap yet/, `${viewer}: none drawn`);
      assert.doesNotMatch(html, /\/(brief|recap)\.js/, `${viewer}: no widget script loaded`);
    }
    const wide = { media: '(min-width: 1024px)' };
    const areas = declOf(TASK_PAGE, '.sess-page.task-page', 'grid-template-areas', wide);
    assert.doesNotMatch(areas, /\bcontext\b|\bquiet\b/, 'no brief/recap column and no quiet row');
    assert.doesNotMatch(read('public/task-page.css'), /task-context|quiet-context|task-summary/, 'no rule names the retired sections');
  });

  test('the Read-all control is wired in the task page client before its first Markdown render', () => {
    const src = read('public/task-page.js');
    const init = src.slice(src.indexOf('function init(doc) {'), src.indexOf('function toggle(row) {'));
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

describe('LIN-3975 — the PR prose names its times as taps, never as UTC text (finding 3)', () => {
  // A finished task whose review and close-out summary both carry a time: the sentences that name them.
  const finished = () => model({
    finished: true,
    tracker: { state: { name: 'Done', type: 'completed' }, url: null, parent: null, subtasks: [], blockedBy: [] },
    evidence: {
      closeOut: { owner: false, status: 'merged', mergedBy: 'close-out', variant: 'standard', pr: { number: 12, url: 'https://github.com/acme/widget/pull/12' } },
      state: { pr: { number: 12, url: 'https://github.com/acme/widget/pull/12' } },
      evidence: { checked: { review: { verdict: 'approve', at: '2026-10-24T09:00:00.000Z' } } },
      ledger: null,
      closeOutSummary: { at: '2026-10-25T10:00:00.000Z', text: 'Merged and checked.' },
    },
  });
  const visible = (fragment) => fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  test('the review and the merge sentence carry their time as the tap piece, in relative words', () => {
    const html = renderTaskPage(finished(), { viewer: 'owner', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {}, promptOpts: PROMPT_OPTS });
    const says = html.slice(html.indexOf('data-testid="task-page-pr-summary"'), html.indexOf('task-pr-raw'));
    const lead = says.match(/task-page-pr-lead">([\s\S]*?)<\/p>/)[1];
    const detail = says.match(/task-page-pr-detail">([\s\S]*?)<\/p>/)[1];
    assert.match(lead, /as reported in the close-out <time class="task-time"[^>]*data-local-time="tap"[^>]*>1 day ago<\/time>/);
    assert.match(detail, /Review approved it, <time class="task-time"[^>]*data-local-time="tap"[^>]*>2 days ago<\/time>/);
    assert.doesNotMatch(visible(lead + detail), /\bUTC\b/, 'no exact UTC time in the sentence a reader sees');
  });

  test('the close-out quote\'s label names its time as a tap piece too', () => {
    const html = renderTaskPage(finished(), { viewer: 'owner', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {}, promptOpts: PROMPT_OPTS });
    const label = html.match(/rev-closeout-summary-label">([\s\S]*?)<\/p>/)[1];
    assert.match(label, /Close-out summary, <time class="task-time"[^>]*data-local-time="tap"[^>]*>1 day ago<\/time>/);
    assert.doesNotMatch(visible(label), /\bUTC\b/);
  });

  test('the guest reads the same sentences, and the page\'s sentences keep the escaped copy', () => {
    const html = renderTaskPage(finished(), { viewer: 'guest', urlKey: 'acme', binding: { source: 'linear' }, now: NOW, pageOptions: {} });
    assert.match(html, /Review approved it, <time class="task-time"/);
    assert.match(html, /The pull request was merged by Harbour&#039;s close-out, after the owner pressed merge|was merged by Harbour&#039;s close-out/, 'the apostrophe is escaped as before');
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
    evidence: null,
    description: null,
    comments: [],
    details: null,
    ...over,
  };
}
