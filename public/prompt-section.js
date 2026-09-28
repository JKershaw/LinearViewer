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

  // Per-task prompt memory (LIN-2944 F11 / addendum 2). The durable record is the
  // SAME shape as the in-memory cache entry, minus `html` (re-rendered from `raw`
  // on hydrate) and with `generatedAt` added; it also keeps the LIN-3079 fields
  // (`kind`/`proxyForce`) and `warning`. Keyed by `urlKey` + `issueId` (never
  // global). The appended proxy block is NEVER persisted — tokens are minted
  // fresh per copy (LIN-1140). All storage access is try/catch'd so a storage
  // that throws (private mode, quota) downgrades to no memory, never a crash.
  const MEMORY_PREFIX = 'harbour:prompt-memory:';
  const MEMORY_VERSION = 1;

  function memoryKey(urlKey, issueId) {
    return `${MEMORY_PREFIX}${urlKey || ''}:${issueId}`;
  }

  // Read compatibility: an old-shape/foreign record that is malformed or lacks a
  // usable `raw` is treated as absent (no crash, no partial hydrate). A record
  // missing the newer fields (generatedAt/kind/proxyForce/warning) still
  // restores — those fields simply stay undefined.
  function loadPromptMemory(urlKey, issueId) {
    try {
      if (!window.localStorage) return null;
      const stored = window.localStorage.getItem(memoryKey(urlKey, issueId));
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.raw !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function savePromptMemory(urlKey, issueId, entry) {
    if (!entry || typeof entry.raw !== 'string') return;
    try {
      if (!window.localStorage) return;
      const record = {
        v: MEMORY_VERSION,
        label: entry.label,
        name: entry.name,
        raw: entry.raw,
        reasoning: entry.reasoning,
        warning: entry.warning,
        kind: entry.kind,
        proxyForce: entry.proxyForce,
        generatedAt: entry.generatedAt
      };
      for (const key of Object.keys(record)) {
        if (record[key] === undefined) delete record[key];
      }
      window.localStorage.setItem(memoryKey(urlKey, issueId), JSON.stringify(record));
    } catch {
      // Best-effort: memory is an optimisation, never load-bearing.
    }
  }

  // "generated 2h ago · regenerate" age label (LIN-2944).
  function formatGeneratedAge(generatedAt) {
    if (!generatedAt) return null;
    const seconds = Math.max(0, Math.round((Date.now() - generatedAt) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

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
   * The one-line "why" header (LIN-2944): the compact reasons from `buildWhy()`
   * that explain why Harbour would take this task first. An empty list means the
   * order had no ranking reason to advertise, so NO line is rendered — the
   * component never invents a claim (LIN-391's "explainable, not opaque").
   */
  function renderWhy(opts) {
    const why = opts.why;
    if (!why || why.length === 0) return '';
    return `<div class="opened-task-why" data-testid="opened-task-why">${esc(why.join(' \u00b7 '))}</div>`;
  }

  /**
   * Why the ✦ primary action is disabled, in plain words — or null when it can
   * run. Distinguishes the three states addendum 5 requires: AI off by the
   * person's choice, unconfigured (no OpenRouter), and free-tier exhausted
   * (429/quota). The action is SHOWN in every state, never hidden (F9).
   */
  function primaryDisabledReason(opts, state) {
    if (state.quotaExhausted) return 'daily free-tier limit reached \u00b7 resets at midnight UTC';
    if (state.quotaChecking) return 'checking free-tier allowance\u2026';
    if (opts.aiState === 'off') return 'AI suggestions are off \u00b7 turn on in settings';
    if (opts.aiState === 'unconfigured') return 'needs OpenRouter';
    if (opts.aiState === 'ready') return null;
    // Legacy callers that only pass hasAI keep the old gate.
    return opts.hasAI === false ? 'needs OpenRouter' : null;
  }

  /**
   * The ✦ next-step primary action ("Go", docs/v1.md step 4). It is the AI-tailored
   * prompt request (`__ai__`), shown disabled with its plain-words reason rather
   * than hidden when AI cannot run.
   */
  function renderPrimary(opts, state) {
    const reason = primaryDisabledReason(opts, state);
    let html = '<div class="opened-task-primary">';
    html += `<button class="opened-task-go" data-testid="opened-task-go" data-prompt="__ai__"${reason ? ' disabled' : ''}>\u2726 next step</button>`;
    if (reason) {
      html += `<span class="opened-task-primary-reason" data-testid="opened-task-primary-reason">${esc(reason)}</span>`;
    }
    html += '</div>';
    return html;
  }

  /**
   * The ladder beside the primary: copy \u2192 run this step \u2192 run the whole
   * task. A rung not yet enabled is SHOWN as "\u25CB set up \u203A", never hidden,
   * and keyed on `featureFlags.dispatch` / `featureFlags.proxy`. Pressing a
   * not-yet-enabled rung says what it needs (recording that press is LIN-2942,
   * deliberately out of P0).
   */
  function renderLadder(opts, state) {
    const rungs = [];
    rungs.push('<button class="opened-task-rung" data-rung="copy" data-action="copy">copy</button>');
    if (opts.dispatchEnabled) {
      rungs.push('<button class="opened-task-rung opened-task-rung--ready" data-rung="run-step" data-action="run-step">run this step</button>');
    } else {
      rungs.push('<button class="opened-task-rung opened-task-rung--setup" data-rung="run-step" data-action="setup" data-setup-needs="dispatch">run this step <span class="opened-task-setup">\u25CB set up \u203A</span></button>');
    }
    if (opts.proxyEnabled && opts.hasAutopilot) {
      rungs.push('<button class="opened-task-rung opened-task-rung--ready" data-rung="run-task" data-prompt="__autopilot__">run the whole task</button>');
    } else {
      rungs.push('<button class="opened-task-rung opened-task-rung--setup" data-rung="run-task" data-action="setup" data-setup-needs="proxy">run the whole task <span class="opened-task-setup">\u25CB set up \u203A</span></button>');
    }
    return `<div class="opened-task-ladder" data-testid="opened-task-ladder">${rungs.join('')}</div>`;
  }

  /**
   * The handwritten templates, grouped under "other prompts" (docs/v1.md step 4:
   * "The handwritten templates stay available under 'other prompts'."). The
   * `.swipe-prompt-buttons` / `.swipe-prompt-btn` classes are kept so the
   * established Swipe selectors keep resolving these controls. Honours
   * `promptButtons === false` by hiding the group (F9).
   */
  function renderOtherPrompts(opts, state) {
    if (opts.promptButtons === false) return '';
    const { defaultPromptKeys = [], morePromptKeys = [], promptMeta = {}, customPrompts = [] } = opts;
    const moreVisible = state.moreVisible;
    const hasMore = morePromptKeys.length > 0 || (customPrompts && customPrompts.length > 0);
    let html = '<div class="opened-task-other-prompts" data-testid="other-prompts">';
    html += '<div class="opened-task-other-prompts-label">other prompts</div>';
    html += '<div class="swipe-prompt-buttons">';
    for (const key of defaultPromptKeys) {
      const name = promptMeta[key] || key;
      html += `<button class="swipe-prompt-btn" data-prompt="${esc(key)}">${esc(name)}</button>`;
    }
    if (opts.hasAutopilot) {
      // LIN-836: sibling stepper variant of the run-whole-task rung. Same kickoff
      // endpoint fetched with ?variant=stepper; dispatch contract stays kind:autopilot.
      html += `<button class="swipe-prompt-btn autopilot-btn" data-prompt="__autopilot_stepper__" title="Run on autopilot in stepped mode — drips ordered beats into one warm session, judging each before advancing">Autopilot · stepped</button>`;
    }
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
    html += '</div>';
    return html;
  }

  /**
   * Build the idle opened-task shell: the one-line why, the ✦ primary action,
   * the ladder, and the templates under "other prompts" (LIN-2944).
   */
  function renderIdle(opts, state) {
    let html = '<div class="swipe-prompt-header"><span class="swipe-prompt-name">next step</span>';
    // Edit slot promoted to the header (LIN-2944). Swipe has no edit route in P0,
    // so this is the placement slot Home fills in P1.
    html += '<button class="swipe-prompt-edit" data-action="edit" title="Edit this task">Edit</button></div>';
    html += renderWhy(opts);
    html += renderPrimary(opts, state);
    html += renderLadder(opts, state);
    if (state.setupNotice) {
      html += `<div class="opened-task-setup-notice">${esc(state.setupNotice)}</div>`;
    }
    html += renderOtherPrompts(opts, state);
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
      // Shared dispatch disclosure (LIN-1137): composes the toggle, exec controls,
      // and target buttons with swipe-specific class names and data-action delegation.
      // LIN-732 / LIN-2944 addendum 3: the disclosure id prefix is caller-supplied
      // so two mounts of the same issue (e.g. Home's In Progress row AND its
      // project-tree row in P1) get disjoint ids. Default stays `swipe-<id>` so
      // Swipe output is byte-identical.
      html += window.renderDispatchDisclosure({
        idPrefix: opts.idPrefix || `swipe-${issue && issue.id}`,
        isLocalhost,
        toggleClass: 'swipe-prompt-dispatch-toggle disclosure-toggle',
        panelClass: 'swipe-prompt-options',
        buttonClass: 'swipe-prompt-dispatch',
        buttonDataAction: 'dispatch'
      });
    }
    html += '<button class="swipe-prompt-change" data-action="change" title="Choose another prompt">\u21BB change</button>';
    return html;
  }

  function renderFresh(state, opts) {
    const { name, html, reasoning, warning, label } = state.result;
    // LIN-3079 (review N1): key the suppression on the SAME `proxyForce` flag
    // the force paths use (common.js dispatchPrompt, ProxyToggle.maybeAppend) —
    // one source of truth. An autopilot entry sets it (:297); ordinary results
    // do not. The cluster is rebuilt on every render, so switching to another
    // result restores the toggle.
    const isForced = !!(state.result && state.result.proxyForce);
    const actions = renderActionCluster(isForced ? { ...opts, proxyEnabled: false } : opts);
    // LIN-2944: the remembered prompt shows its age ("generated 2h ago") with a
    // one-click regenerate (re-runs the same label). Only rendered once the
    // entry carries a `generatedAt` (always true for a freshly built entry and
    // for a hydrated memory record).
    const age = formatGeneratedAge(state.result.generatedAt);
    const generatedLine = age
      ? ` <span class="opened-task-generated">generated ${esc(age)} \u00b7 <button class="opened-task-regenerate" data-prompt="${esc(label || '')}">regenerate</button></span>`
      : '';
    // LIN-2944 reverses LIN-70: the reasoning STAYS visible beside the prompt
    // rather than collapsing behind a "▸ reasoning" toggle. The `hidden` class
    // is deliberately never applied; `data-testid` is the witness hook.
    const reasoningBlock = reasoning
      ? `<div class="swipe-reasoning opened-task-reasoning" data-testid="opened-task-reasoning">${renderReasoning(reasoning)}</div>`
      : '';
    const warningBanner = warning
      ? `<div class="swipe-prompt-warning">\u26A0 ${esc(warning)}</div>`
      : '';
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">${esc(name || 'prompt')}</span>${generatedLine}
        <div class="swipe-prompt-actions">${actions}</div>
      </div>
      ${warningBanner}
      ${reasoningBlock}
      ${renderLadder(opts, state)}
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
      error: null,
      setupNotice: null,
      // Load-time free-tier signal (addendum 5). Only fetched when the caller
      // marks the workspace as free-tier, so ordinary units never hit the
      // network here.
      quotaChecking: false,
      quotaExhausted: false
    };
    let abortController = null;
    let destroyed = false;

    // Restore from durable per-task memory (F11): the in-memory-only Cache is
    // replaced by the persisted record, so a mount hydrates from storage, not
    // from a process-global Map. Durable restore re-renders `html` from `raw`
    // (the record never carries markup) and re-seeds the in-session hint maps.
    const memory = loadPromptMemory(opts.urlKey, issueId);
    if (memory) {
      const hydrated = {
        label: memory.label,
        name: memory.name,
        raw: memory.raw,
        html: renderMarkdown(memory.raw),
        reasoning: memory.reasoning,
        warning: memory.warning,
        kind: memory.kind,
        proxyForce: memory.proxyForce,
        generatedAt: memory.generatedAt
      };
      state.phase = 'fresh';
      state.result = hydrated;
      state.activeLabel = hydrated.label;
      if (hydrated.label) {
        promptCache.set(`${issueId}:${hydrated.label}`, hydrated);
        lastPromptLabel.set(issueId, hydrated.label);
      }
    }

    function render() {
      if (destroyed) return;
      if (state.phase === 'idle') {
        applyState(container, renderIdle(opts, state), 'idle');
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
      state.setupNotice = null;
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
          // LIN-2046: thread source (via URLSearchParams, matching common.js's
          // fetchAutopilotKickoff convention) so a merged multi-binding swipe row
          // resolves recommend against its OWN binding, not the active one.
          const params = new URLSearchParams();
          if (issue.source) params.set('source', issue.source);
          const query = params.toString() ? `?${params.toString()}` : '';
          const response = await fetch(`${apiPrefix}/api/recommend/${issueId}/stream${query}`, { signal: ac.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to load prompt');
          }
          await handleStreamingResponse(response, label, ac);
        } else if (label === '__autopilot__' || label === '__autopilot_stepper__') {
          // LIN-836: the stepper label fetches the same kickoff endpoint with
          // ?variant=stepper; standard (`__autopilot__`) is byte-identical to before.
          // Shared fetch helper (LIN-1137) replaces the raw GET.
          const variant = label === '__autopilot_stepper__' ? 'stepper' : undefined;
          // LIN-2944 addendum 1 (LIN-1916 row 2): thread `source` so the kickoff
          // grounds on the row's OWN binding (fetchAutopilotKickoff already
          // accepts it, common.js). Omitted entirely when the issue has none.
          const result = await window.fetchAutopilotKickoff({
            urlKey: opts.urlKey,
            issueId,
            variant,
            source: issue.source || undefined,
            signal: ac.signal,
            on401: false
          });
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          // Carry kind through so the dispatch tags the item as the autopilot meta-loop.
          // LIN-3079: the kickoff body promises a `readWrite` proxy token, so only
          // this autopilot result forces proxy context (copy/download/dispatch) and
          // suppresses the now-inert +proxy toggle. Every other result stays unforced.
          const entry = { label, name: result.promptName || 'Autopilot', kind: result.kind || 'autopilot', raw: result.prompt, html, proxyForce: true, generatedAt: Date.now() };
          promptCache.set(`${issueId}:${label}`, entry);
          lastPromptLabel.set(issueId, label);
          savePromptMemory(opts.urlKey, issueId, entry);
          state.phase = 'fresh';
          state.result = entry;
          render();
        } else {
          // LIN-2944 addendum 1 (LIN-1916 row 1): thread `source` on the template
          // fetch too, via URLSearchParams (the LIN-2046 shape). The URL is
          // unchanged when the issue has no source.
          const params = new URLSearchParams();
          if (issue.source) params.set('source', issue.source);
          const query = params.toString() ? `?${params.toString()}` : '';
          const result = await window.api(`${apiPrefix}/api/prompt/${issueId}/${encodeURIComponent(label)}${query}`, { signal: ac.signal, on401: false });
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          const entry = { label, name: result.promptName || '', raw: result.prompt, html, generatedAt: Date.now() };
          promptCache.set(`${issueId}:${label}`, entry);
          lastPromptLabel.set(issueId, label);
          savePromptMemory(opts.urlKey, issueId, entry);
          state.phase = 'fresh';
          state.result = entry;
          render();
        }
      } catch (err) {
        if (err.name === 'AbortError' || destroyed) return;
        container.classList.remove('streaming');
        state.phase = 'error';
        state.error = err.message || 'Failed to load prompt';
        render();
      }
    }

    async function handleStreamingResponse(response, label, ac) {
      // The body is consumed by the shared window.readSSEStream reader
      // (LIN-2969/LIN-2980) via the onEvent handler below — this module no
      // longer owns a getReader/TextDecoder pair (F5).
      let promptRaw = '';
      let reasoningRaw = '';
      let currentField = null;
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
          // LIN-2987: sample the pinned-bottom predicate BEFORE the render pass
          // mutates body.innerHTML — the mutation itself grows the body, so
          // sampling after would measure the already-grown gap.
          const wasPinned = window.isPinnedToBottom(body);
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
          if (wasPinned) body.scrollTop = body.scrollHeight;
        });
      }

      // Shared SSE reader (LIN-2944 addendum 4 / F5; the fifth hand-rolled reader
      // consolidated onto window.readSSEStream, LIN-2969). Two contract points:
      //   * non-object payloads are SSE sentinels — the raw string '[DONE]' has
      //     no fields and is ignored;
      //   * `payload.error` is THROWN so it propagates out of readSSEStream and
      //     drives fetchPrompt's error state (LIN-2980 exception propagation).
      function onEvent(type, payload) {
        if (destroyed || abortController !== ac) return;
        if (!payload || typeof payload !== 'object') return;
        if (payload.error) {
          throw new Error(payload.error);
        }
        if (payload.phase) {
          if (payload.phase === 'prompt' && currentField === 'reasoning') {
            prevChildCount = 0;
          }
          currentField = payload.phase;
          return;
        }
        if (payload.section === 'reasoning' && payload.content) {
          reasoningRaw += payload.content;
          currentField = 'reasoning';
          scheduleRender();
        } else if (payload.section === 'prompt' && payload.content) {
          promptRaw += payload.content;
          currentField = 'prompt';
          scheduleRender();
        }
        // The `done` event carries truncation metadata (finish_reason === 'length').
        if (payload.truncated === true) {
          truncated = true;
        }
      }

      await window.readSSEStream(response, onEvent);

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
        html: finalHtml, reasoning: reasoningRaw, warning, generatedAt: Date.now()
      };
      promptCache.set(`${issueId}:${label}`, entry);
      lastPromptLabel.set(issueId, label);
      savePromptMemory(opts.urlKey, issueId, entry);
      state.phase = 'fresh';
      state.result = entry;
      render();
    }

    function handleClick(e) {
      const btn = e.target.closest('button, .swipe-reasoning-toggle');
      if (!btn || !container.contains(btn)) return;
      // A disabled primary (AI off/unconfigured/quota-exhausted) must never fire
      // a recommend request, even on a synthetic click (addendum 5).
      if (btn.disabled) return;

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

      if (action === 'setup') {
        // A not-yet-enabled rung says what it needs. It does NOT spend and does
        // NOT record the press — recording is LIN-2942, out of P0.
        const needs = btn.dataset.setupNeeds;
        state.setupNotice = needs === 'dispatch'
          ? 'running this step needs the dispatch runner set up'
          : 'running the whole task needs the proxy set up';
        render();
        return;
      }

      if (action === 'edit') {
        // Edit slot (LIN-2944). Swipe has no edit route in P0; Home fills this
        // in P1, so the press is inert here.
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
        // LIN-3079: an autopilot result forces the append regardless of the toggle.
        const force = !!(state.result && state.result.proxyForce);
        const text = await window.ProxyToggle.maybeAppend(raw, opts.urlKey, { force });
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
        // LIN-3079: same forced append as handleCopy for the autopilot result.
        const force = !!(state.result && state.result.proxyForce);
        const text = await window.ProxyToggle.maybeAppend(raw, opts.urlKey, { force });
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
        // Proxy-context appending is now handled internally by dispatchPrompt()
        // (LIN-1137). Exec controls (LIN-1096) still live in the dispatch options panel.
        const { model, harness } = window.readDispatchExecControls(btn.closest('.swipe-prompt-options'));
        // `issue` is the full card object (id/identifier/title/url) — passing it
        // through is what ties Swipe-dispatched sessions back to their task.
        await window.dispatchPrompt({
          urlKey: opts.urlKey,
          prompt: raw,
          promptName: (state.result && state.result.name) || 'Prompt',
          kind: (state.result && state.result.kind) || undefined,
          issue,
          target,
          model,
          harness,
          // LIN-3079: server-side attach forced for the autopilot result only.
          proxyForce: !!(state.result && state.result.proxyForce)
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

    // Addendum 5: the free-tier-exhausted state must be known at load. The
    // authoritative quota signal is the EXISTING GET /api/recommend/status
    // endpoint (routes/workspace-api.js), whose `freeTier` block (remaining/limit)
    // is the same one app.js's footer already consumes. It is a read, never a
    // spend. Only consulted when the caller marks the workspace free-tier, so
    // other consumers/units never touch the network from init.
    if (opts.freeTier) {
      state.quotaChecking = true;
      render();
      const statusPrefix = opts.urlKey ? `/workspace/${encodeURIComponent(opts.urlKey)}` : '';
      Promise.resolve()
        .then(() => window.api(`${statusPrefix}/api/recommend/status`, { on401: false }))
        .then((data) => {
          if (destroyed) return;
          state.quotaChecking = false;
          const ft = data && data.freeTier;
          state.quotaExhausted = !!(ft && typeof ft.remaining === 'number' && ft.remaining <= 0);
          render();
        })
        .catch(() => {
          if (destroyed) return;
          state.quotaChecking = false;
          render();
        });
    }

    return {
      destroy() {
        destroyed = true;
        // Aborting the controller aborts the in-flight fetch/recommend stream;
        // window.readSSEStream's read() then rejects with AbortError, which
        // fetchPrompt's catch swallows (and onEvent already no-ops once
        // `destroyed`). The container listener is the only DOM teardown.
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
   * Reads the in-session map first, then durable per-task memory (so the hint
   * survives a reload). `urlKey` is optional for backward compatibility; without
   * it only the in-session hint is available.
   * @param {string} issueId
   * @param {string} [urlKey]
   * @returns {{label: string, name: string} | null}
   */
  function getCached(issueId, urlKey) {
    const l = lastPromptLabel.get(issueId);
    const entry = l ? promptCache.get(`${issueId}:${l}`) : null;
    if (entry) return { label: l, name: entry.name };
    const memory = urlKey ? loadPromptMemory(urlKey, issueId) : null;
    return memory ? { label: memory.label, name: memory.name } : null;
  }

  window.PromptSection = { init, getCached };
})();
