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

  // Canonical client escaper lives in common.js (window.escapeHtml, LIN-422),
  // guaranteed loaded before this file wherever it runs (swipe page).
  const esc = window.escapeHtml;

  // Canonical markdown helpers live in common.js (window.*, LIN-421). This file
  // was the superset source for renderMarkdown; alias to the shared copies.
  const stripCodeBlockWrapper = window.stripCodeBlockWrapper;
  const renderMarkdown = window.renderMarkdown;

  // The reasoning section is line-oriented (assessment bullets, the → action line,
  // Next/DeferTo, and the ↳ descent breadcrumbs). Default GFM collapses single
  // newlines into spaces, which runs those lines together — most visibly on defer
  // descents. Render reasoning with breaks:true so each line stays on its own line.
  // Prompt bodies keep default rendering (they are real markdown documents where
  // soft-break-to-<br> would be wrong).
  function renderReasoning(text) {
    return renderMarkdown(text, { breaks: true });
  }

  // Proxy-toggle logic is shared via window.ProxyToggle (common.js, LIN-525 #7).
  // handleCopy/handleDownload/handleDispatch call ProxyToggle.maybeAppend; the
  // +proxy button's click is handled by ProxyToggle's delegated listener and its
  // active look is driven by the body[data-proxy-active] CSS rule, so this
  // module no longer carries its own copy of the toggle state/mint/append.

  // Slugify + filename helpers mirror lib/prompt-formatters.js (and app.js) so a
  // downloaded prompt file is named consistently across every surface.
  function slugifyForFilename(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
  }

  function buildPromptFilename(identifier, promptName) {
    const id = slugifyForFilename(identifier);
    const name = slugifyForFilename(promptName) || 'prompt';
    const base = id ? `${id}-${name}` : name;
    return `${base}.md`;
  }

  function downloadMarkdown(text, filename) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * Build the picker (idle state): prompt pill row.
   */
  function renderPicker(opts, state) {
    const { hasAI, hasAutopilot, defaultPromptKeys, morePromptKeys, promptMeta, customPrompts } = opts;
    const moreVisible = state.moreVisible;
    let html = '<div class="swipe-prompt-header"><span class="swipe-prompt-name">prompt</span></div>';
    html += '<div class="swipe-prompt-buttons">';
    if (hasAI) {
      html += `<button class="swipe-prompt-btn ai-btn" data-prompt="__ai__">\u2726 AI Recommend</button>`;
    }
    if (hasAutopilot) {
      html += `<button class="swipe-prompt-btn autopilot-btn" data-prompt="__autopilot__" title="Run on autopilot until this task is done — dispatches work to a separate worker and watches the loop">Autopilot</button>`;
      // LIN-836: sibling stepper button (LIN-791 variant). Same kickoff endpoint,
      // fetched with ?variant=stepper; dispatch contract stays kind:autopilot.
      html += `<button class="swipe-prompt-btn autopilot-btn" data-prompt="__autopilot_stepper__" title="Run on autopilot in stepped mode — drips ordered beats into one warm session, judging each before advancing">Autopilot · stepped</button>`;
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
    const { dispatchEnabled, proxyEnabled, isLocalhost, issue } = opts;
    let html = '';
    html += '<button class="swipe-prompt-copy" data-action="copy">copy</button>';
    html += '<button class="swipe-prompt-download" data-action="download" title="Download prompt as a .md file">download</button>';
    if (proxyEnabled) {
      // Active look is driven by the body[data-proxy-active] CSS rule (LIN-525
      // #1), so no per-button class is rendered here. data-action is kept off
      // the button: ProxyToggle's delegated listener (common.js) owns the click.
      html += `<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>`;
    }
    if (dispatchEnabled) {
      // Collapse the dispatch targets behind a single "Dispatch ▾" trigger. The
      // trigger uses the shared .disclosure-toggle convention (initDisclosure in
      // common.js, delegated at document level — no per-card wiring needed). It
      // carries no data-action, so the card's own handleClick ignores it; the
      // panel is resolved as the trigger's next sibling (no id needed). The
      // option buttons keep data-action="dispatch" so they still reach
      // handleDispatch from inside the panel.
      html += '<button class="swipe-prompt-dispatch-toggle disclosure-toggle" aria-expanded="false" aria-haspopup="true">Dispatch ▾</button>';
      html += '<div class="swipe-prompt-options hidden">';
      // Shared model/harness exec controls (LIN-1096) — window.renderDispatchExecControls, common.js.
      html += window.renderDispatchExecControls(`swipe-${issue && issue.id}`);
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
    const { name, html, reasoning, warning } = state.result;
    const actions = renderActionCluster(opts);
    const reasoningToggle = reasoning
      ? `<div class="swipe-reasoning-toggle" data-action="reasoning-toggle">\u25B8 reasoning</div>
         <div class="swipe-reasoning-content hidden">${renderReasoning(reasoning)}</div>`
      : '';
    const warningBanner = warning
      ? `<div class="swipe-prompt-warning">\u26A0 ${esc(warning)}</div>`
      : '';
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">${esc(name || 'prompt')}</span>
        <div class="swipe-prompt-actions">${actions}</div>
      </div>
      ${warningBanner}
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
      } else if (label === '__autopilot__') {
        state.activeLabelName = 'Autopilot';
      } else if (label === '__autopilot_stepper__') {
        state.activeLabelName = 'Autopilot · stepped';
      } else {
        state.activeLabelName = opts.promptMeta[label] || label;
      }
      render();

      const apiPrefix = opts.urlKey ? `/workspace/${encodeURIComponent(opts.urlKey)}` : '';

      try {
        if (label === '__ai__') {
          // SSE carve-out: window.api() parses the body as JSON, but this is a
          // streamed text/event-stream consumed by handleStreamingResponse via a
          // ReadableStream reader — it must stay on raw fetch().
          const response = await fetch(`${apiPrefix}/api/recommend/${issueId}/stream`, { signal: ac.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to load prompt');
          }
          await handleStreamingResponse(response, label, ac);
        } else if (label === '__autopilot__' || label === '__autopilot_stepper__') {
          // LIN-836: the stepper label fetches the same kickoff endpoint with
          // ?variant=stepper; standard (`__autopilot__`) is byte-identical to before.
          const variantQuery = label === '__autopilot_stepper__' ? '?variant=stepper' : '';
          const result = await window.api(`${apiPrefix}/api/autopilot-prompt/${issueId}${variantQuery}`, { signal: ac.signal, on401: false });
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          // Carry kind through so the dispatch tags the item as the autopilot meta-loop.
          const entry = { label, name: result.promptName || 'Autopilot', kind: result.kind || 'autopilot', raw: result.prompt, html };
          promptCache.set(`${issueId}:${label}`, entry);
          lastPromptLabel.set(issueId, label);
          state.phase = 'fresh';
          state.result = entry;
          render();
        } else {
          const result = await window.api(`${apiPrefix}/api/prompt/${issueId}/${encodeURIComponent(label)}`, { signal: ac.signal, on401: false });
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
      let truncated = false;

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
            body.innerHTML = renderReasoning(reasoningRaw);
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
            // The `done` event carries truncation metadata (finish_reason === 'length').
            if (parsed.truncated === true) {
              truncated = true;
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
      // Surface failure modes the backend can't fully prevent: a max_tokens
      // truncation (prompt likely cut off mid-text), or no prompt section at all
      // (the model returned only reasoning, so what's shown is the reasoning).
      let warning = null;
      if (truncated) {
        warning = 'Output hit the length limit — this prompt was cut short. Regenerate or shorten the task context.';
      } else if (!promptRaw) {
        warning = 'The model returned no prompt section — showing its reasoning instead. Try regenerating.';
      }
      const entry = {
        label, name: 'AI Recommendation', raw: displayText,
        html: finalHtml, reasoning: reasoningRaw, warning
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

      if (action === 'download') {
        handleDownload(btn);
        return;
      }

      if (action === 'dispatch') {
        handleDispatch(btn);
        return;
      }

      // +proxy toggle clicks are handled by ProxyToggle's delegated listener in
      // common.js (LIN-525 #7) — no per-section handling needed here.
    }

    async function handleCopy(btn) {
      const raw = state.result && state.result.raw;
      if (!raw) return;
      try {
        // Append the proxy block (if +proxy is on) inside the try so a failed
        // token mint surfaces as "failed" instead of copying a bare prompt.
        const text = await window.ProxyToggle.maybeAppend(raw, opts.urlKey);
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

    // Mirrors handleCopy, but saves the prompt to a .md file instead of the
    // clipboard (LIN-316). The file must byte-match what copy yields, so it
    // applies the same +proxy block via maybeAppendProxy.
    async function handleDownload(btn) {
      const raw = state.result && state.result.raw;
      if (!raw) return;
      try {
        const text = await window.ProxyToggle.maybeAppend(raw, opts.urlKey);
        const filename = buildPromptFilename(issue.identifier, (state.result && state.result.name) || 'prompt');
        downloadMarkdown(text, filename);
        btn.textContent = 'saved!';
        btn.classList.add('copied');
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = 'download';
          btn.classList.remove('copied');
        }, 2000);
      } catch {
        btn.textContent = 'failed';
        setTimeout(() => { if (!destroyed) btn.textContent = 'download'; }, 2000);
      }
    }

    async function handleDispatch(btn) {
      if (btn.disabled) return;
      const raw = state.result && state.result.raw;
      if (!raw) return;
      const target = btn.dataset.target;
      btn.disabled = true;
      const originalText = btn.textContent;
      try {
        // Append the proxy block (if +proxy is on) inside the try so a failed
        // token mint surfaces as "err" instead of dispatching a bare prompt.
        const prompt = await window.ProxyToggle.maybeAppend(raw, opts.urlKey);
        // Exec controls (LIN-1096) live inside this button's own dispatch options panel.
        const { model, harness } = window.readDispatchExecControls(btn.closest('.swipe-prompt-options'));
        // `issue` is the full card object (id/identifier/title/url) \u2014 passing it
        // through is what ties Swipe-dispatched sessions back to their task.
        await window.dispatchPrompt({
          urlKey: opts.urlKey,
          prompt,
          promptName: (state.result && state.result.name) || 'Prompt',
          kind: (state.result && state.result.kind) || undefined,
          issue,
          target,
          model,
          harness
        });
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

    container.addEventListener('click', handleClick);
    render();

    return {
      destroy() {
        destroyed = true;
        if (abortController) abortController.abort();
        container.removeEventListener('click', handleClick);
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
