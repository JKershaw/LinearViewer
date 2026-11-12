// The stability measures' tracker reads (LIN-4421): a paced workspace-proxy client and the reads behind the finished
// tasks, speed, cost and minted rows, and (LIN-4422) the seat's rulings and dispatch reads over the same finished set. Its own file because the CLI runs when imported and the core does no I/O: here
// `fetch`, `sleep` and the clock are injected, so pacing, the 429 path and the whole read are tested without a network
// (tests/unit/stability-measures.test.js). The decisions (ownership, selection, sessions, the search) stay in the core.
//
// Client contract: get(path) never throws. It resolves to { ok: true, status, body } or { ok: false, status, reason }, and the
// caller turns a failure into an unreadable count or a `not measured` row, never a zero.
//   Pacing    calls start at least 60000 / perMinute ms apart, from the first call. The proxy allows 60 a minute per
//             token and that budget is shared with the token's other callers, so the default leaves headroom (50).
//   429       wait Retry-After (seconds, or an HTTP date; a missing or unreadable header waits one minute), then retry,
//             at most `retries` times. A 429 that never clears is a failure: { ok: false, status: 429 }.
//   404       { ok: false, status: 404, reason: 'not found' } at once; the ID-span search reads it as a gap.
//   Other     a non-2xx, a network error or a body that is not JSON is a failure with its reason; no retry.
// Teardown: nothing is held between calls (no timers, sockets or caches of its own), so there is nothing to close.

import {
  TICKET_KEY, costRow, idSpanSearch, landingOwners, mintedRow, notMeasured, selectFinished, speedRow, tasksRow,
} from './stability-measures-core.mjs';
import { membersOf, seatNotMeasured, seatRows } from './stability-measures-seat.mjs';

export const DEFAULT_PER_MINUTE = 50;
export const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_WAIT_MS = 60_000;

/** Retry-After as milliseconds: delta-seconds or an HTTP date; anything else is null. */
export function retryAfterMs(header, nowMs) {
  if (header == null || header === '') return null;
  const s = String(header).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.ceil(Number(s) * 1000);
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/** An error's first line: the reason a row or a failed read carries. */
export const firstLine = (e) => String(e?.message ?? e).trim().split('\n')[0];

export function createProxyClient({
  base,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  perMinute = DEFAULT_PER_MINUTE,
  retries = DEFAULT_RETRIES,
} = {}) {
  if (!base) throw new TypeError('createProxyClient needs a base URL');
  const root = base.replace(/\/+$/, '');
  const gapMs = Math.ceil(60_000 / perMinute);
  let nextAt = null;
  const stats = { calls: 0, retries429: 0, waitedMs: 0 };

  const pace = async () => {
    const t = now();
    if (nextAt != null && t < nextAt) { stats.waitedMs += nextAt - t; await sleep(nextAt - t); }
    nextAt = Math.max(now(), nextAt ?? 0) + gapMs;
  };

  async function get(path) {
    for (let attempt = 0; ; attempt++) {
      await pace();
      stats.calls++;
      let res;
      try {
        res = await fetch(`${root}${path}`, { headers: { accept: 'application/json' } });
      } catch (e) {
        return { ok: false, status: null, reason: `proxy unreachable: ${firstLine(e)}` };
      }
      if (res.status === 429) {
        if (attempt >= retries) return { ok: false, status: 429, reason: `429 did not clear after ${retries} retries` };
        const wait = retryAfterMs(res.headers?.get?.('retry-after'), now()) ?? DEFAULT_RETRY_WAIT_MS;
        stats.retries429++;
        stats.waitedMs += wait;
        await sleep(wait);
        nextAt = null; // the wait already spaced the next call
        continue;
      }
      if (res.status === 404) return { ok: false, status: 404, reason: 'not found' };
      if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
      try {
        return { ok: true, status: res.status, body: await res.json() };
      } catch (e) {
        return { ok: false, status: res.status, reason: `body unreadable: ${firstLine(e)}` };
      }
    }
  }

  return { get, stats };
}

// ── the tracker read ─────────────────────────────────────────────────────────
const enc = encodeURIComponent;

/**
 * Every tracker row not measured, for one reason: no proxy, no landing log, or an unreadable issue list. The seat's
 * rows (LIN-4422) read the same finished set, so they fail with it, under the same reason: `seat` is their list in
 * order, origin keeping its own reason. A row missing here would print `not built yet`, the wrong reason.
 */
export const trackerNotMeasured = (why, references = {}) => ({
  ...Object.fromEntries(['tasks', 'speed', 'cost', 'minted'].map((k) => [k, notMeasured(k, why, { reference: references[k] })])),
  seat: seatNotMeasured(why, references),
});

/** The highest issue number on the newest page of the issue list: a known existing number to bracket the search. */
async function readBracket(client, key) {
  const r = await client.get('/issues?limit=50');
  if (!r.ok) return { reason: `issue list: ${r.reason}` };
  const nums = (r.body?.issues ?? []).map((i) => new RegExp(`^${key}-(\\d+)$`).exec(i.identifier ?? '')).filter(Boolean).map((m) => Number(m[1]));
  return nums.length ? { value: Math.max(...nums) } : { reason: `issue list has no ${key}- issue` };
}

const probeWith = (client, key) => async (n) => {
  const r = await client.get(`/issues/${key}-${n}`);
  if (r.ok) return { status: 'ok', createdAt: r.body?.createdAt ?? null, trashed: r.body?.trashed === true };
  if (r.status === 404) return { status: 'missing' };
  return { status: 'unreadable', reason: r.reason };
};

/**
 * Finished tasks, speed, cost and minted for one window. `windowLandings` and `priorLandings` are parseLandingLog()
 * records of the window and of the lookback before base; `window` carries baseDate, headDate and landings.
 * Calls, in order: the issue list (one), each candidate ticket's issue, each finished task's /cost, then the probes.
 * A failed issue list ends the read: every tracker row is `not measured` with its reason.
 */
export async function readTracker({ client, windowLandings, priorLandings = [], window, lookback = null, key = TICKET_KEY, references = {} }) {
  const own = landingOwners(windowLandings);
  const prior = landingOwners(priorLandings);
  const bracket = await readBracket(client, key);
  if (bracket.reason) return { rows: trackerNotMeasured(`proxy: ${bracket.reason}`, references), selection: null, tasks: null, stats: client.stats };

  const issues = new Map();
  const ids = [...new Set([...own.owners.keys(), ...prior.owners.keys()])];
  for (const id of ids) {
    const r = await client.get(`/issues/${enc(id)}`);
    issues.set(id, r.ok ? { state: r.body?.state ?? null, completedAt: r.body?.completedAt ?? null, parent: r.body?.parent?.identifier ?? null } : { reason: r.status === 404 ? 'issue not found' : r.reason });
  }
  const selection = selectFinished({ window: own, prior, issues, baseDate: window.baseDate, headDate: window.headDate });

  const tasks = [];
  for (const t of selection.finished) {
    const r = await client.get(`/issues/${enc(t.id)}/cost`);
    tasks.push({ id: t.id, lastLandingAt: t.lastLandingAt, cost: r.ok ? { body: r.body } : { reason: r.status === 404 ? 'cost not found' : r.reason } });
  }

  const probe = probeWith(client, key);
  const cache = new Map();
  const base = await idSpanSearch({ at: window.baseDate, hi: bracket.value, probe, cache });
  const head = base.reason ? { reason: 'not searched: the base search failed', probes: [] } : await idSpanSearch({ at: window.headDate, lo: base.value, hi: bracket.value, probe, cache });

  return {
    rows: {
      tasks: tasksRow({ selection, windowTickets: own.owners.size, unownedLandings: own.unowned, lookback, reference: references.tasks }),
      speed: speedRow(tasks, { reference: references.speed }),
      cost: costRow(tasks, { reference: references.cost }),
      minted: mintedRow({ base, head, landings: window.landings, bracket: `${key}-${bracket.value}`, key, reference: references.minted }),
    },
    // The finished selection and each finished task's /cost body, for readers that measure the same tasks (the seat
    // row, LIN-4422): one finished set, two readers, never a second issue or /cost pass.
    selection,
    tasks,
    stats: client.stats,
  };
}

// ── the seat read (LIN-4422) ────────────────────────────────────────────────
export const DISPATCH_LIST_LIMIT = 100;

/**
 * The person's seat for the tracker read's finished tasks. Calls, in order: the rulings once (`includeResolved=true`,
 * filtered by anchor issue here, not one call per task); then per finished task its dispatch list (closedReason on
 * every row of the issue, including rows that never ran) and the detail of every lineage member /cost lists
 * (feedback, merged forward over its lineage, and closedReason for members filed under another issue).
 * A failed rulings read skips the dispatch reads: without the no-ruling condition no share can be read.
 * `finished` is readTracker's selection.finished, `tasks` its [{ id, cost }].
 */
export async function readSeat({ client, finished, tasks, references = {} }) {
  const r = await client.get('/rulings?includeResolved=true');
  const rulings = !r.ok ? { reason: r.reason } : Array.isArray(r.body?.rulings) ? { rulings: r.body.rulings } : { reason: 'rulings body has no list' };
  const dispatch = new Map();
  if (!rulings.reason) {
    for (const t of tasks) {
      const membership = membersOf(t.cost);
      const l = await client.get(`/dispatch?issueIdentifier=${enc(t.id)}&limit=${DISPATCH_LIST_LIMIT}`);
      const list = !l.ok ? { reason: l.reason } : Array.isArray(l.body?.items) ? { items: l.body.items, total: l.body.total ?? null } : { reason: 'list body has no items' };
      const details = [];
      for (const itemId of membership.memberIds ?? []) {
        const d = await client.get(`/dispatch/${enc(itemId)}`);
        details.push(d.ok ? { itemId, body: d.body } : { itemId, reason: d.status === 404 ? 'dispatch not found' : d.reason });
      }
      dispatch.set(t.id, { membership, list, details });
    }
  }
  return { rows: seatRows({ finished, rulings, dispatch, references }), stats: client.stats };
}
