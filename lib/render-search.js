/**
 * The search page (LIN-4562): `/workspace/:urlKey/search?q=`, in the frame.
 *
 * The rail's search field and the phone band's Search link come here from every page. It lists the tasks across the
 * workspace that match, open first and then done, from `searchTasks` (lib/home-rows.js), each linking to its task page.
 * Server-rendered and linkable: no script runs to search.
 */
import { escapeHtml } from './utils/html.js';
import { renderFrame } from './components/frame.js';
import { renderStatusPill } from './components/status-pill.js';
import { taskPageHref } from './task-page-href.js';

/** The pill state a tracker state reads as on a search row. */
function pillStateOf(issue) {
  const type = issue.state?.type;
  if (type === 'completed' || type === 'canceled' || type === 'duplicate') return 'done';
  if (type === 'started') return 'in-progress';
  if (type === 'backlog') return 'backlog';
  return 'todo';
}

function resultRow({ issue, project, done }, urlKey) {
  const href = taskPageHref({ urlKey, identifier: issue.identifier, source: issue.source || null });
  const title = escapeHtml(issue.title || issue.identifier || '');
  const titleHtml = href ? `<a href="${escapeHtml(href)}" class="search-result__title" data-testid="search-result-link">${title}</a>` : `<span class="search-result__title">${title}</span>`;
  const state = issue.state?.name ? escapeHtml(issue.state.name) : (done ? 'Done' : 'Open');
  return `<li class="search-result${done ? ' search-result--done' : ''}" data-testid="search-result" data-identifier="${escapeHtml(issue.identifier || '')}" data-done="${done ? 'true' : 'false'}">
        ${renderStatusPill({ state: pillStateOf(issue), variant: 'bare' })}
        <span class="search-result__id">${escapeHtml(issue.identifier || '')}</span>
        ${titleHtml}
        <span class="search-result__meta">${escapeHtml(project?.name || 'No project')} · ${state}</span>
      </li>`;
}

/** The line under the h1: what was searched and how much was found. */
function summaryOf(q, result) {
  if (!q) return 'Find a task anywhere in this workspace, open or done.';
  const total = result.open + result.done;
  if (total === 0) return `Nothing matches “${q}”.`;
  const parts = [`${result.open} open`, `${result.done} done`];
  const shown = result.remaining > 0 ? `, showing the first ${result.matches.length}` : '';
  return `${total} ${total === 1 ? 'task matches' : 'tasks match'} “${q}”: ${parts.join(', ')}${shown}.`;
}

/**
 * @param {Object} opts
 * @param {string} opts.q - the search text as asked (already length-capped by the route)
 * @param {{matches: Array, open: number, done: number, remaining: number}} opts.result - searchTasks
 * @param {string} opts.urlKey
 * @param {string} [opts.workspaceName]
 * @param {Array} [opts.workspaces]
 * @param {Object} [opts.featureFlags]
 * @param {string|null} [opts.openRouterSource]
 * @param {Object} [opts.deployInfo]
 * @param {string} [opts.notice] - a sentence shown instead of results (the read failed)
 * @returns {string} the complete document
 */
export function renderSearchPage({ q = '', result = { matches: [], open: 0, done: 0, remaining: 0 }, urlKey, workspaceName, workspaces = [], featureFlags = {}, openRouterSource = null, deployInfo = {}, notice = '' } = {}) {
  const form = `<form class="search-page__form" role="search" action="/workspace/${encodeURIComponent(urlKey)}/search" method="get" data-testid="search-page-form">
      <input type="search" name="q" class="search-page__input" aria-label="Search tasks across the workspace" value="${escapeHtml(q)}" maxlength="200" autocomplete="off" data-testid="search-page-input">
      <button type="submit" class="btn--quiet">Search</button>
    </form>`;
  let body = '';
  if (notice) {
    body = `<p class="search-page__notice" data-testid="search-notice">${escapeHtml(notice)}</p>`;
  } else if (result.matches.length > 0) {
    body = `<ol class="search-results" data-testid="search-results">
      ${result.matches.map(m => resultRow(m, urlKey)).join('\n      ')}
    </ol>`;
  }
  return renderFrame({
    place: 'search',
    urlKey,
    workspaceName,
    workspaces,
    featureFlags,
    openRouterSource,
    deployInfo,
    q,
    subtitle: notice ? '' : summaryOf(q, result),
    stylesheets: ['/style.css'],
    scripts: ['/common.js'],
    content: `${form}
    ${body}`,
  });
}
