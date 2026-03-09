/**
 * Proxy Page Client-Side Logic
 *
 * Handles: token generation, agent prompt creation, token CRUD, event log display.
 */

/* global escapeHtml */

(function () {
  'use strict';

  // DOM references
  const generateBtn = document.getElementById('proxy-generate-btn');
  const scopeSelect = document.getElementById('proxy-scope-select');
  const promptOutput = document.getElementById('proxy-prompt-output');
  const generateFeedback = document.getElementById('proxy-generate-feedback');
  const createTokenForm = document.getElementById('proxy-create-token-form');
  const tokenList = document.querySelector('.proxy-token-list');
  const eventsList = document.querySelector('.proxy-events-list');
  const refreshBtn = document.querySelector('.proxy-events-refresh');

  const urlKey = tokenList?.dataset?.urlKey || generateBtn?.closest('[data-url-key]')?.dataset?.urlKey;
  if (!urlKey) return;

  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/proxy`;
  const baseUrl = window.location.origin;

  // =========================================================================
  // Generate & Copy Agent Prompt
  // =========================================================================

  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true;
      showFeedback(generateFeedback, 'Generating...', false);

      try {
        const scope = scopeSelect?.value || 'read';
        const resp = await fetch(`${apiBase}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: 'agent-prompt',
            scope,
            singleUse: false
          })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const token = data.token;

        const prompt = buildAgentPrompt(token, scope);
        promptOutput.textContent = prompt;
        promptOutput.classList.add('has-prompt');

        // Copy to clipboard
        try {
          await navigator.clipboard.writeText(prompt);
          showFeedback(generateFeedback, 'Copied!', false);
        } catch {
          showFeedback(generateFeedback, 'Generated (copy manually)', false);
        }

        // Refresh token list
        loadTokens();
      } catch (err) {
        showFeedback(generateFeedback, err.message, true);
      } finally {
        generateBtn.disabled = false;
      }
    });
  }

  // Click prompt output to copy
  if (promptOutput) {
    promptOutput.addEventListener('click', async () => {
      if (!promptOutput.classList.contains('has-prompt')) return;
      try {
        await navigator.clipboard.writeText(promptOutput.textContent);
        showFeedback(generateFeedback, 'Copied!', false);
      } catch {
        // Selection fallback
      }
    });
  }

  function buildAgentPrompt(token, scope) {
    const instructionsUrl = `${baseUrl}/api/proxy/instructions`;
    return `You have access to a Linear API proxy. Use it to read${scope === 'readWrite' ? ' and modify' : ''} Linear issues, projects, and more.

To get started, fetch the full API documentation:

curl -H "Authorization: Bearer ${token}" ${instructionsUrl}

This will return all available endpoints with examples. Your token scope is: ${scope}.`;
  }

  // =========================================================================
  // Token Management
  // =========================================================================

  if (createTokenForm) {
    createTokenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(createTokenForm);
      const label = formData.get('label') || 'default';
      const scope = formData.get('scope') || 'read';

      try {
        const resp = await fetch(`${apiBase}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, scope })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        showTokenModal(data.token, data.label, data.scope);
        createTokenForm.reset();
        loadTokens();
      } catch (err) {
        alert('Failed to create token: ' + err.message);
      }
    });
  }

  async function loadTokens() {
    if (!tokenList) return;

    try {
      const resp = await fetch(`${apiBase}/tokens`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderTokenList(data.tokens || []);
    } catch {
      tokenList.innerHTML = '<div class="token-list-empty">Failed to load tokens</div>';
    }
  }

  function renderTokenList(tokens) {
    if (!tokens.length) {
      tokenList.innerHTML = '<div class="token-list-empty">No proxy tokens yet</div>';
      return;
    }

    tokenList.innerHTML = tokens.map(t => {
      const scopeBadge = t.scope === 'readWrite' ? ' [rw]' : ' [r]';
      const consumedBadge = t.consumed ? ' (consumed)' : '';
      const meta = [
        formatTimeAgo(t.createdAt),
        t.lastUsedAt ? `used ${formatTimeAgo(t.lastUsedAt)}` : 'never used'
      ].join(' · ');

      return `<div class="token-item">
        <div class="token-info">
          <div class="token-label-text">${escapeHtml(t.label)}${scopeBadge}${consumedBadge}</div>
          <div class="token-meta">${escapeHtml(meta)}</div>
        </div>
        <button class="action-btn token-revoke" data-token-id="${escapeHtml(t.tokenId)}">revoke</button>
      </div>`;
    }).join('');

    // Attach revoke handlers
    tokenList.querySelectorAll('.token-revoke').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tokenId = btn.dataset.tokenId;
        if (!confirm('Revoke this token?')) return;

        try {
          const resp = await fetch(`${apiBase}/tokens/${tokenId}`, { method: 'DELETE' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          loadTokens();
        } catch (err) {
          alert('Failed to revoke: ' + err.message);
        }
      });
    });
  }

  function showTokenModal(token, label, scope) {
    // Remove existing modal
    document.querySelectorAll('.token-modal-overlay, .token-modal').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'token-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'token-modal';
    modal.innerHTML = `
      <div class="token-modal-header">
        <strong>Token Created</strong>
        <button class="token-modal-close">&times;</button>
      </div>
      <p>Save this token now — it cannot be retrieved later.</p>
      <div class="token-display">
        <span class="token-value">${escapeHtml(token)}</span>
        <button class="token-copy-btn">copy</button>
      </div>
      <div class="token-usage-hint">
        <div>Label: ${escapeHtml(label)} · Scope: ${escapeHtml(scope)}</div>
        <div class="token-usage-hint-code">
          <code>curl -H "Authorization: Bearer ${escapeHtml(token)}" ${escapeHtml(baseUrl)}/api/proxy/me</code>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    const close = () => { overlay.remove(); modal.remove(); };
    overlay.addEventListener('click', close);
    modal.querySelector('.token-modal-close').addEventListener('click', close);
    modal.querySelector('.token-copy-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(token);
        modal.querySelector('.token-copy-btn').textContent = 'copied!';
      } catch {
        // fallback
      }
    });
  }

  // =========================================================================
  // Event Log
  // =========================================================================

  async function loadEvents() {
    if (!eventsList) return;

    try {
      const resp = await fetch(`${apiBase}/events?limit=50`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderEvents(data.items || []);
    } catch {
      eventsList.innerHTML = '<div class="proxy-events-empty">Failed to load events</div>';
    }
  }

  function renderEvents(events) {
    if (!events.length) {
      eventsList.innerHTML = '<div class="proxy-events-empty">No proxy events yet</div>';
      return;
    }

    eventsList.innerHTML = events.map(e => {
      const statusClass = e.status < 300 ? 'status-ok' : e.status < 400 ? 'status-warn' : 'status-error';
      const label = e.tokenLabel ? ` · ${escapeHtml(e.tokenLabel)}` : '';
      return `<div class="proxy-event-item">
        <span class="proxy-event-method">${escapeHtml(e.method)}</span>
        <span class="proxy-event-endpoint">${escapeHtml(e.endpoint)}</span>
        <span class="proxy-event-status ${statusClass}">${e.status}</span>
        <span class="proxy-event-meta">${formatTimeAgo(e.timestamp)}${label}</span>
      </div>`;
    }).join('');
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadEvents);
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
  loadEvents();
})();
