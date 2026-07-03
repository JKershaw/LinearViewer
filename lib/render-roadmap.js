/**
 * Roadmap Page Renderer
 *
 * Generates HTML for the roadmap view. The page is delivery-focused:
 * - "Recently shipped" leads the page (cross-project, grouped by week)
 * - "By project" shows current state per project (in-progress, blockers)
 * - "Narrative" and "Chat" provide AI synthesis when available
 *
 * Projection-flavored fields (weeks remaining, confidence ranges, projected
 * end dates, points) are intentionally absent — the page mirrors the
 * delivery framing of the LLM prompt.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderPageHeader } from './components/page-header.js';
import { renderCard } from './components/card.js';
import { renderAccentBar } from './components/accent-bar.js';
import { renderSegmentBar } from './components/segment-bar.js';
import { renderStatusPill } from './components/status-pill.js';

// Risk types derived from forward-looking projections. They're filtered
// out of the page just like they're filtered out of the LLM summary, so
// the page and the narrative tell a consistent story.
const PROJECTION_RISK_TYPES = new Set([
  'velocity-declining',
  'overdue',
  'unestimated-critical'
]);

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const SHIP_LOG_LIMIT_PER_BUCKET = 12;
const SHIP_LOG_WINDOW_DAYS = 90;

/**
 * Flatten recentlyCompleted across all milestones (within the 90-day window),
 * attaching project context, and bucket by recency.
 *
 * @param {Array} milestones
 * @returns {{ total: number, buckets: Array<{ label: string, items: Array }> }}
 */
function buildShipLog(milestones) {
  const now = new Date();
  const all = [];
  for (const m of milestones) {
    const projectName = m.name || 'Unassigned';
    for (const t of m.recentlyCompleted || []) {
      if (!t.completedAt) continue;
      const ageDays = (now - new Date(t.completedAt)) / MS_PER_DAY;
      if (ageDays > SHIP_LOG_WINDOW_DAYS) continue;
      all.push({ ...t, projectName, ageDays });
    }
  }
  all.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const thisWeek = [];
  const lastWeek = [];
  const earlier = [];
  for (const item of all) {
    if (item.ageDays < 7) thisWeek.push(item);
    else if (item.ageDays < 14) lastWeek.push(item);
    else earlier.push(item);
  }

  const buckets = [];
  if (thisWeek.length > 0) buckets.push({ label: 'This week', items: thisWeek });
  if (lastWeek.length > 0) buckets.push({ label: 'Last week', items: lastWeek });
  if (earlier.length > 0) buckets.push({ label: 'Earlier', items: earlier });

  return { total: all.length, buckets };
}

/**
 * Render a single shipped-item line.
 */
function renderShipItem(item) {
  const title = escapeHtml(item.title || '');
  const project = escapeHtml(item.projectName || '');
  const date = item.completedAt ? item.completedAt.split('T')[0] : '';
  const stateName = item.stateName && item.stateName !== 'Done'
    ? `<span class="ship-state">[${escapeHtml(item.stateName)}]</span> `
    : '';
  // Shipped marker via the shared status primitive. The `bare` variant is the
  // box-less inline glyph (no pill chrome per list row); it keeps the row inline
  // and preserves the green ✓ through the `done` state colour.
  const shipMarker = renderStatusPill({ state: 'done', variant: 'bare', className: 'ship-icon' });
  return `<li class="ship-item">
        ${shipMarker}
        <span class="ship-title">${stateName}${title}</span>
        <span class="ship-meta"><span class="ship-project">${project}</span> · <span class="ship-date">${escapeHtml(date)}</span></span>
      </li>`;
}

/**
 * Render the ship log (Recently shipped) section as a collapsible <details>.
 * @param {Array} milestones
 * @param {Object} [opts]
 * @param {boolean} [opts.open] - Start expanded (used as the recap fallback when AI is off)
 */
function renderShipLogSection(milestones, { open = false } = {}) {
  const { total, buckets } = buildShipLog(milestones);
  const openAttr = open ? ' open' : '';

  if (total === 0) {
    return `<details class="roadmap-section roadmap-ship-log"${openAttr}>
      <summary class="roadmap-section-heading">│ Recently shipped</summary>
      ${renderEmptyState({ tag: 'p', className: 'roadmap-empty', text: 'No completions in the last 90 days.' })}
    </details>`;
  }

  const bucketsHtml = buckets.map(bucket => {
    const items = bucket.items.slice(0, SHIP_LOG_LIMIT_PER_BUCKET);
    const hidden = bucket.items.slice(SHIP_LOG_LIMIT_PER_BUCKET);
    const itemsHtml = items.map(renderShipItem).join('\n      ');
    const hiddenHtml = hidden.length > 0
      ? `<details class="ship-more">
          <summary>Show ${hidden.length} more</summary>
          <ul class="ship-list ship-list--hidden">
            ${hidden.map(renderShipItem).join('\n      ')}
          </ul>
        </details>`
      : '';
    return `<div class="ship-bucket">
      <h3 class="ship-bucket-heading">${escapeHtml(bucket.label)} <span class="ship-count">(${bucket.items.length})</span></h3>
      <ul class="ship-list">
        ${itemsHtml}
      </ul>
      ${hiddenHtml}
    </div>`;
  }).join('\n');

  return `<details class="roadmap-section roadmap-ship-log"${openAttr}>
    <summary class="roadmap-section-heading">│ Recently shipped <span class="roadmap-section-total">(${total} in 90 days)</span></summary>
    ${bucketsHtml}
  </details>`;
}

/**
 * Render a single project card.
 * Current-state focus: progress, in-progress work, blockers/risks.
 * No projection/estimate fields.
 */
function renderProjectCard(milestone, criticalPaths, executionQueue, risks) {
  const name = escapeHtml(milestone.name || 'Untitled');
  const total = milestone.totalTasks ?? 0;
  const remaining = milestone.remainingTasks ?? total;
  const done = milestone.completedTasks ?? (total - remaining);
  const pct = milestone.progressPercent ?? (total > 0 ? Math.round((done / total) * 100) : 0);

  // Proportional progress rendered on the shared segment-bar primitive. Keep the
  // 20-cell density and the exact round(done/total*20) fill computation of the
  // former ━/╌ glyph bar — the first `filled` cells read `done`, the rest are the
  // neutral empty track, so the proportional read is preserved on token'd chrome.
  const barLength = 20;
  const filled = total > 0 ? Math.round((done / total) * barLength) : 0;
  const progressSegments = Array.from({ length: barLength }, (_, i) => (
    i < filled ? { state: 'done' } : { state: 'empty' }
  ));
  const progressBarHtml = renderSegmentBar({
    segments: progressSegments,
    ariaLabel: `${pct}% complete`,
    className: 'roadmap-progress-bar'
  });

  // Description
  const description = milestone.description ? escapeHtml(milestone.description) : '';
  const descriptionHtml = description
    ? `<div class="roadmap-milestone-desc">${description}</div>`
    : '';

  // Tasks: in-progress only by default, with a collapsible "upcoming" section
  const tasksInQueue = milestone.tasksInQueue || [];
  const inProgress = tasksInQueue.filter(t =>
    t.stateType === 'started' || (t.subtasks && t.subtasks.some(s => s.stateType === 'started'))
  );
  const upcoming = tasksInQueue.filter(t =>
    t.stateType !== 'started' && !(t.subtasks && t.subtasks.some(s => s.stateType === 'started'))
  );

  const renderTaskItem = (task) => {
    const statusIcon = task.stateType === 'completed' ? '✓'
      : task.stateType === 'started' ? '◐' : '○';
    const taskTitle = escapeHtml(task.title || '');
    const taskId = escapeHtml(task.identifier || '');
    const idPart = taskId ? `<span class="task-id">${taskId}</span> ` : '';

    if (task.subtasks && task.subtasks.length > 0) {
      const r = task.rollup || {};
      const rollupText = `<span class="task-rollup">(${r.subtaskDone || 0}/${r.subtaskTotal || task.subtasks.length} subtasks)</span>`;
      const childItems = task.subtasks.map((sub, idx) => {
        const prefix = idx < task.subtasks.length - 1 ? '├─' : '└─';
        const subIcon = sub.stateType === 'completed' ? '✓'
          : sub.stateType === 'started' ? '◐' : '○';
        const subTitle = escapeHtml(sub.title || '');
        const subId = escapeHtml(sub.identifier || '');
        const subIdPart = subId ? `<span class="task-id">${subId}</span> ` : '';
        return `<div class="roadmap-task-child">${prefix} ${subIcon} ${subIdPart}${subTitle}</div>`;
      }).join('\n        ');

      return `<div class="roadmap-task-parent">${statusIcon} ${idPart}${taskTitle} ${rollupText}
        <div class="roadmap-task-children">
        ${childItems}
        </div>
      </div>`;
    }
    return `<div class="roadmap-task-item">${statusIcon} ${idPart}${taskTitle}</div>`;
  };

  let inProgressHtml = '';
  if (inProgress.length > 0) {
    inProgressHtml = `<div class="roadmap-task-tree">
      <div class="roadmap-tree-heading">│ in progress (${inProgress.length})</div>
      ${inProgress.map(renderTaskItem).join('\n      ')}
    </div>`;
  }

  let upcomingHtml = '';
  if (upcoming.length > 0) {
    upcomingHtml = `<details class="roadmap-upcoming">
      <summary>Show ${upcoming.length} upcoming task${upcoming.length === 1 ? '' : 's'}</summary>
      <div class="roadmap-task-tree roadmap-task-tree--upcoming">
        ${upcoming.map(renderTaskItem).join('\n        ')}
      </div>
    </details>`;
  }

  // Critical path
  const milestoneName = milestone.name || '';
  const cpEntry = criticalPaths instanceof Map
    ? criticalPaths.get(milestoneName)
    : criticalPaths[milestoneName];

  let criticalPathHtml = '';
  if (cpEntry && cpEntry.path && cpEntry.path.length > 1) {
    const issueById = new Map(executionQueue.map(i => [i.id, i]));
    const pathItems = cpEntry.path.map((id, idx) => {
      const prefix = idx < cpEntry.path.length - 1 ? '├─' : '└─';
      const issue = issueById.get(id);
      const statusIcon = issue?.stateType === 'completed' ? '✓'
        : issue?.stateType === 'started' ? '◐'
        : '○';
      const identifier = escapeHtml(issue?.identifier || id);
      const title = escapeHtml(issue?.title || '');
      const idPart = identifier ? `<span class="task-id">${identifier}</span> ` : '';
      return `<div class="roadmap-path-item">${prefix} ${statusIcon} ${idPart}${title}</div>`;
    }).join('\n      ');

    criticalPathHtml = `<div class="roadmap-critical-path">
      <div class="roadmap-tree-heading">│ critical path (${cpEntry.length} deep)</div>
      ${pathItems}
    </div>`;
  }

  // Risks (current-state only)
  const milestoneRisks = risks.filter(r =>
    r.milestone === milestoneName && !PROJECTION_RISK_TYPES.has(r.type)
  );
  let risksHtml = '';
  if (milestoneRisks.length > 0) {
    // Severity → shared accent-bar state (colour-preserving): high → error (red),
    // medium → running (amber), low → queued (slate). The severity word is also
    // carried as text, so the stripe is never the sole signal (a11y `label`).
    const RISK_ACCENT_STATE = { high: 'error', medium: 'running', low: 'queued' };
    const riskItems = milestoneRisks.map(risk => {
      const severity = escapeHtml(risk.severity || 'medium');
      const description = escapeHtml(risk.description || '');
      const accentState = RISK_ACCENT_STATE[risk.severity] || 'running';
      const accentBar = renderAccentBar({
        state: accentState,
        orientation: 'vertical',
        label: `${severity} risk`
      });
      return `<div class="roadmap-risk roadmap-risk--${severity}">${accentBar}<span class="roadmap-risk-body"><span class="roadmap-risk-sev">${severity}</span> ${description}</span></div>`;
    }).join('');
    risksHtml = `<div class="roadmap-risks">
      <div class="roadmap-tree-heading">│ risks</div>
      ${riskItems}
    </div>`;
  }

  // Accent state: complete → done; else any started task → in-progress; else todo.
  const hasStarted = tasksInQueue.some(t =>
    t.stateType === 'started' || (t.subtasks && t.subtasks.some(s => s.stateType === 'started'))
  );
  const accent = pct >= 100 ? 'done' : (hasStarted ? 'in-progress' : 'todo');

  const cardBody = `${descriptionHtml}
    <div class="roadmap-milestone-progress">${progressBarHtml}</div>
    ${inProgressHtml}${upcomingHtml}${criticalPathHtml}${risksHtml}`;

  return renderCard({
    accent,
    title: `<span class="roadmap-milestone-name">${name}</span>`,
    meta: `${pct}% · ${done}/${total} done`,
    body: cardBody,
    className: 'roadmap-milestone-card',
    attrs: `data-milestone-name="${escapeHtml(milestoneName)}"`
  });
}

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
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {}, availableModels = [] } = options;

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

  // Header: workspace + time window + delivery cadence
  const today = new Date().toISOString().split('T')[0];
  const tasksPerWeek = velocity.tasksPerWeek ?? 0;
  const cadenceBadge = tasksPerWeek > 0
    ? `<span class="roadmap-header-cadence">avg ${tasksPerWeek} shipped/week</span>`
    : '';
  const workspaceName = workspaces.find(w => w.urlKey === urlKey)?.name || organizationName || '';
  const headerHtml = `<div class="roadmap-header">
    ${renderPageHeader({ title: 'Roadmap', headerClass: 'roadmap-page-header' })}
    <p class="roadmap-header-meta">
      ${workspaceName ? `<span class="roadmap-header-workspace">${escapeHtml(workspaceName)}</span> · ` : ''}<span>last 90 days</span> · <span>as of ${today}</span>${cadenceBadge ? ' · ' + cadenceBadge : ''}
    </p>
  </div>`;

  // Recently shipped section. Collapsed by default; opened only as the recap
  // fallback when there is no AI digest to be the at-a-glance read.
  const shipLogHtml = renderShipLogSection(milestones, { open: !hasAI });

  // Projects (current-state)
  const milestoneCardsHtml = milestones
    .map(m => renderProjectCard(m, criticalPaths, executionQueue, risks))
    .join('\n');

  const projectsSectionHtml = milestones.length > 0
    ? `<details class="roadmap-section roadmap-milestones">
        <summary class="roadmap-section-heading">│ By project</summary>
        <div class="roadmap-milestone-cards">${milestoneCardsHtml}</div>
      </details>`
    : '';

  // Pipeline + chat placeholders (populated client-side when AI is connected).
  // Server renders the static skeleton — north star input, generate button, the
  // digest placeholder, and five layer sections — so layout doesn't reflow as
  // streaming begins. The digest renders first but generates last.
  const pipelineClass = hasAI ? 'roadmap-section roadmap-pipeline' : 'roadmap-section roadmap-pipeline hidden';
  const chatClass = hasAI ? 'roadmap-section roadmap-chat' : 'roadmap-section roadmap-chat hidden';

  // The digest is the recap — always visible (a plain div). The five detail
  // layers are collapsible <details>, collapsed by default, so the page lands
  // on just the recap and the reader expands what they want.
  const layerSection = (layerId, heading, { modifier = '', collapsible = true } = {}) => {
    const cls = `roadmap-layer${modifier ? ' ' + modifier : ''}`;
    if (!collapsible) {
      return `
        <div class="${cls}" data-layer="${layerId}" data-state="idle">
          <h3 class="roadmap-layer-heading">│ ${heading}</h3>
          <div class="roadmap-layer-status"></div>
          <div class="roadmap-layer-content"></div>
        </div>`;
    }
    return `
        <details class="${cls}" data-layer="${layerId}" data-state="idle">
          <summary class="roadmap-layer-heading">${heading}</summary>
          <div class="roadmap-layer-status"></div>
          <div class="roadmap-layer-content"></div>
        </details>`;
  };

  // Per-request model override (LIN-819): a curated select that lets the user
  // pick a stronger model for just this reading. Default option keeps the
  // workspace-wide default (empty value → server uses resolveWorkspaceModel).
  // Only rendered when AI is available; the override is ephemeral (never saved).
  const modelOptions = [
    '<option value="">Workspace default</option>',
    ...availableModels.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
  ].join('');
  const modelSelectorHtml = hasAI
    ? `<label class="roadmap-model-select-label">
          <span class="roadmap-model-select-text">Model</span>
          <select class="roadmap-model-select" id="roadmap-model-select" aria-label="AI model for this reading">${modelOptions}</select>
        </label>`
    : '';

  const pipelineSkeleton = `
      <h2 class="roadmap-section-heading">│ Reading</h2>
      <div class="roadmap-north-star">
        <label class="roadmap-north-star-label" for="roadmap-north-star-input">North star</label>
        <textarea
          class="roadmap-north-star-input"
          id="roadmap-north-star-input"
          rows="4"
          placeholder="What does success look like? Saves on blur."
          maxlength="8000"></textarea>
        <p class="roadmap-north-star-help">Without a north star, layers 3b and 4 are skipped.</p>
      </div>
      <div class="roadmap-pipeline-controls">
        <button type="button" class="roadmap-generate-reading-btn">Generate reading</button>
        ${modelSelectorHtml}
        <p class="roadmap-orientation-note" id="roadmap-orientation-note" role="status" hidden></p>
      </div>
      <div class="roadmap-history" id="roadmap-history"><!-- past readings, populated client-side --></div>
      <div class="roadmap-history-viewing" id="roadmap-history-viewing" hidden></div>
      <details class="roadmap-orientation-result" id="roadmap-orientation-result" hidden>
        <summary class="roadmap-orientation-result-heading">Orientation bearings</summary>
        <div class="roadmap-orientation-result-body"><!-- per-task bearings, populated client-side --></div>
      </details>
      ${layerSection('digest', 'At a glance', { modifier: 'roadmap-layer--digest', collapsible: false })}
      ${layerSection('technical', 'Technical narrative')}
      ${layerSection('product', 'Product perspective')}
      <div class="roadmap-fork">
        ${layerSection('trajectory', 'Trajectory')}
        ${layerSection('north-star-reading', 'North star reading')}
      </div>
      ${layerSection('gap', 'Gap')}`;

  // Data for the client
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

  return renderPage({
    title: `Roadmap - ${escapeHtml(organizationName || 'Linear')}`,
    stylesheets: ['/style.css', '/roadmap.css'],
    nav: navBarHtml,
    embeddedData: { globalVar: '__ROADMAP_DATA__', value: roadmapData },
    scripts: ['/common.js', '/roadmap.js'],
    content: `<main class="roadmap-page" data-url-key="${encodedUrlKey}">
    ${headerHtml}
    ${shipLogHtml}
    ${projectsSectionHtml}
    <section class="${pipelineClass}" id="roadmap-pipeline">${pipelineSkeleton}
    </section>
    <details class="${chatClass}" id="roadmap-chat">
      <summary class="roadmap-section-heading">│ Chat</summary>
      <div class="roadmap-chat-body"><!-- Populated by client-side JS when AI is available --></div>
    </details>
  </main>
  ${footerHtml}`
  });
}
