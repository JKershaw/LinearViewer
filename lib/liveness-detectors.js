/**
 * Liveness detectors (LIN-3258, M21 option A). PURE — no I/O, no store
 * imports. The sweep (lib/liveness-alarm-sweep.js) reads the fleet and passes
 * plain rows in; these functions only classify.
 *
 * Two rules, ported from `docs/papers/harbour/what-hides-between-sessions.md`
 * v2 (M21 option A) and its committed transcript script
 * (`scripts/survey-hides-detect-sessions.mjs`):
 *
 *  - Rule S, dispatcher silent: no consumer poll within DISPATCHER_SILENT_MS
 *    while at least one item is queued or taken.
 *  - Rule D2, stopped or circular wait: a parked `[pending]` waiter whose
 *    awaited chain has stopped (orphan) or loops back on itself (cycle).
 *
 * D2 reads the wait text from RAW feedback via `findWakeEvent` — never from
 * `loop.waitingMessage`, which is null for `[pending]` by design — and never
 * widens `WAITING_WAKE_MARKERS` (still `['blocked']`). The parent edge (RC1)
 * covers target-less waits addressed to a dispatching parent via `sessionId`;
 * it is applied BEFORE the CI/PR/unresolved cover (RC4), so a wait that names
 * only git SHAs and "the orchestrator" still forms the edge.
 *
 * ALARM ONLY: nothing here mutates anything.
 */

import { findWakeEvent, isWakeEvent } from './dispatch-terminal.js';

/** Rule S threshold: a poll older than 20 minutes with live work. */
export const DISPATCHER_SILENT_MS = 20 * 60 * 1000;

/**
 * A runner whose last non-wake heartbeat is older than this is *silent*,
 * which does not cover a chain (heartbeats are ≤10 min apart). Also the
 * hourly-resume window guard: the LIN-3238 close-out resumes for ~16 s each
 * hour, so a tick landing in one sees it active and simply covers the chain.
 */
export const ACTIVE_FRESH_MS = 15 * 60 * 1000;

/**
 * Orphan grace: a chain whose leaves have stopped is fired only once the due
 * wake is older than this. A wake minted but not yet claimed is never read as
 * lost (the paper's "three-minute merge" artefact, re-expressed for rows).
 */
export const WAKE_DELIVERY_GRACE_MS = 3 * 60 * 1000;

/** Consecutive *evaluated* ticks without the condition before D2 clears. */
export const CLEAR_CONFIRM_TICKS = 2;

/** The window after a wait word in which a target/ticket/parent noun counts. */
export const WAIT_WINDOW = 80;

/**
 * Wait-word vocabulary, ported verbatim from the script
 * (`survey-hides-transcripts.mjs:54`).
 */
export const WAITWORD = /wait(ing|s)? (on|for)|await(ing|s)?|blocked (on|by)|standing by for|until|depends? on|parked on/gi;

/**
 * Person exemption, ported verbatim from the script
 * (`survey-hides-detect-sessions.mjs:90`). A wait on a person, a ruling or a
 * deliberate pause is never an alarm — it outranks every other edge.
 */
export const PERSON = /\b(wait\w* (on|for)|until|answer\w*|holding|owes?)\b[^.]{0,60}\b(John|the human|a ruling|ruling `|witness)\b|\bpaused for\b|\bwind-down\b|\bweekly cap\b|\bafter (the )?(weekly )?reset\b/i;

/**
 * Parent nouns (RC1). Only a wait text that is *parent-addressed* — a WAITWORD
 * followed within WAIT_WINDOW chars by one of these — gets the parent edge. A
 * text-blind parent edge is rejected: the common healthy shape "child parked
 * on CI, parent parked on the child" would otherwise read as a cycle.
 */
export const PARENT_NOUN = /\b(orchestrator|parent|stepper|autopilot|driver|the session that dispatched)\b/i;

/** Full dispatch UUIDs. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** 8-hex tokens (commit SHAs, comment ids, short dispatch prefixes). */
const HEX8_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/gi;

/** LIN ticket ids. */
const LIN_RE = /LIN-\d+/g;

/** `[usage]` markers are excluded from "activity" — they are not heartbeats. */
const USAGE_RE = /^\s*\[usage\]/i;

/**
 * Rule S. Fires when no consumer poll is within DISPATCHER_SILENT_MS while at
 * least one item is `queued` or `taken`. When `lastSeenAt` is null (never
 * polled) the live item itself must be older than the threshold.
 *
 * @param {Object} args
 * @param {number} args.now - epoch ms
 * @param {string|null} args.lastSeenAt - live poll recency (`getConsumerLastSeenAt`, NOT item.consumerLastSeenAt)
 * @param {Array<{status?: string, dispatchedAt?: string}>} args.liveItems
 * @returns {{firing: boolean, startedAt?: string}}
 */
export function detectDispatcherSilent({ now, lastSeenAt, liveItems = [] } = {}) {
  const live = (liveItems || []).filter((i) => i && (i.status === 'queued' || i.status === 'taken'));
  if (!live.length) return { firing: false };

  const seenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
  if (seenMs !== null && !Number.isNaN(seenMs)) {
    if (now - seenMs <= DISPATCHER_SILENT_MS) return { firing: false };
    return { firing: true, startedAt: new Date(seenMs).toISOString() };
  }

  // Never polled: require a live item older than the threshold, and onset at
  // that item's dispatchedAt (the moment the condition became true).
  let oldest = Infinity;
  for (const i of live) {
    const t = Date.parse(i.dispatchedAt);
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  if (!Number.isFinite(oldest) || now - oldest <= DISPATCHER_SILENT_MS) return { firing: false };
  return { firing: true, startedAt: new Date(oldest).toISOString() };
}

/**
 * Rule D2 entry point. Returns the uncovered chains that should alarm.
 *
 * @param {Object} args
 * @param {number} args.now - epoch ms
 * @param {Array<{lineageId: string, sessionId?: string|null}>} args.waiters - candidate waiter lineages
 * @param {Map<string, Array<Object>>} args.rowsByLineage - every raw row for each candidate lineage
 * @param {Map<string, Object>} [args.lineageInfo] - lineageId -> lean-loop facts (fallback state for edge targets)
 * @returns {{chains: Array<Object>, resolvedMembers: Set<string>}}
 */
export function detectStoppedOrCircularWait({ now, waiters = [], rowsByLineage = new Map(), lineageInfo = new Map() } = {}) {
  const graph = buildGraph(rowsByLineage, lineageInfo);

  const resolvedMembers = new Set();
  const bySignature = new Map();

  for (const waiter of waiters) {
    if (!waiter || !waiter.lineageId) continue;
    const walk = walkChain(waiter.lineageId, now, graph);
    if (walk.covered) {
      for (const id of walk.resolved) resolvedMembers.add(id);
      continue;
    }

    // RC7/RC9: for a cycle, the incident identity IS the cycle core, never the
    // feeder-inclusive walk. A chain that merely feeds into a cycle
    // (A → B → C → B) must neither mint a second, orphan-shaped record alongside
    // the {B,C} cycle, nor re-key the record (and reopen it with a fresh
    // `startedAt`) when a feeder joins or leaves across ticks. `members` is
    // therefore the sorted core for a cycle and the full sorted walk otherwise;
    // the feeder edges remain visible in `detail.edges`.
    const members = walk.cycle ? [...walk.cycleCore] : [...walk.members].sort();
    const signature = walk.cycle ? `cycle:${walk.cycleCore.join(',')}` : members.join(',');
    if (bySignature.has(signature)) continue;

    // RC7: label a chain an orphan only when a member really stopped (or its
    // awaited ticket has stopped). An uncovered chain with neither a cycle nor
    // a stopped member is not this rule's call.
    if (!walk.cycle && !walk.orphan) continue;

    // Orphan grace: a stopped leaf chain fires only once its wait is older
    // than WAKE_DELIVERY_GRACE_MS, so a wake minted but not yet claimed is
    // never read as lost.
    if (!walk.cycle) {
      const onset = walk.onsetMs;
      if (!Number.isFinite(onset) || now - onset <= WAKE_DELIVERY_GRACE_MS) continue;
    }

    bySignature.set(signature, {
      shape: walk.cycle ? 'cycle' : 'orphan',
      members,
      dispatchIds: [...walk.dispatchIds].sort(),
      tickets: [...walk.tickets].sort(),
      startedAt: new Date(walk.onsetMs).toISOString(),
      firedAt: new Date(now).toISOString(),
      detail: { edges: walk.edges }
    });
  }

  return { chains: [...bySignature.values()], resolvedMembers };
}

/**
 * The wait state of one lineage at `now`, derived from raw rows.
 */
function computeWait(lineageId, now, graph) {
  // Rows dispatched after this tick do not exist in production; filtering them
  // out is what lets a fixture replay a captured lineage from its start.
  const rows = graph.rowsFor(lineageId).filter((r) => {
    const d = Date.parse(r.dispatchedAt);
    return !Number.isFinite(d) || d <= now;
  });
  if (!rows.length) return stateFromInfo(lineageId, now, graph);

  // Latest wake event across the lineage, ignoring entries timestamped in the
  // future relative to this simulated tick (fixtures replay merged arrays).
  let latest = null;
  for (const row of rows) {
    const visible = (row.feedback || []).filter((e) => {
      const t = Date.parse(e.timestamp);
      return !Number.isFinite(t) || t <= now;
    });
    const ev = findWakeEvent(visible);
    if (!ev || !ev.entry?.timestamp) continue;
    const t = Date.parse(ev.entry.timestamp);
    if (!Number.isFinite(t) || t > now) continue;
    if (!latest || t > latest.t) latest = { t, marker: ev.marker, entry: ev.entry, row };
  }

  if (!latest || latest.marker !== 'pending') {
    const activity = latestActivityMs(rows, now);
    if (activity > -Infinity && now - activity <= ACTIVE_FRESH_MS) return { kind: 'active', wait: null };
    return stateFromInfo(lineageId, now, graph, rows, activity);
  }

  const waitTs = latest.t;
  const wait = { text: latest.entry.message || '', timestamp: latest.entry.timestamp, row: latest.row };

  // answered: any wake or follow-up row on the lineage dispatched at/after the
  // wait. No minimum gap (the script's three-minute merge was a burst artefact).
  const answered = rows.some((r) => {
    const d = Date.parse(r.dispatchedAt);
    if (!Number.isFinite(d) || d < waitTs) return false;
    if (r.kind === 'wake') return true;
    if (r.followUpTo && graph.idToLineage.get(r.followUpTo) === lineageId) return true;
    return false;
  });
  if (answered) return { kind: 'answered', wait };

  // in flight: a queued/taken kind:'wake' row newer than the wait.
  const inFlight = rows.some((r) => r.kind === 'wake'
    && (r.status === 'queued' || r.status === 'taken')
    && Number.isFinite(Date.parse(r.dispatchedAt))
    && Date.parse(r.dispatchedAt) >= waitTs);
  if (inFlight) return { kind: 'in-flight', wait };

  // active: a fresh non-wake, non-[usage] entry newer than the wait.
  const latestActivity = latestActivityMs(rows, now);
  if (latestActivity > waitTs && now - latestActivity <= ACTIVE_FRESH_MS) {
    return { kind: 'active', wait };
  }

  return { kind: 'parked', wait };
}

/**
 * The most recent visible non-wake, non-`[usage]` feedback entry across a
 * lineage's rows, or `-Infinity` when there is none.
 */
function latestActivityMs(rows, now) {
  let latest = -Infinity;
  for (const row of rows) {
    for (const e of row.feedback || []) {
      const t = Date.parse(e.timestamp);
      if (!Number.isFinite(t) || t > now) continue;
      if (isWakeEvent(e.message)) continue;
      if (USAGE_RE.test(e.message || '')) continue;
      if (t > latest) latest = t;
    }
  }
  return latest;
}

/**
 * Fallback state for a lineage with no raw rows read (an edge target that is
 * not itself a candidate waiter). Uses the lean loop's own derived facts:
 * terminal → stopped; recent lineage activity → active; otherwise stopped
 * when there is any activity at all, notyet when there is none.
 */
function stateFromInfo(lineageId, now, graph, rows = [], activity = null) {
  const info = graph.infoFor(lineageId);
  if (info?.terminalStatus) return { kind: 'terminal' };
  const activityMs = activity !== null ? activity : latestActivityMs(rows, now);
  const lineageActivity = info?.lineageLastActivityMs;
  const best = Number.isFinite(lineageActivity) && lineageActivity > activityMs ? lineageActivity : activityMs;
  if (Number.isFinite(best) && best > 0) {
    return now - best <= ACTIVE_FRESH_MS ? { kind: 'active' } : { kind: 'stopped' };
  }
  return { kind: rows.length ? 'stopped' : 'notyet' };
}

/**
 * Walk the chain from `start`. A chain is covered (no alarm) when any member
 * is active, in flight, answered, terminal, not-yet-started, person-exempt or
 * has no resolvable edge. An uncovered chain that contains any back-edge is a
 * cycle; otherwise it is an orphan (its leaves stopped).
 */
function walkChain(start, now, graph) {
  const members = new Set([start]);
  const stack = [start];
  const edges = [];
  const dispatchIds = new Set();
  const tickets = new Set();
  const resolved = new Set();
  let orphan = false;
  let onsetMs = -Infinity;

  while (stack.length) {
    const cur = stack.pop();
    const state = computeWait(cur, now, graph);
    for (const id of graph.dispatchIdsFor(cur)) dispatchIds.add(id);
    for (const tk of graph.ticketsFor(cur)) tickets.add(tk);

    if (state.kind === 'active' || state.kind === 'in-flight' || state.kind === 'notyet') {
      return covered(dispatchIds, tickets);
    }
    if (state.kind === 'answered' || state.kind === 'terminal') {
      resolved.add(cur);
      return covered(dispatchIds, tickets, resolved);
    }
    if (state.kind === 'stopped') {
      orphan = true;
      continue;
    }

    // parked
    const wait = state.wait;
    const onset = Date.parse(wait.timestamp);
    if (Number.isFinite(onset) && onset > onsetMs) onsetMs = onset;

    const edgeResult = extractEdges(cur, wait, graph, now);
    if (edgeResult.exempt) return covered(dispatchIds, tickets);
    if (edgeResult.covered) return covered(dispatchIds, tickets);
    if (!edgeResult.targets.length) {
      // A ticket whose every lineage has stopped is an orphan target, not a
      // cover (RC6), mirroring the script's `orphanT`.
      if (edgeResult.orphanTicket) { orphan = true; continue; }
      return covered(dispatchIds, tickets);
    }

    for (const target of edgeResult.targets) {
      edges.push({ from: cur, to: target, kind: edgeResult.kinds.get(target) || 'text-dispatch' });
      if (members.has(target)) continue;
      members.add(target);
      stack.push(target);
    }
  }

  // RC7: any back-edge makes the chain a cycle; dedupe on the core (the nodes
  // that actually lie on a cycle), so a chain feeding into one does not double.
  const cycleCore = cycleCoreOf(members, edges);
  const cycle = cycleCore.length > 0;
  if (cycle) orphan = false;
  return { covered: false, cycle, cycleCore, orphan, members, edges, dispatchIds, tickets, onsetMs };
}

/**
 * The sorted set of members that lie on a cycle in the collected edge graph:
 * a node `v` is on a cycle iff `v` can reach itself by following ≥1 edge.
 */
function cycleCoreOf(members, edges) {
  const adj = new Map();
  for (const m of members) adj.set(m, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
  }
  const core = new Set();
  for (const start of members) {
    const seen = new Set();
    const stack = [...(adj.get(start) || [])];
    while (stack.length) {
      const node = stack.pop();
      if (node === start) { core.add(start); break; }
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of adj.get(node) || []) stack.push(next);
    }
  }
  return [...core].sort();
}

function covered(dispatchIds, tickets, resolved = new Set()) {
  return { covered: true, resolved, dispatchIds, tickets, members: new Set(), edges: [], onsetMs: -Infinity };
}

/**
 * Edges out of a parked waiter, in the plan's precedence order:
 *   1. person exemption (outranks everything);
 *   2. text edges (dispatch ids and LIN tickets resolved against lineages);
 *   3. parent edge (parent-addressed text + a resolvable `sessionId`);
 *   4. no edges → covered (the script's CI/PR/unresolved rule).
 *
 * RC4: unresolved 8-hex tokens are DISCARDED (never cover), and only an
 * unresolved full UUID can cover — implicitly, since covering happens only
 * after step 3 when no edge was minted at all.
 *
 * RC6: the waiter's own ticket is excluded from ticket edges (the script's
 * `linT = w.linTargets.filter((l) => l !== byId.get(cur)?.issue)`), and a
 * ticket whose lineages have all stopped/terminated does not cover — it is
 * surfaced as an `orphanTicket` leaf, the port of the script's `orphanT`.
 */
function extractEdges(lineageId, wait, graph, now) {
  const text = wait.text || '';
  if (PERSON.test(text)) return { exempt: true, covered: true, targets: [], kinds: new Map() };

  const targets = new Set();
  const kinds = new Map();
  const add = (target, kind) => {
    if (!target || target === lineageId) return;
    targets.add(target);
    if (!kinds.has(target)) kinds.set(target, kind);
  };

  for (const token of extractDispatchIds(text)) {
    const resolved = graph.resolveDispatchToken(token);
    if (resolved) add(resolved, 'text-dispatch');
  }

  const ownTickets = new Set(graph.ticketsFor(lineageId));
  if (wait.row?.issueIdentifier) ownTickets.add(wait.row.issueIdentifier);

  let orphanTicket = false;
  for (const ticket of extractLinTargets(text)) {
    if (ownTickets.has(ticket)) continue;
    const lineages = graph.lineagesForTicket(ticket).filter((l) => l !== lineageId);
    let liveCount = 0;
    for (const targetLineage of lineages) {
      const state = computeWait(targetLineage, now, graph);
      if (state.kind === 'terminal' || state.kind === 'stopped') continue;
      liveCount += 1;
      add(targetLineage, 'text-ticket');
    }
    if (lineages.length && !liveCount) orphanTicket = true;
  }

  const parent = parentEdge(lineageId, text, wait.row, graph);
  if (parent) add(parent, 'parent');

  if (!targets.size) {
    if (orphanTicket) return { covered: false, orphanTicket: true, targets: [], kinds };
    return { covered: true, targets: [], kinds };
  }
  return { covered: false, orphanTicket, targets: [...targets], kinds };
}

/**
 * True when the text is parent-addressed: a WAITWORD followed within
 * WAIT_WINDOW chars by a parent noun.
 */
export function isParentAddressed(text) {
  if (!text) return false;
  const re = new RegExp(WAITWORD.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    if (PARENT_NOUN.test(text.slice(m.index, m.index + WAIT_WINDOW))) return true;
  }
  return false;
}

/**
 * The parent edge (RC1): only when the text is parent-addressed AND the
 * waiter's own `sessionId` resolves to a dispatch row in a DIFFERENT lineage.
 * A text-blind edge (no parent noun) is forbidden; null/opaque/unresolvable
 * `sessionId` falls through to step 4.
 */
function parentEdge(lineageId, text, waitRow, graph) {
  if (!isParentAddressed(text)) return null;
  const sessionId = waitRow?.sessionId;
  if (!sessionId) return null;
  const target = graph.resolveDispatchToken(sessionId);
  if (!target || target === lineageId) return null;
  return target;
}

/** Every full UUID and 8-hex token in a wait text. */
export function extractDispatchIds(text) {
  if (!text) return [];
  const ids = new Set();
  for (const m of text.matchAll(UUID_RE)) ids.add(m[0].toLowerCase());
  for (const m of text.matchAll(HEX8_RE)) ids.add(m[0].toLowerCase());
  return [...ids];
}

/** Every LIN ticket within WAIT_WINDOW chars after a WAITWORD. */
export function extractLinTargets(text) {
  if (!text) return [];
  const lins = new Set();
  for (const w of text.matchAll(new RegExp(WAITWORD.source, 'gi'))) {
    for (const x of text.slice(w.index).matchAll(LIN_RE)) {
      if (x.index < WAIT_WINDOW) lins.add(x[0]);
    }
  }
  return [...lins];
}

/**
 * Build the resolution graph the walker needs: id → lineage, prefix lookups,
 * ticket → lineages, and per-lineage row lookups.
 */
function buildGraph(rowsByLineage, lineageInfo) {
  const idToLineage = new Map();
  const prefixToLineage = new Map();
  const ticketToLineages = new Map();
  const dispatchIdsByLineage = new Map();
  const ticketsByLineage = new Map();

  const registerKnownId = (id, lineageId) => {
    if (!id) return;
    idToLineage.set(id, lineageId);
    if (id.length >= 8) prefixToLineage.set(id.slice(0, 8).toLowerCase(), lineageId);
  };

  for (const [lineageId, rows] of rowsByLineage) {
    registerKnownId(lineageId, lineageId);
    const ids = [];
    const tks = new Set();
    for (const row of rows) {
      registerKnownId(row.id, lineageId);
      if (row.id) ids.push(row.id);
      if (row.issueIdentifier) {
        tks.add(row.issueIdentifier);
        if (!ticketToLineages.has(row.issueIdentifier)) ticketToLineages.set(row.issueIdentifier, new Set());
        ticketToLineages.get(row.issueIdentifier).add(lineageId);
      }
    }
    dispatchIdsByLineage.set(lineageId, ids);
    ticketsByLineage.set(lineageId, [...tks]);
  }

  for (const [lineageId, info] of lineageInfo) {
    registerKnownId(lineageId, lineageId);
    if (info.loopId) registerKnownId(info.loopId, lineageId);
    if (info.issueIdentifier) {
      if (!ticketToLineages.has(info.issueIdentifier)) ticketToLineages.set(info.issueIdentifier, new Set());
      ticketToLineages.get(info.issueIdentifier).add(lineageId);
      const tks = ticketsByLineage.get(lineageId) || [];
      if (!tks.includes(info.issueIdentifier)) tks.push(info.issueIdentifier);
      ticketsByLineage.set(lineageId, tks);
    }
  }

  return {
    idToLineage,
    rowsFor: (lineageId) => rowsByLineage.get(lineageId) || [],
    infoFor: (lineageId) => lineageInfo.get(lineageId) || null,
    dispatchIdsFor: (lineageId) => dispatchIdsByLineage.get(lineageId) || [],
    ticketsFor: (lineageId) => ticketsByLineage.get(lineageId) || [],
    lineagesForTicket: (ticket) => [...(ticketToLineages.get(ticket) || [])],
    resolveDispatchToken(token) {
      if (!token) return null;
      const lower = token.toLowerCase();
      if (idToLineage.has(token)) return idToLineage.get(token);
      if (idToLineage.has(lower)) return idToLineage.get(lower);
      if (lower.length === 8) return prefixToLineage.get(lower) || null;
      return prefixToLineage.get(lower.slice(0, 8)) || null;
    }
  };
}
