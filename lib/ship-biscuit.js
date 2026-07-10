/**
 * "The Ship's Biscuit" — deterministic edition model (LIN-818, V1).
 *
 * An edition is a function of a time window `[since, now]`. This module builds the
 * DETERMINISTIC half of the two-phase design (Approach B, index-first): it reads
 * the already-wired workspace event stores over the window and returns a stable,
 * *addressable* model — an ordered list of source slices, each with a unique id and
 * a self-contained content snapshot. The one "editor-in-chief" LLM call
 * (lib/prompts/ship-biscuit-editor.js) reasons over this model to produce the front
 * page + an index of article stubs; each stub pins the source slices it was built
 * from BY VALUE (the snapshot), so a later on-demand article pass (V2) stays grounded
 * even after the source rows age out.
 *
 * Two load-bearing properties, both pinned by tests:
 *  - **Determinism / addressability (§B):** same inputs → same model, and every
 *    `SourceRef.id` is unique and stable, so a stub can reference a slice by id and
 *    resolve it back to content. `buildEditionModel` is PURE over already-fetched
 *    data (the route does the async gathering) so this is trivially testable.
 *  - **Quiet-window honesty:** an empty window yields `isQuiet: true` and zero news
 *    slices, so the generator can produce an honest "slow news day" rather than
 *    fabricating headlines.
 *
 * V1 sources (all carry a 30-day TTL, so `month` is the honest maximum window):
 *  - observation sessions read-model  → lead stories ("what autopilot did")
 *  - agent-status narrative log        → the richest prose feedstock
 *  - llm-call-log summary              → the "Weather" by-the-numbers strip
 *
 * V2 (deferred) folds in task-snapshots + Linear completions and the on-demand
 * article/cache seam; nothing here forecloses that — new sources are additive slices.
 */

/** Window keys, smallest → largest. `month` is the max because V1 sources TTL at 30 days. */
export const WINDOWS = ['day', 'week', 'month'];

/** Default window when none/invalid requested. */
export const DEFAULT_WINDOW = 'week';

/** The honest maximum window: V1 sources TTL at 30 days, so `month` is the ceiling. */
export const MAX_WINDOW = 'month';

/**
 * Recognised requests for a window LARGER than the max. They cannot be served
 * honestly by V1's 30-day-TTL sources, so they clamp DOWN to the max rather than
 * silently reading aged-out data or dropping to the smaller default (LIN-818 §D — a
 * true no-TTL "quarter" would need task-snapshot/report-history/Linear sources only,
 * which is deferred to V2).
 */
export const OVERSIZED_WINDOWS = ['quarter', 'year', 'all'];

/** Days per window key. `month` = 30 to match the source TTL exactly (LIN-818 §D). */
export const WINDOW_DAYS = { day: 1, week: 7, month: 30 };

/** Suggested "desks" the editor may weight from; a hint, not a frozen layout. */
export const DESKS = ['Front Page', 'The Wire', 'Deep Dive', 'The Column', 'Weather'];

// Keep the model lean: snapshots carry enough to ground a later article, not the world.
const MAX_SNAPSHOT_SUMMARY = 2000;
const MAX_SOURCES = 60;

/**
 * Clamp a requested window to the allowed set, defaulting to `week` and capping at
 * `month`. An unknown/oversized request degrades to the honest maximum rather than
 * silently reading TTL'd-out sources (LIN-818 §D — the window cap is coupled to the
 * 30-day source TTL, so this is where "quarter" would have to drop to no-TTL sources
 * only; V1 has none of those, so it clamps).
 *
 * @param {string} [requested]
 * @returns {'day'|'week'|'month'}
 */
export function resolveWindow(requested) {
  const w = typeof requested === 'string' ? requested.trim().toLowerCase() : '';
  if (WINDOWS.includes(w)) return w;
  // A recognised too-big window clamps to the honest max; anything else defaults.
  if (OVERSIZED_WINDOWS.includes(w)) return MAX_WINDOW;
  return DEFAULT_WINDOW;
}

/**
 * Resolve a window key to a concrete `[since, now]` range.
 * @param {string} window
 * @param {number|Date} [now=Date.now()] - Injectable clock for deterministic tests.
 * @returns {{ window: string, since: Date, now: Date, days: number }}
 */
export function windowRange(window, now = Date.now()) {
  const resolved = resolveWindow(window);
  const days = WINDOW_DAYS[resolved];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return {
    window: resolved,
    since: new Date(nowMs - days * 86400000),
    now: new Date(nowMs),
    days
  };
}

function toMs(value) {
  if (!value) return NaN;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * The one-line outcome of a session, derived from its loops' terminal state — the
 * deterministic "what happened" a lead story needs. Never invents; falls back to a
 * neutral label when the loops carry no terminal signal.
 */
function sessionOutcome(session) {
  const loops = Array.isArray(session?.loops) ? session.loops : [];
  const states = loops.map(l => l && l.agentState).filter(Boolean);
  if (states.includes('error')) return 'ran into trouble';
  if (states.includes('waiting')) return 'is waiting on a human';
  if (states.length && states.every(s => s === 'complete')) return 'completed cleanly';
  if (states.includes('complete')) return 'made progress';
  if (states.includes('running')) return 'is still running';
  return 'was dispatched';
}

/**
 * Turn one materialized session into an addressable lead-story slice. The snapshot
 * carries enough (tasks touched, per-loop summaries, outcome, timings) to ground a
 * later article without re-reading the source rows (§B).
 */
function sessionToSource(session) {
  const loops = Array.isArray(session?.loops) ? session.loops : [];
  const seed = session.seedIssue || (loops[0] && loops[0].issueIdentifier) || null;
  const tasksTouched = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  const outcome = sessionOutcome(session);
  const seedTitle = (loops.find(l => l.issueIdentifier === seed) || {}).issueTitle || null;
  const headline = seed
    ? `${seed}${seedTitle ? ` — ${seedTitle}` : ''} ${outcome}`
    : `An autopilot session ${outcome}`;

  return {
    id: `session:${session.sessionId}`,
    kind: 'session',
    desk: 'The Wire',
    headline: clampText(headline, 200),
    timestamp: session.completedAt || session.dispatchedAt || null,
    weight: 3,
    snapshot: {
      sessionId: session.sessionId,
      seedIssue: seed,
      seedTitle,
      tasksTouched,
      outcome,
      dispatchedAt: session.dispatchedAt || null,
      completedAt: session.completedAt || null,
      runtime: session.telemetry?.runtime || null,
      // Per-loop prose + phase, the best narrative feedstock a session carries.
      beats: loops.slice(0, 12).map(l => ({
        issue: l.issueIdentifier || null,
        title: l.issueTitle || null,
        phase: l.promptName || l.stage || null,
        state: l.agentState || null,
        summary: clampText(l.agentSummary || '', MAX_SNAPSHOT_SUMMARY)
      }))
    }
  };
}

/**
 * Turn one agent-status entry into an addressable narrative slice. Agent-status
 * `summary` is the richest free-text feedstock in the window, so these are prime
 * article seeds.
 */
function statusToSource(item) {
  const task = item.taskIdentifier || null;
  const action = item.action || 'update';
  return {
    id: `status:${item.id}`,
    kind: 'status',
    desk: 'Deep Dive',
    headline: clampText(`${task ? `${task}: ` : ''}${action}${item.status ? ` (${item.status})` : ''}`, 200),
    timestamp: item.timestamp || null,
    weight: 2,
    snapshot: {
      statusId: item.id,
      taskIdentifier: task,
      action,
      status: item.status || null,
      summary: clampText(item.summary || '', MAX_SNAPSHOT_SUMMARY),
      timestamp: item.timestamp || null
    }
  };
}

/**
 * Turn one task's window of snapshots into an addressable board-movement slice
 * (LIN-1197). A single task-snapshot carries only ONE `state`, so a `Before → After`
 * transition can only come from comparing the SAME task's earliest vs latest
 * snapshot inside the window — that grouping happens in `buildEditionModel`, which
 * hands this helper a `{ taskIdentifier, earliest, latest, count }` group.
 *
 * Headline is **title-led** (the task id is used only when the snapshot carries no
 * title — see the ticket's "avoid task IDs unless needed to disambiguate"). The
 * transition/degenerate rule:
 *   - state name changed  → `Title — Before → After` (a real board move). When the
 *     latest state's `type` is `completed`, it is additionally flagged a completion
 *     and floated to the Front Page.
 *   - no state change but priority changed → `Title — priority changed`
 *     (a meaningful-but-lesser move; never a null `X → X`).
 *   - no state change and no priority change → `Title — still <state>` (the slice
 *     changed in some other field — description/comments/labels — since the store is
 *     hash-gated, so it is genuine feedstock, surfaced as a low-weight "still active"
 *     note rather than dropped or faked into a transition).
 */
function taskToSource(group) {
  const { taskIdentifier, earliest, latest, count } = group;
  const beforeSnap = earliest.snapshot || {};
  const afterSnap = latest.snapshot || {};

  const title = clampText(afterSnap.title, 200) || clampText(beforeSnap.title, 200);
  const label = title || taskIdentifier; // title-led; fall back to id only when untitled
  const fromState = clampText(beforeSnap.state?.name, 100) || null;
  const toState = clampText(afterSnap.state?.name, 100) || null;
  const transitioned = !!(fromState && toState && fromState !== toState);
  const completed = transitioned && afterSnap.state?.type === 'completed';

  const priorityBefore = typeof beforeSnap.priority === 'number' ? beforeSnap.priority : null;
  const priorityAfter = typeof afterSnap.priority === 'number' ? afterSnap.priority : null;
  const priorityChanged = priorityBefore !== priorityAfter;

  let headline;
  if (transitioned) {
    headline = `${label} — ${fromState} → ${toState}`;
  } else if (priorityChanged) {
    headline = `${label} — priority changed`;
  } else {
    headline = toState ? `${label} — still ${toState}` : label;
  }

  return {
    id: `task:${taskIdentifier}`,
    kind: 'task',
    // A completion is genuine headline board movement; a plain move rides The Wire.
    desk: completed ? 'Front Page' : 'The Wire',
    headline: clampText(headline, 200),
    timestamp: latest.capturedAt || null,
    // Weight parity with existing sources: a real transition is lead-worthy (3, like a
    // session lead story); a degenerate "still active" note sits at status level (2).
    weight: transitioned ? 3 : 2,
    snapshot: {
      taskIdentifier,
      title,
      from: fromState,
      to: toState,
      transitioned,
      completed,
      priorityBefore,
      priorityAfter,
      priorityChanged,
      snapshots: count,
      capturedFrom: earliest.capturedAt || null,
      capturedTo: latest.capturedAt || null
    }
  };
}

/**
 * Build the deterministic edition model over already-fetched window sources. PURE:
 * the route gathers `sessions` / `agentStatusItems` / `llmStats` / `taskSnapshotItems`
 * from the stores and hands them in, so determinism and addressability are trivially
 * testable.
 *
 * @param {Object} input
 * @param {string} [input.window] - Requested window key (clamped via resolveWindow).
 * @param {number|Date} [input.now=Date.now()] - Injectable clock.
 * @param {string} [input.workspaceName]
 * @param {Array<Object>} [input.sessions] - Materialized observation sessions (findByWorkspace().sessions).
 * @param {Array<Object>} [input.agentStatusItems] - listStatus(urlKey,{since}).items.
 * @param {Array<Object>} [input.taskSnapshotItems] - listByWorkspace(urlKey,{since}).items:
 *   RAW window snapshots, each ~`{ taskIdentifier, capturedAt, snapshot: { title, state{name,type}, priority, … } }`.
 *   Grouped-by-task and diffed here (earliest vs latest) — no store/I/O; derivation is pure.
 * @param {Object|null} [input.llmStats] - llmCallLog.summarize(urlKey) output (the Weather numbers).
 * @returns {Object} A deterministic, addressable edition model.
 */
export function buildEditionModel({
  window,
  now = Date.now(),
  workspaceName = '',
  sessions = [],
  agentStatusItems = [],
  taskSnapshotItems = [],
  llmStats = null
} = {}) {
  const range = windowRange(window, now);
  const sinceMs = range.since.getTime();
  const nowMs = range.now.getTime();

  const inWindow = (ts) => {
    const ms = toMs(ts);
    return Number.isFinite(ms) && ms >= sinceMs && ms <= nowMs;
  };

  const sources = [];

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || !session.sessionId) continue;
    // A session belongs to the window if it started OR finished inside it.
    if (!inWindow(session.dispatchedAt) && !inWindow(session.completedAt)) continue;
    sources.push(sessionToSource(session));
  }

  for (const item of Array.isArray(agentStatusItems) ? agentStatusItems : []) {
    if (!item || !item.id) continue;
    if (!inWindow(item.timestamp)) continue;
    // Skip empty-summary status entries — they carry no article feedstock.
    if (!clampText(item.summary, MAX_SNAPSHOT_SUMMARY)) continue;
    sources.push(statusToSource(item));
  }

  // Task snapshots: a single snapshot has only ONE state, so group the window's
  // snapshots by task and derive Before → After from the earliest vs latest capture
  // in-window (LIN-1197). One source per task. Map insertion order is irrelevant —
  // the sort below re-orders by timestamp with the unique `task:<id>` as tie-break.
  const taskGroups = new Map();
  for (const item of Array.isArray(taskSnapshotItems) ? taskSnapshotItems : []) {
    if (!item || !item.taskIdentifier) continue;
    if (!inWindow(item.capturedAt)) continue;
    const existing = taskGroups.get(item.taskIdentifier);
    if (!existing) {
      taskGroups.set(item.taskIdentifier, { taskIdentifier: item.taskIdentifier, earliest: item, latest: item, count: 1 });
      continue;
    }
    existing.count += 1;
    // Ties on capturedAt broken by the store's monotonic `seq` (lower = earlier).
    const ms = toMs(item.capturedAt);
    const earlierMs = toMs(existing.earliest.capturedAt);
    const laterMs = toMs(existing.latest.capturedAt);
    if (ms < earlierMs || (ms === earlierMs && (item.seq || 0) < (existing.earliest.seq || 0))) existing.earliest = item;
    if (ms > laterMs || (ms === laterMs && (item.seq || 0) >= (existing.latest.seq || 0))) existing.latest = item;
  }
  for (const group of taskGroups.values()) {
    sources.push(taskToSource(group));
  }

  // Deterministic order: newest first, id as a stable tie-break so equal-timestamp
  // slices never reorder between builds (the addressability contract).
  sources.sort((a, b) => {
    const diff = (toMs(b.timestamp) || 0) - (toMs(a.timestamp) || 0);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const boundedSources = sources.slice(0, MAX_SOURCES);

  // Weather is a light by-the-numbers strip, not "news": present only when there is
  // actually spend/activity to report, and it never makes a quiet window loud.
  const stats = llmStats && typeof llmStats === 'object' ? llmStats : null;
  const weather = stats && stats.totalCalls > 0
    ? {
        totalCalls: stats.totalCalls || 0,
        totalCost: stats.totalCost || 0,
        totalTokens: stats.totalTokens || 0,
        byFeature: Array.isArray(stats.byFeature) ? stats.byFeature.slice(0, 8) : []
      }
    : null;

  return {
    window: range.window,
    windowDays: range.days,
    since: range.since.toISOString(),
    generatedAt: range.now.toISOString(),
    workspaceName: clampText(workspaceName, 200),
    isQuiet: boundedSources.length === 0,
    counts: {
      sessions: boundedSources.filter(s => s.kind === 'session').length,
      status: boundedSources.filter(s => s.kind === 'status').length,
      tasks: boundedSources.filter(s => s.kind === 'task').length,
      total: boundedSources.length
    },
    sources: boundedSources,
    weather
  };
}

/**
 * Render the deterministic model into the compact grounding text the editor LLM
 * reasons over. Every source is labelled with its stable id so the model can
 * reference slices by id in its index (and we can validate those ids on the way
 * back — the grounding guard). Pure.
 *
 * @param {Object} model - buildEditionModel output.
 * @returns {string}
 */
export function formatEditionContext(model) {
  if (!model || typeof model !== 'object') return 'No workspace activity available.';
  const lines = [];
  if (model.workspaceName) lines.push(`Workspace: ${model.workspaceName}`);
  lines.push(`Window: the last ${model.windowDays} day(s) (${model.window}), ${model.since} → ${model.generatedAt}.`);
  lines.push(`Activity: ${model.counts.sessions} autopilot session(s), ${model.counts.status} status update(s) with prose, ${model.counts.tasks} task(s) that moved on the board.`);

  if (model.isQuiet) {
    lines.push('');
    lines.push('There is NO activity in this window. This is a genuinely slow news day.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Source slices (reference these by their exact id in your index sourceRefs):');
  for (const s of model.sources) {
    lines.push('');
    lines.push(`- id: ${s.id}  [${s.kind}, suggested desk: ${s.desk}, ${s.timestamp || 'undated'}]`);
    lines.push(`  headline seed: ${s.headline}`);
    if (s.kind === 'session') {
      const snap = s.snapshot;
      if (snap.tasksTouched?.length) lines.push(`  tasks touched: ${snap.tasksTouched.join(', ')}`);
      lines.push(`  outcome: ${snap.outcome}`);
      for (const beat of snap.beats || []) {
        if (beat.summary) lines.push(`  • ${beat.issue || ''} ${beat.phase ? `[${beat.phase}] ` : ''}${beat.summary}`);
      }
    } else if (s.kind === 'status') {
      const snap = s.snapshot;
      if (snap.summary) lines.push(`  detail: ${snap.summary}`);
    } else if (s.kind === 'task') {
      // Title-led board movement: the headline seed above already carries the task
      // title, so this adds the structured transition/completion/priority facts.
      const snap = s.snapshot;
      if (snap.transitioned) {
        lines.push(`  state change: ${snap.from} → ${snap.to}${snap.completed ? ' (completed)' : ''}`);
      } else if (snap.to) {
        lines.push(`  state: ${snap.to} (unchanged in window)`);
      }
      if (snap.priorityChanged) {
        lines.push(`  priority change: ${snap.priorityBefore} → ${snap.priorityAfter}`);
      }
    }
  }

  if (model.weather) {
    lines.push('');
    lines.push(`By the numbers: ${model.weather.totalCalls} AI call(s), $${(model.weather.totalCost || 0).toFixed(4)}, ${model.weather.totalTokens} token(s).`);
  }

  return lines.join('\n');
}
