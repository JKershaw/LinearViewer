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
 * INCIDENT IDENTITY (RC7/RC9/RC11/N13, ruling `lin3258-incident-identity` = A).
 * The whole wait-for graph is classified ONCE per tick and each stuck node is
 * attributed to its CAUSE:
 *
 *  - the wait-for graph is built once from every candidate waiter's edges;
 *  - nodes are classified once (memoized), and `stuck` is the greatest fixed
 *    point of "a dead leaf, or a parked node every one of whose edge targets
 *    is stuck" — the same coverage rule as before, computed for the whole
 *    graph instead of once per walk;
 *  - an incident is a CAUSE inside the stuck subgraph: a **cycle** is an SCC
 *    of two or more stuck lineages; an **orphan** is a dead leaf with at least
 *    one stuck wait edge into it;
 *  - everyone upstream of a cause is a **victim** (`waiters`/`feeders`),
 *    recorded on the incident, never part of its key.
 *
 * Because SCCs and fixed points do not depend on iteration order, the key,
 * onset and member sets are order-independent by construction (N13). An
 * orphan is keyed on its dead leaf's `causeKey` (the root ticket when the leaf
 * has one, else the lineage id), so several waiters reaching one stopped leaf
 * mint ONE record (RC11) and a waiter naming a dispatch and another naming its
 * ticket share an incident.
 *
 * DEAD LEAF (design rule (b), RC12). A terminal lineage is a dead leaf only
 * when the wait that targets it began BEFORE it terminated — a lost wake: it
 * finished without waking the waiter. `deadSince` is its terminal time
 * (`lineageLastActivityMs`). When the lineage terminated BEFORE the wait was
 * posted, the id in the text is context, not a target: the edge is dropped,
 * like a discarded 8-hex token, so it neither covers nor fires. Rule (b)
 * closes the test/production split where a terminal target fired through raw
 * rows but covered through lean `lineageInfo` (the production path). It is
 * implemented in `extractEdges` (which drops a terminal-before-wait edge) and
 * `deadInfoFor` (which marks a terminal lineage dead only when a kept in-edge
 * began before its terminal time).
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

/** A leading wake marker, capturing which marker (see dispatch-terminal). */
const WAKE_MARKER_RE = /^\s*\[(done|complete|failed|aborted|blocked|pending)\]/i;

/** A synthetic graph node id standing for every lineage of a LIN ticket. */
const TICKET_PREFIX = 'ticket:';

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
 * Rule D2 entry point. Builds and classifies the whole wait-for graph once,
 * then returns one chain per incident cause plus the set of nodes that are
 * structurally resolved this tick (answered or terminal).
 *
 * @param {Object} args
 * @param {number} args.now - epoch ms
 * @param {Array<{lineageId: string, sessionId?: string|null}>} args.waiters - candidate waiter lineages
 * @param {Map<string, Array<Object>>} args.rowsByLineage - every raw row for each candidate lineage
 * @param {Map<string, Object>} [args.lineageInfo] - lineageId -> lean-loop facts, or `{latest, loopIds}`; fallback state + id registration for edge targets
 * @param {Array<string>} [args.extraNodes] - open-record nodes to classify even if not current waiters
 * @returns {{chains: Array<Object>, resolvedMembers: Set<string>, states: Map<string, Object>}}
 */
export function detectStoppedOrCircularWait({ now, waiters = [], rowsByLineage = new Map(), lineageInfo = new Map(), extraNodes = [] } = {}) {
  const graph = buildGraph(rowsByLineage, lineageInfo);

  const roots = new Set();
  for (const waiter of waiters) if (waiter && waiter.lineageId) roots.add(waiter.lineageId);
  for (const id of extraNodes || []) if (id) roots.add(id);

  // Explore once from the roots: state and outgoing edges per node.
  const states = new Map();
  const edgesOut = new Map();
  const seen = new Set();
  const queue = [...roots];
  for (const id of queue) seen.add(id);
  while (queue.length) {
    const id = queue.shift();
    const state = nodeState(id, now, graph);
    states.set(id, state);
    if (state.kind !== 'parked') { edgesOut.set(id, []); continue; }
    const edgeResult = extractEdges(id, state.wait, graph, now, state.waitStartMs);
    const edges = edgeResult.targets.map((to) => ({ to, kind: edgeResult.kinds.get(to) || 'text-dispatch' }));
    edgesOut.set(id, edges);
    for (const e of edges) {
      if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }

  // Incoming edges, for the terminal/dead-leaf and ticket classification.
  const edgesIn = new Map();
  for (const [from, edges] of edgesOut) {
    for (const e of edges) {
      if (!edgesIn.has(e.to)) edgesIn.set(e.to, []);
      edgesIn.get(e.to).push({ from, kind: e.kind });
    }
  }

  // Dead-leaf facts (a stopped lineage, a lost-wake terminal lineage, or a
  // ticket whose every lineage is dead). Rule (b) needs the in-edges' wait
  // starts, so `edgesIn` is threaded through.
  const dead = new Map();
  for (const [id, state] of states) dead.set(id, deadInfoFor(id, state, graph, now, states, edgesIn));

  // Greatest fixed point: start with every node stuck, then remove nodes that
  // provably resolve. A parked node resolves as soon as ANY target resolves
  // (the "any reachable live node covers" rule); a dead leaf never resolves.
  const stuck = new Set(states.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...stuck]) {
      if (dead.get(id)?.dead) continue;
      const state = states.get(id);
      if (state.kind === 'parked') {
        const outs = edgesOut.get(id) || [];
        if (!outs.length || outs.some((e) => !stuck.has(e.to))) { stuck.delete(id); changed = true; }
      } else {
        stuck.delete(id); changed = true;
      }
    }
  }

  const stuckIds = [...states.keys()].filter((id) => stuck.has(id));
  const stuckAdj = new Map();
  for (const id of stuckIds) {
    stuckAdj.set(id, (edgesOut.get(id) || []).map((e) => e.to).filter((t) => stuck.has(t)));
  }

  const chains = [];
  const seenSignatures = new Set();

  // Cyclic causes: an SCC of two or more stuck lineages.
  for (const comp of stronglyConnectedComponents(stuckIds, stuckAdj)) {
    if (comp.length < 2) continue;
    const members = [...comp].sort();
    const signature = `cycle:${members.join(',')}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    const feeders = nodesReaching(new Set(comp), stuckAdj).filter((id) => !comp.includes(id)).sort();
    const onsetMs = maxFinite(comp.map((m) => states.get(m)?.waitStartMs));
    chains.push(makeChain('cycle', graph, edgesOut, {
      members,
      waiters: [...comp].sort(),
      feeders,
      leafLineages: [],
      onsetMs
    }));
  }

  // Orphan causes: a stopped lineage, or a ticket whose lineages all stopped,
  // with at least one stuck wait edge into it. Keyed on the cause so several
  // waiters reaching the same leaf share ONE incident (RC11).
  const orphanByCause = new Map();
  for (const id of stuckIds) {
    const info = dead.get(id);
    if (!info?.dead) continue;
    const incoming = (edgesIn.get(id) || []).filter((e) => stuck.has(e.from));
    if (!incoming.length) continue;
    const cause = info.causeKey;
    if (!orphanByCause.has(cause)) orphanByCause.set(cause, { leaves: new Set(), direct: new Set(), deadSinceMs: -Infinity });
    const record = orphanByCause.get(cause);
    for (const leaf of info.leafLineages) record.leaves.add(leaf);
    record.deadSinceMs = Math.max(record.deadSinceMs, Number.isFinite(info.deadSinceMs) ? info.deadSinceMs : -Infinity);
    for (const e of incoming) record.direct.add(e.from);
  }

  for (const [cause, record] of orphanByCause) {
    const deadSince = Number.isFinite(record.deadSinceMs) ? record.deadSinceMs : now;
    // Grace is per direct-waiter edge: a wake may still be in flight for a
    // wait that only just began.
    const direct = [...record.direct].filter((w) => {
      const ws = states.get(w)?.waitStartMs;
      if (!Number.isFinite(ws)) return false;
      return now - Math.max(ws, deadSince) > WAKE_DELIVERY_GRACE_MS;
    });
    if (!direct.length) continue;
    const signature = `orphan:${cause}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    const onsetMs = Math.min(...direct.map((w) => Math.max(states.get(w).waitStartMs, deadSince)));
    const feeders = nodesReaching(new Set(direct), stuckAdj)
      .filter((id) => !direct.includes(id) && !record.leaves.has(id))
      .sort();
    chains.push(makeChain('orphan', graph, edgesOut, {
      members: [cause],
      waiters: direct.sort(),
      feeders,
      leafLineages: [...record.leaves].sort(),
      onsetMs
    }));
  }

  const resolvedMembers = new Set(
    [...states.keys()].filter((id) => {
      const kind = states.get(id)?.kind;
      return kind === 'answered' || kind === 'terminal';
    })
  );

  return { chains, resolvedMembers, states };
}

/** Build one incident record from its classified cause. */
function makeChain(shape, graph, edgesOut, { members, waiters, feeders, leafLineages, onsetMs }) {
  const nodes = [...new Set([...members, ...waiters, ...feeders, ...leafLineages])];
  const dispatchIds = new Set();
  const tickets = new Set();
  for (const id of nodes) {
    if (id.startsWith(TICKET_PREFIX)) { tickets.add(id.slice(TICKET_PREFIX.length)); continue; }
    for (const x of graph.dispatchIdsFor(id)) dispatchIds.add(x);
    for (const x of graph.ticketsFor(id)) tickets.add(x);
  }
  const nodeSet = new Set(nodes);
  const detailEdges = [];
  for (const [from, edges] of edgesOut) {
    if (!nodeSet.has(from)) continue;
    for (const e of edges) {
      if (nodeSet.has(e.to)) detailEdges.push({ from, to: e.to, kind: e.kind });
    }
  }
  const startedAt = new Date(Number.isFinite(onsetMs) ? onsetMs : Date.now()).toISOString();
  return {
    shape,
    members,
    waiters,
    feeders,
    leafLineages,
    dispatchIds: [...dispatchIds].sort(),
    tickets: [...tickets].sort(),
    startedAt,
    firedAt: new Date().toISOString(),
    detail: { edges: detailEdges }
  };
}

/** State of a graph node — a synthetic ticket node or a real lineage. */
function nodeState(id, now, graph) {
  if (typeof id === 'string' && id.startsWith(TICKET_PREFIX)) {
    return { kind: 'ticket', wait: null, waitStartMs: null, deadSinceMs: null };
  }
  return computeWait(id, now, graph);
}

/** Dead-leaf classification for one node (see the file header). */
function deadInfoFor(id, state, graph, now, states, edgesIn = new Map()) {
  if (typeof id === 'string' && id.startsWith(TICKET_PREFIX)) {
    const ticket = id.slice(TICKET_PREFIX.length);
    const lineages = graph.lineagesForTicket(ticket);
    if (!lineages.length) return { dead: false };
    const waitStarts = incomingWaitStarts(id, states, edgesIn);
    let deadSinceMs = -Infinity;
    let allDead = true;
    for (const lineage of lineages) {
      const s = states.get(lineage) || computeWait(lineage, now, graph);
      const d = deadLeafSince(s, waitStarts, now);
      if (d === null) { allDead = false; break; }
      if (d > deadSinceMs) deadSinceMs = d;
    }
    if (!allDead) return { dead: false };
    return { dead: true, deadSinceMs, causeKey: id, leafLineages: lineages };
  }
  const waitStarts = incomingWaitStarts(id, states, edgesIn);
  const deadSince = deadLeafSince(state, waitStarts, now);
  if (deadSince === null) return { dead: false };
  const ticket = graph.rootTicket(id);
  return {
    dead: true,
    deadSinceMs: deadSince,
    causeKey: ticket ? `${TICKET_PREFIX}${ticket}` : id,
    leafLineages: [id]
  };
}

/**
 * The wait-start times of the parked nodes with an edge into `id`. Rule (b)
 * needs them to tell a lost wake (wait began before the target terminated)
 * from a context mention (target already terminal when the wait was posted).
 */
function incomingWaitStarts(id, states, edgesIn) {
  return (edgesIn.get(id) || [])
    .map((e) => states.get(e.from)?.waitStartMs)
    .filter((w) => Number.isFinite(w));
}

/**
 * Rule (b): the time from which a node counts as dead, or `null` when it is
 * not a dead leaf.
 *  - stopped → dead (a) from its last activity;
 *  - terminal → dead (b) only when a kept in-edge's wait began before the
 *    terminal time; otherwise it is context (not a target) and returns null;
 *  - anything else → null.
 */
function deadLeafSince(state, waitStarts, now) {
  if (state.kind === 'stopped') return Number.isFinite(state.deadSinceMs) ? state.deadSinceMs : now;
  if (state.kind === 'terminal') {
    const t = state.deadSinceMs;
    if (Number.isFinite(t) && waitStarts.some((w) => w < t)) return t;
    return null;
  }
  return null;
}

/**
 * The wait state of one lineage at `now`, derived from raw rows. `terminal`
 * and `stopped` are always dead-leaf candidates for a target; `parked` carries
 * the run's earliest `[pending]` (`waitStartMs`).
 */
function computeWait(lineageId, now, graph) {
  const rows = visibleRows(lineageId, now, graph);
  if (!rows.length) return stateFromInfo(lineageId, now, graph, [], null);

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

  const activity = latestActivityMs(rows, now);

  if (!latest || latest.marker !== 'pending') {
    if (activity > -Infinity && now - activity <= ACTIVE_FRESH_MS) {
      return { kind: 'active', wait: null, waitStartMs: null, deadSinceMs: null };
    }
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
  if (answered) return { kind: 'answered', wait, waitStartMs: null, deadSinceMs: null };

  // in flight: a queued/taken kind:'wake' row newer than the wait.
  const inFlight = rows.some((r) => r.kind === 'wake'
    && (r.status === 'queued' || r.status === 'taken')
    && Number.isFinite(Date.parse(r.dispatchedAt))
    && Date.parse(r.dispatchedAt) >= waitTs);
  if (inFlight) return { kind: 'in-flight', wait, waitStartMs: null, deadSinceMs: null };

  // active: a fresh non-wake, non-[usage] entry newer than the wait.
  if (activity > waitTs && now - activity <= ACTIVE_FRESH_MS) {
    return { kind: 'active', wait, waitStartMs: null, deadSinceMs: null };
  }

  return { kind: 'parked', wait, waitStartMs: computeWaitStart(lineageId, rows, now, graph), deadSinceMs: null };
}

/**
 * The earliest `[pending]` in the lineage's *current run*: a sequence of
 * `[pending]` wake events with no answer row and no non-pending wake event
 * between them. The LIN-3238 close-out re-posts `[pending]` hourly, so this
 * stays 15:12:57.700Z all afternoon; onset is therefore independent of when
 * the tick lands, as well as of walk order (N13).
 */
function computeWaitStart(lineageId, rows, now, graph) {
  const events = [];
  for (const row of rows) {
    for (const entry of row.feedback || []) {
      const t = Date.parse(entry.timestamp);
      if (!Number.isFinite(t) || t > now) continue;
      const m = WAKE_MARKER_RE.exec(entry.message || '');
      if (!m) continue;
      events.push({ t, pending: m[1].toLowerCase() === 'pending' });
    }
    const d = Date.parse(row.dispatchedAt);
    if (!Number.isFinite(d) || d > now) continue;
    const isAnswer = row.kind === 'wake' || (row.followUpTo && graph.idToLineage.get(row.followUpTo) === lineageId);
    if (isAnswer) events.push({ t: d, pending: false });
  }
  events.sort((a, b) => a.t - b.t);
  let runStart = null;
  for (const ev of events) {
    if (ev.pending) { if (runStart === null) runStart = ev.t; }
    else runStart = null;
  }
  return runStart;
}

/** Rows visible at `now` for a lineage. */
function visibleRows(lineageId, now, graph) {
  return graph.rowsFor(lineageId).filter((r) => {
    const d = Date.parse(r.dispatchedAt);
    return !Number.isFinite(d) || d <= now;
  });
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

/** The latest row dispatch time at/before `now`, or `-Infinity`. */
function maxDispatchedMs(rows, now) {
  let latest = -Infinity;
  for (const row of rows) {
    const d = Date.parse(row.dispatchedAt);
    if (Number.isFinite(d) && d <= now && d > latest) latest = d;
  }
  return latest;
}

/**
 * Fallback state for a lineage with no raw rows read (an edge target that is
 * not itself a candidate waiter). Uses the lean loop's own derived facts:
 * terminal → terminal (covers); recent lineage activity → active; otherwise
 * stopped when there is any activity at all, notyet when there is none.
 */
function stateFromInfo(lineageId, now, graph, rows = [], activity = null) {
  const info = graph.infoFor(lineageId);
  const activityMs = activity !== null ? activity : latestActivityMs(rows, now);
  const lineageActivity = info?.lineageLastActivityMs;
  const best = Number.isFinite(lineageActivity) && lineageActivity > activityMs ? lineageActivity : activityMs;
  // Terminal carries its terminal time so rule (b) can compare it to a wait.
  if (info?.terminalStatus) {
    return { kind: 'terminal', wait: null, waitStartMs: null, deadSinceMs: Number.isFinite(best) ? best : null };
  }
  if (Number.isFinite(best) && best > 0) {
    if (now - best <= ACTIVE_FRESH_MS) return { kind: 'active', wait: null, waitStartMs: null, deadSinceMs: null };
    return { kind: 'stopped', wait: null, waitStartMs: null, deadSinceMs: best };
  }
  return { kind: rows.length ? 'stopped' : 'notyet', wait: null, waitStartMs: null, deadSinceMs: null };
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
 * ticket whose every lineage is dead (a stopped lineage, or a terminal lineage
 * the wait predates — rule (b)) is surfaced as a `ticket:LIN-x` dead leaf
 * rather than a cover. A terminal lineage that terminated BEFORE the wait was
 * posted is context: it neither covers nor fires.
 */
function extractEdges(lineageId, wait, graph, now, waitStartMs = null) {
  const text = wait.text || '';
  if (PERSON.test(text)) return { covered: true, targets: [], kinds: new Map() };

  const targets = new Set();
  const kinds = new Map();
  const add = (target, kind) => {
    if (!target || target === lineageId) return;
    targets.add(target);
    if (!kinds.has(target)) kinds.set(target, kind);
  };

  for (const token of extractDispatchIds(text)) {
    const resolved = graph.resolveDispatchToken(token);
    if (!resolved) continue;
    // Rule (b): a target that terminated before the wait began is context, not
    // a target — drop the edge (it neither covers nor fires).
    const targetState = computeWait(resolved, now, graph);
    if (targetState.kind === 'terminal' && !(Number.isFinite(waitStartMs) && waitStartMs < targetState.deadSinceMs)) continue;
    add(resolved, 'text-dispatch');
  }

  const ownTickets = new Set(graph.ticketsFor(lineageId));
  if (wait.row?.issueIdentifier) ownTickets.add(wait.row.issueIdentifier);

  for (const ticket of extractLinTargets(text)) {
    if (ownTickets.has(ticket)) continue;
    const lineages = graph.lineagesForTicket(ticket).filter((l) => l !== lineageId);
    let liveCount = 0;
    let contextCount = 0;
    for (const targetLineage of lineages) {
      const state = computeWait(targetLineage, now, graph);
      if (state.kind === 'stopped') continue;
      if (state.kind === 'terminal') {
        // Dead (b) when the wait predates the termination; otherwise context.
        if (Number.isFinite(waitStartMs) && waitStartMs < state.deadSinceMs) continue;
        contextCount += 1;
        continue;
      }
      add(targetLineage, 'text-ticket');
      liveCount += 1;
    }
    if (lineages.length && !liveCount && !contextCount) add(`${TICKET_PREFIX}${ticket}`, 'text-ticket');
  }

  const parent = parentEdge(lineageId, text, wait.row, graph);
  if (parent) add(parent, 'parent');

  if (!targets.size) return { covered: true, targets: [], kinds };
  return { covered: false, targets: [...targets], kinds };
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

/** The largest finite number in `values`, or `-Infinity`. */
function maxFinite(values) {
  let best = -Infinity;
  for (const v of values) if (Number.isFinite(v) && v > best) best = v;
  return best;
}

/**
 * Strongly connected components of size ≥ 2 over the stuck subgraph — the
 * cyclic causes. Mutual reachability is an equivalence relation, so grouping
 * by it is exact; a singleton (no self-loop) is not a cycle.
 */
function stronglyConnectedComponents(nodes, adj) {
  const reach = new Map();
  for (const start of nodes) {
    const seen = new Set();
    const stack = [...(adj.get(start) || [])];
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of adj.get(node) || []) stack.push(next);
    }
    reach.set(start, seen);
  }
  const assigned = new Set();
  const components = [];
  for (const start of nodes) {
    if (assigned.has(start)) continue;
    const comp = [start];
    assigned.add(start);
    for (const other of nodes) {
      if (other === start || assigned.has(other)) continue;
      if (reach.get(start).has(other) && reach.get(other).has(start)) { comp.push(other); assigned.add(other); }
    }
    components.push(comp);
  }
  return components;
}

/** Nodes that can reach any node in `targets` over the (restricted) edge map, excluding the targets themselves. */
function nodesReaching(targets, adj) {
  const reverse = new Map();
  for (const [from, tos] of adj) {
    for (const to of tos) {
      if (!reverse.has(to)) reverse.set(to, []);
      reverse.get(to).push(from);
    }
  }
  const seen = new Set();
  const stack = [...targets];
  while (stack.length) {
    const node = stack.pop();
    for (const prev of reverse.get(node) || []) {
      if (!seen.has(prev)) { seen.add(prev); stack.push(prev); }
    }
  }
  return [...seen];
}

/**
 * Build the resolution graph the walker needs: id → lineage, prefix lookups,
 * ticket → lineages, and per-lineage row lookups. `lineageInfo` may hold a
 * plain lean loop, or `{latest, loopIds}` (the sweep's N12 form): every loop
 * id is registered so a wait naming a mid-lineage row resolves to its lineage.
 */
function buildGraph(rowsByLineage, lineageInfo) {
  const idToLineage = new Map();
  const prefixToLineage = new Map();
  const ticketToLineages = new Map();
  const dispatchIdsByLineage = new Map();
  const ticketsByLineage = new Map();
  const rootTicketByLineage = new Map();

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
        if (row.id === lineageId) rootTicketByLineage.set(lineageId, row.issueIdentifier);
      }
    }
    dispatchIdsByLineage.set(lineageId, ids);
    ticketsByLineage.set(lineageId, [...tks]);
  }

  for (const [lineageId, raw] of lineageInfo) {
    const info = raw && raw.loopIds ? raw.latest : raw;
    registerKnownId(lineageId, lineageId);
    const loopIds = raw && raw.loopIds ? raw.loopIds : (info?.loopId ? [info.loopId] : []);
    for (const loopId of loopIds) registerKnownId(loopId, lineageId);
    if (info?.issueIdentifier) {
      if (!ticketToLineages.has(info.issueIdentifier)) ticketToLineages.set(info.issueIdentifier, new Set());
      ticketToLineages.get(info.issueIdentifier).add(lineageId);
      const tks = ticketsByLineage.get(lineageId) || [];
      if (!tks.includes(info.issueIdentifier)) tks.push(info.issueIdentifier);
      ticketsByLineage.set(lineageId, tks);
      if (!rootTicketByLineage.has(lineageId)) rootTicketByLineage.set(lineageId, info.issueIdentifier);
    }
  }

  return {
    idToLineage,
    rowsFor: (lineageId) => rowsByLineage.get(lineageId) || [],
    infoFor: (lineageId) => {
      const raw = lineageInfo.get(lineageId);
      if (!raw) return null;
      return raw.loopIds ? raw.latest : raw;
    },
    dispatchIdsFor: (lineageId) => dispatchIdsByLineage.get(lineageId) || [],
    ticketsFor: (lineageId) => ticketsByLineage.get(lineageId) || [],
    rootTicket: (lineageId) => rootTicketByLineage.get(lineageId) || null,
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
