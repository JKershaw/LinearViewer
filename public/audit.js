/**
 * Operator Dashboard Frontend
 *
 * Handles the audit button click, fetches audit data, and renders the report.
 */

// =============================================================================
// DOM Elements
// =============================================================================
const runAuditBtn = document.getElementById('run-audit');
const auditStatus = document.getElementById('audit-status');
const auditReport = document.getElementById('audit-report');
const auditError = document.getElementById('audit-error');

// =============================================================================
// Event Handlers
// =============================================================================
runAuditBtn.addEventListener('click', runAudit);

// Collapsible domains use native <details> (renderDisclosure primitive), so the
// browser owns the open/close toggle — no delegated click handler needed.

// =============================================================================
// Audit Functions
// =============================================================================

/**
 * Runs the audit and displays results.
 */
async function runAudit() {
  // Update UI state
  runAuditBtn.disabled = true;
  auditStatus.textContent = 'Running audit...';
  auditStatus.className = 'audit-status loading';
  auditReport.classList.add('hidden');
  auditError.classList.add('hidden');

  try {
    // Get the API URL from the page's data attribute (workspace-prefixed)
    const auditUrl = document.body.dataset.apiAuditUrl || '/api/audit';
    // on401:'/' preserves audit's custom redirect target (not /logout).
    const report = await window.api(auditUrl, { on401: '/' });
    renderReport(report);
    auditStatus.textContent = 'Audit complete';
    auditStatus.className = 'audit-status';
  } catch (error) {
    console.error('Audit error:', error);
    auditError.textContent = `Error: ${error.message}`;
    auditError.classList.remove('hidden');
    auditStatus.textContent = 'Audit failed';
    auditStatus.className = 'audit-status error';
  } finally {
    runAuditBtn.disabled = false;
  }
}

// =============================================================================
// Theme primitives (client-side mirrors of lib/components/*.js)
// =============================================================================
// The shipped primitives (renderCard/renderField/renderStatusPill/renderTag/
// renderDisclosure) are server-only ES modules and can't be imported into the
// browser. These helpers emit the SAME canonical markup + classes, so the
// client-rendered report inherits the shared theme from public/style.css instead
// of bespoke audit.css rules — the technique observation.js uses for the
// run-status pill (LIN-786). Keep in sync with lib/components/*; /styleguide is
// the visual-regression baseline for every primitive.

const esc = (v) => escapeHtml(String(v ?? ''));

// Default state glyphs — mirrors STATE_GLYPHS in lib/components/status-pill.js.
const STATE_GLYPHS = {
  done: '✓',
  'in-progress': '◐',
  todo: '○',
  backlog: '○',
  failed: '✕',
};

/** Canonical .status-pill (mirrors renderStatusPill). */
function statusPill({ state, label, char } = {}) {
  const glyph = char != null && char !== '' ? char : (state ? STATE_GLYPHS[state] : '');
  const classes = ['status-pill'];
  if (state) classes.push(`status-pill--${state}`);
  const charHtml = glyph ? `<span class="status-pill__char">${esc(glyph)}</span>` : '';
  const labelHtml = (label != null && label !== '')
    ? `<span class="status-pill__label">${esc(label)}</span>` : '';
  return `<span class="${classes.join(' ')}">${charHtml}${labelHtml}</span>`;
}

/** Canonical .tag with optional mono count (mirrors renderTag). */
function tag({ label, count, tone } = {}) {
  const classes = ['tag'];
  if (tone) classes.push(`tag--${tone}`);
  const countHtml = (count != null && count !== '')
    ? `<span class="tag__count">${esc(count)}</span>` : '';
  return `<span class="${classes.join(' ')}"><span class="tag__name">${esc(label)}</span>${countHtml}</span>`;
}

/** Canonical .card (mirrors renderCard). Slots (title/meta/body) are raw HTML. */
function card({ accent, title, meta, body, className } = {}) {
  const classes = ['card'];
  if (accent) classes.push('card-accent', `card-accent--${accent}`);
  if (className) classes.push(className);
  let header = '';
  if (title || meta) {
    const parts = [
      title ? `<span class="card-title">${title}</span>` : '',
      meta ? `<span class="card-meta">${meta}</span>` : '',
    ].join('');
    header = `<div class="card-header">${parts}</div>`;
  }
  return `<div class="${classes.join(' ')}">${header}${body || ''}</div>`;
}

/** Canonical .field dim-label + value row (mirrors renderField). */
function field({ label, value, valueHtml, valueClass, className } = {}) {
  const classes = ['field'];
  if (className) classes.push(className);
  const hasHtml = valueHtml != null && valueHtml !== '';
  const hasText = value != null && value !== '';
  let valuePart = '';
  if (hasHtml || hasText) {
    const valueClasses = ['field-value'];
    if (valueClass) valueClasses.push(valueClass);
    const inner = hasHtml ? valueHtml : esc(value);
    valuePart = `<span class="${valueClasses.join(' ')}">${inner}</span>`;
  }
  return `<div class="${classes.join(' ')}"><span class="field-label">${esc(label)}</span>${valuePart}</div>`;
}

/**
 * Canonical .disclosure collapsible domain (mirrors renderDisclosure — native
 * <details>/<summary>, so keyboard + open/close toggle come for free). Rides the
 * `.report-section` hook class + `data-section` so structure-based E2E selectors
 * still resolve. `summary` is escaped plain text; `body` is raw HTML.
 */
function collapsibleDomain(id, summary, body, open = true) {
  const openAttr = open ? ' open' : '';
  return `<details class="disclosure report-section"${openAttr} data-section="${esc(id)}">`
    + `<summary class="disclosure__summary">`
    + `<span class="disclosure__caret" aria-hidden="true"></span>`
    + `<span class="disclosure__label section-header">${esc(summary)}</span>`
    + `</summary>`
    + `<div class="disclosure__body">${body}</div>`
    + `</details>`;
}

/** A flex-wrapping cluster of tag/pill chips (queue-status, state breakdowns). */
function chipRow(html) {
  return `<div class="chip-row">${html}</div>`;
}

// =============================================================================
// Rendering Functions
// =============================================================================

/**
 * Renders the complete audit report.
 */
function renderReport(report) {
  const html = `
    ${renderSummary(report)}
    ${collapsibleDomain('workspace', 'Workspace Structure', renderWorkspaceContent(report.workspace))}
    ${collapsibleDomain('queues', 'Queue Readiness', renderQueuesContent(report.queues))}
    ${collapsibleDomain('health', 'Task Health', renderHealthContent(report.health))}
    ${collapsibleDomain('labels', 'Labels', renderLabelsContent(report.labels))}
    ${collapsibleDomain('projects', 'Projects', renderProjectsContent(report.projectTasks))}
    <div class="report-timestamp">
      Report generated: ${new Date(report.timestamp).toLocaleString()}
    </div>
  `;

  auditReport.innerHTML = html;
  auditReport.classList.remove('hidden');
}

/**
 * Renders the summary stats at the top as accent-coded cards. Health state is
 * conveyed by the card's left-border accent (card-accent--*), not a colored
 * number, so the summary reads at the same altitude as the rest of the theme.
 */
function renderSummary(report) {
  const { health, queues, workspace } = report;

  // Queue readiness → card accent (done/in-progress/failed by score).
  let readinessAccent = 'done';
  if (queues.readinessScore < 100) readinessAccent = 'in-progress';
  if (queues.readinessScore < 50) readinessAccent = 'failed';

  // Health issues → card accent, scaled against the task total.
  const healthIssues = health.orphans.count + health.unlabeled.count;
  let healthAccent = 'done';
  if (healthIssues > 0) healthAccent = 'in-progress';
  if (healthIssues > health.totalTasks * 0.1) healthAccent = 'failed';

  const stat = (value, label, accent) => card({
    accent,
    className: 'summary-stat',
    body: `<span class="stat-value">${esc(value)}</span><span class="stat-label">${esc(label)}</span>`,
  });

  return `
    <div class="report-summary">
      ${stat(health.totalTasks, 'Total Tasks')}
      ${stat(workspace.projectCount, 'Projects')}
      ${stat(workspace.teamCount, 'Teams')}
      ${stat(`${queues.readinessScore}%`, 'Queue Readiness', readinessAccent)}
      ${stat(healthIssues, 'Health Issues', healthAccent)}
    </div>
  `;
}

/**
 * Renders workspace structure content (teams as fields, project states as tags).
 */
function renderWorkspaceContent(workspace) {
  const teamsHtml = workspace.teams.length
    ? workspace.teams.map(t => field({ label: t.key, value: t.name })).join('')
    : field({ label: '', value: 'No teams found' });

  const projectsByState = Object.entries(workspace.projectsByState)
    .map(([state, count]) => tag({ label: state, count }))
    .join('');

  return `
    <h4>Teams (${workspace.teamCount})</h4>
    ${teamsHtml}

    <h4 class="section-subhead">Projects (${workspace.projectCount})</h4>
    ${chipRow(projectsByState || tag({ label: 'None' }))}
  `;
}

/**
 * Renders queue readiness content. Each queue is a field led by a status pill;
 * a missing required queue also carries a red tag.
 */
function renderQueuesContent(queues) {
  const queueItems = queues.queues.map(q => {
    let state;
    if (q.exists) state = 'done';
    else if (q.required) state = 'failed';
    else state = 'todo';

    const labelInfo = q.matchedLabel ? `→ ${esc(q.matchedLabel)}` : '';
    const countInfo = q.taskCount > 0 ? `(${q.taskCount} tasks)` : '';
    const missingTag = !q.exists && q.required ? tag({ label: 'missing', tone: 'error' }) : '';

    const valueHtml = [
      statusPill({ state }),
      labelInfo && `<span class="queue-label">${labelInfo}</span>`,
      countInfo && `<span class="queue-count">${countInfo}</span>`,
      missingTag,
    ].filter(Boolean).join(' ');

    return field({ className: 'queue-item', label: q.name, valueHtml });
  }).join('');

  let statusMessage;
  if (queues.isReady) {
    statusMessage = `<p class="queue-status-msg ok">${statusPill({ state: 'done', label: 'All required queues are configured' })}</p>`;
  } else {
    const missing = queues.missingRequired.map(q => q.name).join(', ');
    statusMessage = `<p class="queue-status-msg bad">${statusPill({ state: 'failed', label: `Missing required queues: ${missing}` })}</p>`;
  }

  return `
    ${statusMessage}
    <div class="queue-list">
      ${queueItems}
    </div>
  `;
}

/**
 * Renders task health content.
 */
function renderHealthContent(health) {
  const stateBreakdown = Object.entries(health.byStateType)
    .map(([type, count]) => tag({ label: type, count }))
    .join('');

  return `
    <h4>Tasks by State Type</h4>
    ${chipRow(stateBreakdown || tag({ label: 'None' }))}

    <h4 class="section-subhead">Health Issues</h4>
    ${renderHealthIssue('Orphan tasks (no project)', health.orphans)}
    ${renderHealthIssue('Unlabeled tasks', health.unlabeled)}
    ${renderHealthIssue(`Short descriptions (<${health.shortDescription.threshold} chars)`, health.shortDescription)}
    ${renderHealthIssue('No assignee', health.noAssignee)}
  `;
}

/**
 * Renders a health issue: a count status pill + label, plus sample items.
 */
function renderHealthIssue(label, issue) {
  const state = issue.count === 0 ? 'done' : (issue.count > 10 ? 'in-progress' : 'failed');

  let itemsHtml = '';
  if (issue.count > 0 && issue.items && issue.items.length > 0) {
    const items = issue.items.map(item =>
      `<li><span class="issue-prefix">├─</span><span class="issue-title">${esc(item.title)}</span></li>`
    ).join('');

    const moreCount = issue.count - issue.items.length;
    const moreLink = moreCount > 0 ? `<span class="more-link">└─ ...and ${moreCount} more</span>` : '';

    itemsHtml = `<ul class="issues-list">${items}</ul>${moreLink}`;
  }

  return `
    <div class="health-indicator">
      ${statusPill({ state, label: String(issue.count) })}
      <span class="health-label">${esc(label)}</span>
    </div>
    ${itemsHtml}
  `;
}

/**
 * Renders labels content as tags — workflow present/missing are toned, other
 * labels carry their issue count.
 */
function renderLabelsContent(labels) {
  const { workflow, other } = labels;

  const renderWorkflowLabel = (label) => label.exists
    ? tag({ label: label.name, count: label.issueCount, tone: 'brand' })
    : tag({ label: label.name, count: 'missing', tone: 'error' });

  const workflowLabelsTags = workflow.labels.map(renderWorkflowLabel).join('');

  const otherTags = other.slice(0, 20)
    .map(l => tag({ label: l.name, count: l.issueCount }))
    .join('');

  const moreOther = other.length > 20
    ? `<span class="more-link">...and ${other.length - 20} more</span>`
    : '';

  return `
    <h4>Workflow Labels (${workflow.presentCount}/${workflow.totalCount})</h4>
    ${chipRow(workflowLabelsTags)}

    <h4 class="section-subhead">Other Labels (${labels.otherCount})</h4>
    ${chipRow((otherTags || '<span class="empty-note">No other labels</span>') + moreOther)}
  `;
}

/**
 * Renders projects content as fields (name → state · count).
 */
function renderProjectsContent(projects) {
  if (projects.length === 0) {
    return '<span class="empty-note">No projects found</span>';
  }

  const rows = projects.slice(0, 20).map(p => field({
    className: 'project-row',
    label: p.name,
    valueHtml: `<span class="project-state">${esc(p.state)}</span><span class="project-count">${esc(p.taskCount)}</span>`,
  })).join('');

  const moreProjects = projects.length > 20
    ? `<span class="more-link">...and ${projects.length - 20} more</span>`
    : '';

  return `
    <div class="projects-table">
      ${rows}
      ${moreProjects}
    </div>
  `;
}

