/**
 * Context Section — shared client renderer (LIN-572).
 *
 * Renders an issue's relationship neighborhood as a lightweight, terminal-styled
 * diagram so a user can see how the task fits into its blocker chains and where
 * to start. Three lanes flow left → right:
 *
 *   blockers (root cause first)   →   THIS TASK   →   blocked (downstream)
 *
 * with a parent/children band and a related/duplicate list below. Every other
 * task is a clickable node: by default it links to the task (its provider URL);
 * a surface can pass `onNavigate(identifier)` to intercept (e.g. the swipe deck
 * jumps to that card instead of leaving the page).
 *
 * Deliberately NOT a heavyweight diagram library (no Mermaid): a custom
 * box-drawing layout matches the CLI aesthetic, keeps the no-build-step rule,
 * and makes the "start here" lane ordering and clickable nodes trivial. Mirrors
 * brief.js/recap.js: a plain global (`ContextSection`) since the swipe page is a
 * plain script with no module loader.
 */
(function () {
  'use strict';

  const esc = window.escapeHtml;

  function contextUrl(urlKey, identifier) {
    return `/workspace/${encodeURIComponent(urlKey)}/api/context/${encodeURIComponent(identifier)}`;
  }

  async function fetchContext(urlKey, identifier) {
    return window.api(contextUrl(urlKey, identifier), { on401: false });
  }

  // ✓ done · ◐ in-progress · ○ todo/backlog — the shared status vocabulary.
  function stateGlyph(stateType) {
    switch (stateType) {
      case 'completed': return { char: '✓', cls: 'done' };
      case 'canceled':
      case 'duplicate': return { char: '✕', cls: 'done' };
      case 'started': return { char: '◐', cls: 'in-progress' };
      case 'unstarted': return { char: '○', cls: 'todo' };
      default: return { char: '○', cls: 'backlog' };
    }
  }

  function nodeHtml(node, { isRoot = false, provenance = null } = {}) {
    const g = stateGlyph(node.stateType);
    const cls = [
      'context-node',
      `context-node--${g.cls}`,
      isRoot ? 'context-node--root' : '',
      node.isStart ? 'context-node--start' : '',
      provenance ? `context-node--${provenance}` : '',
    ].filter(Boolean).join(' ');
    const title = node.title ? `<span class="context-node-title">${esc(node.title)}</span>` : '';
    // Provenance tag (session view) mirrors the single-root "start here" tag. Only
    // one tag shows; the start-here cue is single-root-only so they never collide.
    const startTag = node.isStart ? '<span class="context-node-tag">start here</span>'
      : provenance ? `<span class="context-node-tag context-node-tag--${provenance}">${esc(provenance)}</span>` : '';
    const inner = `
      <span class="context-node-head">
        <span class="state ${g.cls} status-pill__char status-pill--${g.cls}">${g.char}</span>
        <span class="context-node-id">${esc(node.identifier)}</span>
        ${startTag}
      </span>
      ${title}`;
    if (isRoot) {
      return `<div class="${cls}" aria-current="true">${inner}</div>`;
    }
    // Anchor so a node is keyboard-focusable and degrades to a real link when JS
    // navigation isn't intercepted. data-context-nav carries the identifier.
    const href = node.url ? esc(node.url) : '#';
    const target = node.url ? ' target="_blank" rel="noopener"' : '';
    return `<a class="${cls}" href="${href}"${target} data-context-nav="${esc(node.identifier)}">${inner}</a>`;
  }

  function laneHtml(label, nodes, extraClass) {
    if (!nodes.length) return '';
    const items = nodes.map(n => nodeHtml(n)).join('');
    return `
      <div class="context-lane ${extraClass}">
        <div class="context-lane-label">${esc(label)}</div>
        <div class="context-lane-nodes">${items}</div>
      </div>`;
  }

  function truncationNote(count, noun) {
    if (!count) return '';
    return `<div class="context-truncated">+${count} more ${esc(noun)} not shown</div>`;
  }

  function renderGraph(graph) {
    const blockers = graph.blockers || [];
    const blocked = graph.blocked || [];
    const parentChain = graph.parentChain || [];
    const children = graph.children || [];
    const related = graph.related || [];

    // Flow row: blockers → root → blocked. Each side renders its own lane; the
    // arrows between them only appear when there's something to point at.
    const arrow = '<div class="context-flow-arrow">→</div>';
    const flowParts = [];
    if (blockers.length) {
      flowParts.push(laneHtml('Blocked by', blockers, 'context-lane--blockers') + truncationNote(graph.blockersTruncated, 'blockers'));
      flowParts.push(arrow);
    }
    flowParts.push(`
      <div class="context-lane context-lane--root">
        <div class="context-lane-label">This task</div>
        <div class="context-lane-nodes">${nodeHtml(graph.root, { isRoot: true })}</div>
      </div>`);
    if (blocked.length) {
      flowParts.push(arrow);
      flowParts.push(laneHtml('Blocks', blocked, 'context-lane--blocked') + truncationNote(graph.blockedTruncated, 'blocked tasks'));
    }
    const flowHtml = `<div class="context-flow">${flowParts.join('')}</div>`;

    // A one-line read on where to start.
    let hint;
    if (!graph.root.isBlocked && !blockers.length) {
      hint = 'Nothing blocks this task — it’s ready to start.';
    } else if (!graph.root.isBlocked) {
      hint = 'Every blocker is resolved — this task is ready to start.';
    } else {
      const starts = blockers.filter(n => n.isStart).map(n => n.identifier);
      hint = starts.length
        ? `Start with ${starts.map(s => esc(s)).join(', ')} to unblock this task.`
        : 'This task is blocked upstream — follow the chain left to find the start.';
    }

    // Hierarchy band (parent chain + children).
    let hierarchyHtml = '';
    if (parentChain.length || children.length) {
      const parts = [];
      if (parentChain.length) {
        // Nearest parent first in the data; show the lineage top-down.
        const lineage = parentChain.slice().reverse().map(n => nodeHtml(n)).join('<span class="context-sep">›</span>');
        parts.push(`<div class="context-rel-group"><div class="context-lane-label">Parent</div><div class="context-rel-nodes">${lineage}</div></div>`);
      }
      if (children.length) {
        parts.push(`<div class="context-rel-group"><div class="context-lane-label">Children</div><div class="context-rel-nodes">${children.map(n => nodeHtml(n)).join('')}${truncationNote(graph.childrenTruncated, 'children')}</div></div>`);
      }
      hierarchyHtml = `<div class="context-hierarchy">${parts.join('')}</div>`;
    }

    // Related / duplicate.
    let relatedHtml = '';
    if (related.length) {
      const dupes = related.filter(n => n.relType === 'duplicate');
      const rel = related.filter(n => n.relType !== 'duplicate');
      const groups = [];
      if (rel.length) groups.push(`<div class="context-rel-group"><div class="context-lane-label">Related</div><div class="context-rel-nodes">${rel.map(n => nodeHtml(n)).join('')}</div></div>`);
      if (dupes.length) groups.push(`<div class="context-rel-group"><div class="context-lane-label">Duplicate</div><div class="context-rel-nodes">${dupes.map(n => nodeHtml(n)).join('')}</div></div>`);
      relatedHtml = `<div class="context-related">${groups.join('')}</div>`;
    }

    const empty = !blockers.length && !blocked.length && !parentChain.length && !children.length && !related.length;

    return `
      <div class="context-header">
        <span class="context-status-label">context</span>
        <span class="context-hint">${hint}</span>
      </div>
      ${flowHtml}
      ${hierarchyHtml}
      ${relatedHtml}
      ${empty ? '<div class="context-placeholder">No linked tasks yet — no blockers, sub-tasks, or related issues.</div>' : ''}`;
  }

  // ─── Session context (LIN-593) ───────────────────────────────────────────────
  // A session touches a SET of tasks; render each touched task as a node carrying
  // a provenance tag (seed / descended / spun-off) plus its neighborhood, reusing
  // the same node/lane/truncation vocabulary as the single-root diagram. Aligned
  // with, not identical to, the per-task Context section.

  const PROVENANCE_LABEL = { seed: 'seed', descended: 'descended', 'spun-off': 'spun-off' };

  // One touched task: its node (tagged with provenance) flanked by its blocker /
  // blocked lanes, with a parent/children/related band below. `touched` marks
  // neighbors that are themselves in the session (the "merged" cue) — for now a
  // class hook; the data is carried so a surface can highlight overlaps.
  function sessionTaskHtml(task) {
    const blockers = task.blockers || [];
    const blocked = task.blocked || [];
    const arrow = '<div class="context-flow-arrow">→</div>';
    const flowParts = [];
    if (blockers.length) {
      flowParts.push(laneHtml('Blocked by', blockers, 'context-lane--blockers') + truncationNote(task.blockersTruncated, 'blockers'));
      flowParts.push(arrow);
    }
    flowParts.push(`
      <div class="context-lane context-lane--root">
        <div class="context-lane-nodes">${nodeHtml(task.root, { isRoot: true, provenance: task.provenance })}</div>
      </div>`);
    if (blocked.length) {
      flowParts.push(arrow);
      flowParts.push(laneHtml('Blocks', blocked, 'context-lane--blocked') + truncationNote(task.blockedTruncated, 'blocked tasks'));
    }

    const bands = [];
    const parentChain = task.parentChain || [];
    if (parentChain.length) {
      const lineage = parentChain.slice().reverse().map(n => nodeHtml(n)).join('<span class="context-sep">›</span>');
      bands.push(`<div class="context-rel-group"><div class="context-lane-label">Parent</div><div class="context-rel-nodes">${lineage}</div></div>`);
    }
    const children = task.children || [];
    if (children.length) {
      bands.push(`<div class="context-rel-group"><div class="context-lane-label">Children</div><div class="context-rel-nodes">${children.map(n => nodeHtml(n)).join('')}${truncationNote(task.childrenTruncated, 'children')}</div></div>`);
    }
    const related = task.related || [];
    if (related.length) {
      bands.push(`<div class="context-rel-group"><div class="context-lane-label">Related</div><div class="context-rel-nodes">${related.map(n => nodeHtml(n)).join('')}</div></div>`);
    }
    const bandHtml = bands.length ? `<div class="context-hierarchy">${bands.join('')}</div>` : '';

    return `
      <div class="context-session-task" data-provenance="${esc(task.provenance || '')}">
        <div class="context-flow">${flowParts.join('')}</div>
        ${bandHtml}
      </div>`;
  }

  function renderSession(payload) {
    const graph = (payload && payload.graph) || payload || {};
    const tasks = graph.tasks || [];
    const seed = graph.seedIssue ? esc(graph.seedIssue) : null;

    if (!tasks.length) {
      return `
        <div class="context-header"><span class="context-status-label">session context</span></div>
        <div class="context-placeholder">No touched tasks recorded for this session.</div>`;
    }

    const counts = tasks.reduce((acc, t) => { acc[t.provenance] = (acc[t.provenance] || 0) + 1; return acc; }, {});
    const summaryBits = ['seed', 'descended', 'spun-off']
      .filter(k => counts[k])
      .map(k => `${counts[k]} ${PROVENANCE_LABEL[k]}`)
      .join(' · ');
    const hint = `${tasks.length} task${tasks.length === 1 ? '' : 's'} touched${summaryBits ? ` — ${summaryBits}` : ''}${seed ? ` · seed ${seed}` : ''}`;

    const body = tasks.map(sessionTaskHtml).join('');
    return `
      <div class="context-header">
        <span class="context-status-label">session context</span>
        <span class="context-hint">${hint}</span>
      </div>
      <div class="context-session">${body}</div>`;
  }

  function sessionContextUrl(urlKey, sessionId) {
    return `/workspace/${encodeURIComponent(urlKey)}/api/dashboard/session-context/${encodeURIComponent(sessionId)}`;
  }

  /**
   * Mount a SESSION context section: the relationship shape of every task an
   * autopilot session touched, provenance-tagged.
   *
   * @param {HTMLElement} container
   * @param {Object} opts
   * @param {string} opts.urlKey - Workspace url key.
   * @param {string} opts.sessionId - Autopilot session id.
   * @param {Function} [opts.onNavigate] - (identifier, event) => boolean (in-surface nav).
   */
  async function initSession(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.sessionId) return;
    container.classList.add('context-section');
    container.innerHTML = renderLoading();
    container.setAttribute('data-state', 'loading');

    try {
      const payload = await window.api(sessionContextUrl(opts.urlKey, opts.sessionId), { on401: false });
      container.innerHTML = renderSession(payload);
      container.setAttribute('data-state', 'loaded');
    } catch (err) {
      container.innerHTML = renderError(err && err.message);
      container.setAttribute('data-state', 'error');
    }
    wire(container, opts);
  }

  function renderLoading() {
    return `
      <div class="context-header"><span class="context-status-label">context · loading…</span></div>
      <div class="context-placeholder context-loading"><span class="context-spinner"></span> Mapping task relationships.</div>`;
  }

  function renderError(message) {
    return `
      <div class="context-header"><span class="context-status-label">context · error</span>
        <button type="button" class="context-refresh" data-context-refresh>↻ retry</button></div>
      <div class="context-placeholder context-error">${esc(message || 'Could not load context.')}</div>`;
  }

  function wire(container, opts) {
    const retry = container.querySelector('[data-context-refresh]');
    if (retry) retry.addEventListener('click', () => init(container, opts));

    // Node navigation: let the surface intercept (e.g. jump within the swipe
    // deck); otherwise the anchor's href carries the user to the task.
    container.querySelectorAll('[data-context-nav]').forEach(el => {
      el.addEventListener('click', (e) => {
        const identifier = el.getAttribute('data-context-nav');
        if (typeof opts.onNavigate === 'function' && opts.onNavigate(identifier, e)) {
          e.preventDefault();
        }
      });
    });
  }

  /**
   * Mount a context section inside the given container.
   *
   * @param {HTMLElement} container
   * @param {Object} opts
   * @param {string} opts.urlKey - Workspace url key.
   * @param {string} opts.identifier - Linear issue id (UUID) or identifier (LIN-123).
   * @param {Function} [opts.onNavigate] - (identifier, event) => boolean. Return
   *   true to handle navigation in-surface (suppresses the default link follow).
   */
  async function init(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.identifier) return;
    container.classList.add('context-section');
    container.innerHTML = renderLoading();
    container.setAttribute('data-state', 'loading');

    try {
      const graph = await fetchContext(opts.urlKey, opts.identifier);
      container.innerHTML = renderGraph(graph);
      container.setAttribute('data-state', 'loaded');
    } catch (err) {
      container.innerHTML = renderError(err && err.message);
      container.setAttribute('data-state', 'error');
    }
    wire(container, opts);
  }

  window.ContextSection = { init, initSession, renderSession };
})();
