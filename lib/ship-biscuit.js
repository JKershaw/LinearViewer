/**
 * "The Ship's Biscuit" — deterministic edition model (LIN-818, V1; landed-first LIN-4500).
 *
 * An edition is a function of a time window `[since, now]`. This module builds the
 * DETERMINISTIC half of the two-phase design (Approach B, index-first): it reads
 * the window's sources and returns a stable, *addressable* model — an ordered list of
 * source slices, each with a unique id and a self-contained content snapshot. The one
 * "editor-in-chief" LLM call (lib/prompts/ship-biscuit-editor.js) reasons over this model
 * to produce the front page + an index of article stubs; each stub pins the source slices
 * it was built from BY VALUE (the snapshot), so a later on-demand article pass (V2) stays
 * grounded from the snapshot itself, independent of any later store read: the evidence
 * stores are lifetime-retained (LIN-3163), but the observation-sessions read-model still ages
 * out at 30 days and report history is capacity-capped.
 *
 * Two load-bearing properties, both pinned by tests:
 *  - **Determinism / addressability (§B):** same inputs → same model, and every
 *    `SourceRef.id` is unique and stable, so a stub can reference a slice by id and
 *    resolve it back to content. `buildEditionModel` is PURE over already-fetched
 *    data (the route does the async gathering) so this is trivially testable.
 *  - **Quiet-window honesty:** an empty window yields `isQuiet: true` and zero news
 *    slices, so the generator can produce an honest "slow news day" rather than
 *    fabricating headlines. A source that could not be read (`sourcesUnread`, e.g. a
 *    failed tracker read) is never quiet: it is reported as unread, not as nothing.
 *
 * The edition leads with LANDED work: what merged and what was finished in the window
 * (LIN-4500). Runs are background.
 *
 * Sources:
 *  - landed work (merges + tracker completions, joined on issue) → the lead ("what got done")
 *    `landedInWindow` below. Merges come from the close-out ledger (LOCAL: `listMergedSince`),
 *    which records only merges Harbour saw; tracker completions come from `fetchWorkspaceIssues`,
 *    a provider fetch that can fail. A failed tracker read is `sourcesUnread: ['tracker']`.
 *  - observation sessions read-model   → background ("what autopilot did")
 *  - agent-status narrative log        → background, the richest prose feedstock
 *  - roadmap report-history (LIN-1212) → background: the workspace's own synthesised roadmap
 *                                        narrative + per-task orientation bearings
 *  - llm-call-log summary              → the "Weather" by-the-numbers strip
 *
 * The event-stream sources are read on the shared 30-day read horizon (evidence
 * is lifetime-retained; the horizon is a read window, not a TTL), so `month` is
 * the honest maximum window. New sources fold in as additive slices — nothing
 * here forecloses that.
 * Live roadmap MODEL numbers (velocity/milestones/critical-path) still need a provider
 * fetch and stay OUT (LIN-1199 plumbing).
 */

import { toEpochMs } from './utils/time.js';
import { sumWords } from './cost-format.js';

/** Window keys, smallest → largest. `month` is the max because V1 sources read at a 30-day horizon. */
export const WINDOWS = ['day', 'week', 'month'];

/** Default window when none/invalid requested. */
export const DEFAULT_WINDOW = 'week';

/** The honest maximum window: V1 sources are read over a 30-day horizon, so `month` is the ceiling. */
export const MAX_WINDOW = 'month';

/**
 * Recognised requests for a window LARGER than the max. They cannot be served
 * honestly by the 30-day-read-horizon sources, so they clamp DOWN to the max rather than
 * silently reading beyond the horizon or dropping to the smaller default (LIN-818 §D). A
 * wider "quarter" would need the run sources read past the 30-day horizon, or a
 * landed-only window: a product call for John, deferred.
 */
export const OVERSIZED_WINDOWS = ['quarter', 'year', 'all'];

/** Days per window key. `month` = 30 to match the 30-day read horizon exactly (LIN-818 §D). */
export const WINDOW_DAYS = { day: 1, week: 7, month: 30 };

/** Suggested "desks" the editor may weight from; a hint, not a frozen layout. */
export const DESKS = ['Front Page', 'The Wire', 'Deep Dive', 'The Column', 'Weather'];

// Keep the model lean: snapshots carry enough to ground a later article, not the world.
const MAX_SNAPSHOT_SUMMARY = 2000;
const MAX_SOURCES = 60;
// LIN-4500: landed work gets its own cap, so busy run logs cannot push it out of the
// list before it is weighed. The rest of MAX_SOURCES is background (runs, roadmap reports).
export const MAX_LANDED = 25;
export const MAX_BACKGROUND = MAX_SOURCES - MAX_LANDED;
// Cap the per-task orientation bearings a roadmap slice carries by value (LIN-1212),
// mirroring the session `beats` cap — enough to ground an article, not the whole roadmap.
const MAX_ORIENTATION_BEARINGS = 12;

/**
 * Clamp a requested window to the allowed set, defaulting to `week` and capping at
 * `month`. An unknown/oversized request degrades to the honest maximum rather than
 * silently reading beyond the horizon (LIN-818 §D — the window cap is coupled to the
 * 30-day read horizon, so this is where "quarter" would have to drop to wider sources
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
 * Turn one materialized session into an addressable background slice. The snapshot
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
 * Join the window's landings with its tracker completions, one item per issue
 * (LIN-4500). PURE: no I/O, no clock beyond `now`.
 *
 * - A merge counts when its `mergedAt` is inside `[since, now]`. Every in-window PR on an
 *   issue is kept, deduplicated by `prUrl`, each with its merge time. A merge outside the
 *   window is not listed, so a completion whose merge predates the window shows as
 *   finished with no old PR attached.
 * - A completion counts when the issue's literal `state.type === 'completed'` and its
 *   `completedAt` is inside the window. `isCompleted()` is deliberately NOT used: it admits
 *   canceled and duplicate states.
 * - An issue with either fact is one item; with both, one item carries both.
 * - The title comes from the tracker issue. A merge whose issue is not in `issues` (deleted,
 *   other scope, or the tracker was not read) keeps its identifier as the label, with no
 *   title; it is never dropped.
 * - Junk or missing timestamps are excluded, never coerced (`toEpochMs`).
 *
 * @param {Object} input
 * @param {Array<{prUrl: string, issueIdentifier: string, mergedAt: (string|Date)}>} [input.merges] -
 *   `closeOutEventsStore.listMergedSince` output.
 * @param {Array<Object>} [input.issues] - tracker issues `{ identifier, title, state{type}, completedAt }`.
 * @param {Date|number} input.since - inclusive lower bound.
 * @param {Date|number} input.now - inclusive upper bound.
 * @returns {Array<{identifier: string, title: (string|null), prs: Array<{url: string, mergedAt: string}>,
 *   merged: boolean, finished: boolean, completedAt: (string|null), time: number}>}
 *   Newest first (`time` = the item's latest in-window timestamp, epoch ms), identifier as tie-break.
 */
export function landedInWindow({ merges = [], issues = [], since, now } = {}) {
  const sinceMs = toEpochMs(since);
  const nowMs = toEpochMs(now);
  if (sinceMs == null || nowMs == null) return [];
  const inWindow = (ms) => ms != null && ms >= sinceMs && ms <= nowMs;

  const issueById = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue || typeof issue.identifier !== 'string' || !issue.identifier) continue;
    if (!issueById.has(issue.identifier)) issueById.set(issue.identifier, issue);
  }

  const byId = new Map();
  const entryFor = (identifier) => {
    let entry = byId.get(identifier);
    if (!entry) {
      entry = { identifier, title: null, prs: [], merged: false, finished: false, completedAt: null, time: null };
      byId.set(identifier, entry);
    }
    return entry;
  };
  const noteTime = (entry, ms) => {
    if (entry.time == null || ms > entry.time) entry.time = ms;
  };

  for (const merge of Array.isArray(merges) ? merges : []) {
    if (!merge || typeof merge.issueIdentifier !== 'string' || !merge.issueIdentifier) continue;
    const mergedMs = toEpochMs(merge.mergedAt);
    if (!inWindow(mergedMs)) continue;
    const entry = entryFor(merge.issueIdentifier);
    entry.merged = true;
    noteTime(entry, mergedMs);
    const url = typeof merge.prUrl === 'string' ? merge.prUrl : '';
    if (!entry.prs.some(pr => pr.url === url)) {
      entry.prs.push({ url, mergedAt: new Date(mergedMs).toISOString() });
    }
  }

  for (const issue of issueById.values()) {
    // The literal state type, never isCompleted(): that admits canceled and duplicate.
    if (issue.state?.type !== 'completed') continue;
    const completedMs = toEpochMs(issue.completedAt);
    if (!inWindow(completedMs)) continue;
    const entry = entryFor(issue.identifier);
    entry.finished = true;
    entry.completedAt = new Date(completedMs).toISOString();
    noteTime(entry, completedMs);
  }

  for (const entry of byId.values()) {
    const issue = issueById.get(entry.identifier);
    const title = issue && typeof issue.title === 'string' ? issue.title.trim() : '';
    entry.title = title || null;
    // Newest PR first, url as tie-break, so the snapshot is deterministic.
    entry.prs.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : a.mergedAt > b.mergedAt ? -1 : (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)));
  }

  return [...byId.values()].sort((a, b) => (b.time - a.time) || (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0));
}

/**
 * Turn one landed item (from `landedInWindow`) into the addressable Front Page slice
 * (LIN-4500). The snapshot carries the facts by value (title, PRs with merge times,
 * finished, completedAt), so a later article stays grounded after the store ages.
 */
function landedToSource(item) {
  const label = clampText(item.title, 200) || item.identifier;
  const outcome = item.finished && item.merged ? 'finished, and its PR merged'
    : item.finished ? 'finished'
    : 'its PR merged';
  return {
    id: `landed:${item.identifier}`,
    kind: 'landed',
    desk: 'Front Page',
    headline: clampText(`${label} — ${outcome}`, 200),
    timestamp: new Date(item.time).toISOString(),
    weight: 5,
    snapshot: {
      identifier: item.identifier,
      title: item.title || null,
      prs: item.prs.map(pr => ({ url: pr.url, mergedAt: pr.mergedAt })),
      merged: item.merged,
      finished: item.finished,
      completedAt: item.completedAt
    }
  };
}

/**
 * Turn the latest saved roadmap report (report-history — LIN-299/300/301) into an
 * addressable analysis slice (LIN-1212). This is the workspace's OWN synthesised
 * roadmap thinking — the narrative digest + per-task orientation bearings vs the north
 * star — which the event-stream sources never carry. It is LOCAL and additive: the
 * numeric roadmap MODEL (velocity/milestones/critical-path) needs a live provider fetch
 * and stays out (that plumbing is owned by LIN-1199).
 *
 * The snapshot carries the prose + bearings BY VALUE so a later article stays grounded
 * from the snapshot itself (§B), because report-history is capacity-capped
 * (MAX_REPORTS_PER_WORKSPACE — it never TTLs, but it prunes) — clamped by the same
 * MAX_SNAPSHOT_SUMMARY discipline
 * as every other source. Archived bearings are dropped (they are hidden from the
 * orientation view, so they are not news).
 */
function roadmapToSource(report) {
  const narrative = report.narrative && typeof report.narrative === 'object' ? report.narrative : {};
  const northStar = clampText(report.northStar, 200);
  const orientation = (Array.isArray(report.orientation) ? report.orientation : [])
    .filter(o => o && o.archived !== true)
    .slice(0, MAX_ORIENTATION_BEARINGS)
    .map(o => ({
      identifier: clampText(o.identifier, 100),
      bearing: clampText(o.bearing, 200),
      reason: clampText(o.reason, MAX_SNAPSHOT_SUMMARY)
    }));
  const headline = northStar
    ? `The roadmap, measured against "${northStar}"`
    : 'The roadmap, re-read';
  return {
    id: `roadmap:${report.id}`,
    kind: 'roadmap',
    // Analysis feedstock for the Deep Dive desk, not a lead board-move: status-level weight.
    desk: 'Deep Dive',
    headline: clampText(headline, 200),
    timestamp: report.generatedAt || null,
    weight: 2,
    snapshot: {
      reportId: report.id,
      generatedAt: report.generatedAt || null,
      northStar,
      digest: clampText(narrative.digest, MAX_SNAPSHOT_SUMMARY),
      technical: clampText(narrative.technical, MAX_SNAPSHOT_SUMMARY),
      product: clampText(narrative.product, MAX_SNAPSHOT_SUMMARY),
      orientation
    }
  };
}

/** Newest first, the stable id as the tie-break: the addressability contract's order. */
function sortNewestFirst(list) {
  return list.sort((a, b) => {
    const diff = (toEpochMs(b.timestamp) ?? 0) - (toEpochMs(a.timestamp) ?? 0);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Build the deterministic edition model over already-fetched window sources. PURE:
 * the route gathers the merges, the tracker issues, the sessions / status / llmStats /
 * roadmap report from the stores and hands them in, so determinism and addressability
 * are trivially testable.
 *
 * Landed work leads. Landed slices and background slices are two groups with their own
 * caps (`MAX_LANDED`, `MAX_BACKGROUND`), so a busy run log cannot push landed work out.
 * The landed group comes first in `sources`.
 *
 * @param {Object} input
 * @param {string} [input.window] - Requested window key (clamped via resolveWindow).
 * @param {number|Date} [input.now=Date.now()] - Injectable clock.
 * @param {string} [input.workspaceName]
 * @param {Array<Object>} [input.merges] - listMergedSince output: `{ prUrl, issueIdentifier, mergedAt }`.
 *   A merge-store read error arrives as `[]` (the store's own contract), so it looks like an
 *   empty window here.
 * @param {Array<Object>} [input.issues] - tracker issues (fetchWorkspaceIssues): `{ identifier, title,
 *   state{type}, completedAt }`. Completions are read from these.
 * @param {Array<string>} [input.sourcesUnread] - sources that could not be read, e.g. `['tracker']`.
 *   An unread source is never quiet: `isQuiet` stays false.
 * @param {Array<Object>} [input.sessions] - Materialized observation sessions (findByWorkspace().sessions).
 * @param {Array<Object>} [input.agentStatusItems] - listStatus(urlKey,{since}).items.
 * @param {Object|null} [input.llmStats] - `callsSurfaceOf(listInHorizon(urlKey))` output (lib/cost-read-calls.js) (the Weather numbers).
 * @param {Object|null} [input.roadmapReport] - reportHistoryStore.getLatest(urlKey) output (LIN-1212):
 *   the newest saved roadmap report REGARDLESS of window. Window-filtered here by
 *   `generatedAt`, so it only becomes a slice when generated inside `[since, now]`.
 * @returns {Object} A deterministic, addressable edition model.
 */
export function buildEditionModel({
  window,
  now = Date.now(),
  workspaceName = '',
  merges = [],
  issues = [],
  sourcesUnread = [],
  sessions = [],
  agentStatusItems = [],
  llmStats = null,
  roadmapReport = null
} = {}) {
  const range = windowRange(window, now);
  const sinceMs = range.since.getTime();
  const nowMs = range.now.getTime();

  const inWindow = (ts) => {
    const ms = toEpochMs(ts);
    return Number.isFinite(ms) && ms >= sinceMs && ms <= nowMs;
  };

  // Landed work: merges joined to tracker completions on issue identifier (LIN-4500).
  const landed = sortNewestFirst(landedInWindow({ merges, issues, since: range.since, now: range.now }).map(landedToSource));

  const background = [];

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || !session.sessionId) continue;
    // A session belongs to the window if it started OR finished inside it.
    if (!inWindow(session.dispatchedAt) && !inWindow(session.completedAt)) continue;
    background.push(sessionToSource(session));
  }

  for (const item of Array.isArray(agentStatusItems) ? agentStatusItems : []) {
    if (!item || !item.id) continue;
    if (!inWindow(item.timestamp)) continue;
    // Skip empty-summary status entries — they carry no article feedstock.
    if (!clampText(item.summary, MAX_SNAPSHOT_SUMMARY)) continue;
    background.push(statusToSource(item));
  }

  // Roadmap report-history (LIN-1212): the workspace's own synthesised roadmap
  // narrative + orientation bearings. getLatest() returns the newest report REGARDLESS
  // of window, so window-filter it by `generatedAt` exactly like every other source —
  // otherwise a single old report would flip EVERY edition non-quiet, silently
  // destroying quiet-window honesty (the "slow news day" that skips the LLM). A report
  // is news the day it was generated.
  if (roadmapReport && roadmapReport.id && inWindow(roadmapReport.generatedAt)) {
    background.push(roadmapToSource(roadmapReport));
  }

  // Each group keeps its own cap. Landed comes first, so it is never squeezed out by
  // background load: the source-priority guarantee of LIN-4500.
  const boundedLanded = landed.slice(0, MAX_LANDED);
  const landedOmitted = landed.length - boundedLanded.length;
  const boundedBackground = sortNewestFirst(background).slice(0, MAX_BACKGROUND);
  const boundedSources = [...boundedLanded, ...boundedBackground];

  const unread = [...new Set((Array.isArray(sourcesUnread) ? sourcesUnread : []).filter(s => typeof s === 'string' && s))];

  // Weather is a light by-the-numbers strip, not "news": present only when there is
  // actually spend/activity to report, and it never makes a quiet window loud.
  const stats = llmStats && typeof llmStats === 'object' ? llmStats : null;
  // The weather's cost is the priced sum with its unpriced count (LIN-4179): a null call cost is never added as $0.
  const weather = stats && stats.totalCalls > 0
    ? {
        totalCalls: stats.totalCalls || 0,
        pricedUsd: stats.pricedUsd || 0,
        unpricedCalls: stats.unpricedCalls || 0,
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
    // An unread source is not quiet: a failed read must never read as a slow news day.
    isQuiet: boundedSources.length === 0 && unread.length === 0,
    counts: {
      landed: boundedLanded.length,
      sessions: boundedSources.filter(s => s.kind === 'session').length,
      status: boundedSources.filter(s => s.kind === 'status').length,
      roadmap: boundedSources.filter(s => s.kind === 'roadmap').length,
      total: boundedSources.length
    },
    landedOmitted,
    sourcesUnread: unread,
    sources: boundedSources,
    weather
  };
}

/**
 * Render the deterministic model into the compact grounding text the editor LLM
 * reasons over. Every source is labelled with its stable id so the model can
 * reference slices by id in its index (and we can validate those ids on the way
 * back — the grounding guard). Landed work is listed first, under its own heading;
 * background follows. Pure.
 *
 * @param {Object} model - buildEditionModel output.
 * @returns {string}
 */
export function formatEditionContext(model) {
  if (!model || typeof model !== 'object') return 'No workspace activity available.';
  const lines = [];
  if (model.workspaceName) lines.push(`Workspace: ${model.workspaceName}`);
  lines.push(`Window: the last ${model.windowDays} day(s) (${model.window}), ${model.since} → ${model.generatedAt}.`);
  lines.push(`Activity: ${model.counts.landed} landed item(s) (work merged or finished in the window), ${model.counts.sessions} autopilot session(s), ${model.counts.status} status update(s) with prose${model.counts.roadmap ? `, ${model.counts.roadmap} roadmap report(s)` : ''}.`);

  const unread = Array.isArray(model.sourcesUnread) ? model.sourcesUnread : [];
  if (unread.includes('tracker')) {
    // Before the slices, so the editor reads it before any news: an unread tracker must
    // never be reported as nothing having landed.
    lines.push('');
    lines.push('WARNING: the issue tracker could not be read for this window, so landed work may be missing. Do not say nothing landed, and do not call this a slow news day. Say plainly that landed work could not be read.');
  }

  if (model.isQuiet) {
    lines.push('');
    lines.push('There is NO activity in this window: no landed work and no runs. This is a genuinely slow news day.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Source slices (reference these by their exact id in your index sourceRefs):');
  let group = null;
  for (const s of model.sources) {
    const next = s.kind === 'landed' ? 'landed' : 'background';
    if (next !== group) {
      group = next;
      lines.push('');
      lines.push(next === 'landed'
        ? 'LANDED IN THIS WINDOW (work merged or finished; lead with these):'
        : 'BACKGROUND (runs; context only, never the lead while landed work exists):');
    }
    lines.push('');
    lines.push(`- id: ${s.id}  [${s.kind}, suggested desk: ${s.desk}, ${s.timestamp || 'undated'}]`);
    lines.push(`  headline seed: ${s.headline}`);
    if (s.kind === 'landed') {
      // The landed facts: the tracker title, when it finished, and each PR with its merge time.
      const snap = s.snapshot;
      if (snap.title) lines.push(`  title: ${snap.title}`);
      if (snap.finished) lines.push(`  finished in the tracker: ${snap.completedAt}`);
      else lines.push('  not finished in the tracker within this window');
      for (const pr of snap.prs || []) lines.push(`  PR merged: ${pr.url} (${pr.mergedAt})`);
    } else if (s.kind === 'session') {
      const snap = s.snapshot;
      if (snap.tasksTouched?.length) lines.push(`  tasks touched: ${snap.tasksTouched.join(', ')}`);
      lines.push(`  outcome: ${snap.outcome}`);
      for (const beat of snap.beats || []) {
        if (beat.summary) lines.push(`  • ${beat.issue || ''} ${beat.phase ? `[${beat.phase}] ` : ''}${beat.summary}`);
      }
    } else if (s.kind === 'status') {
      const snap = s.snapshot;
      if (snap.summary) lines.push(`  detail: ${snap.summary}`);
    } else if (s.kind === 'roadmap') {
      // The workspace's synthesised roadmap thinking: north star + digest prose +
      // per-task orientation bearings, so the editor can reference it by id.
      const snap = s.snapshot;
      if (snap.northStar) lines.push(`  north star: ${snap.northStar}`);
      if (snap.digest) lines.push(`  roadmap digest: ${snap.digest}`);
      for (const b of snap.orientation || []) {
        lines.push(`  • ${b.identifier}${b.bearing ? ` — ${b.bearing}` : ''}${b.reason ? `: ${b.reason}` : ''}`);
      }
    }
  }

  if (model.landedOmitted > 0) {
    lines.push('');
    lines.push(`${model.landedOmitted} more landed item(s) in this window are not listed (the list is capped). Do not treat the list above as the complete set of landed work.`);
  }

  if (model.weather) {
    lines.push('');
    const cost = sumWords({ usd: model.weather.pricedUsd, priced: model.weather.totalCalls - model.weather.unpricedCalls, unpriced: model.weather.unpricedCalls }, { fine: true });
    lines.push(`By the numbers: ${model.weather.totalCalls} AI call(s), ${cost}, ${model.weather.totalTokens} token(s).`);
  }

  return lines.join('\n');
}
