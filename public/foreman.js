/**
 * Foreman Page Client-Side Logic
 *
 * Handles: token selection/generation, playbook loading, auto-refreshing status log,
 * stack preview with Linear links, status pagination, and copy affordances.
 */

/* global escapeHtml, maybeAppendProxyBlock */

(function () {
  'use strict';

  // DOM references
  const tokenSelect = document.getElementById('foreman-token-select');
  const generateBtn = document.getElementById('foreman-generate-btn');
  const copyBtn = document.getElementById('foreman-copy-btn');
  const playbookOutput = document.getElementById('foreman-playbook-output');
  const playbookFeedback = document.getElementById('foreman-playbook-feedback');
  const statusList = document.getElementById('foreman-status-list');
  const statusRefreshBtn = document.getElementById('foreman-status-refresh');
  const statusLive = document.getElementById('foreman-status-live');
  const statusPager = document.getElementById('foreman-status-pager');
  const statusMoreBtn = document.getElementById('foreman-status-more');
  const statusPagerInfo = document.getElementById('foreman-status-pager-info');
  const stackList = document.getElementById('foreman-stack-list');
  const stackRefreshBtn = document.getElementById('foreman-stack-refresh');

  const urlKey = tokenSelect?.dataset?.urlKey;
  if (!urlKey) return;

  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/proxy`;

  // State — kept in-memory so polling and copy reuse a single token per page load.
  let currentPlaybook = '';
  let currentToken = '';
  let statusOffset = 0;
  let statusTotal = 0;
  let pollTimer = null;
  const STATUS_PAGE_SIZE = 20;
  const POLL_INTERVAL_MS = 10000;
  const statusItems = []; // accumulates across load-more pages

  // =========================================================================
  // Token Loading & Generation
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
        playbookOutput.textContent = 'No read-write tokens yet. Click "generate" above to create one and load the playbook.';
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

  // Selecting an existing token cannot retrieve its raw secret (secrets are
  // hashed server-side and never returned on list). We show a hint nudging the
  // user to click "generate" to mint a fresh token they can actually use.
  if (tokenSelect) {
    tokenSelect.addEventListener('change', () => {
      if (currentToken) return; // already have a live token from generate
      playbookOutput.textContent = 'Existing tokens are hashed and their secrets are not retrievable. Click "generate" to mint a fresh read-write token and load the playbook.';
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
      // Refresh the token list so the newly-minted token appears selected.
      await loadTokens();
      if (tokenSelect && data.tokenId) tokenSelect.value = data.tokenId;

      // Kick off status/stack now that we have a token.
      await Promise.all([loadStatus({ reset: true }), loadStack()]);
      startPolling();
      showFeedback(playbookFeedback, 'Ready — click the output to copy', false);
    } catch (err) {
      showFeedback(playbookFeedback, `Failed: ${err.message}`, true);
    } finally {
      generateBtn.disabled = false;
    }
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', generateAndLoad);
  }

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
  }

  async function copyPlaybook() {
    if (!currentPlaybook) return;
    try {
      let text = currentPlaybook;
      if (typeof maybeAppendProxyBlock === 'function') {
        text = await maybeAppendProxyBlock(text, urlKey);
      }
      await navigator.clipboard.writeText(text);
      showFeedback(playbookFeedback, 'Copied ✓', false);
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
    playbookOutput.addEventListener('click', () => {
      if (currentPlaybook) copyPlaybook();
    });
    playbookOutput.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && currentPlaybook) {
        e.preventDefault();
        copyPlaybook();
      }
    });
  }

  // =========================================================================
  // Status Log (with pagination and auto-refresh)
  // =========================================================================

  async function loadStatus({ reset = false } = {}) {
    if (!statusList) return;
    if (!currentToken) {
      statusList.innerHTML = '<div class="foreman-status-empty">Generate a token above to start watching status.</div>';
      return;
    }

    if (reset) {
      statusOffset = 0;
      statusItems.length = 0;
    }

    try {
      const resp = await fetch(`/api/proxy/foreman/status?limit=${STATUS_PAGE_SIZE}&offset=${statusOffset}`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const items = data.items || [];
      statusTotal = typeof data.total === 'number' ? data.total : (statusOffset + items.length);

      if (reset) {
        statusItems.length = 0;
      }
      statusItems.push(...items);
      statusOffset = statusItems.length;

      renderStatus(statusItems);
      updateStatusPager();
    } catch {
      if (!statusItems.length) {
        statusList.innerHTML = '<div class="foreman-status-empty">Failed to load status — click refresh to retry.</div>';
      }
    }
  }

  function renderStatus(items) {
    if (!items.length) {
      statusList.innerHTML = '<div class="foreman-status-empty">No status entries yet — they\'ll appear here when a foreman agent reports progress.</div>';
      return;
    }

    statusList.innerHTML = items.map(item => {
      const statusClass = getStatusClass(item.status);
      const { relative, absolute } = formatTimestamp(item.timestamp);
      return `<div class="foreman-status-item">
        <span class="foreman-status-task">${escapeHtml(item.taskIdentifier)}</span>
        <span class="foreman-status-action">${escapeHtml(item.action)}</span>
        <span class="foreman-status-badge ${statusClass}">${escapeHtml(item.status)}</span>
        <span class="foreman-status-summary" title="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</span>
        <span class="foreman-status-time" title="${escapeHtml(absolute)}">${escapeHtml(relative)}</span>
      </div>`;
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

  function getStatusClass(status) {
    if (!status) return '';
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'done') return 'status-completed';
    if (s === 'in-progress' || s === 'started') return 'status-in-progress';
    if (s === 'failed' || s === 'error') return 'status-failed';
    if (s === 'blocked') return 'status-blocked';
    return '';
  }

  if (statusRefreshBtn) statusRefreshBtn.addEventListener('click', () => loadStatus({ reset: true }));
  if (statusMoreBtn) statusMoreBtn.addEventListener('click', () => loadStatus({ reset: false }));

  // =========================================================================
  // Stack Preview
  // =========================================================================

  async function loadStack() {
    if (!stackList) return;
    if (!currentToken) {
      stackList.innerHTML = '<div class="foreman-stack-empty">Generate a token above to load the stack.</div>';
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
      stackList.innerHTML = '<div class="foreman-stack-empty">Failed to load stack — click refresh to retry.</div>';
    }
  }

  function renderStack(tasks) {
    if (!tasks.length) {
      stackList.innerHTML = '<div class="foreman-stack-empty">No tasks in the stack.</div>';
      return;
    }

    stackList.innerHTML = tasks.map(task => {
      const stateType = task.state?.type || '';
      const stateClass = getStateClass(stateType);
      const labels = (task.labels || []).map(l => typeof l === 'string' ? l : l?.name).filter(Boolean).join(', ');
      const identifier = task.identifier || task.id;
      const linkOpen = task.url
        ? `<a class="foreman-stack-item foreman-stack-item-link" href="${escapeHtml(task.url)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(identifier)} in Linear">`
        : `<div class="foreman-stack-item">`;
      const linkClose = task.url ? `</a>` : `</div>`;
      return `${linkOpen}
        <span class="foreman-stack-identifier">${escapeHtml(identifier)}</span>
        <span class="foreman-stack-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
        <span class="foreman-stack-state ${stateClass}">${escapeHtml(stateType)}</span>
        ${labels ? `<span class="foreman-stack-labels">${escapeHtml(labels)}</span>` : ''}
      ${linkClose}`;
    }).join('');
  }

  function getStateClass(stateType) {
    if (!stateType) return '';
    if (stateType === 'started') return 'state-started';
    if (stateType === 'unstarted') return 'state-unstarted';
    if (stateType === 'backlog') return 'state-backlog';
    return '';
  }

  if (stackRefreshBtn) stackRefreshBtn.addEventListener('click', () => loadStack());

  // =========================================================================
  // Polling
  // =========================================================================

  function startPolling() {
    if (pollTimer) return;
    if (statusLive) statusLive.hidden = false;
    pollTimer = setInterval(() => {
      if (document.hidden) return; // skip work when tab is backgrounded
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

  function formatTimestamp(dateStr) {
    if (!dateStr) return { relative: '', absolute: '' };
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    let relative;
    if (mins < 1) relative = 'just now';
    else if (mins < 60) relative = `${mins}m ago`;
    else {
      const hours = Math.floor(mins / 60);
      if (hours < 24) relative = `${hours}h ago`;
      else relative = `${Math.floor(hours / 24)}d ago`;
    }
    const absolute = date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    return { relative, absolute };
  }

  // =========================================================================
  // Init
  // =========================================================================
  (async function init() {
    await loadTokens();
    // Auto-mint a fresh session token when the user already has at least one
    // read-write token (i.e. they've been here before). First-time visitors
    // get a clean empty state that nudges them to click "generate".
    if (tokenSelect && !tokenSelect.disabled) {
      generateAndLoad();
    }
  })();
})();
