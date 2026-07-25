/**
 * Dedicated task-edit page renderer (LIN-1565).
 *
 * The edit affordance shipped by LIN-1553 was a hidden, entirely unstyled form
 * buried four interactions deep inside a tree row's collapsed Details panel, with
 * a free-text box for "State". This renders it instead as its own drill-down page
 * — one click from the row, on the shared shell, with a real state `<select>`.
 *
 * A DRILL-DOWN page in the `docs/view-tiers.md` sense (the sibling of
 * `/observation/session/:sessionId`, rendered by `lib/render-session.js`): no
 * feature flag, no `EXPERIMENTAL_VIEWS` entry, no nav or footer link. It is
 * reached only from the task row that owns it.
 *
 * The wire contract is deliberately UNCHANGED from the inline form it replaces:
 * the same four v1 fields under the same `name`s (`title`, `description`,
 * `stateId`, `priority`) POSTed by `public/task-edit.js` to the existing
 * `PATCH /workspace/:urlKey/api/issues/:issueId`. Only the surface moved.
 *
 * Escaping discipline: `renderPage` interpolates `title` RAW (its JSDoc documents
 * the parameter as already-escaped) and `renderPageHeader`'s `titleHtml` is raw
 * too. Both are titled after a user-controlled issue title here, so both escape at
 * the call site — the same sink `8aa32eaf` (LIN-1567) fixed one page over.
 */
import { escapeHtml } from './utils/html.js';
import { priorityOptionsHtml } from './render.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';
import { renderSection } from './components/section.js';
import { renderPageFooter } from './components/footer.js';

const STYLESHEETS = ['/style.css', '/common-actions.css', '/task-edit.css'];
const SCRIPTS = ['/common.js', '/task-edit.js'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The wire value for a state option.
 *
 * This is not provider branching — it is `resolveIssueStateRef`'s own documented
 * resolution order ("UUID escape hatch → symbolic name",
 * `routes/workspace-api.js` / `lib/proxy-ref-resolver.js`) expressed once, at the
 * one place that knows both candidates:
 *
 *   - Linear state ids ARE UUIDs, so the option sends the UUID and short-circuits
 *     the symbolic resolver. That FIXES a live defect in the free-text box this
 *     page replaces: `resolveStateRef` matches on type-alias OR name and then
 *     `uniqueOrThrow`s, so on a team with two `completed`-type states ("Done" and
 *     "Released") typing `Done` resolved to two candidates → 422 Ambiguous.
 *   - Local (`'started'`) and GitHub (`'open'`) ids are not UUIDs, so the option
 *     sends the state NAME — byte-identical to what the shipped inline form sends
 *     today, which is why the PATCH path is provably unchanged for them.
 *
 * @param {{id?: string, name?: string}} state
 * @returns {string}
 */
function stateOptionValue(state) {
  const id = state?.id != null ? String(state.id) : '';
  if (UUID_RE.test(id)) return id;
  return state?.name != null ? String(state.name) : id;
}

/**
 * Board order for the `<select>`. Linear's `STATES_QUERY` selects `position` but
 * `workflowStates` gives no ordering guarantee; Local's `LOCAL_STATES` are already
 * positioned. A provider with no `position` (GitHub) keeps its declared order —
 * `Infinity` is stable under `Array.prototype.sort` for equal keys.
 */
function byBoardPosition(a, b) {
  const pa = Number.isFinite(a?.position) ? a.position : Infinity;
  const pb = Number.isFinite(b?.position) ? b.position : Infinity;
  return pa - pb;
}

/**
 * The state control: a real `<select>` when the provider gave us states, else the
 * free-text input the inline form used.
 *
 * The fallback is load-bearing, not decorative — `states()` is capability-gated
 * AND try/caught in the route, so a provider that cannot answer (github-projects
 * declares no `states`; a Linear team read that throws) degrades to a working
 * text box instead of 500ing the page. Both branches carry the SAME `name` and
 * `data-testid`, so every caller — the client script, the E2E spec, an agent
 * reading `llms.txt` — sees one contract regardless of which rendered.
 */
function renderStateControl(issue, states) {
  const currentName = issue?.state?.name != null ? String(issue.state.name) : '';
  const currentId = issue?.state?.id != null ? String(issue.state.id) : '';

  if (!Array.isArray(states) || states.length === 0) {
    return `<input type="text" class="task-edit-input" id="task-edit-stateId" name="stateId" value="${escapeHtml(currentName)}" data-testid="task-edit-stateId">`;
  }

  const options = [...states].sort(byBoardPosition).map(state => {
    const value = stateOptionValue(state);
    const label = state?.name != null ? String(state.name) : value;
    // Match on id first (exact), then name — the shared issue fragment selects
    // `state { name type }` with no id, so name is the usual hit.
    const selected = (currentId && String(state?.id) === currentId) || (!currentId && label === currentName);
    return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');

  return `<select class="task-edit-input" id="task-edit-stateId" name="stateId" data-testid="task-edit-stateId">${options}</select>`;
}

/**
 * Render the task-edit page.
 *
 * @param {Object} data
 * @param {Object|null} data.issue - The issue being edited; `null` renders the
 *   not-found body (unknown / cross-workspace / deleted id).
 * @param {Array<{id?: string, name?: string, position?: number}>} [data.states] -
 *   Provider workflow states; `[]` degrades the control to a text input.
 * @param {string} data.urlKey - Active workspace url key.
 * @param {string} [data.issueId] - The id as it appeared in the URL, echoed in the
 *   not-found body (the issue itself is unavailable in that branch).
 * @param {Object} [options] - Shared shell options (deployInfo, openRouterSource,
 *   workspaces, featureFlags).
 * @returns {string} Complete HTML document.
 */
export function renderTaskEditPage({ issue, states = [], urlKey, issueId = '' }, options = {}) {
  const {
    deployInfo = {},
    openRouterSource = null,
    workspaces: navWorkspaces = [],
    featureFlags = {}
  } = options;

  const dashboardHref = `/workspace/${encodeURIComponent(urlKey || '')}/`;
  const backLink = `<a class="task-edit-back" href="${escapeHtml(dashboardHref)}" data-testid="task-edit-back">← back to tasks</a>`;

  const navHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'projects', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags });

  // ── Not-found body (unknown / cross-workspace / deleted issue) ──────────────
  // Mirrors `renderSessionPage({ session: null })`: a rendered page on the same
  // shell, never a crash and never a leak of whether the id exists elsewhere.
  if (!issue) {
    const content = `<main class="task-edit-page" data-testid="task-edit-page">
    ${backLink}
    ${renderPageHeader({ titleHtml: 'Task not found', headerClass: 'task-edit-header' })}
    ${renderSection({
      className: 'task-edit-section',
      title: 'Not found',
      body: `<p class="task-edit-muted" data-testid="task-edit-not-found">○ no task <code>${escapeHtml(issueId)}</code> in this workspace.</p>`
    })}
  </main>
  ${footerHtml}`;
    return renderPage({
      title: 'Task not found',
      stylesheets: STYLESHEETS,
      nav: navHtml,
      content
    });
  }

  const issueTitle = issue.title || '';
  const identifier = issue.identifier || '';
  // `data-issue-id` is the FETCHED record's own canonical id, never the URL param
  // — the page is reachable by either a UUID or an identifier, and the PATCH must
  // always receive the canonical value however the reader arrived.
  const issueIdAttr = escapeHtml(issue.id || '');
  const urlKeyAttr = escapeHtml(urlKey || '');
  const escapedTitle = escapeHtml(issueTitle);

  const formBody = `<form class="task-edit-form" data-task-edit data-issue-id="${issueIdAttr}" data-url-key="${urlKeyAttr}" data-testid="task-edit-form">
      <div class="task-edit-field">
        <label class="task-edit-label" for="task-edit-title">Title</label>
        <input type="text" class="task-edit-input" id="task-edit-title" name="title" value="${escapedTitle}" required data-testid="task-edit-title">
      </div>
      <div class="task-edit-field">
        <label class="task-edit-label" for="task-edit-description">Description</label>
        <textarea class="task-edit-input task-edit-textarea" id="task-edit-description" name="description" rows="14" data-testid="task-edit-description">${escapeHtml(issue.description || '')}</textarea>
        <p class="task-edit-hint">Saving replaces the whole description.</p>
      </div>
      <div class="task-edit-row">
        <div class="task-edit-field">
          <label class="task-edit-label" for="task-edit-stateId">State</label>
          ${renderStateControl(issue, states)}
        </div>
        <div class="task-edit-field">
          <label class="task-edit-label" for="task-edit-priority">Priority</label>
          <select class="task-edit-input" id="task-edit-priority" name="priority" data-testid="task-edit-priority">${priorityOptionsHtml(issue.priority)}</select>
        </div>
      </div>
      <div class="task-edit-actions">
        <button type="submit" class="task-edit-submit" data-testid="task-edit-submit">Save changes</button>
        <a class="task-edit-cancel" href="${escapeHtml(dashboardHref)}" data-testid="task-edit-cancel">Cancel</a>
        <span class="task-edit-status" data-task-edit-status aria-live="polite"></span>
      </div>
    </form>`;

  const headingHtml = identifier
    ? `<span class="task-edit-identifier">${escapeHtml(identifier)}</span> ${escapedTitle}`
    : escapedTitle;

  const content = `<main class="task-edit-page" data-url-key="${urlKeyAttr}" data-testid="task-edit-page">
    ${backLink}
    ${renderPageHeader({ titleHtml: headingHtml, headerClass: 'task-edit-header' })}
    ${renderSection({ className: 'task-edit-section', title: 'Edit task', body: formBody })}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `Edit · ${escapedTitle}`,
    stylesheets: STYLESHEETS,
    nav: navHtml,
    content,
    scripts: SCRIPTS
  });
}
