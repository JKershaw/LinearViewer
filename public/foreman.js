/**
 * Foreman Page Client-Side Logic
 *
 * Observer-first live dashboard: active task card, timeline of status reports,
 * up-next stack, and a collapsible setup panel with the playbook.
 * Visual language mirrors the swipe page for consistency.
 */

/* global escapeHtml, maybeAppendProxyBlock */

(function () {
  'use strict';

  // DOM references
  const tokenSelect = document.getElementById('foreman-token-select');
  const generateBtn = document.getElementById('foreman-generate-btn');
  const autopilotBtn = document.getElementById('foreman-autopilot-btn');
  const copyBtn = document.getElementById('foreman-copy-btn');
  const playbookOutput = document.getElementById('foreman-playbook-output');
  const playbookFeedback = document.getElementById('foreman-playbook-feedback');
  const setupDetails = document.getElementById('foreman-setup');
  const setupHint = document.getElementById('foreman-setup-hint');
  const nowCard = document.getElementById('foreman-now-card');
  const liveIndicator = document.getElementById('foreman-live-indicator');
  const statusList = document.getElementById('foreman-status-list');
  const statusRefreshBtn = document.getElementById('foreman-status-refresh');
  const statusPager = document.getElementById('foreman-status-pager');
  const statusMoreBtn = document.getElementById('foreman-status-more');
  const statusPagerInfo = document.getElementById('foreman-status-pager-info');
  const stackList = document.getElementById('foreman-stack-list');
  const stackRefreshBtn = document.getElementById('foreman-stack-refresh');
  const sessionsSection = document.getElementById('foreman-sessions-section');
  const sessionsList = document.getElementById('foreman-sessions');
  const threadsSection = document.getElementById('foreman-threads-section');
  const threadsList = document.getElementById('foreman-threads');
  const filtersBar = document.getElementById('foreman-filters');
  const filterSessionChip = document.getElementById('foreman-filter-session');
  const filterSessionValue = document.getElementById('foreman-filter-session-value');
  const filterTaskChip = document.getElementById('foreman-filter-task');
  const filterTaskValue = document.getElementById('foreman-filter-task-value');

  const urlKey = tokenSelect?.dataset?.urlKey;
  if (!urlKey) return;

  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/proxy`;

  // Provider-aware display name for "Open {id} in {provider}" link titles
  // (LIN-177 S3). Injected on <body> by render-foreman.js; falls back to Linear.
  const providerName = document.body?.dataset?.providerName || 'Linear';

  // State — kept in-memory so polling reuses a single token per page load.
  let currentPlaybook = '';
  let currentToken = '';
  let statusOffset = 0;
  let statusTotal = 0;
  let pollTimer = null;
  const STATUS_PAGE_SIZE = 20;
  const POLL_INTERVAL_MS = 10000;
  const ACTIVE_SESSION_WINDOW_MS = 5 * 60 * 1000; // a session is "live" if it posted in the last 5 min
  const statusItems = [];
  const stackByIdentifier = new Map();
  let sessions = [];

  // Filter state (composable): session (tokenId) + taskIdentifier.
  // `null` in either slot means "no filter for that dimension".
  const filters = { tokenId: null, taskIdentifier: null };

  // =========================================================================
  // Visual helpers — adapted from public/swipe.js for consistency
  // =========================================================================

  // NOTE: Canonical source of truth for state display is lib/providers/state-map.js
  // (getStateDisplay). This browser copy is duplicated because the no-build-step
  // constraint (CLAUDE.md) prevents importing from lib/. Keep in sync; unifying
  // client+server is a candidate follow-up under LIN-174.
  function getStateInfo(stateType) {
    switch (stateType) {
      case 'completed':
      case 'canceled':
      case 'duplicate':
        return { char: '\u2713', cls: 'done', label: stateType };
      case 'started':
        return { char: '\u25D0', cls: 'in-progress', label: 'started' };
      case 'backlog':
        return { char: '\u25CC', cls: 'backlog', label: 'backlog' };
      default:
        return { char: '\u25CB', cls: 'todo', label: stateType || 'unstarted' };
    }
  }

  // Status entries use their own vocabulary (completed / in-progress / failed /
  // blocked / resume / continue / help / etc) — map them onto the same visual
  // language as swipe cards so observers read them at a glance.
  function getStatusVisual(status) {
    const s = (status || '').toLowerCase();
    if (s === 'completed' || s === 'complete' || s === 'done') {
      return { char: '\u2713', cls: 'done', label: status };
    }
    if (s === 'in-progress' || s === 'started' || s === 'resume' || s === 'continue') {
      return { char: '\u25D0', cls: 'in-progress', label: status };
    }
    if (s === 'failed' || s === 'error' || s === 'blocked' || s === 'help') {
      return { char: '\u2715', cls: 'failed', label: status };
    }
    return { char: '\u25CB', cls: 'todo', label: status };
  }

  function isActiveStatus(status) {
    const s = (status || '').toLowerCase();
    return s === 'in-progress' || s === 'started' || s === 'resume' || s === 'continue';
  }

  function renderPriorityDots(priority) {
    if (!priority || priority === 0) return '';
    const filled = Math.max(0, 5 - priority);
    const empty = 4 - filled;
    const priorityNames = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
    const name = priorityNames[priority] || '';
    return `<span class="priority-dots">` +
      `<span class="filled">${'\u25CF'.repeat(filled)}</span>` +
      `<span class="empty">${'\u25CB'.repeat(empty)}</span>` +
      `</span> ${escapeHtml(name)}`;
  }

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }

  function formatAbsoluteTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function normaliseLabels(labels) {
    if (!Array.isArray(labels)) return [];
    return labels
      .map(l => typeof l === 'string' ? l : (l && l.name))
      .filter(Boolean);
  }

  // =========================================================================
  // Tokens
  // =========================================================================

  async function loadTokens() {
    if (!tokenSelect) return;
    try {
      const resp = await fetch(`${apiBase}/tokens`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const tokens = (data.tokens || []).filter(t => t.scope === 'readWrite' && !t.consumed);

      if (!tokens.length) {
        tokenSelect.innerHTML = '<option value="">(no read-write tokens yet)</option>';
        tokenSelect.disabled = true;
        playbookOutput.textContent = 'No read-write tokens yet. Click "generate" to create one and load the playbook.';
        return;
      }

      tokenSelect.innerHTML = tokens.map(t =>
        `<option value="${escapeHtml(t.tokenId)}">${escapeHtml(t.label || 'unnamed')} [rw]</option>`
      ).join('');
      tokenSelect.disabled = false;
    } catch {
      tokenSelect.innerHTML = '<option value="">Failed to load tokens</option>';
      tokenSelect.disabled = true;
    }
  }

  if (tokenSelect) {
    tokenSelect.addEventListener('change', () => {
      if (currentToken) return;
      playbookOutput.textContent = 'Existing token secrets are not retrievable (they\'re hashed). Click "generate" to mint a fresh read-write token.';
      playbookOutput.classList.remove('has-content');
    });
  }

  async function generateAndLoad() {
    if (!generateBtn) return;
    generateBtn.disabled = true;
    showFeedback(playbookFeedback, 'Generating...', false, true);

    try {
      const resp = await fetch(`${apiBase}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'foreman-session', scope: 'readWrite', singleUse: false })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      currentToken = data.token;

      await loadPlaybook();
      await loadTokens();
      if (tokenSelect && data.tokenId) tokenSelect.value = data.tokenId;

      await Promise.all([
        loadSessions(),
        loadThreads(),
        loadStatus({ reset: true }),
        loadStack()
      ]);
      renderNow();
      renderFilters();
      startPolling();

      if (setupHint) setupHint.textContent = 'Playbook ready \u2713 — click output above to copy';
      // Auto-collapse Setup once a token is live so observers see the live view.
      if (setupDetails) setupDetails.open = false;
      showFeedback(playbookFeedback, 'Ready \u2713', false);
    } catch (err) {
      showFeedback(playbookFeedback, `Failed: ${err.message}`, true);
    } finally {
      generateBtn.disabled = false;
    }
  }

  if (generateBtn) generateBtn.addEventListener('click', generateAndLoad);

  // =========================================================================
  // Playbook
  // =========================================================================

  async function loadPlaybook() {
    if (!playbookOutput || !currentToken) return;
    playbookOutput.textContent = 'Loading playbook...';
    playbookOutput.classList.remove('has-content');
    if (copyBtn) copyBtn.disabled = true;

    const resp = await fetch('/api/proxy/foreman/playbook', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    if (!resp.ok) throw new Error(`Playbook HTTP ${resp.status}`);
    let playbook = await resp.text();
    playbook = playbook.replace(/YOUR_TOKEN/g, currentToken);

    currentPlaybook = playbook;
    playbookOutput.textContent = playbook;
    playbookOutput.classList.add('has-content');
    if (copyBtn) copyBtn.disabled = false;
    if (autopilotBtn) autopilotBtn.disabled = false;
  }

  // Load the general Autopilot kickoff into the same box (copy reuses the same
  // minted token). This is the "general autopilot" entry point on the foreman
  // page — orient off the stack and run the loop until it needs the human.
  async function loadAutopilot() {
    if (!playbookOutput || !currentToken) return;
    playbookOutput.textContent = 'Loading autopilot kickoff...';
    playbookOutput.classList.remove('has-content');
    if (copyBtn) copyBtn.disabled = true;

    try {
      const resp = await fetch('/api/proxy/autopilot/kickoff', {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (!resp.ok) throw new Error(`Autopilot HTTP ${resp.status}`);
      let kickoff = await resp.text();
      kickoff = kickoff.replace(/YOUR_TOKEN/g, currentToken);

      currentPlaybook = kickoff;
      playbookOutput.textContent = kickoff;
      playbookOutput.classList.add('has-content');
      if (copyBtn) copyBtn.disabled = false;
      showFeedback(playbookFeedback, 'Autopilot kickoff loaded ✓ — click output to copy', false);
    } catch (err) {
      showFeedback(playbookFeedback, `Failed: ${err.message}`, true);
      if (copyBtn) copyBtn.disabled = false;
    }
  }

  if (autopilotBtn) autopilotBtn.addEventListener('click', loadAutopilot);

  async function copyPlaybook() {
    if (!currentPlaybook) return;
    try {
      let text = currentPlaybook;
      if (typeof maybeAppendProxyBlock === 'function') {
        text = await maybeAppendProxyBlock(text, urlKey);
      }
      await navigator.clipboard.writeText(text);
      showFeedback(playbookFeedback, 'Copied \u2713', false);
      if (copyBtn) {
        copyBtn.classList.add('copied');
        setTimeout(() => copyBtn.classList.remove('copied'), 1500);
      }
    } catch {
      showFeedback(playbookFeedback, 'Copy failed — select manually', true);
    }
  }

  if (copyBtn) copyBtn.addEventListener('click', copyPlaybook);
  if (playbookOutput) {
    playbookOutput.addEventListener('click', () => { if (currentPlaybook) copyPlaybook(); });
    playbookOutput.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && currentPlaybook) {
        e.preventDefault();
        copyPlaybook();
      }
    });
  }

  // =========================================================================
  // Now working — the active task card
  // =========================================================================

  function renderNow() {
    if (!nowCard) return;
    if (!currentToken) {
      nowCard.innerHTML = '<div class="foreman-now-empty">Waiting for a token — generate one below to start watching.</div>';
      return;
    }

    // Find the most recent "active" status entry (in-progress / started / resume / continue).
    // Fall back to the most recent entry of any kind so observers always see *something*.
    const activeEntry = statusItems.find(e => isActiveStatus(e.status)) || statusItems[0];
    if (!activeEntry) {
      nowCard.innerHTML = '<div class="foreman-now-empty">No status entries yet — they\'ll appear here when the agent reports progress.</div>';
      return;
    }

    const visual = getStatusVisual(activeEntry.status);
    const task = stackByIdentifier.get(activeEntry.taskIdentifier);
    const title = task?.title || '';
    const titleHtml = title
      ? `<div class="foreman-now-title">${escapeHtml(title)}</div>`
      : '';

    const metaRows = [];
    metaRows.push(
      `<div class="foreman-meta-row">
        <span class="foreman-meta-label">Action</span>
        <span class="foreman-meta-value">${escapeHtml(activeEntry.action)}</span>
      </div>`
    );
    metaRows.push(
      `<div class="foreman-meta-row">
        <span class="foreman-meta-label">Status</span>
        <span class="foreman-meta-value"><span class="foreman-state ${visual.cls}">${visual.char}</span> ${escapeHtml(visual.label || activeEntry.status)}</span>
      </div>`
    );
    metaRows.push(
      `<div class="foreman-meta-row">
        <span class="foreman-meta-label">Updated</span>
        <span class="foreman-meta-value" title="${escapeHtml(formatAbsoluteTime(activeEntry.timestamp))}">${escapeHtml(formatRelativeTime(activeEntry.timestamp))}</span>
      </div>`
    );
    const projectName = task?.project?.name;
    if (projectName) {
      metaRows.push(
        `<div class="foreman-meta-row">
          <span class="foreman-meta-label">Project</span>
          <span class="foreman-meta-value">${escapeHtml(projectName)}</span>
        </div>`
      );
    }
    if (task?.priority && task.priority > 0) {
      metaRows.push(
        `<div class="foreman-meta-row">
          <span class="foreman-meta-label">Priority</span>
          <span class="foreman-meta-value">${renderPriorityDots(task.priority)}</span>
        </div>`
      );
    }
    const labels = normaliseLabels(task?.labels);
    if (labels.length) {
      const tagsHtml = labels.map(l => `<span class="foreman-label-tag">${escapeHtml(l)}</span>`).join('');
      metaRows.push(
        `<div class="foreman-meta-row">
          <span class="foreman-meta-label">Labels</span>
          <span class="foreman-meta-tags">${tagsHtml}</span>
        </div>`
      );
    }

    const identifier = activeEntry.taskIdentifier;
    const identifierHtml = task?.url
      ? `<a class="foreman-now-identifier" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(identifier)} in ${escapeHtml(providerName)}">${escapeHtml(identifier)}</a>`
      : `<span class="foreman-now-identifier">${escapeHtml(identifier)}</span>`;

    const summaryHtml = activeEntry.summary
      ? `<blockquote class="foreman-now-summary">${escapeHtml(activeEntry.summary)}</blockquote>`
      : '';

    nowCard.innerHTML = `
      <div class="foreman-card-accent ${visual.cls}"></div>
      <div class="foreman-card-inner">
        <div class="foreman-now-header">
          <span class="foreman-state ${visual.cls}" aria-hidden="true">${visual.char}</span>
          ${identifierHtml}
          <span class="foreman-now-action">${escapeHtml(activeEntry.action)}</span>
        </div>
        ${titleHtml}
        ${summaryHtml}
        <div class="foreman-meta">
          ${metaRows.join('')}
        </div>
      </div>`;
  }

  // =========================================================================
  // Timeline (status log, paginated)
  // =========================================================================

  function buildStatusQuery({ offset }) {
    const params = new URLSearchParams();
    params.set('limit', String(STATUS_PAGE_SIZE));
    params.set('offset', String(offset));
    if (filters.tokenId) params.set('tokenId', filters.tokenId);
    if (filters.taskIdentifier) params.set('taskIdentifier', filters.taskIdentifier);
    return params.toString();
  }

  async function loadStatus({ reset = false } = {}) {
    if (!statusList) return;
    if (!currentToken) {
      statusList.innerHTML = '<div class="foreman-empty">Generate a token to start watching.</div>';
      return;
    }

    if (reset) {
      statusOffset = 0;
      statusItems.length = 0;
    }

    try {
      const query = buildStatusQuery({ offset: statusOffset });
      const resp = await fetch(`/api/proxy/foreman/status?${query}`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = data.items || [];
      statusTotal = typeof data.total === 'number' ? data.total : (statusOffset + items.length);

      if (reset) statusItems.length = 0;
      statusItems.push(...items);
      statusOffset = statusItems.length;

      renderStatus(statusItems);
      renderNow();
      updateStatusPager();
    } catch {
      if (!statusItems.length) {
        statusList.innerHTML = '<div class="foreman-empty">Failed to load timeline — click refresh to retry.</div>';
      }
    }
  }

  function renderStatus(items) {
    if (!items.length) {
      statusList.innerHTML = '<div class="foreman-empty">No status entries yet — they\'ll appear here when the agent reports progress.</div>';
      return;
    }

    statusList.innerHTML = items.map(item => {
      const visual = getStatusVisual(item.status);
      const task = stackByIdentifier.get(item.taskIdentifier);
      const id = escapeHtml(item.taskIdentifier);
      const linkHtml = task?.url
        ? `<a class="foreman-timeline-identifier-link" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" title="Open ${id} in ${escapeHtml(providerName)}">\u2197</a>`
        : '';
      // The identifier is a filter-setting button; the arrow next to it opens the provider.
      const identifierHtml = `<button class="foreman-timeline-identifier" type="button" data-filter-task="${id}" title="Filter timeline to ${id}">${id}</button>${linkHtml}`;
      const sessionBadge = item.tokenLabel
        ? `<span class="foreman-timeline-session" title="Session token: ${escapeHtml(item.tokenLabel)}">${escapeHtml(item.tokenLabel)}</span>`
        : '';
      return `<article class="foreman-timeline-item ${visual.cls}">
        <span class="foreman-state ${visual.cls}" aria-hidden="true">${visual.char}</span>
        <div class="foreman-timeline-body">
          <div class="foreman-timeline-head">
            ${identifierHtml}
            <span class="foreman-timeline-action">${escapeHtml(item.action)}</span>
            <span class="foreman-timeline-status">${escapeHtml(visual.label || item.status)}</span>
            ${sessionBadge}
            <span class="foreman-timeline-time" title="${escapeHtml(formatAbsoluteTime(item.timestamp))}">${escapeHtml(formatRelativeTime(item.timestamp))}</span>
          </div>
          ${item.summary ? `<div class="foreman-timeline-summary">${escapeHtml(item.summary)}</div>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function updateStatusPager() {
    if (!statusPager) return;
    const hasMore = statusOffset < statusTotal;
    statusPager.hidden = statusTotal === 0;
    if (statusMoreBtn) statusMoreBtn.disabled = !hasMore;
    if (statusPagerInfo) {
      statusPagerInfo.textContent = statusTotal > 0
        ? `${statusItems.length} of ${statusTotal}`
        : '';
    }
  }

  if (statusRefreshBtn) statusRefreshBtn.addEventListener('click', () => loadStatus({ reset: true }));
  if (statusMoreBtn) statusMoreBtn.addEventListener('click', () => loadStatus({ reset: false }));

  // =========================================================================
  // Up next (stack) — swipe-card style
  // =========================================================================

  async function loadStack() {
    if (!stackList) return;
    if (!currentToken) {
      stackList.innerHTML = '<div class="foreman-empty">Generate a token to load the stack.</div>';
      return;
    }

    try {
      const resp = await fetch('/api/proxy/stack?limit=5', {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderStack(data.tasks || []);
    } catch {
      stackList.innerHTML = '<div class="foreman-empty">Failed to load stack — click refresh to retry.</div>';
    }
  }

  function renderStack(tasks) {
    stackByIdentifier.clear();
    for (const t of tasks) {
      if (t.identifier) stackByIdentifier.set(t.identifier, t);
    }

    if (!tasks.length) {
      stackList.innerHTML = '<div class="foreman-empty">No tasks in the stack.</div>';
      renderNow();
      return;
    }

    stackList.innerHTML = tasks.map((task, idx) => {
      const state = getStateInfo(task.state?.type);
      const identifier = task.identifier || task.id || '';
      const labels = normaliseLabels(task.labels);
      const labelsHtml = labels.length
        ? `<div class="foreman-stack-labels">${labels.map(l => `<span class="foreman-label-tag">${escapeHtml(l)}</span>`).join('')}</div>`
        : '';
      const priorityHtml = task.priority
        ? `<span class="foreman-stack-priority">${renderPriorityDots(task.priority)}</span>`
        : '';
      const projectName = task.project?.name;
      const projectHtml = projectName
        ? `<span class="foreman-stack-project">${escapeHtml(projectName)}</span>`
        : '';

      const linkOpen = task.url
        ? `<a class="foreman-stack-card foreman-stack-card-link" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(identifier)} in ${escapeHtml(providerName)}">`
        : `<div class="foreman-stack-card">`;
      const linkClose = task.url ? `</a>` : `</div>`;

      return `${linkOpen}
        <div class="foreman-card-accent ${state.cls}"></div>
        <div class="foreman-stack-card-inner">
          <div class="foreman-stack-head">
            <span class="foreman-state ${state.cls}" aria-hidden="true">${state.char}</span>
            <span class="foreman-stack-identifier">${escapeHtml(identifier)}</span>
            <span class="foreman-stack-position">${idx + 1} / ${tasks.length}</span>
          </div>
          <div class="foreman-stack-title">${escapeHtml(task.title || '')}</div>
          <div class="foreman-stack-meta">
            ${priorityHtml}
            ${projectHtml}
          </div>
          ${labelsHtml}
        </div>
      ${linkClose}`;
    }).join('');

    // Re-render the active card now that we have richer task context.
    renderNow();
  }

  if (stackRefreshBtn) stackRefreshBtn.addEventListener('click', () => loadStack());

  // =========================================================================
  // Sessions (per-token groupings)
  // =========================================================================

  async function loadSessions() {
    if (!sessionsList || !currentToken) return;
    try {
      const resp = await fetch('/api/proxy/foreman/sessions', {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      sessions = data.sessions || [];
      renderSessions();
    } catch {
      // Non-fatal: just don't show sessions. The timeline still works.
    }
  }

  function renderSessions() {
    if (!sessionsSection || !sessionsList) return;

    // Only show the section when there's more than one session worth distinguishing.
    if (sessions.length < 2) {
      sessionsSection.hidden = true;
      return;
    }
    sessionsSection.hidden = false;

    const now = Date.now();
    const chips = [
      `<button class="foreman-session-chip${!filters.tokenId ? ' is-selected' : ''}" type="button" data-token-id="" role="tab" aria-selected="${!filters.tokenId}">all sessions · ${sessions.reduce((a, s) => a + s.itemCount, 0)}</button>`
    ].concat(sessions.map(s => {
      const active = (now - new Date(s.lastSeen).getTime()) < ACTIVE_SESSION_WINDOW_MS;
      const selected = filters.tokenId === s.id;
      const visual = getStatusVisual(s.lastStatus);
      const label = s.label || (s.tokenId ? s.tokenId.slice(0, 8) : 'unattributed');
      const badge = active ? '<span class="foreman-session-live" title="Last update within 5 min">\u25CF live</span>' : '';
      return `<button class="foreman-session-chip${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}" type="button"
          data-token-id="${escapeHtml(s.id)}"
          role="tab"
          aria-selected="${selected}"
          title="Last: ${escapeHtml(s.lastAction || '')} · ${escapeHtml(s.lastStatus || '')} · ${escapeHtml(formatRelativeTime(s.lastSeen))}">
          <span class="foreman-state ${visual.cls}" aria-hidden="true">${visual.char}</span>
          <span class="foreman-session-chip-label">${escapeHtml(label)}</span>
          <span class="foreman-session-chip-count">${s.itemCount}</span>
          ${badge}
        </button>`;
    })).join('');

    sessionsList.innerHTML = chips;
  }

  if (sessionsList) {
    sessionsList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-token-id]');
      if (!btn) return;
      const raw = btn.getAttribute('data-token-id');
      setFilter('tokenId', raw || null);
    });
  }

  // =========================================================================
  // Task threads (per-identifier groupings)
  // =========================================================================

  async function loadThreads() {
    if (!threadsList || !currentToken) return;
    try {
      const params = new URLSearchParams();
      if (filters.tokenId) params.set('tokenId', filters.tokenId);
      const resp = await fetch(`/api/proxy/foreman/tasks${params.toString() ? '?' + params.toString() : ''}`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderThreads(data.tasks || []);
    } catch {
      // Non-fatal.
    }
  }

  function renderThreads(tasks) {
    if (!threadsSection || !threadsList) return;
    if (tasks.length < 2) {
      threadsSection.hidden = true;
      return;
    }
    threadsSection.hidden = false;

    // Cap to the 8 most-recent threads so the chip row stays scannable.
    const visible = tasks.slice(0, 8);
    threadsList.innerHTML = visible.map(t => {
      const selected = filters.taskIdentifier === t.taskIdentifier;
      const visual = getStatusVisual(t.lastStatus);
      return `<button class="foreman-thread-chip${selected ? ' is-selected' : ''}" type="button"
          data-task-identifier="${escapeHtml(t.taskIdentifier)}"
          title="${escapeHtml(t.lastAction || '')} · ${escapeHtml(t.lastStatus || '')} · ${escapeHtml(formatRelativeTime(t.lastSeen))}">
          <span class="foreman-state ${visual.cls}" aria-hidden="true">${visual.char}</span>
          <span class="foreman-thread-chip-id">${escapeHtml(t.taskIdentifier)}</span>
          <span class="foreman-thread-chip-count">${t.itemCount}</span>
        </button>`;
    }).join('');
  }

  if (threadsList) {
    threadsList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-task-identifier]');
      if (!btn) return;
      const id = btn.getAttribute('data-task-identifier');
      setFilter('taskIdentifier', filters.taskIdentifier === id ? null : id);
    });
  }

  // Any in-page "identifier" button (timeline) sets the task filter too.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter-task]');
    if (!btn) return;
    const id = btn.getAttribute('data-filter-task');
    setFilter('taskIdentifier', filters.taskIdentifier === id ? null : id);
  });

  // =========================================================================
  // Filter state + URL-hash persistence
  // =========================================================================

  function setFilter(key, value) {
    if (filters[key] === value) return;
    filters[key] = value;
    writeHash();
    renderFilters();
    renderSessions();
    // Task threads depend on the session filter (they're scoped), so reload.
    loadThreads();
    // Reload timeline with new filters; renderNow() runs off the returned data.
    loadStatus({ reset: true });
  }

  function renderFilters() {
    if (!filtersBar) return;
    const anyFilter = !!(filters.tokenId || filters.taskIdentifier);
    filtersBar.hidden = !anyFilter;
    if (filterSessionChip) {
      filterSessionChip.hidden = !filters.tokenId;
      if (filters.tokenId && filterSessionValue) {
        const s = sessions.find(x => x.id === filters.tokenId);
        filterSessionValue.textContent = s?.label || filters.tokenId;
      }
    }
    if (filterTaskChip) {
      filterTaskChip.hidden = !filters.taskIdentifier;
      if (filters.taskIdentifier && filterTaskValue) {
        filterTaskValue.textContent = filters.taskIdentifier;
      }
    }
  }

  if (filtersBar) {
    filtersBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-clear]');
      if (!btn) return;
      const which = btn.getAttribute('data-clear');
      if (which === 'session') setFilter('tokenId', null);
      if (which === 'task') setFilter('taskIdentifier', null);
    });
  }

  // URL hash: #session=<tokenId>&task=<identifier>
  // Persists filter selection across reloads and makes links shareable.
  function readHash() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.has('session')) filters.tokenId = params.get('session') || null;
    if (params.has('task')) filters.taskIdentifier = params.get('task') || null;
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (filters.tokenId) params.set('session', filters.tokenId);
    if (filters.taskIdentifier) params.set('task', filters.taskIdentifier);
    const next = params.toString();
    const want = next ? `#${next}` : '';
    if (location.hash !== want) {
      // Replace rather than push so the back button doesn't trap users on filter changes.
      history.replaceState(null, '', location.pathname + location.search + want);
    }
  }

  window.addEventListener('hashchange', () => {
    readHash();
    renderFilters();
    renderSessions();
    loadThreads();
    loadStatus({ reset: true });
  });

  // =========================================================================
  // Polling
  // =========================================================================

  function startPolling() {
    if (pollTimer) return;
    if (liveIndicator) liveIndicator.hidden = false;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      loadSessions();
      loadThreads();
      loadStatus({ reset: true });
      loadStack();
    }, POLL_INTERVAL_MS);
  }

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
  });

  // =========================================================================
  // Utilities
  // =========================================================================

  function showFeedback(el, msg, isError, persistent = false) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    if (!persistent && !isError) {
      setTimeout(() => { el.textContent = ''; el.classList.remove('error'); }, 3000);
    }
  }

  // =========================================================================
  // Init
  // =========================================================================
  (async function init() {
    readHash();
    renderFilters();
    await loadTokens();
    if (tokenSelect && !tokenSelect.disabled) {
      generateAndLoad();
    }
  })();
})();
