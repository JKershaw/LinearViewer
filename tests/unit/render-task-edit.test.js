/**
 * Unit tests for lib/render-task-edit.js (LIN-1565).
 *
 * Run with: node --test tests/unit/render-task-edit.test.js
 *
 * Pins the contract the dedicated task-edit page owns:
 *   - the four v1 fields, under the `name`s the unchanged PATCH route reads
 *   - the state control's TWO branches: a real <select> when the provider
 *     supplied states, the free-text input when it could not
 *   - the option `value` rule (UUID state id → the UUID, otherwise the name),
 *     which is what keeps the wire value identical to the form this replaces
 *     while short-circuiting Linear's ambiguous-symbolic-state 422
 *   - escaping of the user-controlled issue title in BOTH raw sinks
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderTaskEditPage } from '../../lib/render-task-edit.js';
// Side-effect import: the shared shell's nav resolves a provider for the
// workspace switcher, so the Linear provider must be registered in this context.
import '../../lib/providers/linear/index.js';

const ISSUE = {
  id: '11111111-2222-3333-4444-555555555555',
  identifier: 'LIN-42',
  title: 'Fix the thing',
  description: 'Some body text',
  state: { name: 'In Progress', type: 'started' },
  priority: 2,
};

const LINEAR_STATES = [
  { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'ffffffff-0000-1111-2222-333333333333', name: 'In Progress', type: 'started', position: 2 },
];

// Local/GitHub-shaped states: ids are short slugs, not UUIDs.
const LOCAL_STATES = [
  { id: 'unstarted', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'started', name: 'In Progress', type: 'started', position: 2 },
  { id: 'completed', name: 'Done', type: 'completed', position: 3 },
];

function render(overrides = {}, options = {}) {
  return renderTaskEditPage({ issue: ISSUE, states: [], urlKey: 'acme', ...overrides }, options);
}

/** The document `<head>` only — a whole-document assertion would pass for the wrong reason. */
function head(html) {
  return html.slice(0, html.indexOf('</head>'));
}

describe('renderTaskEditPage — the four v1 fields', () => {
  test('renders title, description, state and priority under the PATCH route names', () => {
    const html = render();
    for (const name of ['title', 'description', 'stateId', 'priority']) {
      assert.ok(html.includes(`name="${name}"`), `expected a control named ${name}`);
    }
  });

  test('prefills the form from the issue', () => {
    const html = render();
    assert.ok(html.includes('value="Fix the thing"'));
    assert.ok(html.includes('>Some body text</textarea>'));
    assert.ok(html.includes('<option value="2" selected>High</option>'));
  });

  test('description carries a Write/Preview toggle and an initially-hidden preview pane (LIN-1575)', () => {
    const html = render();
    assert.ok(html.includes('data-testid="task-edit-tab-write"'));
    assert.ok(html.includes('data-testid="task-edit-tab-preview"'));
    // Write is the tab active on arrival — the textarea, not the preview, is
    // what the server renders visible.
    const writeTab = html.match(/<button[^>]*data-testid="task-edit-tab-write"[^>]*>/)[0];
    assert.ok(/aria-selected="true"/.test(writeTab));
    // The preview pane ships `hidden` — the plain textarea is always what's
    // live at first paint, never a fresh-page flash of an empty preview.
    assert.ok(/<div class="task-edit-preview comment-body" data-task-edit-preview data-testid="task-edit-preview" hidden><\/div>/.test(html));
  });

  test('renders NO field beyond the v1 four (the PATCH route reads no others)', () => {
    const html = render();
    for (const name of ['assigneeId', 'labelIds', 'estimate', 'cycleId', 'projectId', 'teamId']) {
      assert.ok(!html.includes(`name="${name}"`), `${name} is out of scope for this page`);
    }
  });

  test('the form carries the FETCHED record id, not the URL param', () => {
    // The page is reachable by identifier too; the PATCH must always get the
    // canonical id.
    const html = render({ issueId: 'LIN-42' });
    assert.ok(html.includes(`data-issue-id="${ISSUE.id}"`));
  });

  test('Save renders DISABLED so the form cannot natively submit before JS arms it', () => {
    // Saving is entirely JS-driven (there is no server-side form POST), so a
    // native submit in the window before the end-of-body script runs would GET
    // `…/edit?title=…&stateId=…` and silently discard the edit. public/task-edit.js
    // enables the button as the last thing it does, so enabled ⇔ handler attached.
    const html = render();
    assert.ok(/<button type="submit"[^>]*data-testid="task-edit-submit"[^>]*disabled>/.test(html),
      'submit button ships disabled');
  });

  test('the title field is focused on arrival, and it is the ONLY autofocus', () => {
    // The ticket's own metric is "interactions before you can type": without
    // this the page arrives with focus on <body>, which is no better than the
    // inline form it replaced (that one focused its first control from JS).
    // Server-rendered, so it holds during the pre-arm window above too.
    const html = render();
    assert.ok(/<input[^>]*data-testid="task-edit-title"[^>]*>/.test(html));
    const titleInput = html.match(/<input[^>]*data-testid="task-edit-title"[^>]*>/)[0];
    assert.ok(/\sautofocus[\s>]/.test(titleInput), 'the title input carries autofocus');
    // A second autofocus would make which field wins browser-dependent.
    assert.strictEqual((html.match(/\sautofocus[\s>]/g) || []).length, 1);
  });

  test('links back to the dashboard from both the breadcrumb and Cancel', () => {
    const html = render();
    assert.ok(html.includes('href="/workspace/acme/" data-testid="task-edit-back"'));
    assert.ok(html.includes('href="/workspace/acme/" data-testid="task-edit-cancel"'));
  });
});

describe('renderTaskEditPage — the state control', () => {
  test('renders a <select> when states are supplied', () => {
    const html = render({ states: LOCAL_STATES });
    assert.ok(/<select[^>]*name="stateId"[^>]*data-testid="task-edit-stateId"/.test(html));
    assert.ok(html.includes('>Done</option>'));
  });

  test('falls back to the text input when states are empty', () => {
    const html = render({ states: [] });
    assert.ok(!/<select[^>]*name="stateId"/.test(html), 'no select without states');
    // Same name AND same testid as the select branch — one contract either way.
    assert.ok(/<input[^>]*name="stateId"[^>]*data-testid="task-edit-stateId"/.test(html));
    // Prefilled with the current state NAME, exactly as the inline form was.
    assert.ok(html.includes('value="In Progress"'));
  });

  test('option value is the state id when it is a UUID (Linear)', () => {
    const html = render({ states: LINEAR_STATES });
    assert.ok(html.includes('<option value="ffffffff-0000-1111-2222-333333333333" selected>In Progress</option>'));
    assert.ok(html.includes('<option value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">Todo</option>'));
  });

  test('option value is the state NAME when the id is not a UUID (Local/GitHub)', () => {
    const html = render({ states: LOCAL_STATES });
    assert.ok(html.includes('<option value="In Progress" selected>In Progress</option>'));
    assert.ok(html.includes('<option value="Done">Done</option>'));
  });

  test('marks the issue\'s current state selected — and only that one', () => {
    const html = render({ states: LOCAL_STATES });
    assert.strictEqual((html.match(/<option[^>]* selected>/g) || []).length, 2,
      'exactly one selected state option, plus one selected priority option');
    assert.ok(html.includes('<option value="In Progress" selected>'));
  });

  test('orders options by board position, not by the provider\'s array order', () => {
    const shuffled = [LOCAL_STATES[2], LOCAL_STATES[0], LOCAL_STATES[1]];
    const html = render({ states: shuffled });
    const optionOrder = [...html.matchAll(/<option value="[^"]*"[^>]*>([^<]+)<\/option>/g)]
      .map(m => m[1])
      .slice(0, 3);
    assert.deepStrictEqual(optionOrder, ['Todo', 'In Progress', 'Done']);
  });

  test('a state with no id degrades to its name rather than emitting an empty value', () => {
    const html = render({ states: [{ name: 'Triage', position: 0 }] });
    assert.ok(html.includes('<option value="Triage">Triage</option>'));
  });
});

describe('renderTaskEditPage — escaping the user-controlled title', () => {
  const HOSTILE = '</title><script>alert(1)</script>';
  const hostileIssue = { ...ISSUE, title: HOSTILE };

  test('escapes the title in the document HEAD specifically', () => {
    const h = head(render({ issue: hostileIssue }));
    // The head legitimately carries the shell's theme-prepaint <script>, so assert
    // on the <title> ELEMENT's own content, not on the head as a whole.
    const titleEl = h.match(/<title>([\s\S]*?)<\/title>/);
    assert.ok(titleEl, 'a <title> element is present');
    assert.ok(!titleEl[1].includes('<script>'), 'raw script tag reached the <title>');
    assert.ok(titleEl[1].includes('&lt;script&gt;'));
    // The injected `</title>` must not have closed the element early.
    assert.strictEqual((h.match(/<title>/g) || []).length, 1);
    assert.strictEqual((h.match(/<\/title>/g) || []).length, 1);
  });

  test('escapes the title in the page heading', () => {
    const html = render({ issue: hostileIssue });
    const body = html.slice(html.indexOf('</head>'));
    assert.ok(!body.includes('<script>alert(1)</script>'));
    assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  test('escapes the title in the prefilled input value (attribute break-out)', () => {
    const html = render({ issue: { ...ISSUE, title: '" onfocus="alert(1)' } });
    assert.ok(!html.includes('onfocus="alert(1)"'));
    assert.ok(html.includes('value="&quot; onfocus=&quot;alert(1)"'));
  });

  test('escapes the description in the textarea', () => {
    const html = render({ issue: { ...ISSUE, description: '</textarea><script>alert(1)</script>' } });
    assert.ok(!html.includes('</textarea><script>'));
    assert.ok(html.includes('&lt;/textarea&gt;'));
  });

  test('escapes a hostile state name in both control branches', () => {
    const hostile = { ...ISSUE, state: { name: '"><script>alert(1)</script>', type: 'started' } };
    const fallback = render({ issue: hostile, states: [] });
    assert.ok(!fallback.includes('<script>alert(1)</script>'));

    const withSelect = render({ issue: ISSUE, states: [{ id: 'x', name: '"><script>alert(1)</script>' }] });
    assert.ok(!withSelect.includes('<script>alert(1)</script>'));
  });
});

describe('renderTaskEditPage — not-found body', () => {
  test('renders a page (not a crash) when the issue is null', () => {
    const html = renderTaskEditPage({ issue: null, urlKey: 'acme', issueId: 'LIN-999' }, {});
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('data-testid="task-edit-not-found"'));
    assert.ok(html.includes('<title>Task not found</title>'));
    assert.ok(html.includes('<code>LIN-999</code>'));
  });

  test('renders no form and loads no page script on the not-found body', () => {
    const html = renderTaskEditPage({ issue: null, urlKey: 'acme', issueId: 'nope' }, {});
    assert.ok(!html.includes('data-testid="task-edit-form"'));
    assert.ok(!html.includes('/task-edit.js'));
  });

  test('escapes the echoed id', () => {
    const html = renderTaskEditPage({ issue: null, urlKey: 'acme', issueId: '<script>alert(1)</script>' }, {});
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

describe('renderTaskEditPage — shell wiring', () => {
  test('loads its own stylesheet and page script', () => {
    const html = render();
    assert.ok(html.includes('href="/task-edit.css"'));
    assert.ok(html.includes('src="/task-edit.js"'));
    // common.js must come first — task-edit.js depends on window.api.
    assert.ok(html.indexOf('src="/common.js"') < html.indexOf('src="/task-edit.js"'));
  });

  test('loads the vendored marked + purify pair before task-edit.js (LIN-1575, no new dependency)', () => {
    const html = render();
    assert.ok(html.includes('src="/marked.min.js"'));
    assert.ok(html.includes('src="/purify.min.js"'));
    assert.ok(html.indexOf('src="/marked.min.js"') < html.indexOf('src="/task-edit.js"'));
    assert.ok(html.indexOf('src="/purify.min.js"') < html.indexOf('src="/task-edit.js"'));
  });

  test('renders the identifier as a machine fact beside the title', () => {
    const html = render();
    assert.ok(html.includes('<span class="task-edit-identifier">LIN-42</span>'));
  });

  test('omits the identifier span when the provider supplies none', () => {
    const html = render({ issue: { ...ISSUE, identifier: undefined } });
    assert.ok(!html.includes('task-edit-identifier'));
    assert.ok(html.includes('Fix the thing'));
  });
});
