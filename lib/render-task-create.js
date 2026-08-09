/**
 * Dedicated task-create page renderer (LIN-1973, Session 2 of LIN-1666 /
 * LIN-1504 Option A).
 *
 * Replaces the inline create form (`renderInlineCreateForm`, LIN-1553, removed
 * from `lib/render.js` in this same landing) with its own drill-down page,
 * mirroring `lib/render-task-edit.js` (LIN-1565): no feature flag, no
 * `EXPERIMENTAL_VIEWS` entry, no nav or footer link — reached only from the
 * project's "+ Add task" affordance.
 *
 * LIN-1504 Option A, restated: the page renders EXACTLY `provider.createFields()`
 * — capability-derived, never a fixed six-field form. A field the provider can't
 * round-trip is simply not rendered (refusal over lossy success), so the wire
 * contract can never drift from what routes/task-create.js fetched. `labels`
 * never appears here — no in-tree provider declares it in `createFields()`.
 *
 * Two controls are shared with the task-edit page rather than forked:
 *   - `priorityOptionsHtml` (lib/render.js) — the 0–4 priority vocabulary.
 *   - `stateOptionValue` / `byBoardPosition` (lib/render-task-edit.js) — the
 *     UUID-vs-name wire-value resolution and board ordering for a state
 *     `<select>`. One resolution order, two surfaces.
 *
 * Every other optional field (team, project) degrades from a `<select>` to a
 * free-text input when its option list is empty (fetch failed, or the provider
 * declares the field but returned none) — the same "never 500 over an
 * unavailable option list" discipline task-edit's state control established.
 * A `<select>` only ever renders real, resolvable provider ids as `<option
 * value>` — never a synthetic `<option selected>` for a value that isn't one of
 * them; an unmatched `?projectId=`/`?teamId=` is dropped silently by the route
 * (routes/task-create.js) before it ever reaches this renderer.
 */
import { escapeHtml } from './utils/html.js';
import { priorityOptionsHtml } from './render.js';
import { stateOptionValue, byBoardPosition } from './render-task-edit.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { renderSection } from './components/section.js';
import { renderPageFooter } from './components/footer.js';

const STYLESHEETS = ['/style.css', '/common-actions.css', '/task-create.css'];
const SCRIPTS = ['/common.js', '/task-create.js'];

/**
 * A `<select>` of real provider ids, or `null` when the list is empty — the
 * caller falls back to a free-text input in that case, so the page never 500s
 * over (or silently no-ops on) an unavailable option list.
 *
 * @param {Object} opts
 * @param {string} opts.id
 * @param {string} opts.name
 * @param {string} opts.testid
 * @param {Array<{id: *, name?: string}>} opts.items
 * @param {string} [opts.selectedId] - Only marks an option selected on an EXACT
 *   id match; never a synthetic selection for an unmatched value.
 * @param {(item: Object) => string} [opts.labelFn]
 * @returns {string|null}
 */
function renderIdSelect({ id, name, testid, items, selectedId = '', labelFn = (item) => item?.name }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const options = items.map(item => {
    const value = String(item.id);
    const selected = selectedId && value === selectedId ? ' selected' : '';
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(labelFn(item) || value)}</option>`;
  }).join('');
  return `<select class="task-create-input" id="${id}" name="${name}" data-testid="${testid}">${options}</select>`;
}

function renderTextFallback({ id, name, testid }) {
  return `<input type="text" class="task-create-input" id="${id}" name="${name}" data-testid="${testid}">`;
}

function renderTeamField(teams, teamId) {
  const control = renderIdSelect({
    id: 'task-create-teamId',
    name: 'teamId',
    testid: 'task-create-teamId',
    items: teams,
    selectedId: teamId,
    labelFn: (t) => (t?.key ? `${t.key} — ${t.name}` : t?.name),
  }) || renderTextFallback({ id: 'task-create-teamId', name: 'teamId', testid: 'task-create-teamId' });

  return `<div class="task-create-field">
        <label class="task-create-label" for="task-create-teamId">Team</label>
        ${control}
      </div>`;
}

function renderProjectField(projects, projectId) {
  const control = renderIdSelect({
    id: 'task-create-projectId',
    name: 'projectId',
    testid: 'task-create-projectId',
    items: projects,
    selectedId: projectId,
  }) || renderTextFallback({ id: 'task-create-projectId', name: 'projectId', testid: 'task-create-projectId' });

  return `<div class="task-create-field">
        <label class="task-create-label" for="task-create-projectId">Project</label>
        ${control}
      </div>`;
}

function renderStateField(states) {
  let control;
  if (Array.isArray(states) && states.length > 0) {
    const options = [...states].sort(byBoardPosition).map(state => {
      const value = stateOptionValue(state);
      const label = state?.name != null ? String(state.name) : value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');
    control = `<select class="task-create-input" id="task-create-stateId" name="stateId" data-testid="task-create-stateId">${options}</select>`;
  } else {
    control = renderTextFallback({ id: 'task-create-stateId', name: 'stateId', testid: 'task-create-stateId' });
  }

  return `<div class="task-create-field">
        <label class="task-create-label" for="task-create-stateId">State</label>
        ${control}
      </div>`;
}

function renderPriorityField() {
  return `<div class="task-create-field">
        <label class="task-create-label" for="task-create-priority">Priority</label>
        <select class="task-create-input" id="task-create-priority" name="priority" data-testid="task-create-priority">${priorityOptionsHtml(0)}</select>
      </div>`;
}

/**
 * Render the task-create page.
 *
 * @param {Object} data
 * @param {string} data.urlKey - Active workspace url key.
 * @param {string[]} data.fields - `provider.createFields()` — the ONLY fields
 *   rendered.
 * @param {Array<{id: string, name: string, key?: string}>} [data.teams] - Only
 *   read when `fields` includes `teamId`.
 * @param {Array<{id: string, name: string}>} [data.projects] - Only read when
 *   `fields` includes `projectId`.
 * @param {Array<{id?: string, name?: string, position?: number}>} [data.states] -
 *   Only read when `fields` includes `stateId`.
 * @param {string} [data.teamId] - The RESOLVED (matched-in-`teams`) team id, if
 *   any — echoed as the team select's selection and threaded to
 *   public/task-create.js as the current `?teamId=` for its resubmit.
 * @param {string} [data.projectId] - The raw `?projectId=` query value; only
 *   marks a project selected on an exact match against `projects`.
 * @param {Object} [options] - Shared shell options (deployInfo, openRouterSource,
 *   workspaces, featureFlags, ui).
 * @returns {string} Complete HTML document.
 */
export function renderTaskCreatePage({ urlKey, fields = [], teams = [], projects = [], states = [], teamId = '', projectId = '' }, options = {}) {
  const {
    deployInfo = {},
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {}
  } = options;

  const dashboardHref = `/workspace/${encodeURIComponent(urlKey || '')}/`;
  const backLink = `<a class="task-create-back" href="${escapeHtml(dashboardHref)}" data-testid="task-create-back">← back to tasks</a>`;

  const navHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'projects', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags });

  const urlKeyAttr = escapeHtml(urlKey || '');

  // Save ships DISABLED; public/task-create.js enables it as the last thing it
  // does, so a submit landing in the window before that script runs can't fall
  // back to a native GET (which would silently discard the input) — the same
  // "honestly disabled" idiom task-edit's form uses.
  const fieldsHtml = [
    `<div class="task-create-field">
        <label class="task-create-label" for="task-create-title">Title</label>
        <input type="text" class="task-create-input" id="task-create-title" name="title" required autofocus data-testid="task-create-title">
      </div>`,
    fields.includes('description') ? `<div class="task-create-field">
        <label class="task-create-label" for="task-create-description">Description</label>
        <textarea class="task-create-input task-create-textarea" id="task-create-description" name="description" rows="10" data-testid="task-create-description"></textarea>
      </div>` : '',
    fields.includes('teamId') ? renderTeamField(teams, teamId) : '',
    fields.includes('projectId') ? renderProjectField(projects, projectId) : '',
    fields.includes('stateId') ? renderStateField(states) : '',
    fields.includes('priority') ? renderPriorityField() : '',
  ].filter(Boolean).join('\n      ');

  const formBody = `<form class="task-create-form" data-task-create data-url-key="${urlKeyAttr}" data-testid="task-create-form">
      ${fieldsHtml}
      <div class="task-create-actions">
        <button type="submit" class="task-create-submit" data-testid="task-create-submit" disabled>Create task</button>
        <a class="task-create-cancel" href="${escapeHtml(dashboardHref)}" data-testid="task-create-cancel">Cancel</a>
        <span class="task-create-status" data-task-create-status aria-live="polite"></span>
      </div>
    </form>`;

  const content = `<main class="task-create-page" data-url-key="${urlKeyAttr}" data-testid="task-create-page">
    ${backLink}
    ${renderPageHeader({ titleHtml: 'New task', headerClass: 'task-create-header' })}
    ${renderSection({ className: 'task-create-section', title: 'Create task', body: formBody })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: 'New task',
    stylesheets: STYLESHEETS,
    nav: navHtml,
    content,
    scripts: SCRIPTS
  });
}
