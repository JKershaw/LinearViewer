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
// State
// =============================================================================
const sectionState = {};

// =============================================================================
// Event Handlers
// =============================================================================
runAuditBtn.addEventListener('click', runAudit);

// Delegate section toggle clicks
document.addEventListener('click', (e) => {
  const header = e.target.closest('.section-header');
  if (header) {
    toggleSection(header);
  }
});

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
    const response = await fetch('/api/audit');

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/';
        return;
      }
      throw new Error(`Audit failed: ${response.status}`);
    }

    const report = await response.json();
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
// Rendering Functions
// =============================================================================

/**
 * Escapes HTML to prevent XSS.
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Renders the complete audit report.
 */
function renderReport(report) {
  const html = `
    ${renderSummary(report)}
    ${renderSection('workspace', 'Workspace Structure', renderWorkspaceContent(report.workspace))}
    ${renderSection('queues', 'Queue Readiness', renderQueuesContent(report.queues))}
    ${renderSection('health', 'Task Health', renderHealthContent(report.health))}
    ${renderSection('labels', 'Labels', renderLabelsContent(report.labels))}
    ${renderSection('fields', 'Field Usage', renderFieldsContent(report.fields))}
    ${renderSection('projects', 'Projects', renderProjectsContent(report.projectTasks))}
    <div class="report-timestamp">
      Report generated: ${new Date(report.timestamp).toLocaleString()}
    </div>
  `;

  auditReport.innerHTML = html;
  auditReport.classList.remove('hidden');
}

/**
 * Renders the summary stats at the top.
 */
function renderSummary(report) {
  const { health, queues, workspace } = report;

  // Determine readiness color
  let readinessClass = 'good';
  if (queues.readinessScore < 100) readinessClass = 'warning';
  if (queues.readinessScore < 50) readinessClass = 'bad';

  // Determine health color based on issues
  const healthIssues = health.orphans.count + health.unlabeled.count;
  let healthClass = 'good';
  if (healthIssues > 0) healthClass = 'warning';
  if (healthIssues > health.totalTasks * 0.1) healthClass = 'bad';

  return `
    <div class="report-summary">
      <div class="summary-stat">
        <span class="stat-value">${health.totalTasks}</span>
        <span class="stat-label">Total Tasks</span>
      </div>
      <div class="summary-stat">
        <span class="stat-value">${workspace.projectCount}</span>
        <span class="stat-label">Projects</span>
      </div>
      <div class="summary-stat">
        <span class="stat-value">${workspace.teamCount}</span>
        <span class="stat-label">Teams</span>
      </div>
      <div class="summary-stat">
        <span class="stat-value ${readinessClass}">${queues.readinessScore}%</span>
        <span class="stat-label">Queue Readiness</span>
      </div>
      <div class="summary-stat">
        <span class="stat-value ${healthClass}">${healthIssues}</span>
        <span class="stat-label">Health Issues</span>
      </div>
    </div>
  `;
}

/**
 * Renders a collapsible section.
 */
function renderSection(id, title, content, defaultOpen = true) {
  const isOpen = sectionState[id] !== undefined ? sectionState[id] : defaultOpen;
  const toggle = isOpen ? '▼' : '▶';
  const contentClass = isOpen ? 'section-content' : 'section-content hidden';

  return `
    <div class="report-section" data-section="${id}">
      <div class="section-header">
        <span class="section-toggle">${toggle}</span>
        <span>${escapeHtml(title)}</span>
      </div>
      <div class="${contentClass}">
        ${content}
      </div>
    </div>
  `;
}

/**
 * Toggles a section's visibility.
 */
function toggleSection(header) {
  const section = header.closest('.report-section');
  const sectionId = section.dataset.section;
  const content = section.querySelector('.section-content');
  const toggle = header.querySelector('.section-toggle');

  const isHidden = content.classList.contains('hidden');
  content.classList.toggle('hidden');
  toggle.textContent = isHidden ? '▼' : '▶';
  sectionState[sectionId] = isHidden;
}

/**
 * Renders workspace structure content.
 */
function renderWorkspaceContent(workspace) {
  const teamsHtml = workspace.teams.map(t =>
    `<li><span class="label">${escapeHtml(t.key)}</span><span class="value">${escapeHtml(t.name)}</span></li>`
  ).join('');

  const projectsByState = Object.entries(workspace.projectsByState)
    .map(([state, count]) => `<span class="state-item"><span class="state-name">${escapeHtml(state)}</span><span class="state-count">${count}</span></span>`)
    .join('');

  return `
    <h4>Teams (${workspace.teamCount})</h4>
    <ul class="data-list">
      ${teamsHtml || '<li><span class="value">No teams found</span></li>'}
    </ul>

    <h4 style="margin-top: 1rem;">Projects (${workspace.projectCount})</h4>
    <div class="state-breakdown">
      ${projectsByState || '<span class="state-item"><span class="state-name">None</span></span>'}
    </div>
  `;
}

/**
 * Renders queue readiness content.
 */
function renderQueuesContent(queues) {
  const queueItems = queues.queues.map(q => {
    let statusIcon, statusClass;
    if (q.exists) {
      statusIcon = '✓';
      statusClass = 'exists';
    } else if (q.required) {
      statusIcon = '✗';
      statusClass = 'missing';
    } else {
      statusIcon = '○';
      statusClass = 'optional';
    }

    const labelInfo = q.matchedLabel ? `→ ${escapeHtml(q.matchedLabel)}` : '';
    const countInfo = q.taskCount > 0 ? `(${q.taskCount} tasks)` : '';
    const requiredBadge = !q.exists && q.required ? '<span class="queue-required">MISSING</span>' : '';

    return `
      <li class="queue-item">
        <span class="queue-status ${statusClass}">${statusIcon}</span>
        <span class="queue-name">${escapeHtml(q.name)}</span>
        <span class="queue-label">${labelInfo}</span>
        <span class="queue-count">${countInfo}</span>
        ${requiredBadge}
      </li>
    `;
  }).join('');

  let statusMessage = '';
  if (queues.isReady) {
    statusMessage = '<p style="color: var(--green); margin-bottom: 1rem;">All required queues are configured.</p>';
  } else {
    const missing = queues.missingRequired.map(q => q.name).join(', ');
    statusMessage = `<p style="color: var(--red); margin-bottom: 1rem;">Missing required queues: ${escapeHtml(missing)}</p>`;
  }

  return `
    ${statusMessage}
    <ul class="queue-list">
      ${queueItems}
    </ul>
  `;
}

/**
 * Renders task health content.
 */
function renderHealthContent(health) {
  const stateBreakdown = Object.entries(health.byStateType)
    .map(([type, count]) => `<span class="state-item"><span class="state-name">${escapeHtml(type)}</span><span class="state-count">${count}</span></span>`)
    .join('');

  return `
    <h4>Tasks by State Type</h4>
    <div class="state-breakdown">
      ${stateBreakdown || '<span class="state-item"><span class="state-name">None</span></span>'}
    </div>

    <h4 style="margin-top: 1rem;">Health Issues</h4>
    ${renderHealthIssue('Orphan tasks (no project)', health.orphans)}
    ${renderHealthIssue('Unlabeled tasks', health.unlabeled)}
    ${renderHealthIssue(`Short descriptions (<${health.shortDescription.threshold} chars)`, health.shortDescription)}
    ${renderHealthIssue('No assignee', health.noAssignee)}
  `;
}

/**
 * Renders a health issue with count and sample items.
 */
function renderHealthIssue(label, issue) {
  const countClass = issue.count === 0 ? 'good' : (issue.count > 10 ? 'warning' : 'bad');

  let itemsHtml = '';
  if (issue.count > 0 && issue.items && issue.items.length > 0) {
    const items = issue.items.map(item =>
      `<li><span class="issue-prefix">├─</span><span class="issue-title">${escapeHtml(item.title)}</span></li>`
    ).join('');

    const moreCount = issue.count - issue.items.length;
    const moreLink = moreCount > 0 ? `<span class="more-link">└─ ...and ${moreCount} more</span>` : '';

    itemsHtml = `<ul class="issues-list">${items}</ul>${moreLink}`;
  }

  return `
    <div class="health-indicator">
      <span class="health-count ${countClass}">${issue.count}</span>
      <span class="health-label">${escapeHtml(label)}</span>
    </div>
    ${itemsHtml}
  `;
}

/**
 * Renders labels content.
 */
function renderLabelsContent(labels) {
  const mappedTags = labels.mapped.map(l =>
    `<span class="label-tag mapped"><span class="tag-name">${escapeHtml(l.name)}</span><span class="tag-count">(${l.issueCount})</span></span>`
  ).join('');

  const unmappedTags = labels.unmapped.slice(0, 20).map(l =>
    `<span class="label-tag unmapped"><span class="tag-name">${escapeHtml(l.name)}</span><span class="tag-count">(${l.issueCount})</span></span>`
  ).join('');

  const moreUnmapped = labels.unmapped.length > 20
    ? `<span class="more-link">...and ${labels.unmapped.length - 20} more</span>`
    : '';

  return `
    <h4>Queue-Mapped Labels (${labels.mappedCount})</h4>
    <div class="labels-list">
      ${mappedTags || '<span style="color: var(--fg-dim)">No labels map to queues</span>'}
    </div>

    <h4 style="margin-top: 1rem;">Other Labels (${labels.unmappedCount})</h4>
    <div class="labels-list">
      ${unmappedTags || '<span style="color: var(--fg-dim)">No other labels</span>'}
      ${moreUnmapped}
    </div>
  `;
}

/**
 * Renders field usage content.
 */
function renderFieldsContent(fields) {
  return `
    ${renderUsageBar('Estimates', fields.estimatesUsage)}
    ${renderUsageBar('Due dates', fields.dueDatesUsage)}

    <h4 style="margin-top: 1rem;">Custom Fields (${fields.customFieldCount})</h4>
    ${fields.customFields.length > 0
      ? `<ul class="data-list">${fields.customFields.map(f =>
          `<li><span class="label">${escapeHtml(f.name)}</span><span class="value">${escapeHtml(f.type)}</span></li>`
        ).join('')}</ul>`
      : '<span style="color: var(--fg-dim)">No custom fields configured</span>'}
  `;
}

/**
 * Renders a usage bar.
 */
function renderUsageBar(label, percent) {
  let fillClass = '';
  if (percent < 25) fillClass = 'very-low';
  else if (percent < 50) fillClass = 'low';

  return `
    <div class="usage-bar-container">
      <span class="usage-label">${escapeHtml(label)}</span>
      <div class="usage-bar">
        <div class="usage-bar-fill ${fillClass}" style="width: ${percent}%"></div>
      </div>
      <span class="usage-percent">${percent}%</span>
    </div>
  `;
}

/**
 * Renders projects content.
 */
function renderProjectsContent(projects) {
  if (projects.length === 0) {
    return '<span style="color: var(--fg-dim)">No projects found</span>';
  }

  const rows = projects.slice(0, 20).map(p => `
    <div class="project-row">
      <span class="project-name">${escapeHtml(p.name)}</span>
      <span class="project-state">${escapeHtml(p.state)}</span>
      <span class="project-count">${p.taskCount}</span>
    </div>
  `).join('');

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
