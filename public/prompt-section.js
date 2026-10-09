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

  // The durable prompt-memory key is `urlKey:issueId`. One ticket source per kind
  // (LIN-3332) removed the binding stamp that once suffixed keys as
  // `@<bindingScope>`; an old `...:<id>@<scope>` key is simply never read again.
  function memoryKey(urlKey, issueId) {
    return `${MEMORY_PREFIX}${urlKey || ''}:${issueId}`;
  }

  // The in-session `promptCache` / `lastPromptLabel` maps key on the issueId.
  // One ticket source per kind (LIN-3332) removed the `@<bindingScope>` suffix
  // the pair-era stamp added.
  function sessionPromptKey(issueId) {
    return `${issueId}`;
  }

  // LIN-3341: the two autopilot result labels. An autopilot prompt is not a
  // reusable step prompt, and once Go dispatches directly a remembered one is
  // stale — it brings the mislabelled "run this step" rung back after a reload.
  // So durable memory neither saves nor hydrates either label (and a legacy
  // record already in localStorage is discarded on load).
  function isAutopilotLabel(label) {
    return label === '__autopilot__' || label === '__autopilot_stepper__';
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
      // LIN-3341: never hydrate an autopilot result; drop a legacy record too.
      if (isAutopilotLabel(parsed.label) || parsed.kind === 'autopilot') {
        try { window.localStorage.removeItem(memoryKey(urlKey, issueId)); } catch { /* best-effort */ }
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function savePromptMemory(urlKey, issueId, entry) {
    if (!entry || typeof entry.raw !== 'string') return;
    // LIN-3341: an autopilot result is a one-shot dispatch, not a reusable
    // prompt; it is never persisted (both labels), so it cannot reappear.
    if (isAutopilotLabel(entry.label) || entry.kind === 'autopilot') return;
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
  // +proxy button's click is bound by applyState (ProxyToggle.bind) and its
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
   * run. Distinguishes the states addendum 5 requires: AI off by the person's
   * choice, and unconfigured (no OpenRouter). The prompt action is NOT gated by
   * the run allowance (LIN-3239): prompts are unlimited, so only run rungs carry
   * the run-limit state. The action is SHOWN in every state, never hidden (F9).
   */
  function primaryDisabledReason(opts, state) {
    if (opts.aiState === 'off') return 'AI suggestions are off \u00b7 turn on in settings';
    if (opts.aiState === 'unconfigured') return 'needs OpenRouter';
    if (opts.aiState === 'ready') return null;
    // Legacy callers that only pass hasAI keep the old gate.
    return opts.hasAI === false ? 'needs OpenRouter' : null;
  }

  /**
   * The ✦ next-step action: the AI-tailored prompt request (`__ai__`), shown
   * disabled with its plain-words reason rather than hidden when AI cannot run.
   * Since LIN-3341 it is the SECONDARY action on the idle opened task — Go is
   * the primary that starts the run — so it keeps its own testid
   * (`opened-task-next-step`) and is no longer called "Go".
   */
  function renderNextStep(opts, state) {
    const reason = primaryDisabledReason(opts, state);
    let html = '<div class="opened-task-next-step-row">';
    html += `<button class="opened-task-next-step" data-testid="opened-task-next-step" data-prompt="__ai__"${reason ? ' disabled' : ''}>\u2726 next step</button>`;
    if (reason) {
      html += `<span class="opened-task-primary-reason" data-testid="opened-task-primary-reason">${esc(reason)}</span>`;
    }
    html += '</div>';
    return html;
  }

  /**
   * LIN-3341: the one-press Go. It is the PRIMARY action on the opened task in
   * EVERY phase (idle, generating, fresh, error) — Go does not need a prompt,
   * so it cannot go missing because no prompt exists. A single press builds the
   * autopilot kickoff and dispatches it through the shared assemblers
   * (`window.fetchAutopilotKickoff` + `window.dispatchPrompt`), then shows that
   * the run has started.
   *
   * Go's own states live on `state.go` (outside `phase`/`result`):
   *   - ready: pressable. Rung vocabulary stays `run-task` (data-rung, pinned by
   *     task-mode-store.test.js). Ready means dispatch AND proxy AND autopilot.
   *   - not set up: shown as "Go ○ set up ›" (never hidden); a press records
   *     intent and writes the notice, dispatching nothing.
   *   - run-limited: disabled with the run-limit reason, from the same quota as
   *     the run-step rung.
   *   - starting: disabled, "starting…".
   *   - started/running: the task-page state line replaces the button.
   * The run allowance ("N of M runs left today") lives beside Go, so it shows in
   * every phase and is the same account-wide count the run rungs used.
   */
  function goReady(opts) {
    return !!(opts.dispatchEnabled && opts.proxyEnabled && opts.hasAutopilot);
  }

  function renderGo(opts, state) {
    const g = state.go || { status: 'ready' };
    const ready = goReady(opts);
    const quota = state.runQuota;
    const quotaKnown = !!(quota && quota.runsUsed != null
      && typeof quota.remaining === 'number' && typeof quota.limit === 'number');
    const runsExhausted = quotaKnown && quota.remaining <= 0;
    const runLimitTitle = 'daily run limit reached \u00b7 resets at midnight UTC';

    let html = '<div class="opened-task-primary" data-go-slot>';

    if (g.status === 'started' || g.status === 'running') {
      // The started/running line: the task page's OWN sentence (the one source
      // of queued/running truth), with a link to the task page. Until a state
      // read lands, it says "Started" — true on a 201, not a status claim.
      const href = window.taskPageHref({
        urlKey: opts.urlKey,
        identifier: opts.issue && opts.issue.identifier,
        source: opts.issue && opts.issue.source
      });
      const link = href
        ? ` <a class="opened-task-started-link" href="${esc(href)}" data-testid="opened-task-started-link">watch on the task page \u203A</a>`
        : '';
      const body = g.headerHtml
        ? g.headerHtml
        : '<p class="task-sentence" data-testid="opened-task-sentence">Started.</p>';
      html += `<div class="opened-task-started" data-testid="opened-task-started" data-go-status="${esc(g.status)}">${body}${link}</div>`;
    } else if (!ready) {
      const needs = opts.dispatchEnabled ? 'proxy' : 'dispatch';
      html += `<button class="opened-task-go opened-task-go--setup" data-testid="opened-task-go" data-rung="run-task" data-action="setup" data-setup-needs="${needs}">Go <span class="opened-task-setup">\u25CB set up \u203A</span></button>`;
    } else if (runsExhausted) {
      html += `<button class="opened-task-go opened-task-go--limited" data-testid="opened-task-go" data-rung="run-task" disabled title="${runLimitTitle}">Go <span class="opened-task-setup">${runLimitTitle}</span></button>`;
    } else if (g.status === 'starting') {
      html += '<button class="opened-task-go" data-testid="opened-task-go" data-rung="run-task" disabled>starting\u2026</button>';
    } else {
      html += '<button class="opened-task-go" data-testid="opened-task-go" data-rung="run-task" data-action="go">Go</button>';
    }

    // The allowance sits beside Go, the control it governs — shown only when the
    // count was readable, so it never invents a number (LIN-3239).
    if (quotaKnown) {
      html += `<span class="opened-task-run-quota" data-testid="opened-task-run-quota" data-runs-remaining="${quota.remaining}" data-runs-limit="${quota.limit}">${quota.remaining} of ${quota.limit} runs left today</span>`;
    }

    // The plain-words line a refusal / not-set-up press writes. Always rendered
    // (empty or filled) so a press can write into it without a full render,
    // preserving N4 (a press never rebuilds the streamed body).
    const noticeLink = g.noticeLink
      ? ` <a class="opened-task-go-notice-link" href="${esc(g.noticeLink)}">${esc(g.noticeLinkLabel || 'watch \u203A')}</a>`
      : '';
    html += `<div class="opened-task-go-notice" data-testid="opened-task-go-notice" data-go-notice-slot aria-live="polite">${g.notice ? esc(g.notice) : ''}${noticeLink}</div>`;

    html += '</div>';
    return html;
  }

  /**
   * The ladder beside Go: copy \u2192 run this step. A rung not yet enabled is
   * SHOWN as "\u25CB set up \u203A", never hidden,
   * and keyed on `featureFlags.dispatch` / `featureFlags.proxy`. Pressing a
   * not-yet-enabled rung says what it needs, and the press is recorded as a
   * mode event (LIN-2942); `data-rung` / `data-setup-needs` are that record's
   * vocabulary (lib/task-mode-store.js, pinned by a unit test).
   */
  // LIN-3098 S4: the runner setup page, where an owner makes their own Claude
  // Code session this workspace's runner.
  function runnerSetupHref(opts) {
    return `/workspace/${encodeURIComponent(opts.urlKey || '')}/runner`;
  }

  // LIN-3098 S4b: "run on my machine ›", shown wherever a task opens and
  // whatever the flags say (/runner explains what to turn on). The card that
  // hosts this component renders it (public/swipe.js), outside the collapsed
  // Prompts section; lib/components/runner-link.js is the server twin.
  function runnerLinkHtml(urlKey) {
    return `<a class="opened-task-runner-link" href="${esc(runnerSetupHref({ urlKey }))}" data-testid="opened-task-runner-link">run on my machine \u203A</a>`;
  }

  // LIN-3098 N3: has THIS browser set up a runner for this workspace?
  // public/runner-setup.js writes the marker after a successful mint. Storage
  // can throw (private mode, blocked site data), which reads as "no".
  function runnerMarkerSet(urlKey) {
    try {
      const ls = window.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
      return !!ls && ls.getItem(`harbour-runner:${urlKey}`) === '1';
    } catch {
      return false;
    }
  }

  function renderLadder(opts, state) {
    // A rung can only act on a prompt once one exists. `hasResult` distinguishes
    // the fresh state from idle/generating.
    const hasResult = !!(state.result && state.result.raw);
    // Streaming policy (LIN-2944 N4): while the ✦ stream is in flight, a rung
    // that needs a prompt is rendered INERT with an honest "generating…"
    // reason rather than hiding the ladder until settle. The ladder's contract
    // is that rungs are shown, never hidden; keeping it mounted also means the
    // settle swaps rung states in place instead of the ladder jumping in under
    // the streamed text. "generate a prompt first" would be false mid-stream,
    // so the set-up form is kept for when no prompt exists or is coming.
    const streaming = !!(state.result && state.result.streaming);
    const needsPrompt = (rung, text) => (streaming
      ? `<button class="opened-task-rung opened-task-rung--pending" data-rung="${rung}" disabled title="a prompt is generating">${text} <span class="opened-task-setup">generating\u2026</span></button>`
      : `<button class="opened-task-rung opened-task-rung--setup" data-rung="${rung}" data-action="setup" data-setup-needs="prompt" title="generate a prompt first">${text} <span class="opened-task-setup">\u25CB set up \u203A</span></button>`);
    // LIN-3239: the caller's own run allowance, read from GET /api/dispatch/quota
    // at load. It gates the run-step rung here and Go above (LIN-3239/LIN-3341);
    // copy and ✦ generation are never gated by it. `runsUsed` null means the
    // count was unreadable — nothing to show, and no limit to claim.
    const quota = state.runQuota;
    const quotaKnown = !!(quota && quota.runsUsed != null
      && typeof quota.remaining === 'number' && typeof quota.limit === 'number');
    const runsExhausted = quotaKnown && quota.remaining <= 0;
    const runLimitTitle = 'daily run limit reached \u00b7 resets at midnight UTC';
    const runLimited = (rung, text) => `<button class="opened-task-rung opened-task-rung--setup" data-rung="${rung}" disabled title="${runLimitTitle}">${text} <span class="opened-task-setup">${runLimitTitle}</span></button>`;
    const rungs = [];
    // copy: with no prompt there is nothing to copy, and generating on a press
    // labelled "copy" would spend AI behind a non-AI label. So the idle rung is
    // SHOWN disabled with a reason (the ✦ primary is the explicit AI ask). In
    // the fresh state the action cluster already carries the prominent copy, so
    // the rung is not re-rendered — no duplicate copy affordance (F1/F3).
    if (!hasResult) {
      rungs.push(needsPrompt('copy', 'copy'));
    }
    if (opts.dispatchEnabled && hasResult) {
      // Enabled run-step: dispatches the current prompt through the SAME path the
      // dispatch disclosure uses (window.dispatchPrompt, default target cli). Its
      // mode is recorded server-side from the dispatch's `entryRung` (LIN-2942).
      // LIN-3098 N3: where a runner was set up in this browser (and proxy is on),
      // THIS rung alone forces workspace API access onto its dispatch, so the
      // runner's subagent can reach Harbour. Every other caller is unchanged.
      if (runsExhausted) {
        rungs.push(runLimited('run-step', 'run this step'));
      } else {
        const force = opts.proxyEnabled && runnerMarkerSet(opts.urlKey) ? ' data-proxy-force="runner"' : '';
        rungs.push(`<button class="opened-task-rung opened-task-rung--ready" data-rung="run-step" data-action="run-step" data-target="cli"${force}>run this step</button>`);
      }
    } else if (opts.dispatchEnabled) {
      rungs.push(needsPrompt('run-step', 'run this step'));
    } else {
      rungs.push('<button class="opened-task-rung opened-task-rung--setup" data-rung="run-step" data-action="setup" data-setup-needs="dispatch">run this step <span class="opened-task-setup">\u25CB set up \u203A</span></button>');
    }
    // LIN-3341: the `run the whole task` rung is DELETED — Go is that rung now
    // (it dispatches directly rather than fetching a copyable prompt), and the
    // `data-rung="run-task"` vocabulary stays on Go. The ladder is copy →
    // run this step; the run allowance moved into the Go block above.
    // "run on my machine ›" is not a rung: since S4b it sits on the card that
    // opens the task (runnerLinkHtml), so it is not repeated here.
    return `<div class="opened-task-ladder" data-testid="opened-task-ladder">${rungs.join('')}</div>`;
  }

  /**
   * Edit slot promoted to the header (LIN-2944). Swipe has no edit route in P0,
   * so rather than ship a dead visible control the slot is HIDDEN unless the
   * caller supplies `editUrl` — Home provides its inline-edit hook in P1.
   */
  function renderEditSlot(opts) {
    if (!opts.editUrl) return '';
    return `<a class="swipe-prompt-edit" href="${esc(opts.editUrl)}" target="_blank" rel="noopener">Edit</a>`;
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

  // LIN-3098 S4: the dispatch and proxy notices also link to the runner setup
  // page; the text itself is unchanged, and "generate a prompt first" gets no link.
  function setupNoticeHtml(notice, linkHref) {
    if (!notice) return '';
    const link = linkHref
      ? ` <a class="opened-task-setup-runner-link" href="${esc(linkHref)}" data-testid="opened-task-setup-runner-link">run on my machine \u203A</a>`
      : '';
    return `<div class="opened-task-setup-notice">${esc(notice)}${link}</div>`;
  }

  /**
   * The slot for the notice a not-yet-enabled rung shows when pressed ("what
   * it needs"). Shared by BOTH states — idle AND fresh — so a `○ set up ›` rung
   * is never a dead control, including for a remembered prompt restored into
   * fresh (N1). The slot is always rendered, even empty: a press writes ONLY
   * into it (N4), so it can never rebuild the prompt body or streamed text.
   */
  function renderSetupNotice(state) {
    return `<div class="opened-task-notice-slot" data-setup-notice-slot aria-live="polite">${setupNoticeHtml(state.setupNotice, state.setupNoticeLink)}</div>`;
  }

  /**
   * The slot for the R1 token-limit skip notice, beside the action cluster. It
   * is always rendered (empty or filled) so a copy/download can write into it
   * directly without rebuilding the prompt body. Plain words, never an error.
   */
  function renderProxyLimitNotice(state) {
    return `<div class="opened-task-proxy-limit" data-proxy-limit-slot aria-live="polite">${state.proxyLimitNotice ? esc(state.proxyLimitNotice) : ''}</div>`;
  }

  /**
   * Build the idle opened-task shell: the one-line why, Go (the primary that
   * starts the run), the ✦ next-step secondary, the ladder, and the templates
   * under "other prompts" (LIN-2944, LIN-3341).
   */
  function renderIdle(opts, state) {
    let html = '<div class="swipe-prompt-header"><span class="swipe-prompt-name">next step</span>';
    html += renderEditSlot(opts);
    html += '</div>';
    html += renderWhy(opts);
    html += renderGo(opts, state);
    html += renderNextStep(opts, state);
    html += renderLadder(opts, state);
    html += renderSetupNotice(state);
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
      // the button: applyState binds ProxyToggle to it after insertion.
      // LIN-2944 P3: a plain-words label sits beside it, with a "what's this?"
      // disclosure that explains what turning the proxy on does and how to turn
      // it off. Native <details> matches the settings-page disclosure pattern.
      html += '<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>';
      html += '<details class="opened-task-proxy">'
        + '<summary class="opened-task-proxy-label">your agent can read &amp; update your tasks \u00b7 what\u2019s this? \u203A</summary>'
        + '<div class="opened-task-proxy-faq">'
        + '<p>With this on, every prompt you copy, download or dispatch carries a workspace API access block so your agent can read and update your tasks through Harbour\u2019s own API. Each copy mints a fresh single-use read/write token, valid for 48 hours, and it appears in this prompt only.</p>'
        + '<p>It also enables the proxy page and nav link, Autopilot prompts and next-run dispatch, and it removes the \u201cproxy off\u201d notices on the surfaces that need it.</p>'
        + '<p>Token creation for prompt copies is capped at 60 per 15 minutes per account. If the cap is reached, the copy or download still completes but skips the agent-access block, and a note beside the toggle says so \u2014 try again in a few minutes.</p>'
        + '<p>Turn it off any time by pressing <strong>+proxy</strong> again, or by switching off <strong>Linear API proxy</strong> in <a href="/workspace/'
        + esc(opts.urlKey || '')
        + '/settings">Settings</a>.</p>'
        + '</div>'
        + '</details>';
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
    // F2: regenerate is a second `__ai__` entry point, so it obeys the SAME
    // disabled gate as the primary — AI-off-by-choice / unconfigured /
    // free-tier-exhausted disable it and it sends zero recommend requests.
    const age = formatGeneratedAge(state.result.generatedAt);
    const gateReason = primaryDisabledReason(opts, state);
    const regenerateDisabled = label === '__ai__' ? gateReason : null;
    const generatedLine = age
      ? ` <span class="opened-task-generated">generated ${esc(age)} \u00b7 <button class="opened-task-regenerate" data-prompt="${esc(label || '')}"${regenerateDisabled ? ` disabled title="${esc(regenerateDisabled)}"` : ''}>regenerate</button></span>`
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
      ${renderProxyLimitNotice(state)}
      ${warningBanner}
      ${reasoningBlock}
      ${renderGo(opts, state)}
      ${renderLadder(opts, state)}
      ${renderSetupNotice(state)}
      <div class="swipe-prompt-text" data-prompt-body>${html}</div>`;
  }

  function renderGenerating(state, opts) {
    const name = state.activeLabelName || 'generating';
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">${esc(name)} \u00b7 generating\u2026</span>
        <span class="recap-spinner" aria-hidden="true"></span>
      </div>
      ${renderGo(opts, state)}
      ${renderSetupNotice(state)}
      <div class="swipe-prompt-text" data-prompt-body>Loading\u2026</div>`;
  }

  function renderError(state, opts) {
    return `
      <div class="swipe-prompt-header">
        <span class="swipe-prompt-name">prompt \u00b7 error</span>
        <button class="swipe-prompt-change" data-action="change">\u21BB back</button>
      </div>
      ${renderGo(opts, state)}
      ${renderSetupNotice(state)}
      <div class="swipe-prompt-text recap-error">${esc(state.error || 'Failed to load prompt.')}</div>`;
  }

  function applyState(container, html, phase) {
    container.innerHTML = html;
    container.setAttribute('data-phase', phase);
    // LIN-3401: the +proxy toggle is bound to itself at the moment it is inserted
    // (there is no delegated listener). The direct-child chain is the header
    // template above; the markdown sinks sit elsewhere, so a look-alike in them
    // is never bound. Every state paint goes through here (expand, poll, swipe
    // card change, setup/error), so no insertion site misses it.
    if (window.ProxyToggle && typeof window.ProxyToggle.bind === 'function' && typeof container.querySelectorAll === 'function') {
      container.querySelectorAll(':scope > .swipe-prompt-header > .swipe-prompt-actions > .prompt-proxy-toggle')
        .forEach((btn) => window.ProxyToggle.bind(btn));
    }
  }

  // LIN-3401: rendered markdown (the prompt body and the reasoning) sits inside
  // this container, so the container-level click handler must not treat a button
  // in it as a control. Ticket text can carry `data-action`/`data-prompt`.
  const MARKDOWN_SINK = '[data-prompt-body], .swipe-reasoning';

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
      // LIN-2944 P3 R1: a toggle-path token-mint 429 makes the copy/download
      // skip the agent-access block; this notice names it beside the toggle.
      proxyLimitNotice: null,
      // Load-time run allowance (LIN-3239). Only fetched when the caller marks
      // the workspace as free-tier, so ordinary units never hit the network
      // here. `null` until the read resolves; it gates ONLY the run rungs.
      runQuota: null,
      // LIN-3341: Go's own state, deliberately OUTSIDE `phase`/`result` so
      // `enterPhase` and `goIdle` never clear it — the started/running line and
      // the refusal notice survive every re-render and every stream settle.
      // status: 'ready' | 'starting' | 'started' | 'running'; headerHtml is the
      // task-page state endpoint's own sentence; notice is our plain-words line.
      go: { status: 'ready', headerHtml: null, notice: null }
    };
    let abortController = null;
    let destroyed = false;
    // LIN-3341: the mount-time "is a run already live?" read and its poll. The
    // read is one best-effort call to the stored-data task state endpoint; the
    // promise is shared with `startRun` so a press during an in-flight read can
    // wait for it (and paint the running line if it reports in progress).
    let mountRead = null;
    let pollTimer = null;
    let pollFailures = 0;

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
      enterPhase('fresh'); // restored-from-memory fresh starts with no notice
      state.result = hydrated;
      state.activeLabel = hydrated.label;
      if (hydrated.label) {
        promptCache.set(`${sessionPromptKey(issueId)}:${hydrated.label}`, hydrated);
        lastPromptLabel.set(sessionPromptKey(issueId), hydrated.label);
      }
    }

    // Every phase transition clears the press-raised setup notice (LIN-2944 N3):
    // the notice's truth is tied to the state it was raised in, so it must not
    // outlive a transition (idle -> generating -> fresh -> error, a new request,
    // and the stream settle). `render()` alone does NOT clear it, so a re-render
    // without a transition keeps the notice visible (N1).
    function enterPhase(phase) {
      state.phase = phase;
      state.setupNotice = null;
      state.setupNoticeLink = null;
    }

    function render() {
      if (destroyed) return;
      if (state.phase === 'idle') {
        applyState(container, renderIdle(opts, state), 'idle');
      } else if (state.phase === 'generating') {
        applyState(container, renderGenerating(state, opts), 'generating');
      } else if (state.phase === 'fresh') {
        applyState(container, renderFresh(state, opts), 'fresh');
      } else if (state.phase === 'error') {
        applyState(container, renderError(state, opts), 'error');
      }
    }

    // LIN-3341: repaint ONLY the Go slot. A full render() during the ✦ stream
    // would rebuild [data-prompt-body] and wipe the streamed text (N4), so every
    // Go state change touches only [data-go-slot] (falling back to a full render
    // when the slot is absent, e.g. a caller that skins the component).
    function paintGo() {
      if (destroyed) return;
      const slot = container.querySelector && container.querySelector('[data-go-slot]');
      if (slot) slot.outerHTML = renderGo(opts, state);
      else render();
    }

    function goIdle() {
      enterPhase('idle');
      state.result = null;
      state.activeLabel = null;
      state.activeLabelName = null;
      state.error = null;
      render();
    }

    // LIN-2942: record which way the task was taken, fire-and-forget. The
    // server stamps the account and time; a failed record never blocks or
    // alters the press. The client never records a dispatch — the dispatch
    // route does, from `entryRung`, once the item exists.
    function recordTaskMode(evt) {
      try {
        if (!opts.urlKey || !issue.identifier) return;
        fetch(`/workspace/${encodeURIComponent(opts.urlKey)}/api/task-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...evt,
            surface: opts.surface || null,
            issueId: issueId || null,
            issueIdentifier: issue.identifier
          }),
          keepalive: true
        }).catch(() => {});
      } catch {
        // ignored: recording is a measurement, never part of the press
      }
    }

    // The rung an act on the current result belongs to: an autopilot result is
    // "run-task"; any other result is copied ("copy") or dispatched
    // ("run this step").
    function isAutopilotResult() {
      const label = state.result && state.result.label;
      return isAutopilotLabel(label);
    }

    async function fetchPrompt(label) {
      if (abortController) abortController.abort();
      abortController = new AbortController();
      const ac = abortController;

      enterPhase('generating'); // a new request clears any press notice
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
            // LIN-3246: the ladder's own autopilot run is bounded to the PR —
            // close-out is the person's to send. Every other launcher omits it.
            stopAt: 'pr',
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
          promptCache.set(`${sessionPromptKey(issueId)}:${label}`, entry);
          lastPromptLabel.set(sessionPromptKey(issueId), label);
          savePromptMemory(opts.urlKey, issueId, entry);
          enterPhase('fresh');
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
          promptCache.set(`${sessionPromptKey(issueId)}:${label}`, entry);
          lastPromptLabel.set(sessionPromptKey(issueId), label);
          savePromptMemory(opts.urlKey, issueId, entry);
          enterPhase('fresh');
          state.result = entry;
          render();
        }
      } catch (err) {
        if (err.name === 'AbortError' || destroyed) return;
        container.classList.remove('streaming');
        enterPhase('error');
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

      // First render: swap to fresh with empty body so the stream animates inline.
      // `streaming` lives on this placeholder result, so it ends with it: the
      // settle, an error, `↻ change` or a new request all replace the result.
      enterPhase('fresh');
      state.result = { label, name: 'AI thinking\u2026', raw: '', html: '', reasoning: '', streaming: true };
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
      promptCache.set(`${sessionPromptKey(issueId)}:${label}`, entry);
      lastPromptLabel.set(sessionPromptKey(issueId), label);
      savePromptMemory(opts.urlKey, issueId, entry);
      enterPhase('fresh');
      state.result = entry;
      render();
    }

    // ── LIN-3341: Go's start / mount-read / poll ────────────────────────────
    //
    // Read the task-page stored state once (best-effort). Same endpoint the task
    // page polls; never a provider call. A non-2xx/throw is a no-op, exactly
    // like the quota read (routes/task-page.js).
    function readTaskState() {
      if (typeof window.api !== 'function') return Promise.resolve(null);
      if (!opts.urlKey || !issue.identifier || !issueId) return Promise.resolve(null);
      const url = `/workspace/${encodeURIComponent(opts.urlKey)}/api/task/${encodeURIComponent(issue.identifier)}/state?issueId=${encodeURIComponent(issueId)}`;
      return Promise.resolve()
        .then(() => window.api(url, { on401: false }))
        .catch(() => null);
    }

    // Round-3 fix 1A: a WAITING session counts as in progress too — `live` only
    // covers running/queued. Go must be suppressed while a run awaits an answer,
    // or a second press starts a second orchestrator.
    function goInProgress(data) {
      return !!(data && (data.live === true || data.status === 'waiting'));
    }

    // Paint the started/running line from the state endpoint and keep reading
    // while the run is in progress.
    function setGoRunning(headerHtml) {
      state.go = { status: 'running', headerHtml: headerHtml || null, notice: null, noticeLink: null, noticeLinkLabel: null };
      paintGo();
      startPoll();
    }

    function stopPoll() {
      if (pollTimer != null) { clearTimeout(pollTimer); pollTimer = null; }
    }

    function schedulePoll(delay) {
      stopPoll();
      if (destroyed) return;
      pollTimer = setTimeout(runPoll, delay);
    }

    // One poll beat. A failed read backs off x2 to 60s; a successful read paints
    // the task page's own sentence and keeps going while (live || waiting).
    function runPoll() {
      pollTimer = null;
      if (destroyed) return;
      if (!state.go || (state.go.status !== 'running' && state.go.status !== 'started')) return;
      if (typeof document !== 'undefined' && document.hidden) { schedulePoll(10000); return; }
      readTaskState().then((data) => {
        if (destroyed) return;
        if (!data) {
          pollFailures += 1;
          schedulePoll(Math.min(60000, 10000 * Math.pow(2, pollFailures)));
          return;
        }
        pollFailures = 0;
        if (data.headerHtml) {
          state.go = { status: 'running', headerHtml: data.headerHtml, notice: null, noticeLink: null, noticeLinkLabel: null };
          paintGo();
        }
        if (goInProgress(data)) schedulePoll(10000);
        // else: the run ended; keep the last sentence and stop polling.
      });
    }

    function startPoll() {
      pollFailures = 0;
      schedulePoll(10000);
    }

    function applyGoRefusal(error) {
      const code = error && error.body && error.body.code;
      const g = { status: 'ready', headerHtml: null, notice: null, noticeLink: null, noticeLinkLabel: null };
      if (code === 'DUPLICATE_DISPATCH') {
        g.notice = 'Already running';
        g.noticeLink = window.taskPageHref({ urlKey: opts.urlKey, identifier: issue.identifier, source: issue.source });
        g.noticeLinkLabel = 'watch \u203A';
      } else if (code === 'RUN_LIMIT_REACHED') {
        g.notice = 'You\u2019ve used today\u2019s runs \u00b7 resets at midnight UTC';
      } else {
        // Includes a code-less 503 (proxyAttachFailed) and RUN_LIMIT_UNVERIFIED:
        // branch on `code`, never on the status (review 1, outcomes).
        g.notice = 'Couldn\u2019t start the run. Try again in a minute, or';
        g.noticeLink = runnerSetupHref(opts);
        g.noticeLinkLabel = 'run on my machine \u203A';
      }
      state.go = g;
      paintGo();
    }

    // The one-press Go: kickoff then dispatch through the shared assemblers,
    // then show that it started. Auto-ignores a second press.
    async function startRun() {
      if (!state.go || state.go.status !== 'ready') return;
      state.go = { status: 'starting', headerHtml: null, notice: null, noticeLink: null, noticeLinkLabel: null };
      paintGo();
      recordTaskMode({ rung: 'run-task', ready: true, needs: null, act: 'press' });

      // Race (round-3 fix 1B): if the mount read is still in flight, wait for it;
      // if it reports in progress, paint the running line and start the poll HERE
      // (the mount handler drops its own result because Go is now `starting`).
      if (mountRead) {
        const data = await mountRead.catch(() => null);
        if (destroyed) return;
        if (goInProgress(data)) { setGoRunning(data.headerHtml); return; }
        if (state.go.status !== 'starting') return;
      }

      try {
        const kickoff = await window.fetchAutopilotKickoff({
          urlKey: opts.urlKey,
          issueId,
          source: issue.source || undefined,
          stopAt: 'pr',
          on401: false
        });
        if (destroyed) return;
        const panel = container.querySelector('.swipe-prompt-options');
        const { model, harness: panelHarness } = window.readDispatchExecControls(panel);
        const result = await window.dispatchPrompt({
          urlKey: opts.urlKey,
          prompt: kickoff.prompt,
          promptName: kickoff.promptName || 'Autopilot',
          kind: kickoff.kind || 'autopilot',
          issue,
          target: 'cli',
          model,
          // LIN-3211: a blank harness falls back to claude-code, so the item
          // carries the structured bootstrap token, never a token in prose.
          harness: (panelHarness || 'claude-code'),
          proxyForce: true,
          entryRung: 'run-task',
          stopAt: 'pr',
          variant: 'standard',
          surface: opts.surface
        });
        if (destroyed) return;
        // The 201's no-runner warning (routes/dispatch.js) is our own plain-words
        // line, never the server's string (FC call bf44d014).
        const noRunner = !!(result && result.warning);
        state.go = {
          status: 'started',
          headerHtml: null,
          notice: noRunner ? 'Nothing is listening for this run yet.' : null,
          noticeLink: noRunner ? runnerSetupHref(opts) : null,
          noticeLinkLabel: noRunner ? 'run on my machine \u203A' : null
        };
        paintGo();
        startPoll();
      } catch (error) {
        if (destroyed) return;
        applyGoRefusal(error);
      }
    }

    function handleClick(e) {
      const btn = e.target.closest('button, .swipe-reasoning-toggle');
      if (!btn || !container.contains(btn)) return;
      if (btn.closest(MARKDOWN_SINK)) return;
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
        // LIN-2942: fetching the kickoff is the "run the whole task" press. A
        // template or ✦ next-step fetch is looking, not taking: not recorded.
        if (promptLabel === '__autopilot__' || promptLabel === '__autopilot_stepper__') {
          recordTaskMode({ rung: 'run-task', ready: true, needs: null, act: 'press' });
        }
        fetchPrompt(promptLabel);
        return;
      }

      if (action === 'setup') {
        // A not-yet-enabled rung says what it needs. It does NOT spend; the press
        // is recorded as intent (LIN-2942), and nothing is dispatched.
        // N4: the press writes ONLY the notice slot, never a full render(), so
        // it cannot rebuild the prompt body — above all the streamed text while
        // the ✦ stream is in flight (the stream paints the body directly).
        const needs = btn.dataset.setupNeeds;
        // LIN-3341: Go is its own control now, so its not-set-up notice names
        // Go, not the run-step rung. The run-step and prompt wording is unchanged.
        const isGo = btn.dataset.rung === 'run-task';
        const notice = needs === 'dispatch'
          ? (isGo ? 'Go needs the dispatch runner set up' : 'running this step needs the dispatch runner set up')
          : needs === 'prompt'
            ? 'generate a prompt first'
            : (isGo ? 'Go needs the proxy set up' : 'running the whole task needs the proxy set up');
        state.setupNotice = notice;
        state.setupNoticeLink = needs === 'dispatch' || needs === 'proxy' ? runnerSetupHref(opts) : null;
        const slot = container.querySelector('[data-setup-notice-slot]');
        if (slot) slot.innerHTML = setupNoticeHtml(state.setupNotice, state.setupNoticeLink);
        recordTaskMode({ rung: btn.dataset.rung, ready: false, needs, act: 'press' });
        return;
      }

      if (action === 'go') {
        // LIN-3341: one press starts the run.
        startRun();
        return;
      }

      if (action === 'run-step') {
        // F1: the enabled run-step rung runs the CURRENT prompt through the same
        // dispatch path as the disclosure (target read from data-target=cli). It
        // is only enabled in the fresh state (renderLadder), so `raw` exists.
        handleDispatch(btn);
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

      // +proxy toggle clicks are bound on the button itself (applyState ->
      // ProxyToggle.bind, LIN-3401) — no per-section handling needed here.
    }

    // LIN-2944 P3 R1: after a copy/download, surface the token-limit skip beside
    // the toggle if maybeAppend had to omit the agent-access block.
    function applyProxyLimitNotice() {
      const T = window.ProxyToggle;
      if (!(T && typeof T.takeRateLimitNotice === 'function' && T.takeRateLimitNotice())) return;
      state.proxyLimitNotice = T.RATE_LIMIT_SKIP_NOTICE || 'The agent-access link was skipped — the token limit was reached. Try again in a few minutes.';
      const slot = container.querySelector('[data-proxy-limit-slot]');
      if (slot) slot.textContent = state.proxyLimitNotice;
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
        applyProxyLimitNotice();
        await navigator.clipboard.writeText(text);
        recordTaskMode({ rung: isAutopilotResult() ? 'run-task' : 'copy', ready: true, needs: null, act: 'copy' });
        btn.textContent = 'copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = 'copy';
          btn.classList.remove('copied');
        }, 2000);
      } catch (error) {
        // LIN-3136: say why (e.g. a driver copy refused for a non-owner), not just 'failed'.
        if (typeof window.toast === 'function') window.toast(error.message, { type: 'error' });
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
        applyProxyLimitNotice();
        const filename = buildPromptFilename(issue.identifier, (state.result && state.result.name) || 'prompt');
        downloadMarkdown(text, filename);
        recordTaskMode({ rung: isAutopilotResult() ? 'run-task' : 'copy', ready: true, needs: null, act: 'copy' });
        btn.textContent = 'saved!';
        btn.classList.add('copied');
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = 'download';
          btn.classList.remove('copied');
        }, 2000);
      } catch (error) {
        // LIN-3136: say why (e.g. a driver copy refused for a non-owner), not just 'failed'.
        if (typeof window.toast === 'function') window.toast(error.message, { type: 'error' });
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
        const isRunStep = btn.dataset.action === 'run-step';
        // LIN-3211: the run-step rung sits in the ladder, outside the panel, so
        // `closest` finds nothing there. It reads its own card's panel instead,
        // and a blank harness falls back to claude-code, so the item carries the
        // structured bootstrapToken rather than a token in prompt prose.
        const panel = isRunStep ? container.querySelector('.swipe-prompt-options') : btn.closest('.swipe-prompt-options');
        const { model, harness: panelHarness } = window.readDispatchExecControls(panel);
        const harness = isRunStep ? (panelHarness || 'claude-code') : panelHarness;
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
          // LIN-3098 N3: or by the run-step rung, when a runner was set up in
          // this browser (only that rung carries data-proxy-force="runner").
          proxyForce: !!(state.result && state.result.proxyForce) || btn.dataset.proxyForce === 'runner',
          // LIN-2942: the rung this dispatch was taken on; the server records it,
          // linked to the created item.
          entryRung: isAutopilotResult() ? 'run-task' : 'run-step',
          // LIN-3246: the ladder's own autopilot run declares the PR boundary on
          // the row too (the server validates it); a run-step dispatch does not.
          stopAt: isAutopilotResult() ? 'pr' : undefined,
          // LIN-3248 (N2): the ladder's autopilot press also declares its own
          // variant, so the run page's seam-guard promise is shown only for a
          // standard run (never inferred from promptName).
          variant: isAutopilotResult()
            ? ((state.result && state.result.label === '__autopilot_stepper__') ? 'stepper' : 'standard')
            : undefined,
          // LIN-2944 P1 (handover d610edd0): which opened-task surface this came
          // from, so Home (`home`) and Swipe (`swipe`) dispatches are
          // distinguishable in the task-mode log. The server validates it against
          // SURFACES and records it in place of null.
          surface: opts.surface || undefined
        });
        btn.textContent = '\u2713';
      } catch (error) {
        // LIN-3136: say why (e.g. a driver copy refused for a non-owner), not just 'failed'.
        if (typeof window.toast === 'function') window.toast(error.message, { type: 'error' });
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

    // LIN-3239: the caller's run allowance must be known at load so the ladder
    // can show "N of <limit> runs left today" before Go and disable only the run
    // rungs at zero. The authoritative read is S1's GET /api/dispatch/quota
    // (routes/dispatch.js) — the session account's own merge-group counts, never
    // instance-wide. It is a read, never a spend. Only consulted when the caller
    // marks the workspace free-tier, so other consumers/units never touch the
    // network from init.
    if (opts.freeTier) {
      const quotaPrefix = opts.urlKey ? `/workspace/${encodeURIComponent(opts.urlKey)}` : '';
      Promise.resolve()
        .then(() => window.api(`${quotaPrefix}/api/dispatch/quota`, { on401: false }))
        .then((data) => {
          if (destroyed) return;
          if (data && data.limited && data.runsUsed != null
            && typeof data.remaining === 'number' && typeof data.limit === 'number') {
            state.runQuota = { remaining: data.remaining, limit: data.limit, runsUsed: data.runsUsed };
          }
          render();
        })
        .catch(() => {
          if (destroyed) return;
          render();
        });
    }

    // LIN-3341 finding 7: on mount, ask once whether a run is already live on
    // this task, so a reopened task shows the running/waiting line instead of a
    // pressable Go. Best-effort and guarded exactly like the quota read, so a
    // unit with no window.api makes no network call and no unhandled rejection.
    // The promise is kept in `mountRead` so a press during the in-flight read can
    // wait for it (round-3 fix 1B).
    if (goReady(opts) && typeof window.api === 'function'
      && opts.urlKey && issue.identifier && issueId) {
      mountRead = readTaskState();
      mountRead.then((data) => {
        if (destroyed) return;
        if (!goInProgress(data)) return;
        if (!state.go || state.go.status !== 'ready') return; // a press already won
        setGoRunning(data.headerHtml);
      });
    }

    return {
      destroy() {
        destroyed = true;
        stopPoll();
        // Aborting the controller aborts the in-flight fetch/recommend stream;
        // window.readSSEStream's read() then rejects with AbortError, which
        // fetchPrompt's catch swallows (and onEvent already no-ops once
        // `destroyed`). The container listener is the only DOM teardown.
        if (abortController) abortController.abort();
        container.removeEventListener('click', handleClick);
      },
      getCachedLabel() {
        const key = sessionPromptKey(issueId);
        const l = lastPromptLabel.get(key);
        const entry = l ? promptCache.get(`${key}:${l}`) : null;
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
    const key = sessionPromptKey(issueId);
    const l = lastPromptLabel.get(key);
    const entry = l ? promptCache.get(`${key}:${l}`) : null;
    if (entry) return { label: l, name: entry.name };
    const memory = urlKey ? loadPromptMemory(urlKey, issueId) : null;
    return memory ? { label: memory.label, name: memory.name } : null;
  }

  window.PromptSection = { init, getCached, runnerLinkHtml };
})();
