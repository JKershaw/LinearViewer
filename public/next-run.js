/**
 * Suggested Next Run client (experimental, LIN-603; LIN-633 UI parity).
 *
 * Drives the "suggest the next autopilot run" page: click Generate → POST to the
 * suggest endpoint → render the returned goal options as Observation-styled cards.
 * Each card's head shows a t-shirt size chip and a standalone headline `title`
 * (LIN-642); its caret-collapsible body holds the goal paragraph, per-option
 * reasoning, the referenced-task ids rendered at the end, and the accept/copy
 * actions. The always-present "continue until stopped" option is flagged. Above
 * the cards sit the deterministic `summary` intro (LIN-638) and the model's global
 * `analysis` preamble (LIN-642 — "how I chose", vs each card's "why this one"). A
 * single page-level expandable panel shows the exact grounding context the model
 * saw (shared across options, not per-option).
 *
 * Above the cards sits the direction chooser (LIN-1566): the generation groups its
 * goals under a few named directions, so you pick a direction first and a concrete
 * goal second — fewer undifferentiated headline rows to scroll past on a phone.
 * Single-select, click-driven (no hover affordance), and purely a display filter:
 * the card markup, the goal it dispatches, and the dispatch path itself are all
 * identical to the ungrouped page.
 *
 * Accepting an option (LIN-640): when the proxy feature is on, each card offers an
 * inline `Dispatch ▾` disclosure (parity with the projects/swipe views) that builds
 * the autopilot kickoff via /api/autopilot-prompt and dispatches it in place via
 * window.dispatchPrompt — no navigation. When proxy is off (the kickoff endpoint is
 * proxy-gated), it falls back to the original navigate-to-/dispatch?goal= link. The
 * inline buttons use a next-run-specific `.next-run-dispatch` class, NOT app.js's
 * `.prompt-dispatch` handler — app.js isn't loaded here and that handler reads a
 * `.prompt-text` node these cards don't have.
 *
 * Visual parity with the Observation page is via reused obs-* CSS + a replicated
 * caret/collapse toggle — observation.js is NOT imported (it binds to
 * server-rendered markup; these cards are built dynamically).
 */
(function () {
  'use strict';

  var data = window.__NEXT_RUN_DATA__ || {};
  var urlKey = data.urlKey || '';

  var generateBtn = document.getElementById('next-run-generate');
  var feedbackEl = document.getElementById('next-run-feedback');
  var optionsEl = document.getElementById('next-run-options');
  var directionsEl = document.getElementById('next-run-directions');
  var summaryEl = document.getElementById('next-run-summary');
  var analysisEl = document.getElementById('next-run-analysis');
  var analysisBodyEl = document.getElementById('next-run-analysis-body');
  var emptyState = document.getElementById('next-run-empty');
  var contextSection = document.getElementById('next-run-context-section');
  var contextToggle = document.getElementById('next-run-context-toggle');
  var contextBody = document.getElementById('next-run-context-body');

  if (!generateBtn || !optionsEl) return;

  function setFeedback(text, isError) {
    if (!feedbackEl) return;
    feedbackEl.textContent = text || '';
    feedbackEl.className = 'next-run-feedback' + (isError ? ' error' : '');
  }

  function dispatchUrl(goal) {
    var base = '/workspace/' + encodeURIComponent(urlKey) + '/dispatch';
    return goal ? base + '?goal=' + encodeURIComponent(goal) : base;
  }

  // The referenced tasks carried on an option: prefer the enriched
  // `referencedTasks: [{id, title}]`, fall back to bare `referencedTaskIds`
  // (older responses) with no title text, else []. Shared by the card renderer
  // and the dispatch-goal builder so both read the refs the same way.
  function referencedTasksOf(opt) {
    if (!opt) return [];
    if (Array.isArray(opt.referencedTasks)) return opt.referencedTasks;
    if (Array.isArray(opt.referencedTaskIds)) {
      return opt.referencedTaskIds.map(function (id) { return { id: id, title: '' }; });
    }
    return [];
  }

  // Fold the option's referenced tasks (id + title) into its prose goal so the
  // dispatched payload carries an unambiguous task reference, not prose alone
  // (LIN-1002). The referenced-task data already rides on the option, so this is
  // plumbing, not new data generation. Returns the prose unchanged when there are
  // no referenced tasks (e.g. the open "continue until stopped" option or a goal
  // with no refs), so the existing goal-less/dispatch paths are untouched.
  function buildDispatchGoal(opt) {
    var goal = (opt && opt.goal) || '';
    var refTasks = referencedTasksOf(opt);
    if (!goal || !refTasks.length) return goal;
    var lines = refTasks.map(function (t) {
      var id = String(t.id || '').trim();
      return t.title ? id + ' — ' + t.title : id;
    }).filter(Boolean);
    if (!lines.length) return goal;
    return goal + '\n\nReferenced tasks:\n' + lines.map(function (l) { return '- ' + l; }).join('\n');
  }

  // Caret/collapse toggle — replicated from the Observation page's pattern (no
  // observation.js import). Flips `is-open` on the card and unhides its body.
  function toggleCard(li) {
    var open = !li.classList.contains('is-open');
    li.classList.toggle('is-open', open);
    var head = li.querySelector('.next-run-option-head');
    var body = li.querySelector('.next-run-option-body');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.hidden = !open;
  }

  // Unique id seed for each card's dispatch panel (aria-controls target).
  var disclosureSeq = 0;

  // Shared dispatch disclosure (LIN-1137): the disclosure toggle, exec controls,
  // and target buttons all come from window.renderDispatchDisclosure. We wrap it
  // to stamp `data-goal` on each button so the delegated dispatchGoal handler can
  // read the goal without per-card closures. Also wraps in a .next-run-dispatch-wrap
  // span for layout.
  function buildDispatchDisclosure(goal) {
    var panelId = 'next-run-dispatch-' + (++disclosureSeq);
    var wrap = document.createElement('span');
    wrap.className = 'next-run-dispatch-wrap';
    wrap.innerHTML = window.renderDispatchDisclosure({
      idPrefix: panelId,
      isLocalhost: data.isLocalhost,
      toggleClass: 'next-run-dispatch-toggle disclosure-toggle',
      buttonClass: 'next-run-dispatch dispatch-btn'
    });
    // Stamp data-goal on each dispatch button so dispatchGoal can read it.
    wrap.querySelectorAll('.next-run-dispatch').forEach(function (btn) {
      btn.setAttribute('data-goal', escapeHtml(goal || ''));
    });
    return wrap;
  }

  // Inline-dispatch a goal: build the autopilot kickoff (proxy-gated endpoint),
  // then dispatch it issue-less and tagged kind=autopilot. The kickoff REQUIRES
  // the proxy, so proxyForce:true is passed; dispatchPrompt turns that into an
  // `attachProxy:true` payload and the SERVER attaches the harness-aware proxy
  // block (LIN-1162, superseding the client-side append LIN-1137 added), so a
  // claude-code kickoff takes the MCP `bootstrapToken` field path. The shared
  // fetchAutopilotKickoff replaces the raw GET.
  function dispatchGoal(btn) {
    var target = btn.getAttribute('data-target') || 'cli';
    var goal = btn.getAttribute('data-goal') || '';
    var original = btn.textContent;
    var exec = window.readDispatchExecControls(btn.closest('.prompt-options'));
    btn.disabled = true;
    btn.textContent = 'sending…';
    window.fetchAutopilotKickoff({ urlKey: urlKey, goal: goal || undefined, on401: false })
      .then(function (kickoff) {
        return dispatchPrompt({
          urlKey: urlKey,
          prompt: kickoff.prompt,
          promptName: kickoff.promptName || 'Autopilot',
          kind: kickoff.kind || 'autopilot',
          issueless: true,
          target: target,
          model: exec.model,
          harness: exec.harness,
          proxyForce: true
        });
      })
      .then(function () {
        btn.textContent = 'dispatched!';
        btn.classList.add('dispatched');
        setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove('dispatched');
          btn.disabled = false;
        }, 1500);
      })
      .catch(function (err) {
        btn.textContent = 'failed';
        setFeedback((err && err.message) ? err.message : 'failed to dispatch', true);
        setTimeout(function () {
          btn.textContent = original;
          btn.disabled = false;
        }, 1500);
      });
  }

  // ── Direction grouping (LIN-1566) ───────────────────────────────────────────
  // The response's flat `options` array stays authoritative; `directions` is the
  // server-resolved grouping over it, each entry owning the `optionIndexes` it
  // covers. The client renders those indexes and never re-derives groups by
  // matching direction names itself, so normalisation lives in exactly one place
  // (lib/next-run.js resolveDirections). An empty `directions` means the reply
  // carried no usable grouping — the flat list then renders exactly as it did
  // before this feature existed.
  var currentOptions = [];
  var currentDirections = [];
  var selectedDirection = 0;

  // Which options are visible for the current selection: the selected direction's
  // goals, then the continue-until-stopped option, which sits OUTSIDE every
  // direction and is offered whichever direction is chosen. Ungrouped → the whole
  // list in its original order, untouched.
  function visibleOptions() {
    if (!currentDirections.length) return currentOptions.slice();
    var dir = currentDirections[selectedDirection] || currentDirections[0] || {};
    var picked = (dir.optionIndexes || []).map(function (i) {
      return currentOptions[i];
    }).filter(Boolean);
    var open = currentOptions.filter(function (o) { return o && o.continueUntilStopped; });
    return picked.concat(open);
  }

  // The chooser: one chip per direction (single-select; selection is a click, never
  // a hover) plus the selected direction's one-line summary. Repainted on every
  // selection — the click listener is delegated to the container, which persists.
  function renderDirections() {
    if (!directionsEl) return;
    if (!currentDirections.length) {
      directionsEl.innerHTML = '';
      directionsEl.hidden = true;
      return;
    }
    var chips = currentDirections.map(function (d, i) {
      return '<button type="button" class="next-run-direction" data-index="' + i + '"' +
        ' aria-pressed="' + (i === selectedDirection ? 'true' : 'false') + '">' +
        '<span class="next-run-direction-name">' + escapeHtml(d.name || '') + '</span>' +
        '<span class="next-run-direction-count">' + ((d.optionIndexes || []).length) + '</span>' +
        '</button>';
    }).join('');
    var current = currentDirections[selectedDirection] || {};
    directionsEl.innerHTML =
      '<div class="next-run-direction-row" role="group" aria-label="choose a direction">' + chips + '</div>' +
      '<p class="next-run-direction-summary">' + escapeHtml(current.summary || '') + '</p>';
    directionsEl.hidden = false;
  }

  function renderOptions(options, directions) {
    currentOptions = Array.isArray(options) ? options : [];
    currentDirections = Array.isArray(directions) ? directions : [];
    // The first direction is selected on arrival, so a generation never lands on a
    // "generated, but nothing visible" dead end. The chooser sits above the cards
    // either way, so the directions are still what you meet first on a phone.
    selectedDirection = 0;

    if (!currentOptions.length) {
      currentDirections = [];
      renderDirections();
      optionsEl.innerHTML = '';
      if (emptyState) {
        emptyState.textContent = '○ no suggestions returned — try again';
        emptyState.hidden = false;
      }
      return;
    }
    if (emptyState) emptyState.hidden = true;

    renderDirections();
    renderOptionCards(visibleOptions());
  }

  // Card building is untouched by grouping: the same cards, re-parented under
  // whichever direction is selected.
  function renderOptionCards(options) {
    optionsEl.innerHTML = '';
    options.forEach(function (opt) {
      var li = document.createElement('li');
      li.className = 'next-run-option' + (opt.continueUntilStopped ? ' next-run-option-open' : '');

      var size = String(opt.size || 'M');
      var isOpen = !!opt.continueUntilStopped;
      var goalText = isOpen ? '(no goal — continue until stopped)' : (opt.goal || '');
      // Headline title (LIN-642): a standalone headline read straight from the
      // option's `title`, falling back to the goal's first line for older
      // responses. No char truncation — it wraps via CSS instead of being
      // ellipsised, so the whole headline is visible while collapsed (LIN-638).
      var preview = isOpen
        ? 'Continue until stopped'
        : (opt.title || (opt.goal || '').split('\n')[0]);

      // Head: caret · size chip (obs-chip) · open tag · one-line goal preview.
      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'next-run-option-head';
      head.setAttribute('aria-expanded', 'false');
      // Size chip → neutral StatusPill tag (LIN-861); `next-run-size` hook rides
      // along for the E2E selector + the bold-mono badge weight.
      var sizePill = window.renderStatusPill({
        label: size,
        variant: 'tag',
        className: 'next-run-size',
        attrs: 'title="t-shirt size estimate"',
      });
      head.innerHTML =
        '<span class="obs-session-caret next-run-option-caret" aria-hidden="true">▸</span>' +
        sizePill +
        (isOpen ? '<span class="next-run-open-tag">continue until stopped</span>' : '') +
        '<span class="next-run-goal-preview">' + escapeHtml(preview) + '</span>';
      head.addEventListener('click', function () { toggleCard(li); });
      li.appendChild(head);

      // Body (collapsed by default): full goal · reasoning · actions.
      var body = document.createElement('div');
      body.className = 'obs-session-body next-run-option-body';
      body.hidden = true;

      // Goal / reasoning / refs blocks → inset Surface panels (LIN-861). Each
      // keeps its per-page hook class (inside the surface) for the existing layout
      // rules + E2E selectors; the Surface supplies the shared inset chrome.
      body.insertAdjacentHTML('beforeend', window.renderSurface({
        body: '<p class="next-run-goal">' + escapeHtml(goalText) + '</p>',
        variant: 'inset',
        className: 'next-run-goal-surface',
      }));

      if (opt.reasoning) {
        body.insertAdjacentHTML('beforeend', window.renderSurface({
          body: '<p class="next-run-reasoning obs-detail-block">' +
            '<span class="obs-body-lbl">why</span> ' + escapeHtml(opt.reasoning) + '</p>',
          variant: 'inset',
          className: 'next-run-reasoning-surface',
        }));
      }

      // Referenced tasks rendered at the end of the recommendation (LIN-642).
      // Each task shows its machine-readable identifier → mono data Chip (LIN-861)
      // AND its human-readable title (LIN-923), so the reader can tell what the
      // tasks actually are, not just their opaque ids. Prefer the enriched
      // `referencedTasks: [{id, title}]`; fall back to bare `referencedTaskIds`
      // (older responses) with no title text.
      var refTasks = referencedTasksOf(opt);
      if (refTasks.length) {
        var items = refTasks.map(function (t) {
          var chip = window.renderChip({ label: String(t.id), className: 'next-run-ref' });
          var title = t.title
            ? '<span class="next-run-ref-title">' + escapeHtml(t.title) + '</span>'
            : '';
          return '<li class="next-run-ref-item">' + chip + title + '</li>';
        }).join('');
        body.insertAdjacentHTML('beforeend', window.renderSurface({
          body: '<div class="next-run-refs obs-detail-block">' +
            '<span class="obs-body-lbl">tasks</span>' +
            '<ul class="next-run-ref-list">' + items + '</ul></div>',
          variant: 'inset',
          className: 'next-run-refs-surface',
        }));
      }

      var actions = document.createElement('div');
      actions.className = 'next-run-option-actions';

      // The goal handed to dispatch/autopilot is enriched with the referenced
      // tasks (id + title) so the autopilot receives an unambiguous task
      // reference alongside the prose, not prose alone (LIN-1002). The open
      // option has no goal (and no refs), so it stays an empty open-ended walk.
      var dispatchGoalText = isOpen ? '' : buildDispatchGoal(opt);

      if (data.proxyEnabled) {
        // Proxy on: offer inline dispatch options (parity with projects/swipe).
        // The open option dispatches with no goal (an open-ended stack walk).
        actions.appendChild(buildDispatchDisclosure(dispatchGoalText));
      } else {
        // Proxy off: the kickoff endpoint is unavailable, so keep handing the goal
        // to the dispatch page via ?goal= (its proxy-off receiver, unchanged).
        var acceptLink = document.createElement('a');
        acceptLink.className = 'action-btn save next-run-accept';
        acceptLink.href = dispatchUrl(dispatchGoalText);
        acceptLink.textContent = isOpen ? 'start (no goal) →' : 'send to dispatch →';
        actions.appendChild(acceptLink);
      }

      if (!isOpen && opt.goal) {
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'action-btn next-run-copy';
        copyBtn.textContent = 'copy goal';
        copyBtn.addEventListener('click', function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(opt.goal).then(function () {
              copyBtn.textContent = 'copied!';
              setTimeout(function () { copyBtn.textContent = 'copy goal'; }, 1500);
            }).catch(function () {
              copyBtn.textContent = 'failed';
              setTimeout(function () { copyBtn.textContent = 'copy goal'; }, 1500);
            });
          }
        });
        actions.appendChild(copyBtn);
      }

      body.appendChild(actions);
      li.appendChild(body);
      optionsEl.appendChild(li);
    });
  }

  // Deterministic intro paragraph above the options (LIN-638). Hidden when the
  // generation returned no summary (e.g. older responses / nothing to say).
  function renderSummary(summary) {
    if (!summaryEl) return;
    if (!summary) {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
      return;
    }
    summaryEl.textContent = summary;
    summaryEl.hidden = false;
  }

  // Global think-first reasoning preamble above the cards (LIN-642). This is the
  // model's "how I chose" — distinct from each card's per-option "why this one".
  // Hidden when the generation returned no analysis (e.g. older responses).
  function renderAnalysis(analysis) {
    if (!analysisEl || !analysisBodyEl) return;
    if (!analysis) {
      analysisEl.hidden = true;
      analysisBodyEl.textContent = '';
      return;
    }
    analysisBodyEl.textContent = analysis;
    analysisEl.hidden = false;
  }

  // Single page-level grounding panel: shows the exact context the model saw. It
  // grounds the WHOLE generation, so it is shared (one panel), not per-option.
  function renderContext(context) {
    if (!contextSection || !contextBody || !contextToggle) return;
    if (!context) {
      contextSection.hidden = true;
      return;
    }
    contextBody.textContent = context;
    contextSection.hidden = false;
    // Reset to collapsed on each fresh generation.
    contextToggle.setAttribute('aria-expanded', 'false');
    contextBody.hidden = true;
  }

  // One delegated listener for all inline dispatch buttons across all cards —
  // optionsEl persists across re-generations (renderOptions only clears its
  // innerHTML), so this binds once and survives every fresh option set.
  optionsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.next-run-dispatch');
    if (!btn || btn.disabled) return;
    dispatchGoal(btn);
  });

  // Direction selection (LIN-1566), delegated for the same reason: directionsEl
  // persists across generations and re-paints, the chips inside it do not.
  if (directionsEl) {
    directionsEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.next-run-direction');
      if (!chip) return;
      var index = parseInt(chip.getAttribute('data-index'), 10);
      if (isNaN(index) || index === selectedDirection) return;
      selectedDirection = index;
      renderDirections();
      renderOptionCards(visibleOptions());
    });
  }

  if (contextToggle && contextBody) {
    contextToggle.addEventListener('click', function () {
      var open = contextToggle.getAttribute('aria-expanded') !== 'true';
      contextToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      contextBody.hidden = !open;
    });
  }

  function generate() {
    if (generateBtn.disabled) return;
    var original = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.textContent = 'generating…';
    setFeedback('');

    api('/workspace/' + encodeURIComponent(urlKey) + '/api/next-run/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      on401: false
    }).then(function (res) {
      renderSummary(res && res.summary);
      renderAnalysis(res && res.analysis);
      renderOptions(res && res.options, res && res.directions);
      renderContext(res && res.context);
      if (res && res.model && res.model !== 'mock') {
        setFeedback('generated with ' + res.model);
      } else {
        setFeedback('');
      }
    }).catch(function (err) {
      var msg = (err && err.message) ? err.message : 'failed to generate suggestions';
      setFeedback(msg, true);
    }).finally(function () {
      generateBtn.disabled = false;
      generateBtn.textContent = original;
    });
  }

  generateBtn.addEventListener('click', generate);
})();
