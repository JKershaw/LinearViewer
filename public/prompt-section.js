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
        generatedAt: entry.generatedAt,
        // LIN-3968: optional; a record written before it simply has none.
        target: entry.target || undefined
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
   * run. Unconfigured (no OpenRouter) is the only disabled state (LIN-3848 removed the
   * `aiRecommendations` switch). The prompt action is NOT gated by
   * the run allowance (LIN-3239): prompts are unlimited, so only run rungs carry
   * the run-limit state. The action is SHOWN in every state, never hidden (F9).
   */
  function primaryDisabledReason(opts, state) {
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

  // The run allowance as the Go button and the run-step rung both read it
  // (LIN-3706: one copy, was two). Browser code cannot import
  // lib/plan-allowance.js, so the sentence stays a literal here. `runsUsed` null
  // means the count was unreadable: no quota is claimed, so nothing is exhausted.
  function runQuotaView(state) {
    const quota = state.runQuota;
    const quotaKnown = !!(quota && quota.runsUsed != null
      && typeof quota.remaining === 'number' && typeof quota.limit === 'number');
    return {
      quota,
      quotaKnown,
      runsExhausted: quotaKnown && quota.remaining <= 0,
      runLimitTitle: 'daily run limit reached \u00b7 resets at midnight UTC'
    };
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
   *     task-mode-store.test.js). Ready means the viewer has run controls (LIN-3849: the owner of a workspace with a live runner key or queue token).
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
    return !!opts.dispatchEnabled;
  }

  // LIN-3975: what each opened-task surface shows, one row per capability. `home` is Home's opened task, `task`
  // the task page's own run control (its top answer already says the sentence, so no state block and no
  // repeated running line), `swipe` the Swipe card and the fallback for any other caller. A surface added to
  // SURFACES (lib/task-mode-store.js) needs a row here; a unit test pins that every one has a value.
  //   runningBody: 'blank' = the running line says the link only (home, task); 'header' = the state's sentence (swipe).
  //   watchLink:   the "watch on the task page" link, not drawn where the viewer is already on the task page.
  const SURFACE_CAPABILITIES = Object.freeze({
    // runBox (LIN-4010): Home's run box, running box, one-line state and Change drawer. The task page and Swipe keep
    // their own run markup, so they stay as they were.
    home: Object.freeze({ stateBlock: true, copyFirst: true, runControl: true, runBox: true, runningBody: 'blank', watchLink: true, plainPromptBox: true, lastCopy: true, sharedButtons: true }),
    task: Object.freeze({ stateBlock: false, copyFirst: true, runControl: true, runBox: false, runningBody: 'blank', watchLink: false, plainPromptBox: true, lastCopy: true, sharedButtons: true }),
    swipe: Object.freeze({ stateBlock: false, copyFirst: false, runControl: false, runBox: false, runningBody: 'header', watchLink: true, plainPromptBox: false, lastCopy: false, sharedButtons: false })
  });
  function capabilitiesOf(surface) {
    return SURFACE_CAPABILITIES[surface] || SURFACE_CAPABILITIES.swipe;
  }

  // LIN-3849: key tools (+proxy, Autopilot) have no switch. The landing preview
  // is the one surface without a workspace, and it has no key to make.
  function hasKeyTools(opts) {
    return !!opts.urlKey;
  }

  function renderGo(opts, state) {
    const g = state.go || { status: 'ready' };
    const ready = goReady(opts);
    const { quota, quotaKnown, runsExhausted, runLimitTitle } = runQuotaView(state);
    const caps = capabilitiesOf(opts.surface);
    // LIN-3987: Home's Go takes the shared button classes. Swipe's card draws this same Go, and it keeps its own look (no change there).
    const homeBtn = caps.sharedButtons ? 'btn ' : '';

    let html = '<div class="opened-task-primary" data-go-slot>';

    if (g.status === 'started' || g.status === 'running') {
      // The started/running line: the task page's OWN sentence (the one source
      // of queued/running truth), with a link to the task page. Until a state
      // read lands, it says "Started" — true on a 201, not a status claim.
      // LIN-4010: once the running box shows, it holds the Watch link, so the Go slot does not repeat it.
      const boxed = caps.runBox && !!(state.opened && state.opened.sessions && state.opened.sessions.running && state.opened.sessions.running.state !== 'queued');
      const href = caps.watchLink && !boxed && window.taskPageHref({
        urlKey: opts.urlKey,
        identifier: opts.issue && opts.issue.identifier,
        source: opts.issue && opts.issue.source
      });
      const link = href
        ? ` <a class="opened-task-started-link" href="${esc(href)}" data-testid="opened-task-started-link">watch on the task page \u203A</a>`
        : '';
      // LIN-3991 (item 5): on Home (and the task page) the top answer already says the running sentence once, so the
      // Go slot keeps only the watch link; "Started." stays until the first state read lands.
      const body = g.headerHtml
        ? (caps.runningBody === 'blank' ? '' : g.headerHtml)
        : '<p class="task-sentence" data-testid="opened-task-sentence">Started.</p>';
      html += `<div class="opened-task-started" data-testid="opened-task-started" data-go-status="${esc(g.status)}">${body}${link}</div>`;
    } else if (!ready) {
      // LIN-3849: only an owner with no way to run yet is offered "set up ›";
      // anyone else gets no run control at all (copy-first view, LIN-3833, is
      // not built yet, so this is today's non-run view).
      if (opts.runSetup) {
        html += `<button class="${homeBtn}opened-task-go opened-task-go--setup" data-testid="opened-task-go" data-rung="run-task" data-action="setup" data-setup-needs="dispatch">Go <span class="opened-task-setup">\u25CB set up \u203A</span></button>`;
      }
    } else if (runsExhausted) {
      html += `<button class="${homeBtn}opened-task-go opened-task-go--limited" data-testid="opened-task-go" data-rung="run-task" disabled title="${runLimitTitle}">Go <span class="opened-task-setup">${runLimitTitle}</span></button>`;
    } else if (g.status === 'starting') {
      html += `<button class="${homeBtn}opened-task-go" data-testid="opened-task-go" data-rung="run-task" disabled>starting\u2026</button>`;
    } else if (caps.sharedButtons) {
      // LIN-3833: Home's one main action names what it does: the step the sessions name, else Run to PR.
      // While a stage runs or is queued, no other step is offered as an action (LIN-3968); Stop and the
      // after-run line stay in the run block.
      const step = runStepOfState(state, opts);
      if (step) html += `<button class="btn btn--primary opened-task-go opened-task-go--main" data-testid="opened-task-go" data-rung="run-step" data-action="run-step-next">Run ${esc(step.label)}</button>`;
      else if (state.opened && !stageBusy(state)) html += '<button class="btn btn--primary opened-task-go opened-task-go--main" data-testid="opened-task-go" data-rung="run-task" data-action="go">Run to PR</button>';
    } else {
      html += `<button class="opened-task-go" data-testid="opened-task-go" data-rung="run-task" data-action="go">Go</button>`;
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
   * for an owner with no way to run (`opts.runSetup`, LIN-3849); for anyone
   * else the run rung is not rendered. Pressing a
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
    return `Harbour can also run steps for you, on your own machine. <a class="opened-task-runner-link" href="${esc(runnerSetupHref({ urlKey }))}" data-testid="opened-task-runner-link">Set up a runner \u203A</a>`;
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
    const { quota, quotaKnown, runsExhausted, runLimitTitle } = runQuotaView(state);
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
        const force = runnerMarkerSet(opts.urlKey) ? ' data-proxy-force="runner"' : '';
        rungs.push(`<button class="opened-task-rung opened-task-rung--ready" data-rung="run-step" data-action="run-step" data-target="cli"${force}>run this step</button>`);
      }
    } else if (opts.dispatchEnabled) {
      rungs.push(needsPrompt('run-step', 'run this step'));
    } else if (opts.runSetup) {
      rungs.push('<button class="opened-task-rung opened-task-rung--setup" data-rung="run-step" data-action="setup" data-setup-needs="dispatch">run this step <span class="opened-task-setup">\u25CB set up \u203A</span></button>');
    }
    // LIN-3341: the `run the whole task` rung is DELETED — Go is that rung now
    // (it dispatches directly rather than fetching a copyable prompt), and the
    // `data-rung="run-task"` vocabulary stays on Go. The ladder is copy →
    // run this step; the run allowance moved into the Go block above.
    // "run on my machine ›" is not a rung: since S4b it sits on the card that
    // opens the task (runnerLinkHtml), so it is not repeated here.
    return `<div class="opened-task-ladder" data-testid="opened-task-ladder" data-ladder-slot>${rungs.join('')}</div>`;
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
   * Always shown (LIN-3848 removed the `promptButtons` switch).
   */
  function renderOtherPrompts(opts, state) {
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
    if (hasKeyTools(opts)) {
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
  // LIN-3833: the copy-first view (no runner). The step comes from the task's status alone (Todo: Plan,
  // Backlog: Scoping; In Progress: the selector generates the next prompt, with no name given, John 24 Oct
  // answer 1). Unknown or finished status: the next prompt, generated.
  const COPY_STEPS = Object.freeze({
    unstarted: Object.freeze({ label: 'plan', name: 'Plan', why: 'the first step for a task in Todo' }),
    backlog: Object.freeze({ label: 'scoping', name: 'Scoping', why: 'the first step for a task in Backlog' }),
  });
  const COPY_NEXT = Object.freeze({ label: '__ai__', name: null, why: 'Generate the next prompt for this task' });
  // LIN-4010: the tracker's word for a state type, for the copy-first state line.
  const COPY_STATE_WORDS = Object.freeze({ started: 'In progress', unstarted: 'Todo', backlog: 'Backlog', completed: 'Done', canceled: 'Cancelled', duplicate: 'Duplicate' });
  function copyStepOf(opts) {
    return COPY_STEPS[opts.issue && opts.issue.stateType] || COPY_NEXT;
  }

  // The last copy on this task, read from the task-mode record (the mount read) or set by a copy just made.
  function renderLastCopy(state) {
    const c = state.lastCopy;
    if (!c) return '';
    const age = formatGeneratedAge(c.at ? Date.parse(c.at) : Date.now()) || 'just now';
    const what = c.label ? `the ${esc(c.label)} prompt` : 'a prompt';
    return `<div class="opened-task-last-copy" data-testid="opened-task-last-copy">You copied ${what} ${esc(age)}</div>`;
  }

  // LIN-3975: the "You copied \u2026" line sits in the copy-first view itself (it was the state block's line on Home),
  // so the task page's copy-first view has it too. A copy repaints only this slot (paintLastCopy).
  function renderLastCopySlot(state) {
    return `<div class="opened-task-last-copy-slot" data-last-copy-slot>${renderLastCopy(state)}</div>`;
  }

  function renderCopyIdle(opts, state) {
    const step = copyStepOf(opts);
    // The AI gate applies to the selector's own write only; a template step needs no AI.
    const gateReason = step.label === '__ai__' ? primaryDisabledReason(opts, state) : null;
    const disabled = gateReason ? ` disabled title="${esc(gateReason)}"` : '';
    const name = step.name ? `<span class="opened-task-step-name">${esc(step.name)}</span> \u00b7 ` : '';
    const reason = gateReason ? ` <span class="opened-task-primary-reason" data-testid="opened-task-primary-reason">${esc(gateReason)}</span>` : '';
    return renderLastCopySlot(state)
      + `<div class="opened-task-step" data-testid="opened-task-step">${name}${esc(step.why)}</div>`
      + `<button class="btn opened-task-write" data-testid="opened-task-write" data-prompt="${esc(step.label)}"${disabled}>\u2726 Write the prompt</button>${reason}`;
  }

  // LIN-3968: the recommender's routing breadcrumbs ("↳ X is a container → routing to Y", and the mock's
  // unarrowed form) are its own steps. The target line says which task the prompt is for, so they stay out.
  const ROUTING_BREADCRUMB = /^\s*(?:\u21b3\s*)?[^\n]*\u2192 routing to [^\n]*$/gm;
  function shownReasoning(text) {
    return String(text || '').replace(ROUTING_BREADCRUMB, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // LIN-3968: which task a written prompt is for, in plain words, when Harbour wrote it for a subtask (the
  // container routed to it). Nothing when the prompt is for the opened task itself.
  function targetSentence(target, openedId) {
    if (!target || !target.identifier || target.identifier === openedId) return null;
    const title = target.title ? ` ${target.title}` : '';
    const via = (target.deferredVia || []).filter(id => id && id !== target.identifier).at(-1) || null;
    if (!via) return `This prompt is for ${target.identifier}${title}.`;
    return `This prompt is for ${target.identifier}${title}, a subtask of ${via}. ${via}\u2019s work is split into subtasks, so Harbour wrote the prompt for the one to do next.`;
  }
  function renderTargetLine(state, opts) {
    const line = targetSentence(state.result && state.result.target, opts.issue && opts.issue.identifier);
    return line ? `<p class="opened-task-target" data-testid="opened-task-target">${esc(line)}</p>` : '';
  }

  // The written prompt: Copy, the bounded box, Rewrite and Download (both views). `note` sits beside Copy (LIN-3991:
  // the copy-first instruction is where the person acts on it); the run-first view passes none.
  function renderPromptBox(state, opts, note = '') {
    const { raw, warning, label, reasoning } = state.result;
    const warningBanner = warning ? `<div class="swipe-prompt-warning">\u26A0 ${esc(warning)}</div>` : '';
    // LIN-2944 reverses LIN-70: the model's reasoning stays visible beside the prompt.
    const shown = shownReasoning(reasoning);
    const reasoningBlock = shown ? `<div class="swipe-reasoning opened-task-reasoning" data-testid="opened-task-reasoning">${renderReasoning(shown)}</div>` : '';
    // LIN-2944 F2: Rewrite re-runs the same label, so it obeys the same gate as the primary.
    const gateReason = primaryDisabledReason(opts, state);
    const rewriteDisabled = label === '__ai__' ? gateReason : null;
    return `
      <div class="opened-task-copy-row">
        <button class="btn btn--primary opened-task-copy" data-testid="opened-task-copy" data-action="copy">Copy prompt</button>
        ${note ? `<p class="opened-task-paste">${esc(note)}</p>` : ''}
      </div>
      ${renderProxyLimitNotice(state)}
      ${warningBanner}
      ${reasoningBlock}
      <div class="opened-task-box"><div class="opened-task-text" data-prompt-body>${esc(raw || '')}</div></div>
      <div class="opened-task-box-actions">
        <button class="btn opened-task-regenerate" data-prompt="${esc(label || '')}"${rewriteDisabled ? ` disabled title="${esc(rewriteDisabled)}"` : ''}>Rewrite</button>
        <button class="btn opened-task-download" data-action="download" title="Download prompt as a .md file">Download</button>
      </div>`;
  }

  // LIN-3968: the header names the step this view offers (Plan, Scoping, or the next prompt), not the
  // result's `AI Recommendation` name, which Swipe and prompt memory share.
  function renderCopyFresh(state, opts) {
    const age = formatGeneratedAge(state.result.generatedAt);
    const keyOn = !!(window.ProxyToggle && typeof window.ProxyToggle.isActive === 'function' && window.ProxyToggle.isActive());
    return `
      ${renderLastCopySlot(state)}
      <div class="opened-task-step" data-testid="opened-task-step"><span class="opened-task-step-name">${esc(copyStepOf(opts).name || 'Next prompt')}</span>${age ? ` \u00b7 generated ${esc(age)}` : ''}</div>
      ${renderTargetLine(state, opts)}
      ${renderPromptBox(state, opts, 'Copy it, then paste it into Claude Code, Codex or any coding agent.')}
      <label class="opened-task-progress-key"><input type="checkbox" data-testid="opened-task-progress-key"${keyOn ? ' checked' : ''}> Let your agent post progress to this task</label>
      <p class="opened-task-key-note">The key lasts 48 hours. Without it, your agent can still do the work, but Harbour won\u2019t see its progress. Turning it off here sets it for every task.</p>`;
  }

  // LIN-3833: the step a run would start, from the state (a step chosen for this run, else the one the
  // sessions name as next). Shared by the main button (renderGo) and the run block.
  // LIN-3968: the offered step (`sessions.offered`), so a running stage offers no other step, and a failed stage
  // is offered again. `sessions.next` stays the "comes next" wording after a run.
  // LIN-4024: a container offers no stage step (its one action is Run to PR), whatever a step chosen for this run says.
  function runStepOfState(state, opts) {
    if (opts && opts.isContainer) return null;
    return (state.run && state.run.step) || (state.opened && state.opened.sessions && state.opened.sessions.offered) || null;
  }
  // LIN-3975 (review finding 1): busy is any session running, queued or waiting on an answer. A waiting question is
  // not a reason to start another run, so "Run to PR" is not offered beside it (LIN-3968's rule, as nextStepOf applies).
  function stageBusy(state) {
    const sessions = state.opened && state.opened.sessions;
    return !!(sessions && (sessions.busy || sessions.running));
  }

  // LIN-3833: the run control's vocabulary. The targets are the dispatch targets Home offers (`dash` is not
  // offered; LIN-3833 ruling, John 24 Oct); `local` only on localhost. Stop is offered only for a target a
  // runner polls (lib/dispatch-targets.js POLLED_TARGETS).
  const TARGET_WORDS = Object.freeze({ cli: 'your runner', web: 'Claude Code on the web', local: 'Harbour OS' });
  const POLLED_RUN_TARGETS = Object.freeze(['cli', 'web', 'dash']);
  function runChoiceDefaults() {
    return { presetId: null, model: null, harness: null, effort: null, target: 'cli', agentAccess: null };
  }

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
    const { dispatchEnabled, isLocalhost, issue } = opts;
    let html = '';
    html += '<button class="swipe-prompt-copy" data-action="copy">copy</button>';
    html += '<button class="swipe-prompt-download" data-action="download" title="Download prompt as a .md file">download</button>';
    if (hasKeyTools(opts) && !opts.hideProxyToggle) {
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
        + '<p>Token creation for prompt copies is capped at 60 per 15 minutes per account. If the cap is reached, the copy or download still completes but skips the agent-access block, and a note beside the toggle says so \u2014 try again in a few minutes.</p>'
        + '<p>Turn it off any time by pressing <strong>+proxy</strong> again.</p>'
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
        buttonDataAction: 'dispatch',
        // LIN-3833: nothing pre-selected, so an untouched harness is null and the server settles it.
        harnessDefault: ''
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
    const actions = renderActionCluster(isForced ? { ...opts, hideProxyToggle: true } : opts);
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
    // LIN-3991: the exact time beside a state sentence is painted in the reader's zone.
    if (typeof window.initLocalTimes === 'function') window.initLocalTimes(container);
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
    // LIN-4024: the run, its state read, Stop and Watch name the opened task itself. A container's autopilot runs on
    // it and works through its subtasks, so no subtask is named here; the ✦ write does not use this either.
    const runSubject = { issue, issueId };
    container.classList.add('prompt-section');
    // LIN-3833: the state block and the copy-first view are Home's. Swipe's card keeps its own Edit slot and
    // change affordances, which the state-first layout does not replace (the PR says so). LIN-3975: which of
    // these a surface shows is one table (SURFACE_CAPABILITIES), not a surface-name test here.
    const caps = capabilitiesOf(opts.surface);
    if (caps.runBox) container.classList.add('opened-task-home');
    // A viewer with no runner (no dispatch) gets the copy-first view on any surface that has one.
    const copyFirstView = () => caps.copyFirst && !opts.dispatchEnabled;

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
      go: { status: 'ready', headerHtml: null, notice: null },
      // LIN-3833: the stored-data task state the state block shows (the state endpoint's body: header,
      // stage strip and session summary). Null until the mount read lands; a poll refreshes it.
      opened: null,
      // LIN-3833: the run control's own state (Home, dispatch on). `choice` is what this run will use once
      // "Use for this run" is pressed; `draft` is what the Change panel is editing. Nothing is pre-selected:
      // the harness starts null, and the resolved setting is shown on the Runs-on line from the preview.
      run: {
        step: null, choice: runChoiceDefaults(), draft: null, preview: null, changeOpen: false, presets: null,
        // LIN-4010: the Change drawer's "Choose for this run" reveals the decision panel; a choice made there opens it.
        chooseOpen: false, panelNumbers: null,
        panelHtml: null, panelFailed: false, withoutEffort: [],
        anotherOpen: false, moreOpen: false, item: null, confirmStop: false, busy: false
      }
    };
    let abortController = null;
    let destroyed = false;
    // LIN-3341: the mount-time "is a run already live?" read and its poll. The
    // read is one best-effort call to the stored-data task state endpoint;
    // `startRun` does its own fresh read at press time (LIN-3446).
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
        generatedAt: memory.generatedAt,
        target: memory.target || null
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
      const oldQuestion = container.querySelector ? container.querySelector('[data-question-slot]') : null;
      const stateBlock = renderOpenedState();
      // LIN-3833: a viewer with no runner (no dispatch) gets the copy-first view: the step, then the prompt
      // to copy. Everything that runs, costs or names a session is absent from it.
      const copyFirst = copyFirstView();
      const runFirst = runControlOn();
      if (state.phase === 'idle') {
        const idle = runFirst ? renderRunBlock() : (copyFirst ? renderCopyIdle(opts, state) + renderRunnerFoot() : renderIdle(opts, state));
        applyState(container, stateBlock + idle, 'idle');
      } else if (state.phase === 'generating') {
        applyState(container, stateBlock + (runFirst ? renderRunBlock() : '') + renderGenerating(state, opts), 'generating');
      } else if (state.phase === 'fresh') {
        let fresh;
        if (runFirst) fresh = renderRunBlock() + renderPromptBox(state, opts);
        else fresh = copyFirst ? renderCopyFresh(state, opts) + renderRunnerFoot() : renderFresh(state, opts);
        applyState(container, stateBlock + fresh, 'fresh');
      } else if (state.phase === 'error') {
        applyState(container, stateBlock + renderError(state, opts), 'error');
      }
      keepTypedQuestion(oldQuestion);
    }

    // LIN-4024: the question card sits in the state block, so a repaint writes it again. When its markup is unchanged,
    // the card already on the page is put back, so a half-typed answer and its thread survive a poll (the task page keeps
    // its card outside the repainted answer for the same reason). A new card is bound here; the kept one is bound already.
    function keepTypedQuestion(oldQuestion) {
      const fresh = container.querySelector ? container.querySelector('[data-question-slot]') : null;
      if (!fresh) return;
      if (oldQuestion && oldQuestion.innerHTML === fresh.innerHTML) { fresh.replaceWith(oldQuestion); return; }
      if (window.QuestionCards && typeof window.QuestionCards.initQuestionCards === 'function') window.QuestionCards.initQuestionCards(container);
    }

    // LIN-3833: the state block above the control. The task's pill and sentence and its stage strip are
    // the state endpoint's own HTML (the task page's renderers); the last session and "All N" come from
    // its session summary. Always a slot, so a state repaint is `paintState` alone and never rebuilds a
    // prompt body or a streamed reply.
    function renderOpenedState() {
      if (!caps.stateBlock) return '';
      // LIN-4010: a copy-first viewer (no runner) gets the tracker's word and whether a prompt was copied here. No session
      // words: nothing here runs, costs or names a session, so a new user never sees "idle" or "No sessions yet".
      if (copyFirstView()) return renderCopyState();
      const opened = state.opened;
      if (!opened) return `<div class="opened-task-state" data-state-slot data-testid="opened-task-state"></div>`;
      // LIN-4010 review: Home's line is '' while a task runs (the running box says it), so it is not replaced by the
      // task page's sentence. Only a server that sends no Home line at all falls back to headerHtml.
      return `<div class="opened-task-state" data-state-slot data-testid="opened-task-state">`
        + `${opened.homeStatusHtml ?? opened.headerHtml ?? ''}${opened.stripHtml || ''}${renderSubtaskNeedsYou()}${renderQuestionSlot()}</div>`;
    }

    // LIN-4024: a task waiting on an open ruling shows the question and its answers here (the server sends the card to the
    // owner only). Its own slot, so keepTypedQuestion can keep the card a repaint would replace.
    function renderQuestionSlot() {
      const html = state.opened && state.opened.questionHtml;
      return html ? `<div class="opened-task-question" data-question-slot>${html}</div>` : '';
    }

    // LIN-4010: a copy-first viewer's runner line is the foot of the Home box, after the step and the prompt, not a line the
    // server appends after the folds. The text is the server's own (lib/components/runner-link.js).
    function renderRunnerFoot() {
      if (!caps.runBox) return '';
      return `<div class="opened-task-runner-line" data-testid="opened-task-runner-line">${runnerLinkHtml(opts.urlKey)}</div>`;
    }

    // LIN-4010: "Last" sits below the run box, not in the state block. No "Last" line while a session runs: the running
    // box says what runs and when it started.
    function renderLastLine() {
      const opened = state.opened;
      const sessions = (opened && opened.sessions) || { count: 0, last: null };
      const last = sessions.last;
      if (!(sessions.count && last && !sessions.running)) return '';
      return `<div class="opened-task-last" data-testid="opened-task-last">Last: ${esc(last.label || 'session')} ${esc(last.state || '')}`
        + `${last.at ? ` \u00b7 ${esc(formatGeneratedAge(Date.parse(last.at)) || '')}` : ''}`
        + ` \u00b7 <button class="btn opened-task-all" data-action="all-sessions" data-testid="opened-task-all">All ${sessions.count}</button></div>`;
    }

    // LIN-4010: the copy-first state line: the tracker's word, then either nothing (a prompt was copied; "You copied …"
    // is the view's own line) or "No prompt copied from here yet.".
    function renderCopyState() {
      const word = COPY_STATE_WORDS[opts.issue && opts.issue.stateType] || 'Open';
      const tail = state.lastCopy ? '' : ' \u00b7 No prompt copied from here yet.';
      return `<div class="opened-task-state" data-state-slot data-testid="opened-task-state">`
        + `<p class="opened-task-copy-state" data-testid="opened-task-copy-state">${esc(word)}${esc(tail)}</p></div>`;
    }

    // LIN-3833: one line naming a subtask that needs you, with an Open link to its task page. Home passes the
    // opened row's own subtask, from the same row states as the In Progress rows (run-control viewers only).
    function renderSubtaskNeedsYou() {
      const sub = opts.subtaskNeedsYou;
      if (!sub || !sub.identifier) return '';
      const name = `${esc(sub.identifier)}${sub.title ? ` ${esc(sub.title)}` : ''}`;
      return `<div class="opened-task-needs-you" data-testid="opened-task-needs-you">`
        + `A subtask needs you: <span class="opened-task-needs-you-name">${name}</span>`
        + ` <a class="btn btn--quiet opened-task-needs-you-open" data-testid="opened-task-needs-you-open" href="${esc(sub.href || '#')}">Open</a></div>`;
    }

    // Repaint only the state slot (a poll or the mount read). Falls back to a full render when the slot is
    // absent, as paintGo does for the Go slot.
    function paintState() {
      if (destroyed) return;
      // Once the state shows a session running, the queued item from this page is no longer the thing to undo.
      if (state.opened && state.opened.sessions && state.opened.sessions.running) state.run.item = null;
      if (!caps.stateBlock) return;
      const oldQuestion = container.querySelector ? container.querySelector('[data-question-slot]') : null;
      const slot = container.querySelector && container.querySelector('[data-state-slot]');
      if (slot) slot.outerHTML = renderOpenedState();
      else render();
      keepTypedQuestion(oldQuestion);
      // LIN-4010: Home's running box and "Last" line live in the run block, so it follows the state too (focus and
      // the Change panel's draft survive a run-block repaint, as they do for a preview).
      if (caps.runBox && runControlOn()) paintRun();
      paintFoldCount();
      if (typeof window.initLocalTimes === 'function') window.initLocalTimes(container);
    }

    // LIN-4010: the Sessions fold's count comes from the state read (the server fragment does not know it). The fold sits
    // in the same opened-task block as this mount, so it is found from the mount's parent.
    function paintFoldCount() {
      const scope = container.parentElement;
      const el = scope && scope.querySelector ? scope.querySelector('[data-fold-count="sessions"]') : null;
      const count = state.opened && state.opened.sessions ? state.opened.sessions.count : 0;
      if (el) el.textContent = count ? ` (${count})` : '';
    }

    // LIN-3975: repaint only the copy-first view's "You copied …" line (a copy, or the task-mode read on mount).
    // No slot (a stream or an error is on screen): the line is already in state and the next full render shows it,
    // so a late read never rebuilds a streaming body.
    function paintLastCopy() {
      if (destroyed) return;
      const slot = container.querySelector && container.querySelector('[data-last-copy-slot]');
      if (slot) slot.outerHTML = renderLastCopySlot(state);
    }

    // ── LIN-3833: the run control (Home, dispatch on) ───────────────────────────
    // The step the run is for: a step chosen for this run, else the one the sessions name as next.
    function runStepOf() {
      return runStepOfState(state, opts);
    }

    // The run control is Home's, and the task page's, for a viewer who can run (dispatch on). The rest of the
    // component is unchanged.
    function runControlOn() {
      return caps.runControl && !!opts.dispatchEnabled;
    }

    // Repaint only the run block (the preview and Change panel write here), never the prompt body.
    // LIN-3969: a preview or presets answer can land while the viewer is typing in the Change panel. The
    // repaint replaces every control in the block, so the control that had the focus is focused again in the
    // new block, with its live value and caret; otherwise the rest of the typing went nowhere and "Use for
    // this run" applied a cut-off model, or none.
    function paintRun() {
      if (destroyed || !runControlOn()) return;
      const slot = container.querySelector && container.querySelector('[data-run-slot]');
      if (!slot) { render(); applyPanelDraft(); return; }
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const testid = active && active.dataset && slot.contains && slot.contains(active) ? active.dataset.testid : null;
      const typed = testid && typeof active.value === 'string'
        ? { value: active.value, start: active.selectionStart, end: active.selectionEnd }
        : null;
      slot.outerHTML = renderRunBlock();
      // The panel's draft goes back into the new controls first; a focused control then keeps its live value and caret.
      applyPanelDraft();
      if (!testid) return;
      const again = container.querySelector(`[data-run-slot] [data-testid="${testid}"]`);
      if (!again || typeof again.focus !== 'function') return;
      again.focus();
      if (typed && again.type === 'text') {
        again.value = typed.value;
        if (typed.start != null && typeof again.setSelectionRange === 'function') again.setSelectionRange(typed.start, typed.end);
      }
    }

    // The resolved setting for the step the run would start, from the server's own resolution
    // (routes/dispatch.js preview). Read-only; the browser resolves nothing itself.
    // LIN-3969: reads can overlap (Reset then "Use for this run", or the mount read still out when a
    // choice is used), and their answers can arrive in either order. Only the latest read may paint, so a
    // stale answer never puts the Runs-on line back to a choice that is no longer this run's.
    let runPreviewSeq = 0;
    function refreshRunPreview() {
      if (!runControlOn() || !opts.urlKey || typeof window.api !== 'function') return;
      const seq = ++runPreviewSeq;
      const step = runStepOf();
      const params = new URLSearchParams({ promptName: step ? step.kind : 'autopilot', surface: opts.surface });
      const c = state.run.choice;
      if (c.presetId) params.set('presetId', c.presetId);
      if (c.model) params.set('model', c.model);
      if (c.harness) params.set('harness', c.harness);
      if (c.effort) params.set('effort', c.effort);
      window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/dispatch/preview?${params.toString()}`, { on401: false })
        .then((preview) => {
          if (destroyed || seq !== runPreviewSeq) return;
          state.run.preview = preview || null;
          paintRun();
        })
        .catch(() => {});
    }

    // The words for where a value came from, from the preview's sources (LIN-3833, "say where every value
    // comes from"). `none` says nothing.
    function sourceWordOf(field, preview) {
      const from = preview && preview.sources ? preview.sources[field] : null;
      const group = preview && preview.group ? preview.group.charAt(0).toUpperCase() + preview.group.slice(1) : null;
      if (from === 'explicit') return 'chosen for this run';
      if (from === 'preset') return `preset ${preview.presetName || ''}, this run only`;
      if (from === 'job') return `set for ${preview.stepLabel || 'this step'} in Models`;
      if (from === 'group') return `from the ${group || 'step'} group in Models`;
      if (from === 'default') return 'from the workspace default in Models';
      if (from === 'anchor') return 'from the parent task';
      if (from === 'fallback') return 'Claude Code, the default';
      return null;
    }

    function renderRunsOn(preview) {
      if (!preview) return '<div class="opened-task-runs-on" data-testid="opened-task-runs-on">Working out what this run will use\u2026</div>';
      // LIN-3987: the names are the server's words for what the run would use (preview.words, routingWords), never a raw id or alias.
      const target = state.run.choice.target || 'cli';
      const w = preview.words || {};
      const bits = [w.model].filter(Boolean);
      if (w.harness && preview.harness !== 'claude-code') bits.push(w.harness);
      if (preview.effort && w.effort !== 'not used') bits.push(`effort ${preview.effort}`);
      // LIN-3992: Claude Code is said once on the line. A model that is Claude Code's own already says it, so the web target
      // reads "on the web", and the source word that only repeats it ("Claude Code, the default") is left out. A named model
      // keeps the word, since there it is the only place the harness is said.
      const modelSaysIt = bits.some((b) => b.includes('Claude Code'));
      const targetWord = target === 'web' && modelSaysIt ? 'on the web' : (TARGET_WORDS[target] || target);
      const saysIt = modelSaysIt || targetWord.includes('Claude Code');
      const words = [...new Set(['model', 'harness', 'effort']
        .filter((f) => !(saysIt && (preview.sources || {})[f] === 'fallback'))
        .map((f) => sourceWordOf(f, preview))
        .filter(Boolean))];
      return `<div class="opened-task-runs-on" data-testid="opened-task-runs-on">`
        + `Runs on <span class="opened-task-runs-on-what" data-testid="run-on-what">${esc(bits.join(' \u00b7 '))}</span>`
        + ` \u00b7 ${esc(targetWord)}`
        + `${words.length ? ` <span class="opened-task-source" data-testid="run-source">\u2014 ${esc(words.join(', '))}</span>` : ''}`
        + ` <button class="btn opened-task-change" data-action="change-run" data-testid="run-change">Change</button></div>`;
    }

    // The step line: the name and why it is next. ✦ write prompt writes this step's prompt (it does not replace the why).
    // LIN-4010: the step as one unit: its name, what it does (the first sentence of its own description, from the
    // preview), and why it is next. The why is the server's words (sessions.offered.reason); a chosen step says so.
    function renderStepLine(step) {
      // LIN-3968: a running stage offers no step; the after-run line names what runs and what comes next. Before
      // the state read lands, the step is not known, so no step is offered either (not "Run to PR").
      if (!state.run.step && (!state.opened || stageBusy(state))) return '';
      let why = 'the next step for this task';
      if (state.run.step) why = 'chosen for this run';
      else if (step && step.reason) why = step.reason;
      const name = step ? esc(step.label) : 'Run to PR';
      const ask = `<button class="btn opened-task-ask" data-action="ask-harbour" data-testid="run-ask-harbour">\u2726 write prompt</button>`;
      if (!caps.runBox) return `<div class="opened-task-step" data-testid="opened-task-step"><span class="opened-task-step-name">${name}</span> \u00b7 ${esc(why)} ${ask}</div>`;
      const what = !state.run.step && step && state.run.preview && state.run.preview.description
        ? `<p class="opened-task-step-what" data-testid="opened-task-step-what">${esc(state.run.preview.description)}</p>`
        : '';
      return `<div class="opened-task-step" data-testid="opened-task-step"><span class="opened-task-step-name">${name}</span>${what}`
        + `<p class="opened-task-step-why" data-testid="opened-task-step-why">${esc(why)} ${ask}</p></div>`;
    }

    // Undo for a run queued from here (until the runner takes it); Watch and Stop once a session runs.
    function renderAfterRun() {
      const summary = (state.opened && state.opened.sessions) || {};
      // A queued session is not running yet: it reads as queued (with Undo), like a run queued from here.
      const running = summary.running && summary.running.state !== 'queued' ? summary.running : null;
      const next = summary.next || null;
      if (running && !caps.runBox) {
        // The task page's own line (unchanged): the next step, the confirm, and a text Stop.
        const polled = POLLED_RUN_TARGETS.includes(running.target);
        let html = next ? `Next: ${esc(next.label)}, once ${esc(running.label || 'this')} finishes` : '';
        if (state.run.confirmStop) {
          html += ` <span class="opened-task-confirm">Stop this run? The session is cancelled and the task stays where it is.`
            + ` <button class="btn btn--red" data-action="stop-run-confirm" data-testid="run-stop-confirm">Stop</button>`
            + ` <button class="btn--quiet" data-action="stop-run-cancel">Cancel</button></span>`;
        } else if (polled) {
          html += ` <button class="btn--quiet opened-task-stop" data-action="stop-run" data-testid="run-stop">Stop</button>`;
        }
        return html.trim() ? `<div class="opened-task-running" data-testid="opened-task-running">${html.trim()}</div>` : '';
      }
      if (running) {
        // LIN-4010: one running box. Its head names the state once (Running now, the step, when it started) with Watch
        // and Stop beside each other; "Next" sits under it. The state block above does not repeat it.
        const polled = POLLED_RUN_TARGETS.includes(running.target);
        const since = running.since ? formatGeneratedAge(Date.parse(running.since)) : null;
        // LIN-4010 review: Watch opens the task the box runs on (the subtask, for a container), as Stop does.
        const watchHref = caps.watchLink && window.taskPageHref
          ? window.taskPageHref({ urlKey: opts.urlKey, identifier: runSubject.issue.identifier, source: runSubject.issue.source })
          : null;
        const watch = watchHref ? `<a class="btn--quiet opened-task-watch" href="${esc(watchHref)}" data-testid="opened-task-watch">Watch \u203A</a>` : '';
        let actions = watch;
        let confirm = '';
        if (state.run.confirmStop) {
          confirm = `<div class="opened-task-confirm">Stop this run? The session is cancelled and the task stays where it is.`
            + ` <button class="btn btn--red" data-action="stop-run-confirm" data-testid="run-stop-confirm">Stop</button>`
            + ` <button class="btn--quiet" data-action="stop-run-cancel">Cancel</button></div>`;
        } else if (polled) {
          actions += ` <button class="btn btn--red opened-task-stop" data-action="stop-run" data-testid="run-stop">Stop</button>`;
        }
        const nextLine = next ? `<p class="opened-task-running-next" data-testid="opened-task-running-next">Next: ${esc(next.label)}, once ${esc(running.label || 'this')} finishes</p>` : '';
        return `<div class="opened-task-running-box" data-testid="opened-task-running">`
          + `<div class="opened-task-running-head"><span class="opened-task-running-title">Running now</span> \u00b7 `
          + `<span class="opened-task-running-step">${esc(running.label || 'step')}</span>${since ? ` \u00b7 started ${esc(since)}` : ''}`
          + `<span class="opened-task-running-actions">${actions}</span></div>${confirm}${nextLine}</div>`;
      }
      if (state.run.item || (summary.running && summary.running.state === 'queued')) {
        return `<div class="opened-task-queued" data-testid="opened-task-queued">Queued, waiting for a runner`
          + ` <button class="btn--quiet opened-task-undo" data-action="undo-run" data-testid="run-undo">Undo</button></div>`;
      }
      return '';
    }

    // LIN-3833 (ruling `lin3833-fit-rule-loop`, comment f9fa6bd7, option c): a step is left out only when the
    // task cannot take it: the steps never offered as a next step (`summary.excluded`, retro), and every step once
    // the task is finished. Every other step always fits, so Build and Review stay on the list after a Review
    // session. The rule does not read the stage order. Before the state is read nothing is left out.
    const FINISHED_STATE_TYPES = ['completed', 'canceled', 'duplicate'];
    function stepFits(kind, summary, stateType) {
      if (!summary) return true;
      if ((summary.excluded || []).includes(kind)) return false;
      if (FINISHED_STATE_TYPES.includes(stateType)) return false;
      return true;
    }

    // Another step (a list in place) and See prompt. The four default steps show, in order; the rest sit behind
    // "Show N more". Steps that do not fit the task's state are left out, and the count says how many.
    function renderRunMore(step) {
      const meta = opts.promptMeta || {};
      const defaults = opts.defaultPromptKeys || [];
      const more = (opts.morePromptKeys || []).filter((k) => !defaults.includes(k));
      const summary = state.opened && state.opened.sessions;
      const fits = (k) => stepFits(k, summary, issue.stateType);
      const shownDefaults = defaults.filter(fits);
      const shownMore = more.filter(fits);
      const leftOut = [...defaults, ...more].filter((k) => !fits(k)).length;
      // LIN-4010 (H9): a step is named by its stage word (Build, not "implement"); the template name is the fallback.
      const wordOf = (k) => (opts.stageWords && opts.stageWords[k]) || meta[k] || k;
      const item = (k) => `<button class="btn opened-task-another-item" data-action="run-pick" data-kind="${esc(k)}" data-label="${esc(wordOf(k))}" data-testid="run-another-item">${esc(wordOf(k))}</button>`;
      let html = '<div class="opened-task-more">';
      if (step) html += `<button class="btn--quiet opened-task-see" data-action="see-prompt" data-testid="run-see-prompt">See prompt \u2726</button>`;
      html += `<button class="btn--quiet opened-task-another" data-action="run-another" data-testid="run-another" aria-expanded="${state.run.anotherOpen ? 'true' : 'false'}">Another step \u25BE</button>`;
      if (state.run.anotherOpen) {
        html += `<div class="opened-task-another-list" data-testid="run-another-list">${shownDefaults.map(item).join('')}`;
        if (shownMore.length) {
          html += state.run.moreOpen
            ? shownMore.map(item).join('')
            : `<button class="btn--quiet opened-task-another-more" data-action="run-more" data-testid="run-another-more">Show ${shownMore.length} more</button>`;
        }
        if (leftOut) {
          html += `<p class="opened-task-left-out" data-testid="run-another-left-out">${leftOut} ${leftOut === 1 ? 'step' : 'steps'} left out: ${leftOut === 1 ? 'it does' : 'they do'} not fit this task's state.</p>`;
        }
        html += '</div>';
      }
      return `${html}</div>`;
    }

    // The words the panel's own options carry for a value: a model's display name, a harness's name. A value no option
    // names is shown as typed (a model id the lists do not know). Read from the panel the server rendered (LIN-3987).
    // The markup's own text is escaped (lib/utils/html.js), so an option's value and label are read back unescaped.
    const unescapeText = (text) => text.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const OPTIONS_OF = {
      harness: /<select[^>]*data-decision-field="harness"[^>]*>([\s\S]*?)<\/select>/g,
      model: /<datalist[^>]*>([\s\S]*?)<\/datalist>/g
    };
    function optionWords(value, which) {
      if (!value) return null;
      const scope = [...(state.run.panelHtml || '').matchAll(OPTIONS_OF[which])].map((m) => m[1]).join('');
      const option = [...scope.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].find((m) => unescapeText(m[1]) === value);
      return option ? unescapeText(option[2]).trim() : value;
    }

    // A target the harness in force cannot run is not kept: Claude Code on the web needs Claude Code, so a draft that
    // names it falls back to the runner when another harness is chosen, and a choice made that way never reaches a run.
    function fallBackTarget(draft, inForce) {
      if (draft.target === 'web' && inForce === 'opencode') draft.target = 'cli';
    }

    // The sentence that says what the draft will run (the Change panel's summary, LIN-3992). It is the one place these words
    // are built: renderChangePanel writes it, and onRunInput rewrites it in place (refreshRunSummary) when a pick or a typed
    // model changes the draft, so the two cannot drift. Effort is judged by the harness in force (the draft's, else the one
    // Settings resolves a blank to), against the server's list of harnesses that take none; a blank harness with nothing
    // resolved keeps effort, as effortAppliesTo does.
    function runWillUseText(d, preview) {
      const panelWords = state.run.panelWords || {};
      const harness = d.harness || '';
      const inForce = harness || (preview && preview.harness) || '';
      const showEffort = !state.run.withoutEffort.includes(inForce);
      const modelNow = d.model ? optionWords(d.model, 'model') : panelWords.model;
      const harnessNow = harness ? optionWords(harness, 'harness') : panelWords.harness;
      const effortNow = !showEffort ? null : (d.effort ? `effort ${d.effort}` : panelWords.effort);
      const summary = [modelNow, harnessNow, effortNow, TARGET_WORDS[d.target] || d.target].filter(Boolean).join(' · ');
      return `This run will use ${summary}.`;
    }

    // LIN-3992: a pick or a typed model changes the draft's model, and the summary follows in place. Only that line is
    // rewritten: a repaint would replace the model field under the datalist and the caret (LIN-3969). No-op while the
    // Change panel is closed, since the summary is not on the page then.
    function refreshRunSummary() {
      const el = container.querySelector && container.querySelector('[data-testid="run-will-use"]');
      if (el) el.textContent = runWillUseText(state.run.draft || state.run.choice, state.run.preview);
    }

    // The Change panel (LIN-3962): Home's extras (the preset, Runs on, agent access, the summary, Use/Reset/Close) around
    // the one decision panel the server renders (lib/components/decision-panel.js), which holds the harness, model and
    // effort. Edits go to a draft; "Use for this run" applies it. The panel's HTML is read when the panel opens.
    function renderChangePanel(preview) {
      const d = state.run.draft || state.run.choice;
      const presets = state.run.presets || [];
      const panelWords = state.run.panelWords || {};
      const harness = d.harness || '';
      const inForce = harness || (preview && preview.harness) || '';
      // LIN-4010: the task page keeps the Preset row and the open decision panel it always had; the cards and "Choose for
      // this run" are Home's (caps.runBox).
      const presetButtons = caps.runBox ? '' : presets.map((p) => `<button class="btn opened-task-preset" data-action="run-preset" data-preset-id="${esc(p.id)}" aria-pressed="${d.presetId === p.id ? 'true' : 'false'}" data-testid="run-preset">${esc(p.name || p.id)}</button>`).join('');
      // LIN-4010 review: the choices are cards. The default is one card (the step's own resolved setting, from the
      // preview, and its numbers from the decision panel); each saved preset is one more. "Choose for this run" reveals the
      // decision panel for anything else.
      const explicit = !!(d.harness || d.model || d.effort);
      const stepLabel = (runStepOf() || {}).label || 'this step';
      const defaultWhat = (preview && preview.words && preview.words.model) || 'Claude Code, the default';
      const defaultFrom = (preview && (sourceWordOf('model', preview) || sourceWordOf('harness', preview))) || 'from Models';
      const nums = state.run.panelNumbers;
      const numbersText = nums && !nums.unavailable && nums.runs != null
        ? `${nums.runs} ${nums.runs === 1 ? 'run' : 'runs'} in the last 30 days${typeof nums.typicalUsd === 'number' ? `, about $${nums.typicalUsd.toFixed(2)} each` : ''}`
        : null;
      const defaultCard = `<button class="btn opened-task-card" data-action="run-default" data-testid="run-default" aria-pressed="${!d.presetId && !explicit ? 'true' : 'false'}">`
        + `<span class="opened-task-card-title">Default for ${esc(stepLabel)}</span>`
        + `<span class="opened-task-card-what">${esc(defaultWhat)} · ${esc(defaultFrom)}</span>`
        + (numbersText ? `<span class="opened-task-card-what">${esc(numbersText)}</span>` : '')
        + `</button>`;
      const choiceCards = defaultCard + presets.map((p) => `<button class="btn opened-task-card" data-action="run-preset" data-preset-id="${esc(p.id)}" aria-pressed="${d.presetId === p.id ? 'true' : 'false'}" data-testid="run-preset">${esc(p.name || p.id)}</button>`).join('');
      const chooseOpen = !!state.run.chooseOpen;
      // Claude Code on the web runs only under Claude Code: with opencode in force it is not offered, and the line says why.
      const onWeb = inForce !== 'opencode';
      const targets = ['cli', ...(onWeb ? ['web'] : []), ...(opts.isLocalhost ? ['local'] : [])];
      const targetButtons = targets.map((t) => `<button class="btn opened-task-choice" data-action="run-target" data-target="${esc(t)}" aria-pressed="${d.target === t ? 'true' : 'false'}" data-testid="run-target-${esc(t)}">${esc(TARGET_WORDS[t])}</button>`).join('');
      const harnessNow = harness ? optionWords(harness, 'harness') : panelWords.harness;
      const webNote = onWeb ? '' : `<p class="opened-task-change-note" data-testid="run-web-unavailable">Claude Code on the web needs Claude Code, so it is not offered with ${esc(harnessNow || '')}.</p>`;
      const agent = d.agentAccess == null ? (window.ProxyToggle && window.ProxyToggle.isActive ? window.ProxyToggle.isActive() : true) : d.agentAccess;
      const panelBody = state.run.panelHtml
        || (state.run.panelFailed
          ? '<p class="opened-task-change-note" data-testid="run-panel-failed">The choices could not load. Use for this run stays off until they do.</p>'
          : '<p class="opened-task-change-note" data-testid="run-panel-loading">Loading the choices\u2026</p>');
      return `<div class="opened-task-change-panel" data-testid="run-change-panel">`
        + `<div class="opened-task-change-head">This run only${panelWords.model ? ` \u00b7 default: ${esc(panelWords.model)}` : ''}`
        + `<button class="btn--quiet opened-task-change-x" data-action="close-change" aria-label="Close" data-testid="run-change-x">\u00d7</button></div>`
        + (caps.runBox
          ? `<div class="opened-task-cards" data-testid="run-cards">${choiceCards}</div>`
            + `<div class="opened-task-change-row"><span class="opened-task-change-label">Runs on</span>${targetButtons}</div>${webNote}`
            + `<button class="btn--quiet opened-task-choose-toggle" data-action="run-choose" aria-expanded="${chooseOpen ? 'true' : 'false'}" data-testid="run-choose">Choose for this run ${chooseOpen ? '▴' : '▾'}</button>`
            + `<div class="opened-task-choose" data-testid="run-choose-panel"${chooseOpen ? '' : ' hidden'}>${panelBody}</div>`
          : (presetButtons ? `<div class="opened-task-change-row"><span class="opened-task-change-label">Preset</span>${presetButtons}</div>` : '')
            + panelBody
            + `<div class="opened-task-change-row"><span class="opened-task-change-label">Runs on</span>${targetButtons}</div>${webNote}`)
        + `<label class="opened-task-change-row"><input type="checkbox" data-testid="run-agent-access"${agent ? ' checked' : ''}> Your agent may read and update this task</label>`
        + `<p class="opened-task-change-summary" data-testid="run-will-use">${esc(runWillUseText(d, preview))}</p>`
        + `<div class="opened-task-change-row">`
        + `<button class="btn btn--primary opened-task-use" data-action="use-run" data-testid="run-use"${state.run.panelFailed || !state.run.panelHtml ? ' disabled' : ''}>Use for this run</button>`
        + `<button class="btn--quiet" data-action="reset-run" data-testid="run-reset">Reset</button>`
        + `<button class="btn--quiet" data-action="close-change">Close</button>`
        + `<a class="opened-task-settings-link" href="/workspace/${encodeURIComponent(opts.urlKey || '')}/settings/models">Settings \u203A Models</a>`
        + `</div><p class="opened-task-change-note">A change here is for this run only. The default is set in Settings \u203A Models.</p>`
        + `</div>`;
    }

    // The decision panel for the draft: the server's panel (routes/dispatch.js decision-panel), read when the Change panel
    // opens, after a reset, and after the draft's harness changes (LIN-3987 review), since a blank model or effort says what
    // the harness the draft names runs. A repaint re-applies the draft to it (applyPanelDraft). Reads can overlap and answer
    // in either order, so only the latest may paint (as refreshRunPreview does, LIN-3969).
    let runPanelSeq = 0;
    function fetchRunPanel() {
      if (!runControlOn() || !opts.urlKey || typeof window.api !== 'function') return;
      const step = runStepOf();
      const params = new URLSearchParams({ promptName: step ? step.kind : 'autopilot', surface: opts.surface });
      const c = state.run.draft || state.run.choice;
      if (c.harness) params.set('harness', c.harness);
      if (c.model) params.set('model', c.model);
      if (c.effort) params.set('effort', c.effort);
      const seq = ++runPanelSeq;
      window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/dispatch/decision-panel?${params.toString()}`, { on401: false })
        .then((r) => {
          if (destroyed || seq !== runPanelSeq) return;
          state.run.panelHtml = (r && r.html) || null;
          state.run.panelWords = (r && r.words) || null;
          state.run.panelNumbers = (r && r.numbers) || null;
          state.run.withoutEffort = (r && r.withoutEffort) || [];
          state.run.panelFailed = !state.run.panelHtml;
          paintRun();
        })
        .catch(() => {
          if (destroyed || seq !== runPanelSeq) return;
          state.run.panelHtml = null;
          state.run.panelWords = null;
          state.run.panelNumbers = null;
          state.run.panelFailed = true;
          paintRun();
        });
    }

    // A repaint re-inserts the cached panel, which holds the choice it was read for. This puts the draft in progress back
    // into its controls, then lets the shared panel's own script settle the suggestions and effort for that harness.
    function applyPanelDraft() {
      const root = container.querySelector && container.querySelector('[data-decision-panel]');
      if (!root) return;
      const d = state.run.draft;
      if (d) {
        const set = (testid, value) => {
          const el = root.querySelector(`[data-testid="${testid}"]`);
          if (el) el.value = value || '';
        };
        set('run-harness', d.harness);
        set('run-model', d.model);
        set('run-effort', d.effort);
      }
      if (window.DecisionPanel) window.DecisionPanel.sync(root);
    }

    // The whole run block: the step, what it runs on, the one main action, the after-run line, and More.
    // LIN-3975: a chat proposal for this task's runs is a staged change: the reader applies or declines it here, and
    // nothing starts until they do. Apply resumes that session on its own harness and model, so Change does not
    // apply to it; the note says so. A row a press has settled shows one quiet line, kept across a repaint.
    function renderStagedProposals() {
      const list = Array.isArray(opts.proposals) ? opts.proposals : [];
      if (!list.length) return '';
      const done = state.run.proposalsDone || {};
      const pending = state.run.proposalsPending || {};
      const rows = list.map((p) => {
        const settled = done[p.id];
        const busy = pending[p.id] ? ' disabled' : '';
        const controls = settled
          ? `<span class="opened-task-proposal-state" data-testid="opened-task-proposal-state">${settled}</span>`
          : `<span class="opened-task-proposal-actions">`
            + `<button type="button" class="btn btn--primary opened-task-proposal-apply" data-action="apply-proposal" data-proposal-id="${esc(p.id)}" data-run-id="${esc(p.runId)}"${busy}>Apply</button>`
            + `<button type="button" class="btn btn--quiet opened-task-proposal-decline" data-action="decline-proposal" data-proposal-id="${esc(p.id)}" data-run-id="${esc(p.runId)}"${busy}>Decline</button>`
            + `</span>`;
        return `<li class="opened-task-proposal" data-testid="opened-task-proposal" data-proposal-id="${esc(p.id)}" data-run-id="${esc(p.runId)}">`
          + `<span class="opened-task-proposal-why">Proposed in chat: ${esc(p.reason || 'a follow-up')}</span> ${controls}</li>`;
      }).join('');
      return `<div class="opened-task-proposals" data-testid="opened-task-proposals">`
        + `<p class="opened-task-proposals-note">Apply resumes that session on its own harness and model. Change does not apply to it.</p>`
        + `<ul class="opened-task-proposal-list">${rows}</ul></div>`;
    }

    // The proposal's own endpoints (the run page's, routes/dashboard.js). A refused or failed press leaves the row
    // pending, its buttons live again, and says why in the toast.
    function proposalAction(btn, verb) {
      const runId = btn.getAttribute('data-run-id') || '';
      const id = btn.getAttribute('data-proposal-id') || '';
      const base = `/workspace/${encodeURIComponent(opts.urlKey)}/api/run/${encodeURIComponent(runId)}/proposals/${encodeURIComponent(id)}`;
      state.run.proposalsPending = { ...(state.run.proposalsPending || {}), [id]: true };
      paintRun();
      window.api(`${base}/${verb}`, { method: 'POST', body: JSON.stringify({}), on401: false })
        .then(() => {
          const settled = state.run.proposalsPending || {};
          delete settled[id];
          state.run.proposalsDone = { ...(state.run.proposalsDone || {}), [id]: verb === 'apply' ? 'applied' : 'declined' };
          state.run.proposalsPending = settled;
          paintRun();
        })
        .catch((err) => {
          const pending = state.run.proposalsPending || {};
          delete pending[id];
          state.run.proposalsPending = pending;
          paintRun();
          if (typeof window.toast === 'function') window.toast(`Could not ${verb} that proposal: ${(err && err.message) || 'failed'}`, { type: 'error' });
        });
    }

    // LIN-4010: the run box holds the step, why it is next, Run, and under a rule what it runs on, Change and the other
    // steps, in that order. While a session runs or is queued, the running box takes its place: it says the state once.
    function renderRunBlock() {
      const step = runStepOf();
      if (!caps.runBox) {
        // The task page's and Swipe's run block, as it was (LIN-3975): the step, what it runs on, Go, the proposals, the
        // after-run line and More, in one slot.
        return `<div class="opened-task-run" data-run-slot data-testid="opened-task-run">${[
          renderStepLine(step),
          renderRunsOn(state.run.preview),
          state.run.changeOpen ? renderChangePanel(state.run.preview) : '',
          renderGo(opts, state),
          renderStagedProposals(),
          renderAfterRun(),
          renderRunMore(step)
        ].join('')}</div>`;
      }
      const summary = (state.opened && state.opened.sessions) || {};
      const active = !!(summary.running || state.run.item);
      if (active) {
        // LIN-4010 review: a Change drawer that is open stays open while a run is active, with its draft: it sets the next run.
        return `<div class="opened-task-run" data-run-slot data-testid="opened-task-run">`
          + renderGo(opts, state) + renderAfterRun() + (state.run.changeOpen ? renderChangePanel(state.run.preview) : '')
          + renderStagedProposals() + renderRunMore(step) + renderLastLine() + `</div>`;
      }
      const box = [
        renderStepLine(step),
        renderGo(opts, state),
        renderRunsOn(state.run.preview),
        state.run.changeOpen ? renderChangePanel(state.run.preview) : '',
        renderRunMore(step)
      ];
      return `<div class="opened-task-run" data-run-slot data-testid="opened-task-run">`
        + `<div class="opened-task-next-run" data-testid="opened-task-next-run">${box.join('')}</div>`
        + renderStagedProposals() + renderLastLine() + `</div>`;
    }

    // Run a step now: fetch its prompt, then dispatch it with this run's choice (the one press, LIN-3446's
    // press-time read applies to Go; a step has no live-task gate of its own).
    async function runStepNow(step) {
      if (!step || state.run.busy || destroyed) return;
      state.run.busy = true;
      try {
        const prompt = await window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/prompt/${runSubject.issueId}/${encodeURIComponent(step.kind)}${runSubject.issue.source ? `?source=${encodeURIComponent(runSubject.issue.source)}` : ''}`, { on401: false });
        if (destroyed) return;
        const c = state.run.choice;
        const result = await window.dispatchPrompt({
          urlKey: opts.urlKey,
          prompt: prompt.prompt,
          promptName: prompt.promptName || step.label,
          kind: step.kind,
          issue: runSubject.issue,
          target: c.target || 'cli',
          model: c.model || undefined,
          harness: c.harness || undefined,
          effort: c.effort || undefined,
          presetId: c.presetId || undefined,
          appendProxyContext: c.agentAccess !== false,
          entryRung: 'run-step',
          surface: opts.surface,
          on401: false
        });
        if (destroyed) return;
        state.run.item = { id: result && result.item ? result.item.id : null, kind: step.kind, label: step.label, target: c.target || 'cli' };
        state.go = { status: 'started', headerHtml: null, notice: null, noticeLink: null, noticeLinkLabel: null };
        paintRun();
        startPoll();
      } catch (error) {
        if (destroyed) return;
        // LIN-3494: one place words a run refusal, shared with Go (applyGoRefusal).
        applyGoRefusal(error);
      } finally {
        state.run.busy = false;
      }
    }

    // LIN-4010: focus a control in the opened task, when it is on the page.
    function focusIn(selector) {
      const el = container.querySelector && container.querySelector(selector);
      if (el && typeof el.focus === 'function') el.focus();
    }

    // LIN-4010: Escape closes the Change drawer (the same path as its Close button). While it is open, Tab and Shift+Tab
    // cycle inside it: on a phone it is a modal sheet, and on a desktop focus must not go behind it.
    const onRunKeydown = (e) => {
      if (!caps.runBox || !state.run.changeOpen || !runControlOn() || !container.contains(e.target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleRunAction('close-change');
      } else if (e.key === 'Tab') {
        keepFocusInDrawer(e);
      }
    };
    function keepFocusInDrawer(e) {
      const drawer = container.querySelector && container.querySelector('[data-testid="run-change-panel"]');
      if (!drawer || !drawer.querySelectorAll) return;
      // Only what can take focus: the phone's × is display:none on a desktop, and a hidden control cannot hold focus.
      const items = [...drawer.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')]
        .filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const outside = !active || !drawer.contains(active);
      if (e.shiftKey && (outside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    container.addEventListener('keydown', onRunKeydown);

    // The run control's clicks. Returns true when it handled the button.
    function handleRunAction(action, btn) {
      if (!runControlOn()) return false;
      const d = () => state.run.draft || (state.run.draft = { ...state.run.choice });
      switch (action) {
        case 'change-run':
          state.run.changeOpen = true;
          state.run.draft = { ...state.run.choice };
          // A choice already made by hand (not a card) opens the decision panel it was made in.
          state.run.chooseOpen = !!(state.run.choice.harness || state.run.choice.model || state.run.choice.effort);
          state.run.panelHtml = null;
          state.run.panelFailed = false;
          fetchRunPanel();
          if (!state.run.presets) {
            window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/dispatch/presets`, { on401: false })
              .then((r) => { state.run.presets = (r && r.presets) || []; paintRun(); })
              .catch(() => { state.run.presets = []; paintRun(); });
          }
          paintRun();
          // LIN-4010: opening the choice moves focus into it, so a keyboard user lands in the drawer (the first card: the
          // phone's × is hidden on a desktop, where focus would otherwise go nowhere).
          if (caps.runBox) focusIn('[data-testid="run-default"]');
          return true;
        case 'apply-proposal':
          proposalAction(btn, 'apply');
          return true;
        case 'decline-proposal':
          proposalAction(btn, 'decline');
          return true;
        case 'close-change':
          state.run.changeOpen = false;
          state.run.chooseOpen = false;
          state.run.draft = null;
          paintRun();
          // LIN-4010: closing returns focus to the Change button that opened it.
          if (caps.runBox) focusIn('[data-action="change-run"]');
          return true;
        case 'run-default': {
          // The default card: no preset and no hand-made choice; the target and agent access stay as the draft has them.
          const keep = d();
          state.run.draft = { ...runChoiceDefaults(), target: keep.target, agentAccess: keep.agentAccess };
          state.run.chooseOpen = false;
          fetchRunPanel();
          paintRun();
          return true;
        }
        case 'run-choose':
          state.run.chooseOpen = !state.run.chooseOpen;
          paintRun();
          return true;
        case 'run-preset':
          d().presetId = d().presetId === btn.dataset.presetId ? null : btn.dataset.presetId;
          paintRun();
          return true;
        case 'run-target':
          d().target = btn.dataset.target;
          paintRun();
          return true;
        case 'use-run':
          // Blank fields are not sent, and with no panel there is nothing to send from: Use stays off until it loads.
          if (state.run.panelFailed || !state.run.panelHtml) return true;
          const chosen = { ...state.run.draft };
          fallBackTarget(chosen, chosen.harness || (state.run.preview && state.run.preview.harness) || '');
          state.run.choice = chosen;
          state.run.changeOpen = false;
          state.run.draft = null;
          state.run.panelHtml = null;
          refreshRunPreview();
          return true;
        case 'reset-run':
          state.run.choice = runChoiceDefaults();
          state.run.draft = null;
          state.run.step = null;
          state.run.panelHtml = null;
          state.run.panelFailed = false;
          if (state.run.changeOpen) fetchRunPanel();
          refreshRunPreview();
          return true;
        case 'ask-harbour':
          fetchPrompt('__ai__');
          return true;
        case 'see-prompt': {
          const step = runStepOf();
          if (step) fetchPrompt(step.kind);
          return true;
        }
        case 'run-another':
          state.run.anotherOpen = !state.run.anotherOpen;
          paintRun();
          return true;
        case 'run-more':
          state.run.moreOpen = true;
          paintRun();
          return true;
        case 'run-pick':
          state.run.step = { kind: btn.dataset.kind, label: btn.dataset.label || btn.dataset.kind };
          state.run.anotherOpen = false;
          state.run.moreOpen = false;
          refreshRunPreview();
          return true;
        case 'run-step-next':
          runStepNow(runStepOf());
          return true;
        case 'undo-run': {
          const id = state.run.item && state.run.item.id;
          if (!id) return true;
          window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/dispatch/${encodeURIComponent(id)}`, { method: 'DELETE', on401: false })
            .then(() => { state.run.item = null; paintRun(); })
            .catch((err) => { if (typeof window.toast === 'function') window.toast(err.message, { type: 'error' }); });
          return true;
        }
        case 'stop-run':
          state.run.confirmStop = true;
          paintRun();
          return true;
        case 'stop-run-cancel':
          state.run.confirmStop = false;
          paintRun();
          return true;
        case 'stop-run-confirm':
          stopRunNow();
          return true;
        default:
          return false;
      }
    }

    // Stop: an abort aimed at the running session's own target (the server checks the abort item's target,
    // not the session's, so a non-polled target is never offered Stop, see renderAfterRun).
    function stopRunNow() {
      const running = state.opened && state.opened.sessions && state.opened.sessions.running;
      state.run.confirmStop = false;
      if (!running || !running.loopId || !POLLED_RUN_TARGETS.includes(running.target)) { paintRun(); return; }
      window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          abort: true,
          abortTo: running.loopId,
          cascade: true,
          target: running.target,
          issueId: runSubject.issueId,
          issueIdentifier: runSubject.issue.identifier
        }),
        headers: { 'Content-Type': 'application/json' },
        on401: false
      })
        .then(() => { state.go = { status: 'running', headerHtml: null, notice: null, noticeLink: null, noticeLinkLabel: null }; startPoll(); })
        .catch((err) => { if (typeof window.toast === 'function') window.toast(err.message, { type: 'error' }); });
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
      if (typeof window.initLocalTimes === 'function') window.initLocalTimes(container);
    }

    // LIN-3267: the ladder twin of paintGo(). A post-press quota read changes only
    // the allowance count and the run rungs' disabled state, so it repaints just
    // [data-ladder-slot] and leaves the pressed button's feedback, the dispatch
    // disclosure and its selects alone (falling back to a full render when absent).
    function paintLadder() {
      if (destroyed) return;
      const slot = container.querySelector && container.querySelector('[data-ladder-slot]');
      if (slot) slot.outerHTML = renderLadder(opts, state);
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

    // LIN-4010: `subject` is the task the prompt is for. The ✦ write reads the opened task (the selector decides for a
    // container); a step's "See prompt" reads the subtask its run box runs on.
    async function fetchPrompt(label, subject = null) {
      const subjectIssue = subject ? subject.issue : issue;
      const subjectId = subject ? subject.issueId : issueId;
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
          if (subjectIssue.source) params.set('source', subjectIssue.source);
          const query = params.toString() ? `?${params.toString()}` : '';
          const response = await fetch(`${apiPrefix}/api/recommend/${subjectId}/stream${query}`, { signal: ac.signal });
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
            issueId: subjectId,
            variant,
            source: subjectIssue.source || undefined,
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
          promptCache.set(`${sessionPromptKey(subjectId)}:${label}`, entry);
          lastPromptLabel.set(sessionPromptKey(subjectId), label);
          savePromptMemory(opts.urlKey, subjectId, entry);
          enterPhase('fresh');
          state.result = entry;
          render();
        } else {
          // LIN-2944 addendum 1 (LIN-1916 row 1): thread `source` on the template
          // fetch too, via URLSearchParams (the LIN-2046 shape). The URL is
          // unchanged when the issue has no source.
          const params = new URLSearchParams();
          if (subjectIssue.source) params.set('source', subjectIssue.source);
          const query = params.toString() ? `?${params.toString()}` : '';
          const result = await window.api(`${apiPrefix}/api/prompt/${subjectId}/${encodeURIComponent(label)}${query}`, { signal: ac.signal, on401: false });
          if (abortController !== ac || destroyed) return;
          const html = renderMarkdown(result.prompt);
          const entry = { label, name: result.promptName || '', raw: result.prompt, html, generatedAt: Date.now() };
          promptCache.set(`${sessionPromptKey(subjectId)}:${label}`, entry);
          lastPromptLabel.set(sessionPromptKey(subjectId), label);
          savePromptMemory(opts.urlKey, subjectId, entry);
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
      let target = null;

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
            body.innerHTML = renderReasoning(shownReasoning(reasoningRaw));
          } else {
            if (nameEl) nameEl.textContent = 'AI Recommendation';
            // LIN-3968: Home's box is the text that will be pasted; Swipe keeps its markdown card.
            if (caps.plainPromptBox) body.textContent = promptRaw || reasoningRaw;
            else body.innerHTML = renderMarkdown(promptRaw || reasoningRaw);
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
        // LIN-3968: and the task the prompt is for (its title; the containers it was routed through).
        if (type === 'done' && payload.identifier) {
          target = { identifier: payload.identifier, title: payload.title || null, deferredVia: Array.isArray(payload.deferredVia) ? payload.deferredVia : [] };
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
        html: finalHtml, reasoning: reasoningRaw, warning, generatedAt: Date.now(), target
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
      if (!opts.urlKey || !runSubject.issue.identifier || !runSubject.issueId) return Promise.resolve(null);
      const url = `/workspace/${encodeURIComponent(opts.urlKey)}/api/task/${encodeURIComponent(runSubject.issue.identifier)}/state?issueId=${encodeURIComponent(runSubject.issueId)}`;
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
        state.opened = data;
        paintState();
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
      // LIN-3446: a duplicate refusal means a run IS live — same outcome as the
      // press-time read finding one: the running/watch line and the poll, never
      // a pressable Go.
      if (code === 'DUPLICATE_DISPATCH') { setGoRunning(null); return; }
      // LIN-3494: this is the only place a refusal is worded. Every refusal
      // (run limit reached/unverified, a code-less 503, a network error) shows
      // the server's own reason, then the runner link. The reason is the reply
      // body's `error`, else its `message`, else the thrown Error's message; if
      // all are empty the notice is just the link. paintGo escapes the text.
      const body = (error && error.body) || {};
      const reason = body.error || body.message || (error && error.message) || '';
      const g = {
        status: 'ready',
        headerHtml: null,
        notice: typeof reason === 'string' && reason ? reason : null,
        noticeLink: runnerSetupHref(opts),
        noticeLinkLabel: 'run on my machine \u203A'
      };
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

      // LIN-3446: read the state afresh at press time — the mount read can be
      // arbitrarily old (another tab, a phone, the second Home mount). This also
      // covers a mount read still in flight (round-3 fix 1B): the mount handler
      // drops its own result because Go is now `starting`. A failed read is
      // best-effort (null) and proceeds; the server's duplicate guard remains.
      const data = await readTaskState();
      if (destroyed) return;
      if (goInProgress(data)) { setGoRunning(data.headerHtml); return; }
      if (state.go.status !== 'starting') return;

      try {
        const kickoff = await window.fetchAutopilotKickoff({
          urlKey: opts.urlKey,
          issueId,
          source: issue.source || undefined,
          stopAt: 'pr',
          on401: false
        });
        if (destroyed) return;
        // LIN-3833: Home's run choice (what "Use for this run" set; nothing when untouched). A blank harness is
        // not sent, so the server settles it: the table's harness for this job, else claude-code. Swipe's card
        // keeps reading its own panel (its Change affordances are not replaced here).
        const panelNow = container.querySelector('.swipe-prompt-options');
        const panelChoice = window.readDispatchExecControls(panelNow);
        const c = runControlOn() ? state.run.choice : { ...runChoiceDefaults(), model: panelChoice.model, harness: panelChoice.harness };
        const result = await window.dispatchPrompt({
          urlKey: opts.urlKey,
          prompt: kickoff.prompt,
          promptName: kickoff.promptName || 'Autopilot',
          kind: kickoff.kind || 'autopilot',
          issue,
          target: c.target || 'cli',
          model: c.model,
          harness: c.harness,
          effort: c.effort,
          presetId: c.presetId,
          proxyForce: true,
          entryRung: 'run-task',
          stopAt: 'pr',
          variant: 'standard',
          surface: opts.surface
        });
        if (runControlOn()) state.run.item = { id: result && result.item ? result.item.id : null, kind: 'autopilot', label: 'Run to PR', target: c.target || 'cli' };
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
      // LIN-3267: the press has settled either way — re-read the allowance.
      await refreshRunQuota();
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

      // LIN-3833: the run control's own buttons (Change, the run itself, Undo, Stop, Another step, See prompt).
      if (action && handleRunAction(action, btn)) return;

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
        // LIN-3849: `proxy` left the vocabulary with its switch.
        const notice = needs === 'dispatch'
          ? (isGo ? 'Go needs the dispatch runner set up' : 'running this step needs the dispatch runner set up')
          : 'generate a prompt first';
        state.setupNotice = notice;
        state.setupNoticeLink = needs === 'dispatch' ? runnerSetupHref(opts) : null;
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

      if (action === 'all-sessions') {
        // LIN-3833: "All N" opens the Sessions fold in place, through the same toggle a click on it uses.
        const toggle = container.closest('.details')?.querySelector('.detail-toggle[data-toggle="sessions"]');
        const content = container.closest('.details')?.querySelector('.detail-content[data-content="sessions"]');
        if (toggle && content && content.classList.contains('hidden')) toggle.click();
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
        // LIN-3833: which prompt was copied (the kind the copy-first view reads back as "You copied the …").
        const copiedKind = state.result.label && state.result.label !== '__ai__' ? state.result.label : (state.result.kind || null);
        recordTaskMode({ rung: isAutopilotResult() ? 'run-task' : 'copy', ready: true, needs: null, act: 'copy', kind: copiedKind });
        if (copyFirstView()) {
          state.lastCopy = { label: state.result.name || null, kind: copiedKind, at: new Date().toISOString() };
          paintLastCopy();
        }
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
        // `closest` finds nothing there. It reads its own card's panel instead.
        // LIN-3833 (Q1): a blank harness is no longer forced here. The server settles it
        // for an opened-task run (the table's harness, else claude-code, `surface` below).
        const panel = isRunStep ? container.querySelector('.swipe-prompt-options') : btn.closest('.swipe-prompt-options');
        const { model, harness } = window.readDispatchExecControls(panel);
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
        // LIN-3267: the press has settled either way. The allowance is re-read
        // only once the 2s feedback window closes and the button is restored,
        // so the repaint cannot cut short the ✓/err or the double-press guard.
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = originalText;
          btn.disabled = false;
          refreshRunQuota();
        }, 2000);
      }
    }

    container.addEventListener('click', handleClick);
    // LIN-3833: the copy-first "Let your agent post progress" checkbox sets the account's task-key default
    // (ProxyToggle.setActive persists it, as the +proxy button does).
    const onRunInput = (e) => {
      const el = e.target;
      if (!el || !el.dataset || !container.contains(el) || !runControlOn() || !el.dataset.testid) return;
      const draft = state.run.draft || (state.run.draft = { ...state.run.choice });
      switch (el.dataset.testid) {
        case 'run-harness':
          draft.harness = el.value || null;
          fallBackTarget(draft, draft.harness || (state.run.preview && state.run.preview.harness) || '');
          paintRun();
          // LIN-3987 (review): the words for a blank model and effort follow the harness the draft names, so ask again.
          if (state.run.changeOpen) fetchRunPanel();
          break;
        // LIN-3992: a pick (or a typed model) names what the run will use at once, in the summary, without a repaint.
        case 'run-model': draft.model = el.value.trim() || null; refreshRunSummary(); break;
        case 'run-effort': draft.effort = el.value || null; paintRun(); break;
        case 'run-agent-access': draft.agentAccess = el.checked === true; break;
        default: break;
      }
    };
    container.addEventListener('input', onRunInput);
    container.addEventListener('change', (e) => {
      const box = e.target && e.target.closest && e.target.closest('[data-testid="opened-task-progress-key"]');
      if (box && container.contains(box) && window.ProxyToggle && typeof window.ProxyToggle.setActive === 'function') {
        window.ProxyToggle.setActive(box.checked === true);
        return;
      }
      onRunInput(e);
    });
    render();
    // LIN-3833: the mount read is the one state read: it paints the state block (every viewer) and is the
    // Go gate's read below (dispatch-enabled viewers). Best-effort: a failed read leaves the block empty.
    const mountRead = (opts.urlKey && issueId && issue.identifier && typeof window.api === 'function')
      ? readTaskState().then((data) => {
        if (destroyed || !data) return null;
        state.opened = data;
        paintState();
        // LIN-3968: the run block is repainted from the state at once, so the step is never guessed while the
        // preview is still out (the preview's answer repaints it again, in refreshRunPreview).
        if (runControlOn()) { paintRun(); refreshRunPreview(); }
        return data;
      })
      : null;
    if (copyFirstView() && opts.urlKey && issue.identifier && typeof window.api === 'function') {
      window.api(`/workspace/${encodeURIComponent(opts.urlKey)}/api/task-mode/${encodeURIComponent(issue.identifier)}`, { on401: false })
        .then((mode) => {
          if (destroyed || !mode || !mode.lastCopy) return;
          state.lastCopy = mode.lastCopy;
          paintLastCopy();
        })
        .catch(() => {});
    }

    // LIN-3239: the caller's run allowance must be known at load so the ladder
    // can show "N of <limit> runs left today" before Go and disable only the run
    // rungs at zero. The authoritative read is S1's GET /api/dispatch/quota
    // (routes/dispatch.js) — the session account's own merge-group counts, never
    // instance-wide. It is a read, never a spend. Only consulted when the caller
    // marks the workspace free-tier, so other consumers/units never touch the
    // network from init.
    //
    // LIN-3267: this is the ONE place the ladder's run state is decided from the
    // quota. Load calls it, and so does every settled ladder press (Go and the
    // run-step rung, success or failure), so the count and the disabled rungs
    // track the press — including a RUN_LIMIT_REACHED 429, whose exhausted state
    // comes from this read, never from a hand-set flag. An unreadable response
    // leaves the last known value untouched. Only the load-time call
    // (`initial`) rebuilds the component; a press repaints the Go and ladder
    // slots, never the whole container (LIN-3341's paintGo contract).
    function refreshRunQuota({ initial = false } = {}) {
      if (!opts.freeTier) return Promise.resolve();
      const quotaPrefix = opts.urlKey ? `/workspace/${encodeURIComponent(opts.urlKey)}` : '';
      return Promise.resolve()
        .then(() => window.api(`${quotaPrefix}/api/dispatch/quota`, { on401: false }))
        .then((data) => {
          if (destroyed) return;
          if (data && data.limited && data.runsUsed != null
            && typeof data.remaining === 'number' && typeof data.limit === 'number') {
            state.runQuota = { remaining: data.remaining, limit: data.limit, runsUsed: data.runsUsed };
          }
        })
        .catch(() => {})
        .then(() => {
          if (destroyed) return;
          if (!initial) { paintGo(); paintLadder(); return; }
          // A ✦ stream in flight owns [data-prompt-body] (N4): repaint only Go.
          if (state.result && state.result.streaming) paintGo();
          else render();
        });
    }
    refreshRunQuota({ initial: true });

    // LIN-3341 finding 7: on mount, ask once whether a run is already live on
    // this task, so a reopened task shows the running/waiting line instead of a
    // pressable Go. Best-effort and guarded exactly like the quota read, so a
    // unit with no window.api makes no network call and no unhandled rejection.
    if (goReady(opts) && mountRead) {
      mountRead.then((data) => {
        if (destroyed) return;
        if (!goInProgress(data)) return;
        if (!state.go || state.go.status !== 'ready') return; // a press already won
        setGoRunning(data.headerHtml);
      });
    }

    return {
      // LIN-3975 (finding 1): the task page hands in the staged chat proposals again after a fold turn proposes one.
      // Only the run block is repainted (the same slot a preview answer writes), so a prompt or a stream is untouched.
      setProposals(list) {
        if (destroyed) return;
        opts.proposals = Array.isArray(list) ? list : [];
        paintRun();
      },
      destroy() {
        destroyed = true;
        stopPoll();
        // Aborting the controller aborts the in-flight fetch/recommend stream;
        // window.readSSEStream's read() then rejects with AbortError, which
        // fetchPrompt's catch swallows (and onEvent already no-ops once
        // `destroyed`). The container listener is the only DOM teardown.
        if (abortController) abortController.abort();
        container.removeEventListener('click', handleClick);
        container.removeEventListener('keydown', onRunKeydown);
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

  window.PromptSection = { init, getCached, runnerLinkHtml, capabilitiesOf };
})();
