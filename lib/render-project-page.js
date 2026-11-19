/**
 * LIN-4494 (piece 3): the project page (`/workspace/:urlKey/project`): the records addressed to the project, numbered
 * oldest first as its backlog. The number is a view-time ordinal computed by the route, never stored.
 *
 * It is NOT the issues backlog (`/workspace/:urlKey/backlog`, LIN-4119), which stays as it is; the two names are
 * a ruling for later (LIN-4494's out-of-scope list).
 *
 * A finding in the backlog offers two actions to a signed-in person: "Make a task" (the finding is handed on into a
 * new task record addressed to the project) and "Decline" (the finding is ended as declined, with a reason). Neither
 * makes a tracker ticket; that is slice 2.
 */
import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderPageHeader } from './components/page-header.js';
import { renderSection } from './components/section.js';
import { previewOf } from './render-task-records.js';
import { taskPageHref } from './task-page-href.js';

const STYLESHEETS = ['/style.css', '/session.css', '/task-page.css'];

/** A backlog line: the number, the kind, the words, who wrote it, and the actions a signed-in person may take. */
function renderItem(item, { urlKey, canAct }) {
  const base = `/workspace/${encodeURIComponent(urlKey)}/project/records/${encodeURIComponent(item.id)}`;
  const ticket = item.kind === 'task' ? item.fields?.ref : null;
  const taskWords = item.kind === 'task'
    ? (ticket
      ? `<a href="${escapeHtml(taskPageHref({ urlKey, identifier: ticket }))}">${escapeHtml(ticket)}</a>`
      : '<span class="task-record-noticket" data-testid="backlog-no-ticket">no ticket yet</span>')
    : '';
  const actions = canAct && item.kind === 'finding'
    ? `<div class="task-record-actions">
        <form class="task-record-form" method="post" action="${base}/make-task" data-testid="backlog-make-task-form">
          <button type="submit">Make a task</button>
        </form>
        <form class="task-record-form" method="post" action="${base}/decline" data-testid="backlog-decline-form">
          <label>decline because <input name="reason" required maxlength="500"></label>
          <button type="submit">Decline</button>
        </form>
      </div>`
    : '';
  return `<li class="task-record backlog-item" data-testid="backlog-item" data-record-id="${escapeHtml(item.id)}" data-kind="${escapeHtml(item.kind)}" data-number="${item.number}">
      <div class="task-record-head"><span class="backlog-number" data-testid="backlog-number">${item.number}.</span> <span class="task-record-state">${escapeHtml(item.kind)}</span> <span class="task-record-id">${escapeHtml(item.id)}</span> ${taskWords}</div>
      <div class="task-record-preview">${escapeHtml(previewOf(item) || item.id)}</div>
      <div class="task-record-meta">by ${escapeHtml(item.by)} · ${escapeHtml(item.at || '')}${item.in ? ` · in ${escapeHtml(item.in)}` : ''}</div>
      ${actions}
    </li>`;
}

/**
 * @param {object} data
 * @param {string} data.urlKey
 * @param {Array<object>} data.items - the open records to the project, oldest first, each with a `number`
 * @param {boolean} data.canAct - a signed-in person
 * @param {string|null} [data.refused]
 * @param {object} options - {deployInfo, workspaces, featureFlags, openRouterSource}
 */
export function renderProjectPage({ urlKey, items = [], canAct = false, refused = null }, options = {}) {
  const { deployInfo = {}, workspaces: navWorkspaces = [], featureFlags = {}, openRouterSource = null } = options;
  const nav = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'backlog', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags });
  const refusedHtml = refused ? `<p class="task-records-refused" role="alert" data-testid="project-refused">${escapeHtml(refused)}</p>` : '';
  const list = items.length
    ? `<ol class="task-records-list backlog-list" data-testid="project-backlog">${items.map((item) => renderItem(item, { urlKey, canAct })).join('')}</ol>`
    : '<p class="task-records-none" data-testid="project-backlog-none">○ nothing is waiting for the project</p>';
  const body = `${refusedHtml}${list}`;
  const content = `<main class="sess-page project-page" data-testid="project-page" data-url-key="${escapeHtml(urlKey)}">
    <a class="sess-back" href="/workspace/${encodeURIComponent(urlKey)}/">← back to tasks</a>
    ${renderPageHeader({ titleHtml: '<span class="task-title" data-testid="project-title">Project backlog</span>', headerClass: 'sess-header' })}
    ${renderSection({ className: 'sess-section project-backlog', title: 'Backlog', body })}
  </main>
  ${footerHtml}`;
  return renderPage({ title: 'Project backlog', stylesheets: STYLESHEETS, nav, content });
}
