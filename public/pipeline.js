/**
 * Pipeline Page Client-Side Logic
 *
 * Handles:
 * - Hydration from window.__PIPELINE_DATA__
 * - Polling loop (5s, visibility-gated)
 * - Cell diffing for active grid
 * - Queue rail + activity rail rendering
 * - Leaf detail overlay (recommend + dispatch controls)
 * - Parent detail overlay (container view)
 *
 * Loaded only on the /pipeline page. Requires common.js (provides escapeHtml).
 * See LIN-249.
 */

// ─── State ──────────────────────────────────────────────────────────────────

let pipelineData = null;
let pollId = null;
let overlayPollId = null;
let _visibilityHandler = null;
const POLL_MS = 5000;
const OVERLAY_POLL_MS = 2000;

/** @type {Map<string, HTMLElement>} identifier → cell DOM node */
const cellMap = new Map();

/** Tracked overlay handlers for cleanup (prevent accumulation on re-render) */
let _overlayEscHandler = null;
let _overlayClickHandler = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STAGE_LABELS = {
  research: 'research',
  plan: 'plan',
  breakdown: 'breakdown',
  implementation: 'impl',
  review: 'review',
  blocked: 'blocked',
  bug: 'bug'
};

const STATE_INDICATORS = {
  queued: { symbol: '○', css: 'state-queued' },
  running: { symbol: '◐', css: 'state-running' },
  waiting: { symbol: '◑', css: 'state-waiting' },
  complete: { symbol: '✓', css: 'state-complete' },
  error: { symbol: '✕', css: 'state-error' }
};

function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || '—';
}

function stateIndicator(agentState) {
  return STATE_INDICATORS[agentState] || STATE_INDICATORS.queued;
}

const VALID_HEALTH = new Set(['green', 'amber', 'red']);
function safeHealth(color) {
  return VALID_HEALTH.has(color) ? color : 'green';
}

function progressSegClass(loop) {
  const fs = loop.foremanStatus;
  if (fs === 'completed') return 'seg-complete';
  if (fs === 'failed') return 'seg-error';
  if (fs === 'blocked') return 'seg-waiting';
  const as = loop.agentState;
  if (as === 'complete') return 'seg-complete';
  if (as === 'error') return 'seg-error';
  if (as === 'waiting') return 'seg-waiting';
  if (as === 'running') return 'seg-running';
  return 'seg-neutral';
}

function renderProgressBar(loops) {
  if (!loops || loops.length === 0) return '';
  const segs = loops.map(l =>
    `<div class="progress-seg ${progressSegClass(l)}"></div>`
  ).join('');
  return `<div class="cell-progress">${segs}</div>`;
}

// ─── Grid cell rendering ────────────────────────────────────────────────────

function renderCell(task) {
  const el = document.createElement('div');
  el.className = `pipeline-cell health-${safeHealth(task.healthColor)}`;
  el.dataset.identifier = task.identifier;
  if (task.agentState) el.dataset.agentState = task.agentState;

  const si = stateIndicator(task.agentState);

  // Parent chain tag
  let parentTag = '';
  if (task.parentChain && task.parentChain.length > 0) {
    const p = task.parentChain[0];
    parentTag = `<button class="cell-parent-tag" data-parent-id="${escapeHtml(p.identifier)}" title="${escapeHtml(p.title)}">◀ ${escapeHtml(p.identifier)}</button>`;
  }

  const health = safeHealth(task.healthColor);

  el.innerHTML = `
    ${parentTag}
    <div class="cell-header">
      <span class="cell-health health-${health}">●</span>
      <span class="cell-id">${escapeHtml(task.identifier)}</span>
      <span class="cell-loops health-${health}">×${task.loopCount || 0}</span>
    </div>
    <div class="cell-title">${escapeHtml(task.title || '')}</div>
    <div class="cell-footer">
      <span class="cell-stage cell-stage-badge">${escapeHtml(stageLabel(task.currentStage))}</span>
      <span class="cell-state ${si.css}">${si.symbol}</span>
    </div>
    ${renderProgressBar(task.loops)}
  `;

  // Click cell → leaf detail overlay
  el.addEventListener('click', (e) => {
    if (e.target.closest('.cell-parent-tag')) return;
    openLeafOverlay(task.identifier);
  });

  // Click parent tag → parent detail overlay
  const parentBtn = el.querySelector('.cell-parent-tag');
  if (parentBtn) {
    parentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openParentOverlay(parentBtn.dataset.parentId);
    });
  }

  return el;
}

function updateCell(el, task) {
  const si = stateIndicator(task.agentState);
  const health = safeHealth(task.healthColor);
  el.className = `pipeline-cell health-${health}`;
  if (task.agentState) el.dataset.agentState = task.agentState;

  const healthDot = el.querySelector('.cell-health');
  if (healthDot) healthDot.className = `cell-health health-${health}`;
  const loopsEl = el.querySelector('.cell-loops');
  if (loopsEl) {
    loopsEl.textContent = `×${task.loopCount || 0}`;
    loopsEl.className = `cell-loops health-${health}`;
  }
  const titleEl = el.querySelector('.cell-title');
  if (titleEl) titleEl.textContent = task.title || '';
  const stageEl = el.querySelector('.cell-stage');
  if (stageEl) stageEl.textContent = stageLabel(task.currentStage);
  const stateEl = el.querySelector('.cell-state');
  if (stateEl) {
    stateEl.textContent = si.symbol;
    stateEl.className = `cell-state ${si.css}`;
  }
  // Update progress bar
  const existingProgress = el.querySelector('.cell-progress');
  if (existingProgress) existingProgress.remove();
  const progressHtml = renderProgressBar(task.loops);
  if (progressHtml) el.insertAdjacentHTML('beforeend', progressHtml);
}

// ─── Grid diffing ───────────────────────────────────────────────────────────

function diffGrid(activeTasks) {
  const grid = document.getElementById('pipeline-grid');
  const empty = document.getElementById('pipeline-grid-empty');
  if (!grid) return;

  const newIds = new Set(activeTasks.map(t => t.identifier));
  const taskMap = new Map(activeTasks.map(t => [t.identifier, t]));

  // Remove cells no longer in active
  for (const [id, el] of cellMap) {
    if (!newIds.has(id)) {
      el.remove();
      cellMap.delete(id);
    }
  }

  // Update existing or add new
  for (const task of activeTasks) {
    const existing = cellMap.get(task.identifier);
    if (existing) {
      updateCell(existing, task);
    } else {
      const el = renderCell(task);
      el.classList.add('cell-new');
      grid.appendChild(el);
      cellMap.set(task.identifier, el);
      // Remove highlight after animation
      setTimeout(() => el.classList.remove('cell-new'), 1500);
    }
  }

  // Toggle empty state
  if (empty) empty.classList.toggle('hidden', activeTasks.length > 0);
}

// ─── Queue rail ─────────────────────────────────────────────────────────────

function renderQueue(queueTasks) {
  const list = document.getElementById('pipeline-queue-list');
  const empty = document.getElementById('pipeline-queue-empty');
  if (!list) return;

  if (queueTasks.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  list.innerHTML = queueTasks.slice(0, 20).map((task, i) => {
    const nextClass = i === 0 ? ' queue-next' : '';
    const prio = task.priority ?? 0;
    return `<li class="queue-entry${nextClass}" data-identifier="${escapeHtml(task.identifier)}" data-priority="${prio}">
      <span class="queue-id">${escapeHtml(task.identifier)}</span>
      <span class="queue-title">${escapeHtml(task.title || '')}</span>
    </li>`;
  }).join('');
}

// ─── Activity rail ──────────────────────────────────────────────────────────

function renderActivity(recentLoops) {
  const list = document.getElementById('pipeline-activity-list');
  const empty = document.getElementById('pipeline-activity-empty');
  if (!list) return;

  if (recentLoops.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  list.innerHTML = recentLoops.slice(0, 30).map(loop => {
    const si = stateIndicator(loop.agentState);
    const time = relativeTime(loop.resolvedAt || loop.dispatchedAt);
    return `<li class="activity-entry">
      <span class="activity-state ${si.css}">${si.symbol}</span>
      <span class="activity-id">${escapeHtml(loop.issueIdentifier || '')}</span>
      <span class="activity-stage">${escapeHtml(stageLabel(loop.stage))}</span>
      <span class="activity-time">${time}</span>
    </li>`;
  }).join('');
}

// ─── Timestamp ──────────────────────────────────────────────────────────────

function updateFetchedAt(fetchedAt) {
  const el = document.getElementById('pipeline-fetched-at');
  if (el && fetchedAt) {
    el.textContent = `fetched: ${relativeTime(fetchedAt)}`;
    el.dataset.fetchedAt = fetchedAt;
  }
}

// ─── Counts and status summary ─────────────────────────────────────────────

function updateCounts(snapshot) {
  const queue = snapshot.queue || [];
  const active = snapshot.active || [];
  const recent = snapshot.recent || [];

  const queueEl = document.getElementById('pipeline-queue-count');
  if (queueEl) queueEl.textContent = queue.length > 0 ? `· ${queue.length} ` : '';

  const activeEl = document.getElementById('pipeline-active-count');
  if (activeEl) activeEl.textContent = active.length > 0 ? `· ${active.length} ` : '';

  const activityEl = document.getElementById('pipeline-activity-count');
  if (activityEl) activityEl.textContent = recent.length > 0 ? `· ${recent.length} ` : '';

  const statusEl = document.getElementById('pipeline-status');
  if (statusEl) {
    const running = active.filter(t => t.agentState === 'running').length;
    if (running > 0) {
      statusEl.textContent = `● ${running} running`;
      statusEl.className = 'pipeline-header-status status-running';
    } else if (active.length > 0) {
      statusEl.textContent = `○ ${active.length} active`;
      statusEl.className = 'pipeline-header-status status-active';
    } else {
      statusEl.textContent = '';
      statusEl.className = 'pipeline-header-status';
    }
  }
}

// ─── Full render from snapshot ──────────────────────────────────────────────

function renderSnapshot(snapshot) {
  diffGrid(snapshot.active || []);
  renderQueue(snapshot.queue || []);
  renderActivity(snapshot.recent || []);
  updateFetchedAt(snapshot.fetchedAt);
  updateCounts(snapshot);
}

// ─── Polling ────────────────────────────────────────────────────────────────

async function pollState() {
  if (!pipelineData) return;
  const urlKey = pipelineData.urlKey;
  if (!urlKey) return;

  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/pipeline/state`);
    if (res.status === 401) {
      window.location.href = '/logout';
      return;
    }
    if (!res.ok) return;

    const snapshot = await res.json();
    renderSnapshot(snapshot);
  } catch (e) {
    console.warn('Pipeline poll failed:', e);
  }
}

function startPolling() {
  pollId = setInterval(() => {
    if (!document.hidden) pollState();
  }, POLL_MS);

  // Immediate re-fetch when tab becomes visible (tracked for cleanup)
  _visibilityHandler = () => { if (!document.hidden) pollState(); };
  document.addEventListener('visibilitychange', _visibilityHandler);
}

// ─── Overlay: shared infrastructure ─────────────────────────────────────────

function getOverlayEl() {
  return document.getElementById('pipeline-overlay');
}

function removeOverlayHandlers() {
  if (_overlayEscHandler) {
    document.removeEventListener('keydown', _overlayEscHandler);
    _overlayEscHandler = null;
  }
  if (_overlayClickHandler) {
    const overlay = getOverlayEl();
    if (overlay) overlay.removeEventListener('click', _overlayClickHandler);
    _overlayClickHandler = null;
  }
}

function closeOverlay() {
  removeOverlayHandlers();
  const overlay = getOverlayEl();
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = '';
  document.body.classList.remove('overlay-open');
  if (overlayPollId) {
    clearInterval(overlayPollId);
    overlayPollId = null;
  }
}

function showOverlay(html) {
  // Clean up any previously tracked handlers before re-adding
  removeOverlayHandlers();

  const overlay = getOverlayEl();
  if (!overlay) return;
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overlay-open');

  // Close button
  const closeBtn = overlay.querySelector('.overlay-close');
  if (closeBtn) closeBtn.addEventListener('click', closeOverlay);

  // Escape key (tracked for cleanup)
  _overlayEscHandler = (e) => {
    if (e.key === 'Escape') closeOverlay();
  };
  document.addEventListener('keydown', _overlayEscHandler);

  // Click outside content to close (tracked for cleanup)
  _overlayClickHandler = (e) => {
    if (e.target === overlay) closeOverlay();
  };
  overlay.addEventListener('click', _overlayClickHandler);
}

// ─── Overlay: leaf detail ───────────────────────────────────────────────────

function renderLoopEntry(loop, isLatest) {
  const si = stateIndicator(loop.agentState);
  const time = relativeTime(loop.dispatchedAt);
  const pulseClass = (isLatest && loop.agentState === 'running') ? ' loop-pulse' : '';

  let feedbackHtml = '';
  if (loop.feedback && loop.feedback.length > 0) {
    feedbackHtml = loop.feedback.map((f, i) => {
      const prefix = i === loop.feedback.length - 1 ? '└─' : '├─';
      const fTime = relativeTime(f.timestamp);
      return `<div class="loop-feedback-entry">${prefix} ${escapeHtml(f.message || '')} <span class="loop-feedback-time">· ${fTime}</span></div>`;
    }).join('');
    feedbackHtml = `<div class="loop-feedback">${feedbackHtml}</div>`;
  }

  let summaryHtml = '';
  if (loop.foremanSummary) {
    summaryHtml = `<div class="loop-summary">${escapeHtml(loop.foremanSummary)}</div>`;
  }

  return `
    <div class="loop-entry${pulseClass}" data-agent-state="${escapeHtml(loop.agentState || '')}">
      <div class="loop-header">
        <span class="loop-state ${si.css}">${si.symbol}</span>
        <span class="loop-stage">${escapeHtml(stageLabel(loop.stage))}</span>
        <span class="loop-prompt-name">${escapeHtml(loop.promptName || '')}</span>
        <span class="loop-time">${time}</span>
      </div>
      ${summaryHtml}
      ${feedbackHtml}
    </div>
  `;
}

function renderLeafOverlayContent(task) {
  const si = stateIndicator(task.agentState);
  const loops = task.loops || [];

  const loopsHtml = loops.length > 0
    ? loops.map((l, i) => renderLoopEntry(l, i === 0)).join('')
    : '<div class="overlay-empty">No loops yet</div>';

  // Operator controls state machine
  let controlsHtml = '';
  if (!task.agentState || task.agentState === 'complete' || task.agentState === 'error') {
    controlsHtml = `
      <div class="overlay-controls">
        <button class="overlay-btn overlay-recommend" data-identifier="${escapeHtml(task.identifier)}">generate next prompt</button>
      </div>
      <div class="overlay-recommend-result hidden" id="overlay-recommend-result"></div>
      <div class="overlay-dispatch-controls hidden" id="overlay-dispatch-controls"></div>
    `;
  } else if (task.agentState === 'queued') {
    controlsHtml = `<div class="overlay-controls"><span class="overlay-waiting">○ queued — waiting for agent</span></div>`;
  } else if (task.agentState === 'running' || task.agentState === 'waiting') {
    controlsHtml = `<div class="overlay-controls"><span class="overlay-waiting">◐ agent running</span></div>`;
  }

  return `
    <div class="overlay-content overlay-leaf">
      <div class="overlay-header">
        <div class="overlay-header-left">
          <span class="overlay-id">${escapeHtml(task.identifier)}</span>
          <span class="overlay-title">${escapeHtml(task.title || '')}</span>
        </div>
        <button class="overlay-close" aria-label="Close">×</button>
      </div>
      <div class="overlay-meta">
        <span class="overlay-stage">${escapeHtml(stageLabel(task.currentStage))}</span>
        <span class="overlay-loops-count health-${safeHealth(task.healthColor)}">${task.loopCount || 0} loops</span>
        <span class="overlay-state ${si.css}">${si.symbol} ${escapeHtml(task.agentState || 'idle')}</span>
        ${task.url ? `<a class="overlay-linear-link" href="${escapeHtml(task.url)}" target="_blank">view on linear</a>` : ''}
      </div>
      ${controlsHtml}
      <div class="overlay-loops">
        <h3 class="overlay-section-title">│ loop history │</h3>
        ${loopsHtml}
      </div>
      <div class="overlay-git-placeholder">git integration: pending</div>
    </div>
  `;
}

async function openLeafOverlay(identifier) {
  closeOverlay();

  const urlKey = pipelineData?.urlKey;
  if (!urlKey) return;

  // Show loading state
  showOverlay(`
    <div class="overlay-content overlay-leaf">
      <div class="overlay-header">
        <span class="overlay-id">${escapeHtml(identifier)}</span>
        <button class="overlay-close" aria-label="Close">×</button>
      </div>
      <div class="overlay-loading">loading...</div>
    </div>
  `);

  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/pipeline/task/${encodeURIComponent(identifier)}`);
    if (!res.ok) throw new Error('Failed to fetch task');
    const task = await res.json();

    showOverlay(renderLeafOverlayContent(task));
    wireOverlayControls(task, urlKey);

    // Start overlay polling
    overlayPollId = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/pipeline/task/${encodeURIComponent(identifier)}`);
        if (!r.ok) return;
        const updated = await r.json();
        const overlay = getOverlayEl();
        if (!overlay || overlay.classList.contains('hidden')) return;
        showOverlay(renderLeafOverlayContent(updated));
        wireOverlayControls(updated, urlKey);
      } catch (e) { /* ignore refresh errors */ }
    }, OVERLAY_POLL_MS);
  } catch (e) {
    console.error('Failed to open leaf overlay:', e);
    showOverlay(`
      <div class="overlay-content overlay-leaf">
        <div class="overlay-header">
          <span class="overlay-id">${escapeHtml(identifier)}</span>
          <button class="overlay-close" aria-label="Close">×</button>
        </div>
        <div class="overlay-error">Failed to load task details</div>
      </div>
    `);
  }
}

// ─── Overlay: operator controls (recommend → dispatch) ──────────────────────

function wireOverlayControls(task, urlKey) {
  const overlay = getOverlayEl();
  if (!overlay) return;

  const recommendBtn = overlay.querySelector('.overlay-recommend');
  if (recommendBtn) {
    recommendBtn.addEventListener('click', async () => {
      recommendBtn.textContent = 'generating...';
      recommendBtn.disabled = true;

      try {
        const recRes = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/recommendations/${encodeURIComponent(task.identifier)}`);
        if (recRes.status === 401) {
          window.location.href = '/logout';
          return;
        }
        if (!recRes.ok) throw new Error('Recommend failed');

        const data = await recRes.json();
        const prompt = data.recommendation || data.prompt || '';
        const promptName = data.promptName || data.templateKey || 'ai-recommend';

        const resultEl = overlay.querySelector('#overlay-recommend-result');
        const dispatchEl = overlay.querySelector('#overlay-dispatch-controls');
        if (resultEl) {
          resultEl.classList.remove('hidden');
          resultEl.innerHTML = `
            <div class="recommend-prompt">
              <h4 class="recommend-label">│ recommended prompt │</h4>
              <pre class="recommend-text">${escapeHtml(prompt)}</pre>
            </div>
          `;
        }
        if (dispatchEl) {
          dispatchEl.classList.remove('hidden');
          dispatchEl.innerHTML = `
            <button class="overlay-btn overlay-dispatch" data-prompt-name="${escapeHtml(promptName)}">dispatch to agent</button>
          `;
          const dispatchBtn = dispatchEl.querySelector('.overlay-dispatch');
          if (dispatchBtn) {
            dispatchBtn.addEventListener('click', async () => {
              dispatchBtn.textContent = 'dispatching...';
              dispatchBtn.disabled = true;
              try {
                const dRes = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt,
                    promptName,
                    target: task.identifier
                  })
                });
                if (!dRes.ok) throw new Error('Dispatch failed');
                dispatchBtn.textContent = 'dispatched!';
                // Trigger a poll to refresh the grid
                setTimeout(pollState, 1000);
              } catch (e) {
                console.error('Dispatch failed:', e);
                dispatchBtn.textContent = 'failed';
                setTimeout(() => {
                  if (dispatchBtn.isConnected) {
                    dispatchBtn.textContent = 'dispatch to agent';
                    dispatchBtn.disabled = false;
                  }
                }, 1500);
              }
            });
          }
        }

        recommendBtn.textContent = 'generate next prompt';
        recommendBtn.disabled = false;
      } catch (e) {
        console.error('Recommend failed:', e);
        recommendBtn.textContent = 'failed';
        setTimeout(() => {
          if (recommendBtn.isConnected) {
            recommendBtn.textContent = 'generate next prompt';
            recommendBtn.disabled = false;
          }
        }, 1500);
      }
    });
  }
}

// ─── Overlay: parent detail ─────────────────────────────────────────────────

async function openParentOverlay(identifier) {
  closeOverlay();

  const urlKey = pipelineData?.urlKey;
  if (!urlKey) return;

  showOverlay(`
    <div class="overlay-content overlay-parent">
      <div class="overlay-header">
        <span class="overlay-id">${escapeHtml(identifier)}</span>
        <button class="overlay-close" aria-label="Close">×</button>
      </div>
      <div class="overlay-loading">loading...</div>
    </div>
  `);

  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/pipeline/task/${encodeURIComponent(identifier)}`);
    if (!res.ok) throw new Error('Failed to fetch parent');
    const task = await res.json();

    const si = stateIndicator(task.agentState);
    const loops = task.loops || [];

    const loopsHtml = loops.length > 0
      ? loops.map((l, i) => renderLoopEntry(l, i === 0)).join('')
      : '<div class="overlay-empty">No loops for this parent</div>';

    // We don't have subtasks from the detail endpoint, but we can show loop history
    showOverlay(`
      <div class="overlay-content overlay-parent">
        <div class="overlay-header">
          <div class="overlay-header-left">
            <span class="overlay-id">${escapeHtml(task.identifier)}</span>
            <span class="overlay-title">${escapeHtml(task.title || '')}</span>
            <span class="overlay-badge">container</span>
          </div>
          <button class="overlay-close" aria-label="Close">×</button>
        </div>
        <div class="overlay-meta">
          <span class="overlay-loops-count health-${safeHealth(task.healthColor)}">${task.loopCount || 0} loops</span>
          <span class="overlay-state ${si.css}">${si.symbol} ${escapeHtml(task.agentState || 'idle')}</span>
          ${task.url ? `<a class="overlay-linear-link" href="${escapeHtml(task.url)}" target="_blank">view on linear</a>` : ''}
        </div>
        <div class="overlay-loops">
          <h3 class="overlay-section-title">│ loop history │</h3>
          ${loopsHtml}
        </div>
      </div>
    `);
  } catch (e) {
    console.error('Failed to open parent overlay:', e);
    showOverlay(`
      <div class="overlay-content overlay-parent">
        <div class="overlay-header">
          <span class="overlay-id">${escapeHtml(identifier)}</span>
          <button class="overlay-close" aria-label="Close">×</button>
        </div>
        <div class="overlay-error">Failed to load parent details</div>
      </div>
    `);
  }
}

// ─── Initialization ─────────────────────────────────────────────────────────

function init() {
  pipelineData = window.__PIPELINE_DATA__;
  if (!pipelineData || !pipelineData.snapshot) {
    console.warn('Pipeline: no initial data');
    return;
  }

  // Set up queue click delegation once (not per-render)
  const queueList = document.getElementById('pipeline-queue-list');
  if (queueList) {
    queueList.addEventListener('click', (e) => {
      const entry = e.target.closest('.queue-entry');
      if (entry) openLeafOverlay(entry.dataset.identifier);
    });
  }

  renderSnapshot(pipelineData.snapshot);
  startPolling();
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (pollId) { clearInterval(pollId); pollId = null; }
  if (overlayPollId) { clearInterval(overlayPollId); overlayPollId = null; }
  if (_visibilityHandler) { document.removeEventListener('visibilitychange', _visibilityHandler); _visibilityHandler = null; }
  removeOverlayHandlers();
});

document.addEventListener('DOMContentLoaded', init);
