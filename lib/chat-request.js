/**
 * lib/chat-request.js — the chat-request preamble every LLM-backed chat route
 * re-derives by hand: which key to spend, whether the free tier allows this
 * call, and how long a message may be (LIN-2970).
 *
 * Adopted across every in-scope session-credential site — LIN-2970's chat
 * lane plus LIN-2978's follow-up sweep: `routes/task-chat.js`,
 * `routes/flight-companion.js` (all three sites), `routes/next-run.js`,
 * `routes/ship-biscuit.js`, `routes/workspace-api.js` (the six
 * recommend/recap/brief/scan/scan-retire sites, full adopt, plus the
 * feedback-title site, credential only — it never charges, so no gate is
 * added), `routes/dashboard.js` (both summary sites), and both
 * `routes/workspace-api-roadmap.js` handlers — roadmap-chat (full adopt)
 * and roadmap *generate* (`resolveRoadmapLLM`, credential only;
 * `chargeRoadmapLayer`'s per-layer charge stays its own, outside this
 * module). `routes/proxy-flight-companion.js` adopts `CHAT_MESSAGE_MAX_LENGTH`
 * only — its credential path stays separate, below.
 *
 * Proxy routes (LIN-2427): `routes/proxy*.js` resolve the TOKEN CREATOR's key
 * via `getWorkspaceOpenRouterKey` and feed it in as `sessionApiKey` — the
 * bearer authenticates the call, not the spend. The former `resolveProxyLLM`
 * is gone; a creator-less proxy token still falls back to the server env key
 * (behaviour preserved; whether that fallback is correct is a separate,
 * still-open ruling).
 *
 * PRESERVED, NOT CHANGED: the `OAuth > paid env key > free tier` precedence,
 * the free-tier clamp, and every caller's own `429` body shape. This module
 * owns the CHECK and the free-tier refusal's `freeTier` block
 * (`freeTierRefusalBlock`, LIN-3658) — never the HTTP response: each caller
 * keeps its own status, transport (`jsonError`, `keepaliveError`, the proxy's
 * `{status, body}`, ...) and logs, differing only in that transport.
 *
 * Who is on the free tier (LIN-3658): one rule, here — `resolveChatCredential`
 * (the prompt gate), `resolveOpenRouterSource` (footer / Home / Swipe /
 * `/api/recommend/status`) and `isFlagFreeTier` (the AI-mock charge). The
 * run-limit refusal (`lib/dispatch-factory.js`) keeps its own home.
 */

import { getPaidEnvKey, hasPaidEnvKey } from './openrouter.js';
import { resolveAccountGroup } from './account-group.js';

/** The shared 2000-character chat message/question cap (LIN-2970). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

/** The shared half of the free-tier rule: no session key and no usable (trimmed) paid env key. */
function hasNoOwnCredential(sessionApiKey) {
  return !sessionApiKey && !hasPaidEnvKey();
}

/**
 * The operator's shared free-tier key, trimmed; `null` when unset or blank
 * (LIN-3664). Trims the way `getPaidEnvKey` does for the paid key (LIN-961), so
 * a whitespace-only OPENROUTER_FREE_TIER_KEY is NOT a configured free tier —
 * the source, the credential, the landing copy and the precompute guard all
 * read it through here and so agree.
 *
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function getFreeTierKey(env = process.env) {
  const key = typeof env.OPENROUTER_FREE_TIER_KEY === 'string' ? env.OPENROUTER_FREE_TIER_KEY.trim() : '';
  return key || null;
}

/**
 * Which source backs the OpenRouter key for the current session, behind the
 * footer / Home / Swipe status and `/api/recommend/status`.
 * Priority: user OAuth key > server env key > free tier key > null.
 *
 * The test-only session flag counts for the source (and only here and in
 * `isFlagFreeTier`) — `resolveChatCredential` deliberately never reads it, so
 * a flag with no key says `'free'` here while the prompt gate stays not-free
 * (kept as-is, LIN-3658 class (d)). Reads `process.env` at call time.
 *
 * hasPaidEnvKey() trims, so a blank/whitespace OPENROUTER_API_KEY is NOT
 * classified as a paid `env` source (LIN-961). This keeps the operator-facing
 * status honest: the footer can no longer read a blank key as `env` while the
 * token-authed proxy path silently runs on the free tier — the exact
 * divergence that hid this bug.
 *
 * @param {Object} p
 * @param {string|null|undefined} p.sessionApiKey - `req.session.openRouterApiKey`
 * @param {boolean} [p.sessionFreeTierFlag] - `req.session.freeTierEnabled` (LIN-405)
 * @returns {'oauth'|'env'|'free'|null}
 */
export function resolveOpenRouterSource({ sessionApiKey, sessionFreeTierFlag }) {
  if (sessionApiKey) return 'oauth';
  if (hasPaidEnvKey()) return 'env';
  if (getFreeTierKey() || sessionFreeTierFlag) return 'free';
  return null;
}

/**
 * The AI-mock path's free-tier answer (LIN-405, routes/test.js): the session
 * is flagged on the shared free tier, with no own key and no paid env key.
 * Ignores the free env key on purpose — neither this nor
 * `resolveChatCredential().isFreeTier` is a superset of the other, so they are
 * not merged (merging would change which sessions are charged).
 *
 * @param {Object} p
 * @param {string|null|undefined} p.sessionApiKey
 * @param {boolean} [p.sessionFreeTierFlag] - `req.session.freeTierEnabled`
 * @returns {boolean}
 */
export function isFlagFreeTier({ sessionApiKey, sessionFreeTierFlag }) {
  return !!sessionFreeTierFlag && hasNoOwnCredential(sessionApiKey);
}

/**
 * The `freeTier` block every prompt-refusal 429 carries, built from a
 * `checkFreeTierGate` denial record — only these four fields, in this order
 * (never `allowed` / `reason`). Callers spread or pass it into their own body.
 *
 * @param {{remaining: number, limit: number, resetsAt: string}} denial
 * @returns {{freeTier: {used: true, remaining: number, limit: number, resetsAt: string}}}
 */
export function freeTierRefusalBlock(denial) {
  return { freeTier: { used: true, remaining: denial.remaining, limit: denial.limit, resetsAt: denial.resetsAt } };
}

/**
 * Resolve which key a chat call spends and whether it is a free-tier call.
 *
 * Every adopted site derived both of these by hand from the same three
 * inputs (session key, paid env key, free-tier key) in the same
 * `OAuth > paid env key > free tier` order; half of them then re-derived
 * `isFreeTier` a second time from the same three values. One derivation,
 * read twice.
 *
 * @param {Object} p
 * @param {string|null|undefined} p.sessionApiKey - `req.session.openRouterApiKey`
 * @returns {{apiKey: string|null, isFreeTier: boolean, available: boolean}}
 *   `apiKey` is `null` (not `undefined`, not `''`) when nothing resolves,
 *   matching every adopted site's existing falsy-check convention
 *   (`if (!apiKeyToUse)`). `available` is `!!apiKey` — the one answer to "is
 *   any AI key (session, paid env, or free tier) configured?" (LIN-2427).
 */
export function resolveChatCredential({ sessionApiKey }) {
  const freeTierKey = getFreeTierKey();
  const isFreeTier = hasNoOwnCredential(sessionApiKey) && !!freeTierKey;
  const apiKey = sessionApiKey || getPaidEnvKey() || freeTierKey || null;
  return { apiKey, isFreeTier, available: !!apiKey };
}

/**
 * The one AI-availability gate (LIN-2427): true when the call must be refused
 * as "AI not configured". A predicate only — each caller keeps its own reply
 * status/body and logging. `mockAi` (or a caller's test-mode flag) bypasses
 * the gate; callers with no mock path pass `mockAi: false`.
 *
 * @param {Object} p
 * @param {{available: boolean}} p.credential - a `resolveChatCredential` result
 * @param {boolean} [p.mockAi=false]
 * @returns {boolean}
 */
export function isAiUnavailable({ credential, mockAi = false }) {
  return !mockAi && !credential.available;
}

/**
 * The free-tier gate: on a free-tier call, atomically charge the global hourly
 * counter — the only prompt refusal left — and report whether this call is
 * allowed. The per-workspace daily count is written best-effort and never refuses.
 *
 * Returns `null` when the call may proceed (not free tier, or free tier and
 * allowed). It adds no catch of its own: if the store rejects, so does this
 * (each caller's placement relative to its `try` decides the outcome, LIN-3598).
 * On a denial, returns `freeTierStore.tryUse`'s own
 * `{allowed: false, reason, remaining, limit, resetsAt}` record UNCHANGED; the
 * `freeTier` block of the 429 is `freeTierRefusalBlock(record)`, and each
 * caller keeps its own status, transport and logs (LIN-3658).
 *
 * @param {Object} p
 * @param {boolean} p.isFreeTier
 * @param {string} p.urlKey
 * @param {Object} p.freeTierStore - injected store (tryUse(urlKey))
 * @returns {Promise<null|{allowed: false, reason: string, remaining: number, limit: number, resetsAt: string}>}
 */
export async function checkFreeTierGate({ isFreeTier, urlKey, freeTierStore }) {
  if (!isFreeTier) return null;
  const check = await freeTierStore.tryUse(urlKey);
  if (check.allowed) return null;
  return check;
}

/**
 * Build the run gate for a lane, or `null` when the lane is not gated
 * (LIN-3238). Mirrors `checkFreeTierGate`'s "one small shared helper" posture:
 * the lane derives `isFreeTier` from its own credential resolution and passes
 * it in, so no new tier concept is invented here (LIN-1645 owns that).
 *
 * Returns `null` when:
 *   - not free tier (own key, paid env key, or no free key configured: CI and
 *     dev stay unlimited, exactly as for prompts today), or
 *   - `accountId` is null — null attribution is not attributable, so not gated;
 *     logged so the exemption is visible rather than silent.
 * Otherwise returns an async gate that resolves the session account's merge
 * group (so merging accounts cannot double the allowance) and calls
 * `freeTierStore.checkRun`. The gate's result is the tagged error's source at
 * the factory seam (lib/dispatch-factory.js step 1.55).
 *
 * @param {Object} p
 * @param {boolean} p.isFreeTier
 * @param {Object} p.freeTierStore - injected store providing `checkRun(accountIds)`
 * @param {string|null|undefined} p.accountId - the session account (`req.session.accountId`)
 * @param {Object|null} [p.accountStore] - merge-group resolver (lib/account-group.js)
 * @returns {null|(() => Promise<{allowed: boolean, reason?: 'limit'|'unverified', runsUsed: number|null, limit: number, remaining: number, resetsAt: string}>)}
 */
export function buildRunGate({ isFreeTier, freeTierStore, accountId, accountStore = null }) {
  if (!isFreeTier) return null;
  if (!accountId) {
    console.warn('buildRunGate: no session account — null attribution is not gated (LIN-3238)');
    return null;
  }
  return async () => {
    const accountIds = await resolveAccountGroup(accountStore, accountId);
    return freeTierStore.checkRun(accountIds);
  };
}
