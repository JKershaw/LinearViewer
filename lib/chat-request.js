/**
 * lib/chat-request.js — the chat-request preamble every LLM-backed chat route
 * re-derives by hand: which key to spend, whether the free tier allows this
 * call, and how long a message may be (LIN-2970).
 *
 * Adopted at the chat lane only: `routes/task-chat.js`, `routes/flight-companion.js`
 * (all three sites) and `routes/workspace-api-roadmap.js`'s roadmap-chat handler.
 * NOT adopted: `routes/next-run.js`, `routes/ship-biscuit.js`,
 * `routes/workspace-api.js`, `routes/dashboard.js`, `routes/proxy.js`, and
 * roadmap *generate* (`workspace-api-roadmap.js`'s `resolveRequestContext`) —
 * filed as a named follow-up at this ticket's close-out, not swept here.
 *
 * PRESERVED, NOT CHANGED: the `OAuth > paid env key > free tier` precedence,
 * the free-tier clamp, and every caller's own `429` body shape. This module
 * owns the CHECK, never the HTTP response — each caller keeps building its
 * own response from the values handed back, exactly as it did before this
 * extraction existed.
 *
 * `routes/proxy-flight-companion.js`'s turn does NOT join this chain: it
 * resolves the TOKEN CREATOR's key via `getWorkspaceOpenRouterKey` +
 * `resolveProxyLLM`, because the bearer authenticates the call, not the
 * spend. That is a deliberately separate credential path and must stay that
 * way — this module only owns the session/env/free-tier chain.
 */

import { getPaidEnvKey, hasPaidEnvKey } from './openrouter.js';

/** The shared 2000-character chat message/question cap (LIN-2970). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

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
 * @returns {{apiKey: string|null, isFreeTier: boolean}} `apiKey` is `null`
 *   (not `undefined`, not `''`) when nothing resolves, matching every
 *   adopted site's existing falsy-check convention (`if (!apiKeyToUse)`).
 */
export function resolveChatCredential({ sessionApiKey }) {
  const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
  const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
  const apiKey = sessionApiKey || getPaidEnvKey() || freeTierKey || null;
  return { apiKey, isFreeTier };
}

/**
 * The free-tier gate: on a free-tier call, atomically charge the daily/hourly
 * counters and report whether this call is allowed.
 *
 * Returns `null` when the call may proceed (not free tier, or free tier and
 * allowed) — never throws. On a denial, returns `freeTierStore.tryUse`'s own
 * `{allowed: false, reason, remaining, limit, resetsAt}` record UNCHANGED, so
 * each caller keeps building its own `429` body from these same fields
 * exactly as it did before this extraction (task-chat.js's inline JSON,
 * workspace-api-roadmap.js's `jsonError`, flight-companion.js's
 * `onBeforeSpend` refusal object all differ in shape today, and none of that
 * shape lives here).
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
