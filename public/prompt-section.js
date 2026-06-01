/**
 * Prompt Section — shared client renderer.
 *
 * Renders the prompt picker and result inside a container in one of four states:
 *   - idle:       pill row, no result
 *   - generating: streaming/loading result
 *   - fresh:      result with copy/dispatch/+proxy/change actions
 *   - error:      error message with retry
 *
 * Exposed as a global `PromptSection` (plain script, no build step).
 */
(function () {
  'use strict';

  const promptCache = new Map(); // `${issueId}:${label}` -> {label, name, raw, html, reasoning}
  const lastPromptLabel = new Map(); // issueId -> label
  const PROXY_TOGGLE_KEY = 'proxy-toggle-active';
  let cachedProxyToken = null;

  function esc(str) {
    return window.escapeHtml ? window.escapeHtml(str) : String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function stripCodeBlockWrapper(text) {
    if (!text) return text;
    const m = text.match(/^\s*```[a-z]*\s*\n([\s\S]*?)\n\s*```\s*$/);
    return m ? m[1] : text;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    const cleaned = stripCodeBlockWrapper(text);
    const html = typeof marked !== 'undefined' ? marked.parse(cleaned) : esc(cleaned);
    return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
  }

  function isProxyActive() {
    return localStorage.getItem(PROXY_TOGGLE_KEY) === 'true';
  }

  async function getOrCreateProxyToken(urlKey) {
    if (cachedProxyToken) return cachedProxyToken;
    if (!urlKey) return null;
    try {
      const resp = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/proxy/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'prompt-proxy', scope: 'readWrite', singleUse: false })
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      cachedProxyToken = data.token;
      return cachedProxyToken;
    } catch { return null; }
  }

  function buildProxyBlock(token) {
    const baseUrl = window.location.origin;
    return `\n\n## Linear API Proxy\n\nYou have access to a Linear API proxy. Use it to read and modify Linear issues, projects, and more.\n\nTo get started, fetch the full API documentation:\n\n  curl -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/instructions\n\nThis will return all available endpoints with examples. Your token scope is: readWrite.`;
  }

  async function maybeAppendProxy(text, urlKey) {
    if (!isProxyActive()) return text;
    const token = await getOrCreateProxyToken(urlKey);
    if (!token) return text;
    return text + buildProxyBlock(token);
  }

  /**
   * Build the picker (idle state): prompt pill row.
   */
  function renderPicker(opts, state) {
    const { hasAI, hasForeman, hasMiniForeman, defaultPromptKeys, morePromptKeys, promptMeta, customPrompts } = opts;
    const moreVisible = state.moreVisible;
    let html = '<div class="swipe-prompt-header"><span class="swipe-prompt-name">prompt</span></div>';
    html += '<div class="swipe-prompt-buttons">';
    if (hasAI) {
      html += `<button class="swipe-prompt-btn ai-btn" data-prompt="__ai__">\u2726 AI Recommend</button>`;
    }
    if (hasForeman) {
      html += `<button class="swipe-prompt-btn foreman-btn" data-prompt="__foreman__" title="Foreman playbook pinned to this task">Foreman</button>`;
    }
    if (hasMiniForeman) {
      html += `<button class="swipe-prompt-btn mini-foreman-btn" data-prompt="__mini-foreman__" title="One-step API fetch: agent pulls a fresh prompt from the proxy and runs it once">Mini-foreman</button>`;
    }
    for (const key of defaultPromptKeys) {
      const name = promptMeta[key] || key;
      html += `<button class="swipe-prompt-btn" data-prompt="${esc(key)}">${esc(name)}</button>`;
    }
    const hasMore = morePromptKeys.length > 0 || (customPrompts && customPrompts.length > 0);
    if (hasMore) {
      html += `<button class="swipe-prompt-btn swipe-prompt-btn-more" data-prompt="__more__">${moreVisible ? 'less \u25B4' : 'more \u25BE'}</button>`;
    }
    html += '</div>';
    if (hasMore) {
      html += `<div class="swipe-more-prompts${moreVisible ? ' visible' : ''}" style="display: ${moreVisible ? 'flex' : 'none'};">`;
      for (const key of morePromptKeys) {
        const name = promptMeta[key] || key;
        html += `<button class="swipe-prompt-btn" data-prompt="${esc(key)}">${esc(name)}</button>`;
      }
      for (const cp of customPrompts || []) {
        const label = `custom:${cp.id}`;
        html += `<button class="swipe-prompt-btn custom-prompt-btn" data-prompt="${esc(label)}">${esc(cp.name)}</button>`;
      }
      html += '</div>';
    }
    return html;
  }

  function renderActionCluster(opts) {
    const { dispatchEnabled, proxyEnabled, isLocalhost } = opts;
    let html = '';
    html += '<button class="swipe-prompt-copy" data-action="copy">copy</button>';
    if (proxyEnabled) {
      const active = isProxyActive() ? ' active' : '';
      html += `<button class="prompt-proxy-toggle${active}" data-action="proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>`;
    }
    if (dispatchEnabled) {
      // LIN-295: collapse dispatch targets behind a single Dispatch \u25BE disclosure.
      // Panel ID is per-issue so concurrent prompt sections never collide.
      const panelId = `swipe-dispatch-options-${(opts.issue && opts.issue.id) || 'x'}`;
      html += `<button class="swipe-prompt-dispatch-toggle dispatch-toggle" data-action="dispatch-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="${esc(panelId)}">Dispatch \u25BE</button>`;
      html += `<div class="dispatch-options hidden" id="${esc(panelId)}">`;
      html += '<button class="swipe-prompt-dispatch" data-action="dispatch" data-target="cli">cli</button>';
      html += '<button class="swipe-prompt-dispatch" data-action="dispatch" data-target="web">web</button>';
      html += '<button class="swipe-prompt-dispatch" data-action="dispatch" data-target="dash">dash</button>';
      if (isLocalhost) {
        html += '<button class="swipe-prompt-dispatch" data-action="dispatch" data-target="local">harbour</button>';
      }
      html += '</div>';
    }
    html += '<button class="swipe-prompt-change" data-action="change" title="Choose another prompt">\u21BB change</button>';
    return html;
  }

  function renderFresh(state, opts) {
    const { name, html, reasoning } = state.result;
    const actions = renderActionCluster(opts);
    const reasoningToggle = reasoning
      ? `<div class="swipe-reasoning-toggle" data-action="reasoning-toggle">\u25B8 reasoning</div>
         <div class="swipe-reasoning-content hidden">${renderMarkdown(reasoning)}</div>`
      : '';
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">${esc(name || 'prompt')}</span>
        <div class="swipe-prompt-actions">${actions}</div>
      </div>
      ${reasoningToggle}
      <div class="swipe-prompt-text" data-prompt-body>${html}</div>`;
  }

  function renderGenerating(state) {
    const name = state.activeLabelName || 'generating';
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">${esc(name)} \u00b7 generating\u2026</span>
        <span class="recap-spinner" aria-hidden="true"></span>
      </div>
      <div class="swipe-prompt-text" data-prompt-body>Loading\u2026</div>`;
  }

  function renderError(state, opts) {
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">prompt \u00b7 error</span>
        <button class="swipe-prompt-change" data-action="change">\u21BB back</button>
      </div>
      <div class="swipe-prompt-text recap-error">${esc(state.error || 'Failed to load prompt.')}</div>`;
  }

  function applyState(container, html, phase) {
    container.innerHTML = html;
    container.setAttribute('data-phase', phase);
  }

  /**
   * Initialise a prompt section inside the given container.
   * Returns a handle with a `destroy()` method to abort in-flight work.
   */
  function init(container, opts) {
    if (!container || !opts || !opts.issue) return { destroy() {} };

    const issue = opts.issue;
    const issueId = issue.id;
    container.classList.add('prompt-section');

    const state = {
      phase: 'idle',
      moreVisible: false,
      result: null,
      activeLabel: null,
      activeLabelName: null,
      error: null
    };
    let abortController = null;
    let destroyed = false;

    // Restore from cache if available
    const lastLabel = lastPromptLabel.get(issueId);
    const cached = lastLabel ? promptCache.get(`${issueId}:${lastLabel}`) : null;
    if (cached) {
      state.phase = 'fresh';
      state.result = cached;
      state.activeLabel = cached.label;
    }

    function render() {
      if (destroyed) return;
      if (state.phase === 'idle') {
        applyState(container, renderPicker(opts, state), 'idle');
      } else if (state.phase === 'generating') {
        applyState(container, renderGenerating(state), 'generating');
      } else if (state.phase === 'fresh') {
        applyState(container, renderFresh(state, opts), 'fresh');
      } else if (state.phase === 'error') {
        applyState(container, renderError(state, opts), 'error');
      }
    }

    function goIdle() {
      state.phase = 'idle';
      state.result = null;
      state.activeLabel = null;
      state.activeLabelName = null;
      state.error = null;
      render();
    }

    async function fetchPrompt(label) {
      if (abortController) abortController.abort();
      abortController = new AbortController();
      const ac = abortController;

      state.phase = 'generating';
      state.activeLabel = label;
      if (label === '__ai__') {
        state.activeLabelName = 'AI Recommend';
      } else if (label === '__foreman__') {
        state.activeLabelName = 'Foreman';
      } else if (label === '__mini-foreman__') {
        state.activeLabelName = 'Mini-foreman';
      } else {
        state.activeLabelName = opts.promptMeta[label] || label;
      }
      render();

      const apiPrefix = opts.urlKey ? `/workspace/${encodeURIComponent(opts.urlKey)}` : '';

      try {
        if (label === '__ai__') {
          const response = await fetch(`${apiPrefix}/api/recommend/${issueId}/stream`, { signal: ac.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to load prompt');
          }
          await handleStreamingResponse(response, label, ac);
        } else if (label === '__foreman__') {
          const response = await fetch(`${apiPrefix}/api/foreman-prompt/${issueId}`, { signal: ac.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to load foreman prompt');
          }
          const result = await response.json();
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          const entry = { label, name: result.promptName || 'Foreman', raw: result.prompt, html };
          promptCache.set(`${issueId}:${label}`, entry);
          lastPromptLabel.set(issueId, label);
          state.phase = 'fresh';
          state.result = entry;
          render();
        } else if (label === '__mini-foreman__') {
          const response = await fetch(`${apiPrefix}/api/mini-foreman-prompt/${issueId}`, { signal: ac.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to load mini-foreman prompt');
          }
          const result = await response.json();
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          const entry = { label, name: result.promptName || 'Mini-foreman', raw: result.prompt, html };
          promptCache.set(`${issueId}:${label}`, entry);
          lastPromptLabel.set(issueId, label);
          state.phase = 'fresh';
          state.result = entry;
          render();
        } else {
          const response = await fetch(`${apiPrefix}/api/prompt/${issueId}/${encodeURIComponent(label)}`, { signal: ac.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to load prompt');
          }
          const result = await response.json();
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          const entry = { label, name: result.promptName || '', raw: result.prompt, html };
          promptCache.set(`${issueId}:${label}`, entry);
          lastPromptLabel.set(issueId, label);
          state.phase = 'fresh';
          state.result = entry;
          render();
        }
      } catch (err) {
        if (err.name === 'AbortError' || destroyed) return;
        state.phase = 'error';
        state.error = err.message || 'Failed to load prompt';
        render();
      }
    }

    async function handleStreamingResponse(response, label, ac) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let promptRaw = '';
      let reasoningRaw = '';
      let currentField = null;
      let sseBuffer = '';
      let renderPending = false;
      let prevChildCount = 0;

      // First render: swap to fresh with empty body so the stream animates inline
      state.phase = 'fresh';
      state.result = { label, name: 'AI thinking\u2026', raw: '', html: '', reasoning: '' };
      render();
      container.classList.add('streaming');
      let body = container.querySelector('[data-prompt-body]');

      function scheduleRender() {
        if (renderPending) return;
        renderPending = true;
        requestAnimationFrame(() => {
          renderPending = false;
          if (destroyed || abortController !== ac) return;
          const nameEl = container.querySelector('.swipe-prompt-name');
          body = container.querySelector('[data-prompt-body]');
          if (!body) return;
          if (currentField === 'reasoning') {
            if (nameEl) nameEl.textContent = 'AI thinking\u2026';
            body.innerHTML = renderMarkdown(reasoningRaw);
          } else {
            if (nameEl) nameEl.textContent = 'AI Recommendation';
            body.innerHTML = renderMarkdown(promptRaw || reasoningRaw);
          }
          const children = body.children;
          for (let i = prevChildCount; i < children.length; i++) {
            children[i].classList.add('stream-in');
          }
          for (let i = 0; i < children.length; i++) {
            children[i].classList.toggle('stream-cursor', i === children.length - 1);
          }
          prevChildCount = children.length;
          const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
          if (nearBottom) body.scrollTop = body.scrollHeight;
        });
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortController !== ac || destroyed) return;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.phase) {
              if (parsed.phase === 'prompt' && currentField === 'reasoning') {
                prevChildCount = 0;
              }
              currentField = parsed.phase;
              continue;
            }
            if (parsed.section === 'reasoning' && parsed.content) {
              reasoningRaw += parsed.content;
              currentField = 'reasoning';
              scheduleRender();
            } else if (parsed.section === 'prompt' && parsed.content) {
              promptRaw += parsed.content;
              currentField = 'prompt';
              scheduleRender();
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (destroyed || abortController !== ac) return;
      container.classList.remove('streaming');
      const displayText = stripCodeBlockWrapper(promptRaw || reasoningRaw);
      const finalHtml = renderMarkdown(displayText);
      const entry = {
        label, name: 'AI Recommendation', raw: displayText,
        html: finalHtml, reasoning: reasoningRaw
      };
      promptCache.set(`${issueId}:${label}`, entry);
      lastPromptLabel.set(issueId, label);
      state.phase = 'fresh';
      state.result = entry;
      render();
    }

    function handleClick(e) {
      const btn = e.target.closest('button, .swipe-reasoning-toggle');
      if (!btn || !container.contains(btn)) return;

      const action = btn.dataset.action;
      const promptLabel = btn.dataset.prompt;

      if (promptLabel === '__more__') {
        state.moreVisible = !state.moreVisible;
        render();
        return;
      }

      if (promptLabel) {
        fetchPrompt(promptLabel);
        return;
      }

      if (action === 'change') {
        if (abortController) abortController.abort();
        container.classList.remove('streaming');
        goIdle();
        return;
      }

      if (action === 'reasoning-toggle') {
        const content = container.querySelector('.swipe-reasoning-content');
        if (content) {
          const hidden = content.classList.toggle('hidden');
          btn.textContent = hidden ? '\u25B8 reasoning' : '\u25BE reasoning';
        }
        return;
      }

      if (action === 'copy') {
        handleCopy(btn);
        return;
      }

      if (action === 'dispatch-toggle') {
        const panel = btn.getAttribute('aria-controls')
          ? container.querySelector(`#${CSS.escape(btn.getAttribute('aria-controls'))}`)
          : null;
        if (!panel) return;
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        panel.classList.toggle('hidden', open);
        return;
      }

      if (action === 'dispatch') {
        handleDispatch(btn);
        return;
      }

      if (action === 'proxy-toggle') {
        const now = !isProxyActive();
        localStorage.setItem(PROXY_TOGGLE_KEY, now ? 'true' : 'false');
        document.querySelectorAll('.prompt-proxy-toggle').forEach(b => b.classList.toggle('active', now));
        return;
      }
    }

    async function handleCopy(btn) {
      const raw = state.result && state.result.raw;
      if (!raw) return;
      const text = await maybeAppendProxy(raw, opts.urlKey);
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = 'copy';
          btn.classList.remove('copied');
        }, 2000);
      } catch {
        btn.textContent = 'failed';
        setTimeout(() => { if (!destroyed) btn.textContent = 'copy'; }, 2000);
      }
    }

    async function handleDispatch(btn) {
      if (btn.disabled) return;
      const raw = state.result && state.result.raw;
      if (!raw) return;
      const target = btn.dataset.target;
      const prompt = await maybeAppendProxy(raw, opts.urlKey);
      const apiPrefix = opts.urlKey ? `/workspace/${encodeURIComponent(opts.urlKey)}` : '';
      btn.disabled = true;
      const originalText = btn.textContent;
      try {
        const response = await fetch(`${apiPrefix}/api/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, target })
        });
        if (!response.ok) throw new Error('Dispatch failed');
        btn.textContent = '\u2713';
      } catch {
        btn.textContent = 'err';
      } finally {
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = originalText;
          btn.disabled = false;
        }, 2000);
      }
    }

    // LIN-295: close this section's open dispatch panel(s). Scoped to the
    // container so one prompt section never affects another's panel state.
    function closeDispatchPanels() {
      container.querySelectorAll('.dispatch-toggle[aria-expanded="true"]').forEach((toggle) => {
        toggle.setAttribute('aria-expanded', 'false');
        const id = toggle.getAttribute('aria-controls');
        const panel = id ? container.querySelector(`#${CSS.escape(id)}`) : null;
        if (panel) panel.classList.add('hidden');
      });
    }

    function onDocClick(e) {
      // Close when the click lands outside this container, or inside it but not
      // on the trigger/panel. Leaving in-panel clicks alone keeps the panel open
      // after a dispatch so the button feedback stays visible.
      if (container.contains(e.target) &&
          (e.target.closest('.dispatch-toggle') || e.target.closest('.dispatch-options'))) {
        return;
      }
      closeDispatchPanels();
    }

    function onDocKeydown(e) {
      if (e.key === 'Escape') closeDispatchPanels();
    }

    container.addEventListener('click', handleClick);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKeydown);
    render();

    return {
      destroy() {
        destroyed = true;
        if (abortController) abortController.abort();
        container.removeEventListener('click', handleClick);
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onDocKeydown);
      },
      getCachedLabel() {
        const l = lastPromptLabel.get(issueId);
        const entry = l ? promptCache.get(`${issueId}:${l}`) : null;
        return entry ? { label: l, name: entry.name } : null;
      }
    };
  }

  /**
   * Look up any cached prompt for an issue (used by the accordion header hint).
   * @param {string} issueId
   * @returns {{label: string, name: string} | null}
   */
  function getCached(issueId) {
    const l = lastPromptLabel.get(issueId);
    const entry = l ? promptCache.get(`${issueId}:${l}`) : null;
    return entry ? { label: l, name: entry.name } : null;
  }

  window.PromptSection = { init, getCached };
})();
