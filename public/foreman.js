/**
 * Foreman Page Client-Side Logic
 *
 * Handles: token selection, playbook loading/copy, status log display, stack preview.
 */

/* global escapeHtml, maybeAppendProxyBlock */

(function () {
  'use strict';

  // DOM references
  const tokenSelect = document.getElementById('foreman-token-select');
  const copyBtn = document.getElementById('foreman-copy-btn');
  const playbookOutput = document.getElementById('foreman-playbook-output');
  const playbookFeedback = document.getElementById('foreman-playbook-feedback');
  const statusList = document.getElementById('foreman-status-list');
  const statusRefreshBtn = document.getElementById('foreman-status-refresh');
  const stackList = document.getElementById('foreman-stack-list');
  const stackRefreshBtn = document.getElementById('foreman-stack-refresh');

  const urlKey = tokenSelect?.dataset?.urlKey;
  if (!urlKey) return;

  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/proxy`;
  let currentPlaybook = '';
  let currentToken = '';

  // =========================================================================
  // Token Loading & Selection
  // =========================================================================

  async function loadTokens() {
    if (!tokenSelect) return;

    try {
      const resp = await fetch(`${apiBase}/tokens`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const tokens = (data.tokens || []).filter(t => t.scope === 'readWrite' && !t.consumed);

      if (!tokens.length) {
        tokenSelect.innerHTML = '<option value="">No read-write tokens</option>';
        tokenSelect.disabled = true;
        playbookOutput.textContent = `No read-write tokens found.\nCreate one on the proxy page, then return here.`;
        return;
      }

      tokenSelect.innerHTML = tokens.map(t =>
        `<option value="${escapeHtml(t.tokenId)}" data-label="${escapeHtml(t.label)}">${escapeHtml(t.label || 'unnamed')} [rw]</option>`
      ).join('');
      tokenSelect.disabled = false;

      // Auto-load playbook with first token
      await loadPlaybook(tokens[0].tokenId);
    } catch {
      tokenSelect.innerHTML = '<option value="">Failed to load tokens</option>';
      tokenSelect.disabled = true;
    }
  }

  if (tokenSelect) {
    tokenSelect.addEventListener('change', () => {
      const tokenId = tokenSelect.value;
      if (tokenId) loadPlaybook(tokenId);
    });
  }

  // =========================================================================
  // Playbook Loading
  // =========================================================================

  async function loadPlaybook(tokenId) {
    if (!playbookOutput) return;

    playbookOutput.textContent = 'Loading playbook...';
    playbookOutput.classList.remove('has-content');
    if (copyBtn) copyBtn.disabled = true;

    try {
      // First, get the actual token value by fetching from token endpoint
      const tokenResp = await fetch(`${apiBase}/tokens`);
      if (!tokenResp.ok) throw new Error(`HTTP ${tokenResp.status}`);
      const tokenData = await tokenResp.json();
      const token = (tokenData.tokens || []).find(t => t.tokenId === tokenId);

      if (!token) throw new Error('Token not found');

      // We can't get the raw token value from the list API (it's masked).
      // Instead, we use the session-authed playbook endpoint via a proxy approach.
      // Actually, the playbook endpoint requires a Bearer token, not session auth.
      // We need to inform the user about the token situation.

      // The playbook replaces YOUR_TOKEN with the actual token value.
      // Since we can't retrieve the raw token from the list API, we fetch the playbook
      // using a different approach: we'll show the playbook with a placeholder and let
      // the user know to replace it, OR we create a fresh token for this purpose.

      // Simpler approach: create a dedicated token and use it to fetch the playbook
      const newTokenResp = await fetch(`${apiBase}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'foreman-playbook', scope: 'readWrite', singleUse: false })
      });

      if (!newTokenResp.ok) throw new Error('Failed to create token for playbook');
      const newTokenData = await newTokenResp.json();
      currentToken = newTokenData.token;

      // Fetch the playbook using the new token
      const playbookResp = await fetch('/api/proxy/foreman/playbook', {
        headers: { Authorization: `Bearer ${currentToken}` }
      });

      if (!playbookResp.ok) throw new Error(`HTTP ${playbookResp.status}`);
      let playbook = await playbookResp.text();

      // Replace YOUR_TOKEN placeholder with the actual token
      playbook = playbook.replace(/YOUR_TOKEN/g, currentToken);

      currentPlaybook = playbook;
      playbookOutput.textContent = playbook;
      playbookOutput.classList.add('has-content');
      if (copyBtn) copyBtn.disabled = false;

      // Also load status and stack using this token
      loadStatus(currentToken);
      loadStack(currentToken);
    } catch (err) {
      playbookOutput.textContent = `Failed to load playbook: ${err.message}`;
      currentPlaybook = '';
    }
  }

  // =========================================================================
  // Copy Playbook
  // =========================================================================

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!currentPlaybook) return;

      try {
        // Apply +proxy toggle if active
        let text = currentPlaybook;
        if (typeof maybeAppendProxyBlock === 'function') {
          text = await maybeAppendProxyBlock(text, urlKey);
        }

        await navigator.clipboard.writeText(text);
        showFeedback(playbookFeedback, 'Copied!', false);
      } catch {
        showFeedback(playbookFeedback, 'Copy failed', true);
      }
    });
  }

  // Click playbook output to copy
  if (playbookOutput) {
    playbookOutput.addEventListener('click', async () => {
      if (!currentPlaybook) return;
      try {
        let text = currentPlaybook;
        if (typeof maybeAppendProxyBlock === 'function') {
          text = await maybeAppendProxyBlock(text, urlKey);
        }
        await navigator.clipboard.writeText(text);
        showFeedback(playbookFeedback, 'Copied!', false);
      } catch {
        // selection fallback
      }
    });
  }

  // =========================================================================
  // Status Log
  // =========================================================================

  async function loadStatus(token) {
    if (!statusList) return;
    const bearerToken = token || currentToken;
    if (!bearerToken) {
      statusList.innerHTML = '<div class="foreman-status-empty">No token available</div>';
      return;
    }

    try {
      const resp = await fetch('/api/proxy/foreman/status?limit=20', {
        headers: { Authorization: `Bearer ${bearerToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderStatus(data.items || []);
    } catch {
      statusList.innerHTML = '<div class="foreman-status-empty">Failed to load status</div>';
    }
  }

  function renderStatus(items) {
    if (!items.length) {
      statusList.innerHTML = '<div class="foreman-status-empty">No status entries yet — they\'ll appear here when a foreman agent reports progress</div>';
      return;
    }

    statusList.innerHTML = items.map(item => {
      const statusClass = getStatusClass(item.status);
      return `<div class="foreman-status-item">
        <span class="foreman-status-task">${escapeHtml(item.taskIdentifier)}</span>
        <span class="foreman-status-action">${escapeHtml(item.action)}</span>
        <span class="foreman-status-badge ${statusClass}">${escapeHtml(item.status)}</span>
        <span class="foreman-status-summary" title="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</span>
        <span class="foreman-status-time">${formatTimeAgo(item.timestamp)}</span>
      </div>`;
    }).join('');
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

  if (statusRefreshBtn) {
    statusRefreshBtn.addEventListener('click', () => loadStatus());
  }

  // =========================================================================
  // Stack Preview
  // =========================================================================

  async function loadStack(token) {
    if (!stackList) return;
    const bearerToken = token || currentToken;
    if (!bearerToken) {
      stackList.innerHTML = '<div class="foreman-stack-empty">No token available</div>';
      return;
    }

    try {
      const resp = await fetch('/api/proxy/stack?limit=5', {
        headers: { Authorization: `Bearer ${bearerToken}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderStack(data.tasks || []);
    } catch {
      stackList.innerHTML = '<div class="foreman-stack-empty">Failed to load stack</div>';
    }
  }

  function renderStack(tasks) {
    if (!tasks.length) {
      stackList.innerHTML = '<div class="foreman-stack-empty">No tasks in the stack</div>';
      return;
    }

    stackList.innerHTML = tasks.map(task => {
      const stateType = task.state?.type || '';
      const stateClass = getStateClass(stateType);
      const labels = (task.labels || []).join(', ');
      return `<div class="foreman-stack-item">
        <span class="foreman-stack-identifier">${escapeHtml(task.identifier || task.id)}</span>
        <span class="foreman-stack-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
        <span class="foreman-stack-state ${stateClass}">${escapeHtml(stateType)}</span>
        ${labels ? `<span class="foreman-stack-labels">${escapeHtml(labels)}</span>` : ''}
      </div>`;
    }).join('');
  }

  function getStateClass(stateType) {
    if (!stateType) return '';
    if (stateType === 'started') return 'state-started';
    if (stateType === 'unstarted') return 'state-unstarted';
    if (stateType === 'backlog') return 'state-backlog';
    return '';
  }

  if (stackRefreshBtn) {
    stackRefreshBtn.addEventListener('click', () => loadStack());
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  function showFeedback(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    if (!isError) {
      setTimeout(() => { el.textContent = ''; }, 3000);
    }
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // =========================================================================
  // Init
  // =========================================================================
  loadTokens();
})();
