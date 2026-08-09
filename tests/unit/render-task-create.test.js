/**
 * Unit tests for lib/render-task-create.js (LIN-1973).
 *
 * Run with: node --test tests/unit/render-task-create.test.js
 *
 * Pins the LIN-1504 Option A contract: the page renders EXACTLY
 * `provider.createFields()` — never a fixed form — and:
 *   - `labels` never appears, on any field set
 *   - team/project selects render only REAL provider ids as `<option value>`,
 *     never a synthetic `<option selected>` for an unmatched `?projectId=`
 *   - an empty option list degrades to a text-input fallback, never a crash
 *   - the state control reuses render-task-edit.js's UUID-vs-name value rule
 *     (byte-identical resolution, not a forked copy)
 *   - the shared `priorityOptionsHtml` (lib/render.js) is what renders priority
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderTaskCreatePage } from '../../lib/render-task-create.js';
// Side-effect import: the shared shell's nav resolves a provider for the
// workspace switcher, so the Linear provider must be registered in this context.
import '../../lib/providers/linear/index.js';

const LINEAR_FIELDS = ['title', 'description', 'teamId', 'projectId', 'stateId', 'priority'];
const LOCAL_FIELDS = ['title', 'description', 'projectId', 'stateId', 'priority'];
const GITHUB_FIELDS = ['title', 'description', 'projectId'];

const TEAMS = [{ id: 'team-1', name: 'Engineering', key: 'ENG' }];
const PROJECTS = [{ id: 'proj-1', name: 'Roadmap' }];

const LINEAR_STATES = [
  { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'ffffffff-0000-1111-2222-333333333333', name: 'In Progress', type: 'started', position: 2 },
];

// Local/GitHub-shaped states: ids are short slugs, not UUIDs.
const LOCAL_STATES = [
  { id: 'unstarted', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'started', name: 'In Progress', type: 'started', position: 2 },
];

function render(overrides = {}, options = {}) {
  return renderTaskCreatePage({ urlKey: 'acme', fields: LINEAR_FIELDS, teams: TEAMS, projects: PROJECTS, states: LINEAR_STATES, ...overrides }, options);
}

describe('renderTaskCreatePage — capability-derived field set', () => {
  test('title is always rendered, required, and autofocused', () => {
    const html = render({ fields: ['title'] });
    assert.ok(/<input[^>]*name="title"[^>]*required[^>]*autofocus/.test(html) || /<input[^>]*name="title"[^>]*autofocus[^>]*required/.test(html));
  });

  test('renders ONLY the fields createFields() declared (GitHub: no team/state/priority)', () => {
    const html = render({ fields: GITHUB_FIELDS, teams: [], states: [] });
    assert.ok(html.includes('name="title"'));
    assert.ok(html.includes('name="description"'));
    assert.ok(html.includes('name="projectId"'));
    assert.ok(!html.includes('name="teamId"'));
    assert.ok(!html.includes('name="stateId"'));
    assert.ok(!html.includes('name="priority"'));
  });

  test('a teamless provider (Local) never renders a team control', () => {
    const html = render({ fields: LOCAL_FIELDS, teams: [], states: LOCAL_STATES });
    assert.ok(!html.includes('name="teamId"'));
    assert.ok(html.includes('name="stateId"'));
    assert.ok(html.includes('name="priority"'));
  });

  test('labels never renders on any field set', () => {
    for (const fields of [LINEAR_FIELDS, LOCAL_FIELDS, GITHUB_FIELDS]) {
      const html = render({ fields });
      assert.ok(!html.includes('name="labels"'));
      assert.ok(!/labels/i.test(html), `unexpected "labels" reference for fields=${fields.join(',')}`);
    }
  });
});

describe('team / project selects', () => {
  test('renders a <select> of real provider ids when the list is populated', () => {
    const html = render();
    assert.ok(/<select[^>]*name="teamId"/.test(html));
    assert.ok(html.includes('<option value="team-1">ENG — Engineering</option>'));
    assert.ok(/<select[^>]*name="projectId"/.test(html));
    assert.ok(html.includes('<option value="proj-1">Roadmap</option>'));
  });

  test('degrades to a text-input fallback when the list is empty (never a crash)', () => {
    const html = render({ teams: [], projects: [] });
    assert.ok(/<input[^>]*name="teamId"/.test(html));
    assert.ok(!/<select[^>]*name="teamId"/.test(html));
    assert.ok(/<input[^>]*name="projectId"/.test(html));
    assert.ok(!/<select[^>]*name="projectId"/.test(html));
  });

  test('a matching ?projectId= is marked selected', () => {
    const html = render({ projectId: 'proj-1' });
    assert.ok(html.includes('<option value="proj-1" selected>Roadmap</option>'));
  });

  test('an UNMATCHED projectId is dropped silently — no synthetic selected option', () => {
    const html = render({ projectId: 'does-not-exist' });
    assert.ok(html.includes('<option value="proj-1">Roadmap</option>'), 'the real option stays unselected');
    assert.ok(!html.includes('does-not-exist'), 'the unmatched value never appears in the markup');
  });

  test('a resolved teamId is marked selected on the team select', () => {
    const html = render({ teamId: 'team-1' });
    assert.ok(html.includes('<option value="team-1" selected>ENG — Engineering</option>'));
  });
});

describe('state control (shared resolution with render-task-edit.js)', () => {
  test('a UUID state id renders as the UUID (Linear)', () => {
    const html = render({ states: LINEAR_STATES });
    assert.ok(html.includes(`<option value="${LINEAR_STATES[0].id}">Todo</option>`));
  });

  test('a non-UUID state id renders as the NAME (Local/GitHub), matching the old form byte-for-byte', () => {
    const html = render({ fields: LOCAL_FIELDS, states: LOCAL_STATES });
    assert.ok(html.includes('<option value="Todo">Todo</option>'));
    assert.ok(html.includes('<option value="In Progress">In Progress</option>'));
  });

  test('degrades to a text-input fallback when states is empty', () => {
    const html = render({ states: [] });
    assert.ok(/<input[^>]*name="stateId"/.test(html));
    assert.ok(!/<select[^>]*name="stateId"/.test(html));
  });

  test('no state option ships pre-selected (there is no "current" state for a new task)', () => {
    const html = render({ states: LINEAR_STATES });
    assert.ok(!/<option[^>]*selected/.test(html.match(/<select[^>]*name="stateId"[\s\S]*?<\/select>/)[0]));
  });
});

describe('priority control (shared with render-task-edit.js)', () => {
  test('renders the shared 0–4 priority vocabulary, defaulting to No priority', () => {
    const html = render();
    assert.ok(html.includes('<option value="0" selected>No priority</option>'));
    assert.ok(html.includes('<option value="1">Urgent</option>'));
  });
});

describe('form scaffolding', () => {
  test('the submit button ships disabled (armed by public/task-create.js)', () => {
    const html = render();
    assert.ok(/data-testid="task-create-submit"[^>]*disabled/.test(html));
  });

  test('the form carries the url key for the client script', () => {
    const html = render();
    assert.ok(html.includes('data-url-key="acme"'));
    assert.ok(html.includes('data-testid="task-create-form"'));
  });

  test('loads the dedicated stylesheet and script', () => {
    const html = render();
    assert.ok(html.includes('/task-create.css'));
    assert.ok(html.includes('/task-create.js'));
  });
});
