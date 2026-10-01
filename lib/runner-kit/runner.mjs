#!/usr/bin/env node
/**
 * LIN-3098 S2 — the runner helper.
 *
 * A person's Claude Code session becomes the runner for their Harbour
 * workspace (LIN-3098). The session is the brain: it reads what this helper
 * prints and runs one subagent per item. This helper holds the rules and the
 * credentials, so the session never has to improvise either:
 *
 *   - It keeps the runner's own credential at rest behind the kit's single
 *     storage function (`credentialStore`, imported from broker.mjs) and
 *     never prints it or any item bootstrap.
 *   - It decides, per polled item, whether to take it (`pollDecision`), and a
 *     refused item is LEFT QUEUED, never taken and then failed (B1).
 *   - It starts one broker per taken item (broker.mjs), so a subagent reaches
 *     Harbour through a same-user Unix socket and never holds a token.
 *   - It keeps an ids-only ledger (`ledger.json`): which subagent ran which
 *     item, the lineage's first item (`rootItemId`), its state, and the
 *     fingerprint of the runner token that took it.
 *   - Every feedback post carries the lineage's `rootItemId` (NB1), so a
 *     subagent's cumulative `[usage]` counts once however many wakes it ran.
 *
 * The file is self-contained (Node built-ins plus ./broker.mjs, Node 18+)
 * because the served runner prompt (S3) hands it to the person's machine.
 *
 * Commands (all print one JSON object on stdout):
 *   recover [--session <id>]    before login: fail this token's lost rows, list orphans
 *   login                       stdin: the /runner credential block (or a bare bootstrap)
 *   poll                        decide every queued item; apply a stop halt's sweep
 *   wait                        long-poll in the background, refreshing the heartbeat
 *   take <id>                   take an approved item, start its broker, print its prompt
 *   handoff <id> <agentId>      record the subagent and post the [handoff] marker
 *   feedback <id> <kind> <msg>  post a marker with the lineage's rootItemId
 *   usage <agentId>             post the subagent's [usage] from its transcript
 *   stop-broker <id>            stop an item's broker
 *   ledger | status             print the ledger / heartbeat and credential state
 * Every command takes `--url-key <k>` (needed only when more than one
 * workspace is set up) and `--home <dir>` (default ~/.harbour-runner).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  credentialStore,
  ensurePrivateDir,
  isHeartbeatStale,
  stopBroker,
  BROKER_HOST,
  BROKER_STALE_MS,
  BROKER_SLEEP_GAP_MS
} from './broker.mjs';

export { isHeartbeatStale };

export const RUNNER_HARNESS = 'claude-code';
// NB2: another consumer (a Simple Dispatcher) polled this workspace within
// this window, so two runners would race for the same items. The runner stops.
// No wider than Harbour's own 1h "active consumer" window
// (lib/consumer-poll-warning.js), so anything called recent here Harbour also
// calls active.
export const OTHER_CONSUMER_RECENT_MS = 10 * 60 * 1000;
// NB3: with less than this left on the 24h runner token, fresh items are left
// queued. Follow-ups, wakes and aborts still flow, so running work can finish
// under the token that took it.
export const FRESH_TAKE_MIN_TOKEN_LIFE_MS = 2 * 60 * 60 * 1000;
export const WATCHDOG_STALL_MIN = 20;
export const WATCHDOG_FAIL_MIN = 60;
export const WAIT_CAP_MS = 25 * 60 * 1000;
export const WAIT_POLL_MS = 30 * 1000;
export const WAIT_HEARTBEAT_MS = 30 * 1000;

const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;
const TERMINAL_RE = /^\s*\[(done|complete|failed|aborted|skipped)\]/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORPHAN_COPY = 'These rows were taken by a runner that is gone. They stay `taken` — Harbour keeps the history for the project\'s lifetime, so nothing expires them and nothing can close them from here. A parent Autopilot waiting on one hangs: re-dispatch the task from Harbour.';

// ─── Pure decisions ──────────────────────────────────────────────────────────

/** Short, stable, one-way fingerprint of a token: identifies it without holding it. */
export function tokenFingerprint(token) {
  return `sha256:${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16)}`;
}

export function promptDigest(prompt) {
  return crypto.createHash('sha256').update(prompt == null ? '' : String(prompt)).digest('hex');
}

/**
 * Q4: is this item the owner's? Decided on the POLL result, before any take.
 * An owner dispatch passes; a server-minted wake (no attribution of its own)
 * passes only when the dispatch it wakes reads as the owner's. Everything else
 * is left queued. Fails closed with no owner id.
 */
export function attributeItem(item, { ownerAccountId, wakeRoot = null }) {
  if (!ownerAccountId) return { pass: false, reason: 'no-owner' };
  if (item.dispatchedBy === ownerAccountId) return { pass: true, reason: 'owner' };
  if (item.kind === 'wake' && item.dispatchedBy == null && item.followUpTo) {
    if (wakeRoot && wakeRoot.id === item.followUpTo && wakeRoot.dispatchedBy === ownerAccountId) {
      return { pass: true, reason: 'owner-wake' };
    }
    return { pass: false, reason: 'wake-root-not-owner' };
  }
  return { pass: false, reason: 'not-owner' };
}

/**
 * The wake rule's root, from a `GET /api/proxy/dispatch/:followUpTo` read.
 * The id is only ever what the watch body says (null when absent), never the
 * id the read was keyed by, so attributeItem's id check stays a real check.
 */
export function wakeRootFrom(res) {
  if (!res || res.status !== 200) return null;
  return { id: res.json?.id ?? null, dispatchedBy: res.json?.dispatchedBy ?? null };
}

/** N2: this runner is Claude Code only. `null` passes (wakes inherit). */
export function harnessDecision(item) {
  if (item.harness == null || item.harness === RUNNER_HARNESS) return null;
  return `harness:${item.harness}`;
}

// LIN-3211: the prose bootstrap exchange line every Harbour emitter writes
// (lib/proxy-preamble.js, public/common.js, public/proxy.js, the Collective
// builder). A bootstrap is randomBytes(32).toString('base64url'): 43 chars.
const PROSE_EXCHANGE_RE = /curl -X POST -H "Authorization: Bearer [A-Za-z0-9_-]{43}" \S+\/api\/proxy\/token/;

/**
 * LIN-3211: a runner subagent never holds a token, so an item whose prompt
 * carries one in prose is never taken, whether or not it also has a structured
 * `bootstrapToken`. The prompt is passed verbatim, so leave rather than strip.
 */
export function credentialInProseRefusal(item) {
  if (item.abort) return false;
  return typeof item.prompt === 'string' && PROSE_EXCHANGE_RE.test(item.prompt);
}

/** Confirm a polled item against its own `GET /api/proxy/dispatch/:id/prompt` read. */
export function confirmItem(pollItem, promptRead) {
  if (pollItem.abort) return { ok: true, reason: 'abort-row' };
  if (!promptRead || promptRead.id !== pollItem.id) return { ok: false, reason: 'prompt-unreadable' };
  if (promptRead.prompt !== pollItem.prompt) return { ok: false, reason: 'prompt-mismatch' };
  if ((promptRead.followUpTo || null) !== (pollItem.followUpTo || null)) return { ok: false, reason: 'followUpTo-mismatch' };
  return { ok: true, reason: 'confirmed' };
}

function ledgerRows(ledger) {
  return Object.values(ledger?.items || {});
}

// The ledger row a dispatch id refers to: the row for that item, or the
// newest row of the lineage it started. Every item handed to a subagent has a
// row, so this keys on all of them (Simple Dispatcher's followup.js matches
// on rootItemId OR the current itemId for the same reason).
function findRow(ledger, dispatchId) {
  const direct = ledger?.items?.[dispatchId];
  if (direct) return direct;
  const lineage = ledgerRows(ledger).filter((r) => r.rootItemId === dispatchId);
  return lineage.sort((a, b) => String(a.takenAt || '').localeCompare(String(b.takenAt || ''))).at(-1) || null;
}

/**
 * A follow-up continues the subagent that ran the item it names. A subagent
 * that finished (`done`) or was stopped (N4) can be continued; one lost to a
 * runner restart can't, and neither can an id the ledger never saw.
 */
export function resolveFollowUp(item, ledger) {
  if (!item.followUpTo) return { action: 'new' };
  const row = findRow(ledger, item.followUpTo);
  if (!row || !row.agentId || row.state === 'lost') {
    return {
      action: 'reject',
      message: `[failed] No live subagent to resume for follow-up (original dispatch ${item.followUpTo} not found).`
    };
  }
  return { action: 'continue', agentId: row.agentId, rootItemId: row.rootItemId || row.itemId, fromItemId: item.followUpTo };
}

/**
 * Simple Dispatcher's halt meaning, per item. `pause`: fresh items wait;
 * follow-ups and wakes for this runner's own subagents, and aborts, still
 * flow. `stop`: nothing is taken.
 */
export function haltAction(halt, item, ledger) {
  const mode = halt?.mode;
  if (!mode) return { decision: 'take', reason: 'no-halt' };
  if (mode === 'pause') {
    if (item.abort) return { decision: 'take', reason: 'halt:pause:abort-flows' };
    if (item.followUpTo && resolveFollowUp(item, ledger).action === 'continue') {
      return { decision: 'take', reason: 'halt:pause:follow-up-flows' };
    }
    return { decision: 'leave', reason: 'halt:pause' };
  }
  return { decision: 'leave', reason: `halt:${mode}` };
}

/**
 * Can the current runner token post on this row? Harbour accepts feedback on
 * a taken row only from the token that took it (`ownershipFilter`), so after a
 * re-login inside a live session the old token's rows are unpostable. A row
 * with no recorded token is treated as the current one's. No live token: no.
 */
export function canPost(row, currentTokenId) {
  if (!currentTokenId) return false;
  return !row.tokenId || row.tokenId === currentTokenId;
}

// Postability for the pure decisions below. Omitting `currentTokenId` keeps
// the plain "post everything" reading; the commands always pass it.
function postableFor(opts) {
  return (row) => !('currentTokenId' in (opts || {})) || canPost(row, opts.currentTokenId);
}

/**
 * A `stop` halt stops every running subagent, posts Simple Dispatcher's
 * `[aborted] … (stopped by operator).` on its row, and keeps it in the ledger
 * as `stopped`, so a follow-up after the stop clears can continue it (N4).
 * A row the current token can't post on is still stopped and kept, and is
 * listed in `unposted` instead of posted (F2).
 */
export function haltSweep(halt, ledger, opts = {}) {
  const next = structuredClone(ledger || { items: {} });
  if (halt?.mode !== 'stop') return { posts: [], unposted: [], stopAgents: [], ledger: next };
  const postable = postableFor(opts);
  const posts = [];
  const unposted = [];
  const stopAgents = new Set();
  for (const row of Object.values(next.items)) {
    if (row.state !== 'running') continue;
    const post = {
      itemId: row.itemId,
      rootItemId: row.rootItemId || row.itemId,
      message: `[aborted] Cancelled running session ${row.itemId.slice(0, 8)} (stopped by operator).`
    };
    (postable(row) ? posts : unposted).push(post);
    if (row.agentId) stopAgents.add(row.agentId);
    row.state = 'stopped';
  }
  return { posts, unposted, stopAgents: [...stopAgents], ledger: next };
}

/** Everything `pollDecision` checks before the `/prompt` read. `wait` uses this. */
export function preConfirmDecision(item, ctx) {
  const now = ctx.now ?? Date.now();
  const seen = Date.parse(ctx.otherConsumerLastSeenAt || '');
  if (Number.isFinite(seen) && now - seen < OTHER_CONSUMER_RECENT_MS) {
    return { decision: 'abort', reason: 'other-consumer' };
  }
  const harness = harnessDecision(item);
  if (harness) return { decision: 'leave', reason: harness };
  const attribution = attributeItem(item, { ownerAccountId: ctx.ownerAccountId, wakeRoot: ctx.wakeRoot });
  if (!attribution.pass) return { decision: 'leave', reason: attribution.reason };
  if (credentialInProseRefusal(item)) return { decision: 'leave', reason: 'credential-in-prose' };
  const halt = haltAction(ctx.halt, item, ctx.ledger);
  if (halt.decision !== 'take') return halt;
  const expires = Date.parse(ctx.tokenExpiresAt || '');
  const fresh = !item.followUpTo && !item.abort;
  if (fresh && (!Number.isFinite(expires) || expires - now < FRESH_TAKE_MIN_TOKEN_LIFE_MS)) {
    return { decision: 'leave', reason: 'token-expiring' };
  }
  return { decision: 'take', reason: 'ok' };
}

/**
 * The poll-time decision, in order: another consumer (NB2) → harness (N2) →
 * owner attribution (Q4) → credential in prose (LIN-3211) → halt →
 * runner-token life (NB3) → prompt confirmation. `take`, `leave` (the item stays queued) or `abort` (stop the
 * runner).
 */
export function pollDecision(item, ctx) {
  const pre = preConfirmDecision(item, ctx);
  if (pre.decision !== 'take') return pre;
  const confirmed = confirmItem(item, ctx.promptRead);
  if (!confirmed.ok) return { decision: 'leave', reason: confirmed.reason };
  return { decision: 'take', reason: 'confirmed' };
}

/**
 * After take, the item must be the one poll confirmed. A mismatch (unreachable
 * in practice) closes with `[skipped] refused:`: terminal, never a wake, and
 * never `[failed]`.
 */
export function postTakeCheck(polled, taken) {
  const diffs = [];
  if (!taken || taken.id !== polled.id) diffs.push('id');
  else {
    if (promptDigest(taken.prompt) !== polled.promptSha256) diffs.push('prompt');
    if ((taken.followUpTo || null) !== (polled.followUpTo || null)) diffs.push('followUpTo');
    if ((taken.abort === true) !== (polled.abort === true)) diffs.push('abort');
    if ((taken.abortTo || null) !== (polled.abortTo || null)) diffs.push('abortTo');
    if ((taken.dispatchedBy ?? null) !== (polled.dispatchedBy ?? null)) diffs.push('dispatchedBy');
  }
  return diffs.length ? `[skipped] refused: taken item differs from the confirmed poll (${diffs.join(', ')})` : null;
}

/**
 * B5, Simple Dispatcher's ack-plus-child-post pair. Running target: stop it,
 * post the line on its row and ack on the abort row. Finished target: the ack
 * only, so a real completion is never overwritten. Unknown target: a failed
 * ack. Cascades arrive already expanded into plain abort rows.
 */
export function abortAction(abortItem, ledger, opts = {}) {
  const next = structuredClone(ledger || { items: {} });
  const postable = postableFor(opts);
  const to = abortItem.abortTo;
  const lineage = Object.values(next.items).filter((r) => r.itemId === to || r.rootItemId === to);
  if (!to || lineage.length === 0) {
    return { ack: `[failed] No session to abort (${to}).`, childPost: null, unpostedChild: null, stopAgent: null, ledger: next };
  }
  const running = lineage.find((r) => r.state === 'running');
  if (running) {
    const line = `[aborted] Cancelled running session ${to.slice(0, 8)} (running).`;
    running.state = 'stopped';
    const child = { itemId: running.itemId, message: line, rootItemId: running.rootItemId || running.itemId };
    // F2: a target taken under an earlier runner token is still stopped and
    // acked, but its own row can't take the post: list it instead.
    return {
      ack: line,
      childPost: postable(running) ? child : null,
      unpostedChild: postable(running) ? null : child,
      stopAgent: running.agentId || null,
      ledger: next
    };
  }
  const phase = (lineage.find((r) => r.itemId === to) || lineage[0]).state;
  return { ack: `[aborted] Closed finished session ${to.slice(0, 8)} (${phase}).`, childPost: null, unpostedChild: null, stopAgent: null, ledger: next };
}

/**
 * B4 and NB3, run at startup before login replaces anything. Rows from THIS
 * runner session are live (a re-login inside a running session keeps every
 * subagent). From another session: a running/stopped row this token took
 * gets `[failed] runner restarted: subagent lost`; one another token took is
 * an orphan, listed with the honest copy; a finished one is marked lost so no
 * follow-up tries to continue a subagent that no longer exists.
 */
export function recoverAction(ledger, { currentTokenId, sessionId }) {
  const next = structuredClone(ledger || { items: {} });
  const out = { fail: [], orphans: [], lost: [], live: [] };
  for (const row of Object.values(next.items)) {
    if (sessionId && row.session === sessionId) {
      if (row.state === 'running' || row.state === 'stopped') out.live.push(row.itemId);
      continue;
    }
    if (row.state === 'running' || row.state === 'stopped') {
      if (currentTokenId && row.tokenId === currentTokenId) out.fail.push(row.itemId);
      else out.orphans.push(row.itemId);
      row.state = 'lost';
    } else if (row.state === 'done') {
      out.lost.push(row.itemId);
      row.state = 'lost';
    }
  }
  return { ...out, message: '[failed] runner restarted: subagent lost', orphanCopy: ORPHAN_COPY, ledger: next };
}

/**
 * The runner's own watchdog (there is no Simple Dispatcher reaper). Silence is
 * measured from the subagent's transcript, else from the take, so a row that
 * was taken but never handed to a subagent is caught too (F3). Activity after
 * a `[blocked]` clears it (`clear`), so a later second stall gets a second
 * `[blocked]`.
 */
export function watchdogAction(inflight, now, { stallMin = WATCHDOG_STALL_MIN, failMin = WATCHDOG_FAIL_MIN, transcriptMtime = null } = {}) {
  const taken = Date.parse(inflight.takenAt || '');
  const last = Math.max(Number.isFinite(transcriptMtime) ? transcriptMtime : -Infinity, Number.isFinite(taken) ? taken : -Infinity);
  if (!Number.isFinite(last)) return null;
  const silentMin = Math.floor((now - last) / 60_000);
  const blockedMs = Date.parse(inflight.blockedAt || '');
  const resumed = Number.isFinite(blockedMs) && Number.isFinite(transcriptMtime) && transcriptMtime > blockedMs;
  const blocked = Number.isFinite(blockedMs) && !resumed;
  const what = inflight.agentId
    ? `subagent ${inflight.agentId} silent for ${silentMin} min`
    : `no subagent took item ${inflight.itemId} (silent for ${silentMin} min)`;
  if (silentMin >= failMin) return { action: 'fail', stop: true, message: `[failed] stalled: ${what}` };
  if (silentMin >= stallMin && !blocked) return { action: 'block', stop: false, message: `[blocked] stalled: ${what}` };
  if (resumed) return { action: 'clear', stop: false, message: null };
  return null;
}

/**
 * One watchdog pass over the ledger's running rows: each action, whether the
 * current token may post it (F2), and the ledger with `blockedAt` set or
 * cleared and failed rows marked done. The caller posts only `post: true`.
 */
export function watchdogSweep(ledger, now, { currentTokenId, transcriptMtimeFor = () => null, stallMin, failMin } = {}) {
  const next = structuredClone(ledger || { items: {} });
  const actions = [];
  for (const row of Object.values(next.items)) {
    if (row.state !== 'running') continue;
    const w = watchdogAction(row, now, { stallMin, failMin, transcriptMtime: transcriptMtimeFor(row) });
    if (!w) continue;
    if (w.action === 'clear') delete row.blockedAt;
    if (w.action === 'block') row.blockedAt = new Date(now).toISOString();
    if (w.action === 'fail') row.state = 'done';
    actions.push({
      itemId: row.itemId, agentId: row.agentId || null, rootItemId: row.rootItemId || row.itemId,
      action: w.action, stop: w.stop, message: w.message, post: w.message != null && canPost(row, currentTokenId)
    });
  }
  return { actions, ledger: next };
}

/**
 * Cumulative usage of one subagent transcript (Claude Code JSONL). Each
 * assistant message counts once (its blocks repeat the same id and usage);
 * the model is the one with the most output tokens. With nothing readable it
 * returns the harness only, which reads unpriced, never a false $0.
 */
export function sumTranscriptUsage(lines) {
  const seen = new Set();
  const totals = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0 };
  const outputByModel = new Map();
  let found = false;
  for (const line of lines || []) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || entry.type !== 'assistant') continue;
    const message = entry.message;
    const usage = message && message.usage;
    if (!usage || typeof usage !== 'object') continue;
    if (message.id) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
    }
    found = true;
    const add = (field, value) => { if (Number.isFinite(value)) totals[field] += value; };
    add('inputTokens', usage.input_tokens);
    add('outputTokens', usage.output_tokens);
    add('cacheCreationInputTokens', usage.cache_creation_input_tokens);
    add('cacheCreation1hInputTokens', usage.cache_creation?.ephemeral_1h_input_tokens);
    add('cacheReadInputTokens', usage.cache_read_input_tokens);
    if (typeof message.model === 'string' && message.model && Number.isFinite(usage.output_tokens)) {
      outputByModel.set(message.model, (outputByModel.get(message.model) || 0) + usage.output_tokens);
    }
  }
  if (!found) return { harness: RUNNER_HARNESS };
  const model = [...outputByModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { harness: RUNNER_HARNESS, ...(model ? { model } : {}), ...totals };
}

/**
 * The `[usage]` line, kind:'usage'. It reports what the run REALISED, from the
 * transcript; there is deliberately no way to pass the item's requested model
 * in (NB5).
 */
export function usageMessage(usage) {
  return `[usage] ${JSON.stringify({ schema: 1, ...usage })}`;
}

/**
 * NB5: the item's `model` is mapped onto the subagent's model alias (Claude
 * Code's Task tool takes `opus`, `sonnet` or `haiku`); anything else runs on
 * the session's own model. `effort` has no per-subagent control, so it is not
 * applied. Either way `[usage]` reports the realised model.
 */
export function subagentModelFor(item) {
  const requested = typeof item.model === 'string' ? item.model.toLowerCase() : '';
  const alias = ['opus', 'sonnet', 'haiku'].find((a) => requested.includes(a)) || null;
  return {
    model: alias,
    effort: null,
    note: `${alias ? `subagent model: ${alias}` : 'subagent model: inherit (runner session\'s own)'}; effort ${item.effort ? `"${item.effort}" ` : ''}not applied (no per-subagent control); [usage] reports the realised model`
  };
}

export function handoffMessage(itemId, agentId, continuedFrom) {
  return `[handoff] item ${itemId} → subagent ${agentId} (${continuedFrom ? `continued from ${continuedFrom}` : 'new'})`;
}

/**
 * NB1: every runner post carries the lineage's `rootItemId` (the subagent's
 * first item), so wakes and follow-ups join one lineage and a cumulative
 * `[usage]` counts once in lib/task-cost.js.
 */
export function feedbackBody(ledger, itemId, kind, message) {
  const row = ledger?.items?.[itemId];
  return { message, kind, rootItemId: row?.rootItemId || itemId };
}

/**
 * The /runner credential block (S4): `key: value` lines, list bullets,
 * bold keys and backticks tolerated. A bare token on its own is the bootstrap.
 */
export function parseCredentialBlock(text) {
  const out = {};
  const keys = {
    baseurl: 'baseUrl', base: 'baseUrl', urlkey: 'urlKey', owneraccountid: 'ownerAccountId', owner: 'ownerAccountId',
    bootstrap: 'bootstrap', bootstraptoken: 'bootstrap', expiresat: 'expiresAt'
  };
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*(?:[-*]\s*)?\**`?([A-Za-z]+)`?\**\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = keys[m[1].toLowerCase()];
    if (key && !out[key]) out[key] = m[2].replace(/^`+|`+$/g, '').trim();
  }
  if (!out.bootstrap) {
    const bare = String(text || '').trim();
    if (bare && !/\s/.test(bare)) out.bootstrap = bare;
  }
  return out;
}

// ─── State on disk ───────────────────────────────────────────────────────────

function defaultHome() {
  return path.join(os.homedir(), '.harbour-runner');
}

function resolveUrlKey(home, flag) {
  if (flag) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(flag)) throw new Error('invalid --url-key');
    return flag;
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(home, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(home, d.name, 'runner.json')))
      .map((d) => d.name);
  } catch { /* no home yet */ }
  if (dirs.length === 1) return dirs[0];
  throw new Error(dirs.length ? `several workspaces are set up (${dirs.join(', ')}); pass --url-key` : 'no workspace set up yet; run login first');
}

function runnerPaths(home, urlKey) {
  const dir = path.join(home, urlKey);
  return {
    dir,
    token: path.join(dir, 'runner.token'),
    state: path.join(dir, 'runner.json'),
    ledger: path.join(dir, 'ledger.json'),
    poll: path.join(dir, 'poll.json'),
    heartbeat: path.join(dir, 'runner.heartbeat')
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function touch(file) {
  ensurePrivateDir(path.dirname(file));
  const t = new Date();
  try { fs.utimesSync(file, t, t); } catch { fs.writeFileSync(file, '', { mode: 0o600 }); }
}

function findTranscript(root, agentId) {
  const name = `agent-${agentId}.jsonl`;
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) if (e.isFile() && e.name === name) return path.join(dir, e.name);
    if (depth <= 0) return null;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const hit = walk(path.join(dir, e.name), depth - 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, 4);
}

function mtimeOf(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

// ─── Harbour I/O ─────────────────────────────────────────────────────────────

function client({ baseUrl, token, fetchImpl = fetch }) {
  const call = async (method, route, body) => {
    const res = await fetchImpl(`${baseUrl}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual'
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 401) throw new Error('the runner credential was rejected (expired or revoked): mint a new one on /runner and run login');
    return { status: res.status, json };
  };
  return {
    poll: () => call('GET', '/api/proxy/runner/poll'),
    take: (id) => call('POST', `/api/proxy/runner/take/${id}`),
    feedback: (id, body) => call('POST', `/api/proxy/runner/feedback/${id}`, body),
    promptRead: (id) => call('GET', `/api/proxy/dispatch/${id}/prompt`),
    watch: (id) => call('GET', `/api/proxy/dispatch/${id}`)
  };
}

function assertBase(base) {
  let u;
  try { u = new URL(base); } catch { throw new Error('invalid baseUrl'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u.origin;
  throw new Error('the Harbour base must be https (http only for loopback)');
}

// Start the item's broker with its bootstrap on stdin; resolve its ready line.
function startItemBroker({ home, baseUrl, urlKey, itemId, bootstrap }) {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), 'broker.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, 'serve', '--base', baseUrl, '--url-key', urlKey, '--item', itemId, '--home', home], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: Object.fromEntries(Object.entries({ PATH: process.env.PATH, HOME: process.env.HOME }).filter(([, v]) => v !== undefined))
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('broker did not start')); }, 15_000);
    child.stdout.on('data', (c) => {
      out += c;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      try {
        const ready = JSON.parse(out.split('\n')[0]);
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve(ready);
      } catch (e) { reject(e); }
    });
    child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`broker exited ${code}: ${err.trim()}`)); });
    child.stdin.end(`${bootstrap}\n`);
  });
}

function environmentPreamble(socket) {
  if (!socket) {
    return 'This item was dispatched without workspace API access. Run it without calling Harbour; no credential is available and none may be derived.';
  }
  return [
    `HARBOUR_LOCAL_BASE=http://${BROKER_HOST}`,
    `Every curl to $HARBOUR_LOCAL_BASE must add: --unix-socket ${socket}`,
    'No Authorization header: the local broker adds the credential. You never hold a token.'
  ].join('\n');
}

// ─── Commands ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else positional.push(a);
  }
  return { positional, flags };
}

/**
 * Run one command. Returns the object the CLI prints. Injectable for tests:
 * `home`, `stdin`, `now`, `fetchImpl`, `transcriptRoot` and the wait timings.
 */
export async function runCommand(argv, deps = {}) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...args] = positional;
  const home = flags.home || deps.home || defaultHome();
  const now = deps.now || Date.now;
  const fetchImpl = deps.fetchImpl || fetch;
  const transcriptRoot = deps.transcriptRoot || path.join(os.homedir(), '.claude', 'projects');

  if (command === 'login') return login({ home, flags, stdin: deps.stdin ?? await readStdin(), fetchImpl, now });

  const urlKey = command === 'recover' ? (flags['url-key'] || resolveUrlKeyOrNull(home)) : resolveUrlKey(home, flags['url-key']);
  if (!urlKey) throw new Error('no workspace set up yet; pass --url-key or run login first');
  const p = runnerPaths(home, urlKey);
  const state = readJson(p.state, {});
  const creds = credentialStore({ file: p.token });
  const loadLedger = () => readJson(p.ledger, { items: {} });
  const saveLedger = (l) => writeJson(p.ledger, l);
  const api = () => {
    const token = creds.get();
    if (!token || !state.baseUrl) throw new Error('not logged in: run login with the /runner credential');
    return client({ baseUrl: state.baseUrl, token, fetchImpl });
  };
  const currentTokenId = () => {
    const token = creds.get();
    const expires = Date.parse(state.expiresAt || '');
    return token && Number.isFinite(expires) && expires > now() ? tokenFingerprint(token) : null;
  };
  const post = async (itemId, body) => {
    const r = await api().feedback(itemId, body);
    if (r.status !== 200) throw new Error(`feedback on ${itemId} returned HTTP ${r.status}`);
  };
  const stopItemBroker = (itemId) => stopBroker({ home, urlKey, itemId }).catch(() => null);

  switch (command) {
    case 'recover': {
      const session = flags.session || crypto.randomBytes(8).toString('hex');
      const r = recoverAction(loadLedger(), { currentTokenId: currentTokenId(), sessionId: flags.session || null });
      for (const itemId of r.fail) {
        await post(itemId, { message: r.message, kind: 'status', rootItemId: r.ledger.items[itemId].rootItemId || itemId });
      }
      for (const itemId of [...r.fail, ...r.orphans, ...r.lost]) await stopItemBroker(itemId);
      saveLedger(r.ledger);
      writeJson(p.state, { ...state, session });
      return { session, fail: r.fail, orphans: r.orphans, lost: r.lost, live: r.live, ...(r.orphans.length ? { orphanCopy: r.orphanCopy } : {}) };
    }

    case 'poll': {
      const c = api();
      const res = await c.poll();
      if (res.status !== 200) throw new Error(`poll returned HTTP ${res.status}`);
      const { items = [], halt = null, otherConsumerLastSeenAt = null } = res.json || {};
      let ledger = loadLedger();
      const sweep = haltSweep(halt, ledger, { currentTokenId: currentTokenId() });
      for (const s of sweep.posts) await post(s.itemId, { message: s.message, kind: 'status', rootItemId: s.rootItemId });
      for (const s of [...sweep.posts, ...sweep.unposted]) await stopItemBroker(s.itemId);
      ledger = sweep.ledger;
      saveLedger(ledger);
      const decisions = [];
      const snapshots = {};
      let aborted = false;
      for (const it of items) {
        const base = { ownerAccountId: state.ownerAccountId, halt, ledger, otherConsumerLastSeenAt, now: now(), tokenExpiresAt: state.expiresAt };
        let wakeRoot = null;
        if (it.kind === 'wake' && it.dispatchedBy == null && it.followUpTo) {
          wakeRoot = wakeRootFrom(await c.watch(it.followUpTo));
        }
        let d = preConfirmDecision(it, { ...base, wakeRoot });
        if (d.decision === 'take') {
          const pr = it.abort ? null : await c.promptRead(it.id);
          d = pollDecision(it, { ...base, wakeRoot, promptRead: pr && pr.status === 200 ? pr.json : null });
        }
        if (d.decision === 'abort') aborted = true;
        decisions.push({
          id: it.id, decision: d.decision, reason: d.reason, kind: it.kind, promptName: it.promptName || null,
          issueIdentifier: it.issueIdentifier || null, followUpTo: it.followUpTo || null, abort: it.abort === true,
          abortTo: it.abortTo || null, harness: it.harness || null, model: it.model || null, effort: it.effort || null,
          apiAccess: Boolean(it.bootstrapToken)
        });
        if (d.decision === 'take') {
          snapshots[it.id] = {
            id: it.id, promptSha256: promptDigest(it.prompt), followUpTo: it.followUpTo || null,
            abort: it.abort === true, abortTo: it.abortTo || null, dispatchedBy: it.dispatchedBy ?? null
          };
        }
      }
      if (aborted) {
        for (const d of decisions) if (d.decision === 'take') { d.decision = 'leave'; d.reason = 'runner-aborted'; }
      }
      writeJson(p.poll, aborted ? {} : snapshots);
      writeJson(p.state, { ...state, lastHalt: halt ? halt.mode : null });
      return {
        halt, otherConsumerLastSeenAt, decisions,
        stopAgents: sweep.stopAgents,
        ...(sweep.unposted.length ? { unposted: sweep.unposted.map((u) => ({ itemId: u.itemId, reason: 'taken under an earlier runner credential; stopped here, left taken on Harbour' })) } : {}),
        ...(aborted ? { abort: true, message: 'Another consumer (a Simple Dispatcher?) polled this workspace recently. Stop this runner: two runners would race for the same items.' } : {})
      };
    }

    case 'take': {
      const [itemId] = args;
      if (!UUID_RE.test(itemId || '')) throw new Error('usage: take <itemId>');
      const snapshots = readJson(p.poll, {});
      const polled = snapshots[itemId];
      if (!polled) throw new Error(`${itemId} was not approved by the last poll; run poll first (refused items stay queued)`);
      const c = api();
      const res = await c.take(itemId);
      delete snapshots[itemId];
      writeJson(p.poll, snapshots);
      if (res.status !== 200) throw new Error(`take returned HTTP ${res.status} (already taken, or gone)`);
      const taken = res.json.item;
      let ledger = loadLedger();
      const refused = postTakeCheck(polled, taken);
      if (refused) {
        await post(itemId, { message: refused, kind: 'status', rootItemId: itemId });
        return { id: itemId, refused };
      }
      const tokenId = currentTokenId();
      if (taken.abort) {
        const a = abortAction(taken, ledger, { currentTokenId: tokenId });
        await post(itemId, { message: a.ack, kind: 'status', rootItemId: itemId });
        if (a.childPost) {
          await post(a.childPost.itemId, { message: a.childPost.message, kind: 'status', rootItemId: a.childPost.rootItemId });
        }
        const target = a.childPost || a.unpostedChild;
        if (target) await stopItemBroker(target.itemId);
        saveLedger(a.ledger);
        return {
          id: itemId,
          abort: {
            ack: a.ack, stopAgent: a.stopAgent, target: taken.abortTo,
            ...(a.unpostedChild ? { unpostedChild: { itemId: a.unpostedChild.itemId, reason: 'taken under an earlier runner credential; stopped here, left taken on Harbour' } } : {})
          }
        };
      }
      const follow = resolveFollowUp(taken, ledger);
      if (follow.action === 'reject') {
        await post(itemId, { message: follow.message, kind: 'status', rootItemId: itemId });
        return { id: itemId, rejected: follow.message };
      }
      let broker = null;
      if (taken.bootstrapToken) {
        // The row is already taken: a broker that can't start must close it
        // honestly rather than leave it `taken` with nothing running. The
        // error names the broker's status only, never the bootstrap.
        try {
          const ready = await startItemBroker({ home, baseUrl: state.baseUrl, urlKey, itemId, bootstrap: taken.bootstrapToken });
          broker = { socket: ready.socket, pid: ready.pid };
        } catch (err) {
          const failed = `[failed] runner could not start this item's broker (${String(err.message).replaceAll(taken.bootstrapToken, '[bootstrap]').slice(0, 300)})`;
          await post(itemId, { message: failed, kind: 'status', rootItemId: follow.action === 'continue' ? follow.rootItemId : itemId });
          return { id: itemId, failed };
        }
      }
      ledger = loadLedger();
      ledger.items[itemId] = {
        itemId,
        agentId: follow.action === 'continue' ? follow.agentId : null,
        rootItemId: follow.action === 'continue' ? follow.rootItemId : itemId,
        continuedFrom: follow.action === 'continue' ? follow.fromItemId : null,
        state: 'running',
        tokenId,
        session: state.session || null,
        takenAt: new Date(now()).toISOString(),
        socket: broker ? broker.socket : null
      };
      saveLedger(ledger);
      return {
        item: {
          id: taken.id, kind: taken.kind, promptName: taken.promptName || null, issueIdentifier: taken.issueIdentifier || null,
          followUpTo: taken.followUpTo || null, harness: taken.harness || null, model: taken.model || null, effort: taken.effort || null
        },
        handoff: follow.action === 'continue'
          ? { mode: 'continue', agentId: follow.agentId, continuedFrom: follow.fromItemId, rootItemId: follow.rootItemId }
          : { mode: 'new' },
        subagent: subagentModelFor(taken),
        broker,
        environment: environmentPreamble(broker && broker.socket),
        prompt: taken.prompt
      };
    }

    case 'handoff': {
      const [itemId, agentId] = args;
      if (!itemId || !agentId) throw new Error('usage: handoff <itemId> <agentId>');
      const ledger = loadLedger();
      const row = ledger.items[itemId];
      if (!row) throw new Error(`${itemId} is not in the ledger; take it first`);
      row.agentId = agentId;
      saveLedger(ledger);
      const message = handoffMessage(itemId, agentId, row.continuedFrom);
      await post(itemId, feedbackBody(ledger, itemId, 'status', message));
      return { itemId, agentId, message };
    }

    case 'feedback': {
      const [itemId, kind = 'status', ...rest] = args;
      const message = rest.join(' ');
      if (!itemId || !message) throw new Error('usage: feedback <itemId> <kind> <message>');
      if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) throw new Error(`message exceeds ${MAX_FEEDBACK_MESSAGE_LENGTH} characters`);
      const ledger = loadLedger();
      const row = ledger.items[itemId];
      const tokenId = currentTokenId();
      if (row && row.tokenId && tokenId && row.tokenId !== tokenId) {
        throw new Error(`${itemId} was taken under an earlier runner credential; Harbour only accepts its feedback from that one (it stays taken)`);
      }
      await post(itemId, feedbackBody(ledger, itemId, kind, message));
      if (row && TERMINAL_RE.test(message) && row.state === 'running') {
        row.state = 'done';
        saveLedger(ledger);
        await stopItemBroker(itemId);
      }
      return { itemId, kind, posted: true, ...(row ? { state: row.state, rootItemId: row.rootItemId } : {}) };
    }

    case 'usage': {
      const [agentId] = args;
      if (!agentId) throw new Error('usage: usage <agentId>');
      const ledger = loadLedger();
      const rows = Object.values(ledger.items).filter((r) => r.agentId === agentId)
        .sort((a, b) => String(a.takenAt || '').localeCompare(String(b.takenAt || '')));
      const row = rows.at(-1);
      if (!row) throw new Error(`no ledger row for subagent ${agentId}`);
      const file = flags.transcript || findTranscript(transcriptRoot, agentId);
      const lines = file ? fs.readFileSync(file, 'utf8').split('\n') : [];
      const usage = sumTranscriptUsage(lines);
      const message = usageMessage(usage);
      await post(row.itemId, feedbackBody(ledger, row.itemId, 'usage', message));
      return { itemId: row.itemId, agentId, transcript: file || null, usage };
    }

    case 'wait':
      return waitLoop({ deps, p, state, api, currentTokenId, loadLedger, saveLedger, post, stopItemBroker, transcriptRoot, now });

    case 'stop-broker': {
      const [itemId] = args;
      return stopBroker({ home, urlKey, itemId });
    }

    case 'ledger':
      return loadLedger();

    case 'status': {
      const mtime = mtimeOf(p.heartbeat);
      const age = mtime == null ? null : now() - mtime;
      return {
        urlKey,
        loggedIn: Boolean(creds.get()),
        expiresAt: state.expiresAt || null,
        session: state.session || null,
        heartbeat: { ageMs: age, stale: isHeartbeatStale(mtime, now(), BROKER_STALE_MS, 0, { sleepGapMs: BROKER_SLEEP_GAP_MS }) }
      };
    }

    default:
      throw new Error('usage: runner.mjs recover|login|poll|wait|take|handoff|feedback|usage|stop-broker|ledger|status');
  }
}

function resolveUrlKeyOrNull(home) {
  try { return resolveUrlKey(home, null); } catch { return null; }
}

async function login({ home, flags, stdin, fetchImpl, now }) {
  const block = parseCredentialBlock(stdin);
  const baseUrl = assertBase(flags.base || block.baseUrl);
  const urlKey = flags['url-key'] || block.urlKey;
  const ownerAccountId = flags.owner || block.ownerAccountId;
  if (!urlKey || !/^[A-Za-z0-9_-]{1,64}$/.test(urlKey)) throw new Error('the credential block has no valid urlKey');
  if (!ownerAccountId) throw new Error('the credential block has no ownerAccountId; the runner can\'t tell the owner\'s items apart without it');
  if (!block.bootstrap) throw new Error('no bootstrap on stdin');
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/api/proxy/token`, { method: 'POST', headers: { Authorization: `Bearer ${block.bootstrap}` }, redirect: 'manual' });
  } catch {
    throw new Error('login failed: Harbour unreachable');
  }
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status} (a bootstrap works once and lives 1h; mint a new one on /runner)`);
  const json = await res.json().catch(() => null);
  if (!json || typeof json.token !== 'string') throw new Error('login failed: no token in the response');
  const grants = Array.isArray(json.grants) ? json.grants : [];
  if (!grants.includes('take')) throw new Error('this credential has no take grant: it is not a runner credential');
  const p = runnerPaths(home, urlKey);
  credentialStore({ file: p.token }).set(json.token);
  const prior = readJson(p.state, {});
  const tokenId = tokenFingerprint(json.token);
  writeJson(p.state, {
    ...prior, baseUrl, urlKey, ownerAccountId, expiresAt: json.expiresAt || null, tokenId, grants,
    loggedInAt: new Date(now()).toISOString()
  });
  return { ok: true, urlKey, expiresAt: json.expiresAt || null, grants, tokenId };
}

async function waitLoop({ deps, p, state, api, currentTokenId, loadLedger, saveLedger, post, stopItemBroker, transcriptRoot, now }) {
  const pollMs = deps.waitPollMs ?? WAIT_POLL_MS;
  const heartbeatMs = deps.waitHeartbeatMs ?? WAIT_HEARTBEAT_MS;
  const capMs = deps.waitCapMs ?? WAIT_CAP_MS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const started = now();
  let lastBeat = -Infinity;
  let lastPoll = -Infinity;
  const c = api();
  while (true) {
    const t = now();
    if (t - lastBeat >= heartbeatMs) { touch(p.heartbeat); lastBeat = t; }
    if (t - started >= capMs) return { reason: 'cap' };
    if (t - lastPoll >= pollMs) {
      lastPoll = t;
      let res;
      try { res = await c.poll(); } catch (e) { return { reason: 'credential', message: e.message }; }
      if (res.status !== 200) return { reason: 'error', status: res.status };
      const { items = [], halt = null, otherConsumerLastSeenAt = null } = res.json || {};
      if ((halt ? halt.mode : null) !== (state.lastHalt ?? null)) return { reason: 'halt', halt };
      const ledger = loadLedger();
      const work = [];
      for (const it of items) {
        let wakeRoot = null;
        if (it.kind === 'wake' && it.dispatchedBy == null && it.followUpTo) {
          wakeRoot = wakeRootFrom(await c.watch(it.followUpTo));
        }
        const d = preConfirmDecision(it, { ownerAccountId: state.ownerAccountId, halt, ledger, otherConsumerLastSeenAt, now: now(), tokenExpiresAt: state.expiresAt, wakeRoot });
        if (d.decision === 'abort') return { reason: 'abort', message: 'another consumer polled this workspace recently' };
        if (d.decision === 'take') work.push(it.id);
      }
      if (work.length) return { reason: 'work', items: work };
      const sweep = watchdogSweep(ledger, now(), {
        currentTokenId: currentTokenId(),
        transcriptMtimeFor: (row) => {
          const file = row.agentId ? findTranscript(transcriptRoot, row.agentId) : null;
          return file ? mtimeOf(file) : null;
        }
      });
      if (sweep.actions.length) saveLedger(sweep.ledger);
      const stalls = [];
      for (const a of sweep.actions) {
        if (a.action === 'clear') continue;
        if (a.post) await post(a.itemId, { message: a.message, kind: 'status', rootItemId: a.rootItemId });
        if (a.action === 'fail') await stopItemBroker(a.itemId);
        stalls.push({ itemId: a.itemId, agentId: a.agentId, action: a.action, stop: a.stop, posted: a.post });
      }
      if (stalls.length) return { reason: 'stall', stalls };
    }
    await sleep(Math.max(5, Math.min(pollMs, heartbeatMs) / 2));
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  runCommand(process.argv.slice(2))
    .then((out) => { process.stdout.write(`${JSON.stringify(out, null, 2)}\n`); })
    .catch((err) => { process.stderr.write(`runner: ${err.message}\n`); process.exit(1); });
}
