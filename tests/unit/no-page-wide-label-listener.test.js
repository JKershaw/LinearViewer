/**
 * LIN-3385 — guard: no page-wide, label-keyed listener drives an action.
 *
 * Ticket text is formatted onto the task page, the run page and the Flight
 * Companion, and the formatting keeps `data-*`, `id` and `class`. A control
 * that listens on the whole document and picks its target by label
 * (`closest('[data-action=…]')`), or that looks itself up by label after
 * markdown is already on the page, can be driven by look-alike ticket text.
 * Each Harbour control is instead bound to the element Harbour created,
 * captured before any markdown renders.
 *
 * Rule A — over EVERY non-vendored public/*.js: a `document|doc|body`
 *   `click|submit|change` listener whose handler selects by label
 *   (`closest(` / `matches(`) must be allow-listed with a reason.
 * Rule B — in the five scripts the three pages run: every document-level
 *   lookup is classified (captured before markdown, or UI-only); a new one
 *   fails until it is. No production call of `closeOutContext()` with no
 *   arguments (a unit-test seam only).
 * Rule C — ordering: the captures happen before the first markdown render,
 *   and the shared scripts load before it.
 *
 * LIN-3401 owns the dashboard/swipe/prompt-family entries below and deletes
 * them as it wires those controls to themselves.
 *
 * Run with: node --test tests/unit/no-page-wide-label-listener.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PUBLIC_JS = readdirSync(join(ROOT, 'public'))
  .filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'))
  .sort();

// ── Rule A ──────────────────────────────────────────────────────────────────
// `file:first-label-selector` -> reason. Selectors are the first
// `closest(`/`matches(` literal in the handler.
const DELEGATED_ALLOW = {
  // LIN-3401 (dashboard / prompt family): still delegated, wired in the next piece.
  'app.js:.prompt-copy': 'LIN-3401',
  'app.js:.prompt-download': 'LIN-3401',
  'app.js:.prompt-dispatch': 'LIN-3401',
  'app.js:.queue-item-remove': 'LIN-3401',
  'app.js:.settings-section .toggle-btn': 'LIN-3401',
  // UI-only or off the three pages: no request, no setting write.
  'app.js:.desc-toggle': 'UI-only: expands a description',
  'app.js:[data-queue-badge]': 'UI-only: opens the queue panel (dashboard)',
  'app.js:.queue-panel-close': 'UI-only: closes the queue panel (dashboard)',
  'common.js:.dispatch-exec-harness-select, .harness-select': 'UI-only: syncs a model list on change',
  'common.js:.dispatch-defaults-form': 'settings page form; adds an <option> before its own native submit',
  'common.js:.disclosure-toggle': 'UI-only: opens a disclosure',
  'common.js:form[data-confirm]': 'asks confirm() before a native submit; can only cancel one',
  'observation.js:.obs-run-gen': 'UI-only: expands rows (observation page)',
  'ship.js:.swim-box': 'UI-only: opens a popover (ship page)',
  'swim.js:.swim-box': 'UI-only: closes a popover (swim page)',
};

function delegatedSites() {
  const sites = [];
  const re = /\b(document|doc|body)\.addEventListener\(\s*['"](click|submit|change)['"]/g;
  for (const file of PUBLIC_JS) {
    const lines = stripComments(read(`public/${file}`)).split('\n');
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (!re.test(line)) return;
      const window = lines.slice(i, i + 30).join('\n');
      const m = window.match(/\.(?:closest|matches)\(\s*(['"`])((?:(?!\1).)*)\1/);
      sites.push({ file, line: i + 1, selector: m ? m[2] : null });
    });
  }
  return sites;
}

describe('Rule A: no unlisted delegated label listener in public/*.js', () => {
  test('the sweep covers every non-vendored public/*.js', () => {
    assert.ok(PUBLIC_JS.length >= 30, 'found ' + PUBLIC_JS.length);
    assert.ok(PUBLIC_JS.includes('common.js') && PUBLIC_JS.includes('feedback-widget.js'));
    assert.ok(!PUBLIC_JS.some((f) => f.includes('.min.')));
  });

  test('the four listeners this ticket removed are gone', () => {
    const sites = delegatedSites();
    const has = (file, needle) => stripComments(read(`public/${file}`)).includes(needle);
    assert.ok(!has('close-out.js', "doc.addEventListener('click'"), 'close-out.js press is bound on its button');
    assert.ok(!has('session.js', "document.addEventListener('click'"), 'session.js press is bound on its button');
    assert.ok(!has('feedback-widget.js', "document.addEventListener('click'"), 'feedback toggle is bound on itself');
    // ProxyToggle keeps its delegated handler only for LIN-3401's pages, behind disableDelegation.
    const common = stripComments(read('public/common.js'));
    assert.match(common, /delegationDisabled/);
    assert.deepStrictEqual(sites.filter((s) => ['close-out.js', 'session.js', 'feedback-widget.js', 'task-page.js', 'flight-companion.js'].includes(s.file)), []);
  });

  test('every delegated click/submit/change listener that selects by label is allow-listed', () => {
    const unlisted = delegatedSites()
      .filter((s) => s.selector)
      .filter((s) => !(`${s.file}:${s.selector}` in DELEGATED_ALLOW))
      // A listener whose first label is a sub-lookup (e.g. closest('form')) is
      // keyed by its own handler's first selector; report anything unknown.
      .map((s) => `${s.file}:${s.line} -> ${s.selector}`);
    assert.deepStrictEqual(unlisted, [], 'wire the control to its own element, or allow-list it with a reason');
  });

  test('the allow-list has no stale entries', () => {
    const live = new Set(delegatedSites().filter((s) => s.selector).map((s) => `${s.file}:${s.selector}`));
    // ProxyToggle's `.prompt-proxy-toggle` handler is installed via a named
    // `delegatedClick` (disableable), not an inline listener, so it is not here.
    const stale = Object.keys(DELEGATED_ALLOW).filter((k) => !live.has(k));
    assert.deepStrictEqual(stale, []);
  });
});

// ── Rule B ──────────────────────────────────────────────────────────────────
const PAGE_SCRIPTS = ['session.js', 'task-page.js', 'close-out.js', 'flight-companion.js', 'feedback-widget.js'];
// `file:selector` -> classification. 'captured' = taken before the first
// markdown render on its page (Rule C pins the order); 'ui-only' = no action.
const LOOKUP_ALLOW = {
  'close-out.js:[data-testid="run-evidence-closeout"]': 'captured: init, before markdown (task-page init calls it first)',
  'session.js:[data-testid="run-evidence-closeout"]': 'captured: initCloseOut / test seam, before renderRunTranscripts',
  'session.js:[data-testid="session-inline-reply"][data-issue-id]': 'captured: initCloseOut / test seam',
  'session.js:.sess-run': 'ui-only: expands run rows',
  'session.js:[data-testid="session-run-transcript"]': 'renders into Harbour-rendered transcript containers (the markdown sink itself)',
  'session.js:[data-testid="session-inline-reply"]': 'captured: initInlineReplies, before renderRunTranscripts',
  'session.js:[data-testid="session-question-card"]': 'captured: initQuestionCards, before renderRunTranscripts',
  'session.js:.sess-ctx-panel.brief-section': 'captured: initContextWidgets, before renderRunTranscripts',
  'session.js:.sess-ctx-panel.recap-section': 'captured: initContextWidgets, before renderRunTranscripts',
  'session.js:[data-testid="session-run-elapsed"]': 'ui-only: textContent clock',
  'session.js:[data-testid="session-elapsed"]': 'ui-only: textContent clock',
  'session.js:[data-testid="session-waiting-clock"]': 'ui-only: textContent clock',
  'session.js:[data-testid="session-proposals"]': 'captured: initProposals, before renderRunTranscripts',
  'session.js:[data-testid="session-pr-state"]': 'captured: initPrState, before renderRunTranscripts',
  'task-page.js:[data-testid="task-page-share-slot"][data-shares-url]': 'owner share slot, outside every markdown body (server-rendered; initShare runs before enhanceMarkdown)',
  'task-page.js:[data-testid="task-page"][data-state-url]': 'page root, an ancestor of all ticket text',
  'task-page.js:[data-testid="task-page-owner-widgets"]': 'captured: mountWidgets, before enhanceContextMarkdown',
  'task-page.js:[data-testid="task-page-answer"]': 'init, before markdown; repaint target only',
  'task-page.js:[data-testid="task-page-track-mount"]': 'init, before markdown; repaint target only',
  'task-page.js:[data-testid="task-page-context-mount"]': 'init, before markdown; repaint target only',
  'flight-companion.js:.flight-companion-page': 'top-level capture, before any restored markdown',
  'flight-companion.js:flight-companion-prompt': 'top-level capture (copy control)',
  'flight-companion.js:flight-companion-copy': 'top-level capture (copy control)',
  'flight-companion.js:flight-companion-copy-feedback': 'top-level capture (copy control)',
  'flight-companion.js:flight-companion-chat-empty': 'text only (playbook empty state)',
  'flight-companion.js:flight-companion-thread': 'top-level capture',
  'flight-companion.js:flight-companion-checkin': 'top-level capture',
  'flight-companion.js:flight-companion-question': 'top-level capture',
  'flight-companion.js:flight-companion-send': 'top-level capture',
  'flight-companion.js:flight-companion-start': 'top-level capture',
  'flight-companion.js:flight-companion-reorient': 'top-level capture',
  'flight-companion.js:flight-companion-strip-next': 'top-level capture',
  'flight-companion.js:flight-companion-strip-tab-total': 'top-level capture',
  'flight-companion.js:flight-companion-model': 'top-level capture',
  'flight-companion.js:flight-companion-model-search': 'top-level capture',
  'flight-companion.js:flight-companion-model-list': 'top-level capture',
  'flight-companion.js:flight-companion-tools-warning': 'top-level capture',
  'flight-companion.js:flight-companion-model-price': 'top-level capture',
  'feedback-widget.js:feedback-widget-root': 'init runs before any page markdown (deferred script; FC restores late)',
  'feedback-widget.js:footer.page-footer .footer-feedback-toggle': 'footer-scoped, init runs before any page markdown',
  'feedback-widget.js:[data-testid="nav-feedback-trigger"]': 'ui-only: opens the panel',
};

function lookups() {
  const out = [];
  const re = /\b(?:document|doc)\.(?:querySelector|querySelectorAll|getElementById)\(\s*(['"`])((?:(?!\1).)*)\1/g;
  for (const file of PAGE_SCRIPTS) {
    const src = stripComments(read(`public/${file}`));
    let m;
    while ((m = re.exec(src))) out.push(`${file}:${m[2]}`);
  }
  return out;
}

describe('Rule B: document-level lookups on the three pages are classified', () => {
  test('every document lookup in the page scripts is allow-listed with its classification', () => {
    const unknown = [...new Set(lookups())].filter((k) => !(k in LOOKUP_ALLOW));
    assert.deepStrictEqual(unknown, [], 'capture it before markdown renders (and list it), or mark it UI-only');
  });

  test('no production call of closeOutContext() with no arguments (unit-test seam only)', () => {
    const offenders = [];
    for (const file of PUBLIC_JS) {
      const src = stripComments(read(`public/${file}`));
      src.split('\n').forEach((line, i) => {
        if (/\bcloseOutContext\(\s*\)/.test(line) && !/function\s+closeOutContext/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    assert.deepStrictEqual(offenders, []);
  });
});

// ── Rule C ──────────────────────────────────────────────────────────────────
describe('Rule C: Harbour controls are captured before the first markdown render', () => {
  test('session.js: every init other than initRunToggles runs before renderRunTranscripts()', () => {
    const src = stripComments(read('public/session.js'));
    const boot = src.slice(src.indexOf("document.addEventListener('DOMContentLoaded'"));
    const at = (s) => boot.indexOf(s);
    const render = at('renderRunTranscripts();');
    assert.ok(render > 0);
    for (const init of ['initQuestionCards();', 'initInlineReplies();', 'initProposals();', 'initContextWidgets();', 'initPrState();', 'initCloseOut();']) {
      assert.ok(at(init) > 0 && at(init) < render, `${init} must run before renderRunTranscripts()`);
    }
    assert.ok(at('initRunToggles();') > render, 'initRunToggles needs the rendered transcripts');
  });

  test('task-page.js: CloseOut.init and mountWidgets run before enhanceContextMarkdown (the first markdown call in init)', () => {
    const src = stripComments(read('public/task-page.js'));
    const init = src.slice(src.indexOf('function init(doc)'));
    const firstMd = init.indexOf('enhanceContextMarkdown(contextMount)');
    assert.ok(firstMd > 0);
    assert.ok(init.indexOf('CloseOut.init(doc)') > 0 && init.indexOf('CloseOut.init(doc)') < firstMd);
    assert.ok(init.indexOf('mountWidgets(doc, main)') > 0 && init.indexOf('mountWidgets(doc, main)') < firstMd);
    assert.ok(init.indexOf('enhanceMarkdown(doc)') > firstMd);
  });

  test('flight-companion.js: no markdown render at script top level; the copy control is captured above it', () => {
    const src = stripComments(read('public/flight-companion.js'));
    // Restored-thread rendering lives only inside startSession().
    const start = src.indexOf('function startSession()');
    const end = src.indexOf("if (document.readyState === 'loading')");
    assert.ok(start > 0 && end > start);
    const restore = src.indexOf('window.ChatUI.renderMarkdownText(restoredBody');
    assert.ok(restore > start && restore < end, 'the restore render sits inside startSession()');
    const topLevelRestoreCalls = (src.slice(0, start) + src.slice(end)).match(/renderMarkdownText\(restoredBody|restored: true/g);
    assert.strictEqual(topLevelRestoreCalls, null);
    assert.ok(src.indexOf("copyBtn.addEventListener('click', copyPrompt)") < start, 'the copy control is bound at top level, before the restore');
    assert.ok(src.indexOf("window.addEventListener('beforeunload'") > restore, 'restore, then beforeunload');
    assert.ok(src.indexOf('scheduleAutoWake(initialDelayMs') > src.indexOf("window.addEventListener('beforeunload'"), 'then scheduleAutoWake');
  });

  test('page script order: common.js precedes the page script; the footer widget is deferred', () => {
    for (const [file, page] of [['lib/render-task-page.js', '/task-page.js'], ['lib/render-session.js', '/session.js'], ['lib/render-flight-companion.js', '/flight-companion.js']]) {
      const m = read(file).match(/\[('\/[^\]]*\.js')[^\]]*\]/g) || [];
      const list = m.find((l) => l.includes(`'${page}'`));
      assert.ok(list, `${file} lists ${page}`);
      assert.ok(list.indexOf("'/common.js'") >= 0 && list.indexOf("'/common.js'") < list.indexOf(`'${page}'`), `${file}: /common.js before ${page}`);
    }
    assert.match(read('lib/components/footer.js'), /<script src="\/feedback-widget\.js" defer><\/script>/);
  });
});
