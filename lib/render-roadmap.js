/**
 * Roadmap Page Renderer
 *
 * Generates HTML for the roadmap view.
 * Embeds roadmap data as JSON for client-side rendering.
 * Shows velocity metrics, milestone projections, critical paths, and risks.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';

/**
 * Renders the roadmap page.
 *
 * @param {Object} data - Page data
 * @param {Object} data.roadmapModel - Roadmap model with velocity, milestones, etc.
 * @param {string} data.organizationName - Organization name
 * @param {Object} options - Page options
 * @returns {string} Complete HTML document
 */
export function renderRoadmapPage(data, options = {}) {
  const { roadmapModel = {}, organizationName = '' } = data;
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const {
    velocity = {},
    milestones = [],
    criticalPaths = new Map(),
    risks = [],
    executionQueue = []
  } = roadmapModel;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'roadmap', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/roadmap',
    urlKey,
    openRouterSource,
    featureFlags
  });

  const hasAI = !!openRouterSource;
  const encodedUrlKey = escapeHtml(urlKey || '');

  // Build velocity panel
  const tasksPerWeek = velocity.tasksPerWeek ?? 0;
  const pointsPerWeek = velocity.pointsPerWeek ?? 0;
  const trend = velocity.trend || 'stable';
  const trendIndicator = trend === 'increasing' ? '↑' : trend === 'decreasing' ? '↓' : '→';
  const trendClass = trend === 'increasing' ? 'roadmap-trend--increasing' : trend === 'decreasing' ? 'roadmap-trend--decreasing' : 'roadmap-trend--stable';

  const velocityHtml = `
    <div class="roadmap-velocity-panel">
      <h2 class="roadmap-section-heading">│ Velocity</h2>
      <div class="roadmap-velocity-stats">
        <div class="roadmap-velocity-stat">
          <span class="roadmap-velocity-value">${escapeHtml(String(tasksPerWeek))}</span>
          <span class="roadmap-velocity-label">tasks/week</span>
        </div>
        <div class="roadmap-velocity-stat">
          <span class="roadmap-velocity-value">${escapeHtml(String(pointsPerWeek))}</span>
          <span class="roadmap-velocity-label">points/week</span>
        </div>
        <div class="roadmap-velocity-stat">
          <span class="roadmap-velocity-value ${escapeHtml(trendClass)}">${trendIndicator}</span>
          <span class="roadmap-velocity-label">${escapeHtml(trend)}</span>
        </div>
      </div>
    </div>`;

  // Build milestone cards
  const milestoneCardsHtml = milestones.map(milestone => {
    const name = escapeHtml(milestone.name || 'Untitled');
    const total = milestone.totalTasks ?? 0;
    const remaining = milestone.remainingTasks ?? total;
    const done = milestone.completedTasks ?? (total - remaining);
    const remainingPoints = milestone.remainingPoints ?? 0;
    const weeksRemaining = milestone.weeksRemaining ?? null;
    const confidenceLow = milestone.confidenceLow ?? weeksRemaining;
    const confidenceHigh = milestone.confidenceHigh ?? weeksRemaining;

    // Progress bar using ━ characters (CLI aesthetic)
    const barLength = 20;
    const filled = total > 0 ? Math.round((done / total) * barLength) : 0;
    const empty = barLength - filled;
    const progressBar = '━'.repeat(filled) + '╌'.repeat(empty);
    const pct = milestone.progressPercent ?? (total > 0 ? Math.round((done / total) * 100) : 0);

    // Critical path for this milestone (keyed by project name)
    const milestoneName = milestone.name || '';
    const cpEntry = criticalPaths instanceof Map
      ? criticalPaths.get(milestoneName)
      : criticalPaths[milestoneName];

    let criticalPathHtml = '';
    if (cpEntry && cpEntry.path && cpEntry.path.length > 0) {
      // Resolve path IDs to issue details from the execution queue
      const issueById = new Map(executionQueue.map(i => [i.id, i]));
      const pathItems = cpEntry.path.map((id, idx) => {
        const prefix = idx < cpEntry.path.length - 1 ? '├─' : '└─';
        const issue = issueById.get(id);
        const statusIcon = issue?.stateType === 'completed' ? '✓'
          : issue?.stateType === 'started' ? '◐'
          : '○';
        const identifier = escapeHtml(issue?.identifier || id);
        const title = escapeHtml(issue?.title || '');
        return `<div class="roadmap-path-item">${prefix} ${statusIcon} ${identifier} ${title}</div>`;
      }).join('\n            ');

      criticalPathHtml = `
          <div class="roadmap-critical-path">
            <div class="roadmap-path-heading">│ critical path (${cpEntry.length} deep)</div>
            ${pathItems}
          </div>`;
    }

    // Risk indicators for this milestone (matched by name)
    const milestoneRisks = risks.filter(r => r.milestone === milestoneName);
    let risksHtml = '';
    if (milestoneRisks.length > 0) {
      const riskItems = milestoneRisks.map(risk => {
        const severity = escapeHtml(risk.severity || 'medium');
        const description = escapeHtml(risk.description || '');
        return `<span class="roadmap-risk-badge roadmap-risk--${severity}">${severity}</span> ${description}`;
      }).join('<br>');
      risksHtml = `
          <div class="roadmap-risks">
            <div class="roadmap-risks-heading">│ risks</div>
            <div class="roadmap-risks-list">${riskItems}</div>
          </div>`;
    }

    const weeksDisplay = weeksRemaining !== null ? `~${weeksRemaining}` : '?';
    const confDisplay = confidenceLow !== null && confidenceHigh !== null
      ? `${confidenceLow}–${confidenceHigh}`
      : '?';

    return `
        <div class="roadmap-milestone-card" data-milestone-name="${escapeHtml(milestoneName)}">
          <div class="roadmap-milestone-header">
            <span class="roadmap-milestone-name">${name}</span>
          </div>
          <div class="roadmap-milestone-progress">
            <code class="roadmap-progress-bar">${progressBar}</code> <span class="roadmap-progress-pct">${pct}%</span>
          </div>
          <div class="roadmap-milestone-stats">
            <span>remaining: ${remaining}/${total} tasks</span>
            <span>points: ${remainingPoints}</span>
            <span>projected: ${escapeHtml(weeksDisplay)} weeks</span>
            <span>confidence: ${escapeHtml(confDisplay)} weeks</span>
          </div>${criticalPathHtml}${risksHtml}
        </div>`;
  }).join('\n');

  // Narrative section (AI-populated)
  const narrativeClass = hasAI ? 'roadmap-narrative' : 'roadmap-narrative hidden';

  // Chat Q&A section (AI-populated)
  const chatClass = hasAI ? 'roadmap-chat' : 'roadmap-chat hidden';

  // Prepare data for client-side
  const roadmapData = {
    velocity: {
      tasksPerWeek: velocity.tasksPerWeek ?? 0,
      pointsPerWeek: velocity.pointsPerWeek ?? 0,
      trend: velocity.trend || 'stable',
      weeklyData: velocity.weeklyData || []
    },
    milestones,
    criticalPaths: criticalPaths instanceof Map
      ? Object.fromEntries(criticalPaths)
      : criticalPaths,
    risks,
    urlKey: urlKey || '',
    hasAI
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roadmap - ${escapeHtml(organizationName || 'Linear')}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/roadmap.css">
</head>
<body>
  ${navBarHtml}
  <main class="roadmap-page" data-url-key="${encodedUrlKey}">
    ${velocityHtml}

    <div class="roadmap-milestones">
      <h2 class="roadmap-section-heading">│ Milestones</h2>
      <div class="roadmap-milestone-cards">
        ${milestoneCardsHtml}
      </div>
    </div>

    <div class="${narrativeClass}" id="roadmap-narrative">
      <!-- Populated by client-side JS when AI is available -->
    </div>

    <div class="${chatClass}" id="roadmap-chat">
      <!-- Populated by client-side JS when AI is available -->
    </div>
  </main>
  ${footerHtml}
  <script>window.__ROADMAP_DATA__ = ${JSON.stringify(roadmapData).replace(/</g, '\\u003c')};</script>
  <script src="/common.js"></script>
  <script src="/roadmap.js"></script>
</body>
</html>`;
}
