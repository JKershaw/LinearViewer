/**
 * Roadmap Page Renderer
 *
 * Generates HTML for the roadmap view. The page is delivery-focused: no
 * projection fields (weeks remaining, confidence ranges, projected end dates,
 * points), no velocity panel or trend — it mirrors the delivery framing of the
 * LLM prompt. Top to bottom:
 * - "Recently shipped" (cross-project, grouped by recency)
 * - "By project" (current state per project: in-progress work, path, risks)
 * - "Reading" and "Chat", the AI synthesis, populated client-side
 *
 * Shape: derive, then render. `shippedFeed`, `projectView` and `clientPayload`
 * turn the inputs into plain data (no HTML); each page region has one renderer
 * that only lays that data out. The inputs are read once and `now` is taken
 * once, in `renderRoadmapPage`.
 */

import { escapeHtml } from './utils/html.js';
import { formatModelPricing } from './openrouter.js';
import { getStateDisplay } from './providers/state-map.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderPageHeader } from './components/page-header.js';
import { renderCard } from './components/card.js';
import { renderAccentBar } from './components/accent-bar.js';
import { renderSegmentBar } from './components/segment-bar.js';
import { renderStatusPill } from './components/status-pill.js';

// Risk types derived from forward-looking projections. They're filtered out of
// the page just like they're filtered out of the LLM summary, so the page and
// the narrative tell a consistent story.
const PROJECTION_RISK_TYPES = new Set([
  'velocity-declining',
  'overdue',
  'unestimated-critical'
]);

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const SHIP_WINDOW_DAYS = 90;
const SHIP_BUCKET_LIMIT = 12;
const PROGRESS_CELLS = 20;

// Ship-log buckets by age. The last bucket is also where an age that is not a
// number lands (an unparseable completedAt is kept, not dropped).
const SHIP_BUCKETS = [
  { label: 'This week', underDays: 7 },
  { label: 'Last week', underDays: 14 },
  { label: 'Earlier', underDays: Infinity }
];

// Severity → shared accent-bar state (colour-preserving): high → error (red),
// medium → running (amber), low → queued (slate). The severity word is also
// carried as text, so the stripe is never the sole signal.
const RISK_ACCENTS = { high: 'error', medium: 'running', low: 'queued' };

// The Reading skeleton, as the client expects it (ids and `data-layer`/
// `data-state` are its hooks). The digest is the always-visible recap (a plain
// div); the detail layers are collapsed <details>. `fork` layers sit side by
// side in one wrapper. Server-rendered so layout doesn't reflow as streaming
// begins; the digest renders first but generates last.
const READING_LAYERS = [
  { id: 'digest', heading: 'At a glance', modifier: 'roadmap-layer--digest', collapsible: false },
  { id: 'technical', heading: 'Technical narrative' },
  { id: 'product', heading: 'Product perspective' },
  { fork: [
    { id: 'trajectory', heading: 'Trajectory' },
    { id: 'north-star-reading', heading: 'North star reading' }
  ] },
  { id: 'gap', heading: 'Gap' }
];

/** Own-property lookup, so keys like `toString` never resolve to a prototype member. */
function pick(table, key, fallback) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
}

/** Numeric slots are escaped like text; `0` must still render as "0". */
function num(value) {
  return escapeHtml(String(value));
}

/** A task counts as active when it, or any of its subtasks, has started. */
function isActive(task) {
  return task.stateType === 'started' || !!(task.subtasks && task.subtasks.some(s => s.stateType === 'started'));
}

const branch = (index, count) => (index < count - 1 ? '├─' : '└─');

/** `✓ <id> title`: the one line shape shared by tasks, subtasks and path items. */
function taskLine({ stateType, identifier, title }) {
  const id = escapeHtml(identifier);
  return `${getStateDisplay(stateType).char} ${id ? `<span class="task-id">${id}</span> ` : ''}${escapeHtml(title)}`;
}

// ---------------------------------------------------------------------------
// Derivations (plain data, no HTML)
// ---------------------------------------------------------------------------

/**
 * Everything completed inside the window, newest first, bucketed by age.
 * Dates stay strings for display; `now` is only used for ageing.
 * Sorting subtracts freshly parsed dates on purpose: for an unparseable date
 * (NaN) the resulting order is whatever the engine's sort makes of it, and
 * the page has always shown that order.
 */
function shippedFeed(milestones, now) {
  const items = [];
  for (const m of milestones) {
    const projectName = m.name || 'Unassigned';
    for (const task of m.recentlyCompleted || []) {
      if (!task.completedAt) continue;
      const ageDays = (now - new Date(task.completedAt)) / MS_PER_DAY;
      if (ageDays > SHIP_WINDOW_DAYS) continue;
      items.push({ ...task, projectName, ageDays });
    }
  }
  items.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  const buckets = SHIP_BUCKETS.map(({ label }) => ({ label, items: [] }));
  for (const item of items) {
    const index = SHIP_BUCKETS.findIndex(b => item.ageDays < b.underDays);
    buckets[index === -1 ? buckets.length - 1 : index].items.push(item);
  }
  return { total: items.length, buckets: buckets.filter(b => b.items.length > 0) };
}

/**
 * One project card as data. `issueById` is lazy (only called for a path longer
 * than 1), so a model whose `executionQueue` is unusable still renders when no
 * path needs it.
 */
function projectView(milestone, { criticalPaths, issueById, risks }) {
  const name = milestone.name || '';
  const total = milestone.totalTasks ?? 0;
  const remaining = milestone.remainingTasks ?? total;
  const done = milestone.completedTasks ?? (total - remaining);
  const pct = milestone.progressPercent ?? (total > 0 ? Math.round((done / total) * 100) : 0);

  const tasks = milestone.tasksInQueue || [];
  const active = tasks.filter(isActive);
  const upcoming = tasks.filter(t => !isActive(t));

  const entry = criticalPaths instanceof Map ? criticalPaths.get(name) : criticalPaths[name];
  let path = null;
  if (entry && entry.path && entry.path.length > 1) {
    const byId = issueById();
    path = {
      depth: entry.length,
      items: entry.path.map(id => {
        const issue = byId.get(id);
        return { stateType: issue?.stateType, identifier: issue?.identifier || id, title: issue?.title };
      })
    };
  }

  return {
    name,
    pct,
    done,
    total,
    filled: total > 0 ? Math.round((done / total) * PROGRESS_CELLS) : 0,
    description: milestone.description,
    active,
    upcoming,
    path,
    risks: risks.filter(r => r.milestone === name && !PROJECTION_RISK_TYPES.has(r.type)),
    // complete → done; else anything started → in-progress; else todo.
    accent: pct >= 100 ? 'done' : (active.length > 0 ? 'in-progress' : 'todo')
  };
}

/** What `public/roadmap.js` reads from `window.__ROADMAP_DATA__`. */
function clientPayload({ velocity, milestones, criticalPaths, risks, urlKey, hasAI }) {
  return {
    velocity: {
      tasksPerWeek: velocity.tasksPerWeek ?? 0,
      pointsPerWeek: velocity.pointsPerWeek ?? 0,
      trend: velocity.trend || 'stable',
      weeklyData: velocity.weeklyData || []
    },
    milestones,
    // Object.fromEntries keeps insertion order, which is observable: the chat
    // route walks these entries to write the prompt.
    criticalPaths: criticalPaths instanceof Map ? Object.fromEntries(criticalPaths) : criticalPaths,
    risks,
    urlKey: urlKey || '',
    hasAI
  };
}

// ---------------------------------------------------------------------------
// Region renderers
// ---------------------------------------------------------------------------

/**
 * Header: workspace + time window + delivery cadence. Each fact is its own
 * atomic flex item; the `·` separators are CSS pseudo-elements (see
 * .roadmap-header-meta), NOT literal text — so at 390 the row wraps
 * fact-by-fact and never orphans a dangling separator (LIN-1222).
 */
function renderHeader({ workspaceName, today, tasksPerWeek }) {
  const facts = [
    workspaceName ? `<span class="roadmap-header-workspace">${escapeHtml(workspaceName)}</span>` : '',
    '<span>last 90 days</span>',
    `<span>as of ${today}</span>`,
    tasksPerWeek > 0 ? `<span class="roadmap-header-cadence">avg ${num(tasksPerWeek)} shipped/week</span>` : ''
  ].filter(Boolean).join('\n      ');
  return `<div class="roadmap-header">
    ${renderPageHeader({ title: 'Roadmap', headerClass: 'roadmap-page-header' })}
    <p class="roadmap-header-meta">
      ${facts}
    </p>
  </div>`;
}

/**
 * A shipped entry is two lines (LIN-1222): the title wraps as a human label,
 * with `project · date` as a muted machine-fact line beneath it, so nothing is
 * truncated at any width. The marker is the status primitive's box-less `bare`
 * glyph (green ✓ via the `done` colour). `[state]` shows only when the state
 * isn't plain "Done".
 */
function renderShipItem(item) {
  const state = item.stateName && item.stateName !== 'Done'
    ? `<span class="ship-state">[${escapeHtml(item.stateName)}]</span> `
    : '';
  const date = item.completedAt.split('T')[0];
  return `<li class="ship-item">
        ${renderStatusPill({ state: 'done', variant: 'bare', className: 'ship-icon' })}
        <div class="ship-body">
          <span class="ship-title">${state}${escapeHtml(item.title)}</span>
          <span class="ship-meta"><span class="ship-project">${escapeHtml(item.projectName)}</span> · <span class="ship-date">${escapeHtml(date)}</span></span>
        </div>
      </li>`;
}

/** Collapsible "Recently shipped"; `open` is the recap fallback when AI is off. */
function renderShipped({ total, buckets }, open) {
  const openAttr = open ? ' open' : '';
  if (total === 0) {
    return `<details class="roadmap-section roadmap-ship-log"${openAttr}>
      <summary class="roadmap-section-heading">Recently shipped</summary>
      ${renderEmptyState({ tag: 'p', className: 'roadmap-empty', text: 'No completions in the last 90 days.' })}
    </details>`;
  }

  const renderBucket = ({ label, items }) => {
    const shown = items.slice(0, SHIP_BUCKET_LIMIT).map(renderShipItem).join('\n      ');
    const overflow = items.slice(SHIP_BUCKET_LIMIT);
    const more = overflow.length > 0
      ? `<details class="ship-more">
          <summary>Show ${overflow.length} more</summary>
          <ul class="ship-list ship-list--hidden">
            ${overflow.map(renderShipItem).join('\n      ')}
          </ul>
        </details>`
      : '';
    return `<div class="ship-bucket">
      <h3 class="ship-bucket-heading">${escapeHtml(label)} <span class="ship-count">(${items.length})</span></h3>
      <ul class="ship-list">
        ${shown}
      </ul>
      ${more}
    </div>`;
  };

  return `<details class="roadmap-section roadmap-ship-log"${openAttr}>
    <summary class="roadmap-section-heading">Recently shipped <span class="roadmap-section-total">(${total} in 90 days)</span></summary>
    ${buckets.map(renderBucket).join('\n')}
  </details>`;
}

function renderTask(task) {
  if (!(task.subtasks && task.subtasks.length > 0)) {
    return `<div class="roadmap-task-item">${taskLine(task)}</div>`;
  }
  const rollup = task.rollup || {};
  const children = task.subtasks.map((sub, i) =>
    `<div class="roadmap-task-child">${branch(i, task.subtasks.length)} ${taskLine(sub)}</div>`
  ).join('\n        ');
  return `<div class="roadmap-task-parent">${taskLine(task)} <span class="task-rollup">(${num(rollup.subtaskDone || 0)}/${num(rollup.subtaskTotal || task.subtasks.length)} subtasks)</span>
        <div class="roadmap-task-children">
        ${children}
        </div>
      </div>`;
}

function renderCriticalPath(path) {
  const items = path.items.map((item, i) =>
    `<div class="roadmap-path-item">${branch(i, path.items.length)} ${taskLine(item)}</div>`
  ).join('\n      ');
  return `<div class="roadmap-critical-path">
      <div class="roadmap-tree-heading">│ critical path (${num(path.depth)} deep)</div>
      ${items}
    </div>`;
}

function renderRisks(risks) {
  // Tight join: no whitespace between risk rows (a space vs none is observable; LIN-3566).
  const rows = risks.map(risk => {
    const severity = escapeHtml(risk.severity || 'medium');
    const accentBar = renderAccentBar({
      state: pick(RISK_ACCENTS, risk.severity, 'running'),
      orientation: 'vertical',
      label: `${severity} risk`
    });
    return `<div class="roadmap-risk roadmap-risk--${severity}">${accentBar}<span class="roadmap-risk-body"><span class="roadmap-risk-sev">${severity}</span> ${escapeHtml(risk.description)}</span></div>`;
  }).join('');
  return `<div class="roadmap-risks">
      <div class="roadmap-tree-heading">│ risks</div>
      ${rows}
    </div>`;
}

/**
 * Project card (LIN-855): a proportional 20-cell segment bar filled
 * round(done/total*20) — the first `filled` cells read `done`, the rest are the
 * neutral track — plus current-state work only. Tight (no-whitespace) joins in
 * the body are deliberate: the CSS and client address these blocks as adjacent
 * siblings.
 */
function renderProject(view) {
  const cells = Array.from({ length: PROGRESS_CELLS }, (_, i) => ({ state: i < view.filled ? 'done' : 'empty' }));
  const bar = renderSegmentBar({ segments: cells, ariaLabel: `${view.pct}% complete`, className: 'roadmap-progress-bar' });

  const description = escapeHtml(view.description);
  const descriptionHtml = description ? `<div class="roadmap-milestone-desc">${description}</div>` : '';

  const activeHtml = view.active.length > 0
    ? `<div class="roadmap-task-tree">
      <div class="roadmap-tree-heading">│ in progress (${view.active.length})</div>
      ${view.active.map(renderTask).join('\n      ')}
    </div>`
    : '';

  const upcomingHtml = view.upcoming.length > 0
    ? `<details class="roadmap-upcoming">
      <summary>Show ${view.upcoming.length} upcoming task${view.upcoming.length === 1 ? '' : 's'}</summary>
      <div class="roadmap-task-tree roadmap-task-tree--upcoming">
        ${view.upcoming.map(renderTask).join('\n        ')}
      </div>
    </details>`
    : '';

  const pathHtml = view.path ? renderCriticalPath(view.path) : '';
  const risksHtml = view.risks.length > 0 ? renderRisks(view.risks) : '';

  return renderCard({
    accent: view.accent,
    title: `<span class="roadmap-milestone-name">${escapeHtml(view.name || 'Untitled')}</span>`,
    meta: `${num(view.pct)}% · ${num(view.done)}/${num(view.total)} done`,
    body: `${descriptionHtml}
    <div class="roadmap-milestone-progress">${bar}</div>
    ${activeHtml}${upcomingHtml}${pathHtml}${risksHtml}`,
    className: 'roadmap-milestone-card',
    attrs: `data-milestone-name="${escapeHtml(view.name)}"`
  });
}

function renderProjects(views) {
  if (views.length === 0) return '';
  // No whitespace at the edges of .roadmap-milestone-cards: CSS :first-child/:last-child and the client address the cards directly (LIN-3566).
  return `<details class="roadmap-section roadmap-milestones">
        <summary class="roadmap-section-heading">By project</summary>
        <div class="roadmap-milestone-cards">${views.map(renderProject).join('\n')}</div>
      </details>`;
}

function renderLayer({ id, heading, modifier, collapsible = true }) {
  const cls = `roadmap-layer${modifier ? ' ' + modifier : ''}`;
  const tag = collapsible ? 'details' : 'div';
  const headingHtml = collapsible
    ? `<summary class="roadmap-layer-heading">${heading}</summary>`
    : `<h3 class="roadmap-layer-heading">│ ${heading}</h3>`;
  return `
        <${tag} class="${cls}" data-layer="${id}" data-state="idle">
          ${headingHtml}
          <div class="roadmap-layer-status"></div>
          <div class="roadmap-layer-content"></div>
        </${tag}>`;
}

/**
 * Per-request model override (LIN-819): a curated select to pick a stronger
 * model for just this reading. The empty "Workspace default" option keeps the
 * workspace-wide default (server uses resolveWorkspaceModel). Pricing (LIN-993)
 * rides as a data-attribute, never option text; the hint span stays empty so
 * `.roadmap-model-price:empty` hides it for the default option.
 */
function renderModelSelector(optionsHtml) {
  return `<label class="roadmap-model-select-label">
          <span class="roadmap-model-select-text">Model</span>
          <select class="roadmap-model-select" id="roadmap-model-select" aria-label="AI model for this reading">${optionsHtml}</select>
          <span class="roadmap-model-price" id="roadmap-model-price" data-model-price></span>
        </label>`;
}

/** The Reading section: populated client-side, hidden without AI. */
function renderReading({ hasAI, modelOptionsHtml }) {
  const layers = READING_LAYERS.map(layer => layer.fork
    ? `
      <div class="roadmap-fork">
        ${layer.fork.map(renderLayer).join('')}
      </div>`
    : renderLayer(layer)
  ).join('');
  return `<section class="roadmap-section roadmap-pipeline${hasAI ? '' : ' hidden'}" id="roadmap-pipeline">
      <h2 class="roadmap-section-heading">Reading</h2>
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
        ${hasAI ? renderModelSelector(modelOptionsHtml) : ''}
        <p class="roadmap-orientation-note" id="roadmap-orientation-note" role="status" hidden></p>
      </div>
      <div class="roadmap-history" id="roadmap-history"><!-- past readings, populated client-side --></div>
      <div class="roadmap-history-viewing" id="roadmap-history-viewing" hidden></div>
      <details class="roadmap-orientation-result" id="roadmap-orientation-result" hidden>
        <summary class="roadmap-orientation-result-heading">Orientation bearings</summary>
        <div class="roadmap-orientation-result-body"><!-- per-task bearings, populated client-side --></div>
      </details>
      ${layers}
    </section>`;
}

function renderChat(hasAI) {
  return `<details class="roadmap-section roadmap-chat${hasAI ? '' : ' hidden'}" id="roadmap-chat">
      <summary class="roadmap-section-heading">Chat</summary>
      <div class="roadmap-chat-body"><!-- Populated by client-side JS when AI is available --></div>
    </details>`;
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
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], workspace, featureFlags = {}, availableModels = [], teams = [], selectedTeamId = null } = options;
  const {
    velocity = {},
    milestones = [],
    criticalPaths = new Map(),
    risks = [],
    executionQueue = []
  } = roadmapModel;

  const now = new Date();
  const hasAI = !!openRouterSource;

  // Mapped even without AI so a malformed `availableModels` fails the same way
  // with or without it (LIN-3566 K4 parity).
  // Tight join: <option>s sit directly inside <select> (LIN-3566).
  const modelOptionsHtml = [
    '<option value="">Workspace default</option>',
    ...availableModels.map(m => {
      const pricing = formatModelPricing(m);
      const priceAttr = pricing ? ` data-pricing="${escapeHtml(pricing)}"` : '';
      return `<option value="${escapeHtml(m.id)}"${priceAttr}>${escapeHtml(m.name)}</option>`;
    })
  ].join('');

  // Built on first use: only a path longer than 1 needs it.
  let issuesById = null;
  const issueById = () => (issuesById ??= new Map(executionQueue.map(i => [i.id, i])));

  const shipped = shippedFeed(milestones, now);
  const projects = milestones.map(m => projectView(m, { criticalPaths, issueById, risks }));
  const payload = clientPayload({ velocity, milestones, criticalPaths, risks, urlKey, hasAI });

  const header = renderHeader({
    workspaceName: workspace?.name || organizationName || '',
    today: now.toISOString().split('T')[0],
    tasksPerWeek: velocity.tasksPerWeek ?? 0
  });

  return renderPage({
    // || 'Linear' stays: LIN-3458 covers other pages only (LIN-3566 research §6).
    title: `Roadmap - ${escapeHtml(organizationName || 'Linear')}`,
    stylesheets: ['/style.css', '/roadmap.css'],
    nav: renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'roadmap', featureFlags }),
    embeddedData: { globalVar: '__ROADMAP_DATA__', value: payload },
    scripts: ['/common.js', '/roadmap.js'],
    content: `<main class="roadmap-page" data-url-key="${escapeHtml(urlKey || '')}">
    ${header}
    ${renderShipped(shipped, !hasAI)}
    ${renderProjects(projects)}
    ${renderReading({ hasAI, modelOptionsHtml })}
    ${renderChat(hasAI)}
  </main>
  ${renderPageFooter({ deployInfo, currentPage: '/roadmap', urlKey, openRouterSource, featureFlags })}`
  });
}
