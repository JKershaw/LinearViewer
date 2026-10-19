/**
 * lib/plan-allowance.js — the plan / allowance seam (LIN-3706).
 *
 * One home for "who is Free, and what does Free get": the plan table, the
 * allowance arithmetic (runs per UTC day, prompts per UTC hour), the UTC day
 * and hour windows, the run-limit codes and their status, and the three
 * refusal / answer shapes built from them. A later plan joins as a row in
 * `PLANS` (and a cell in `FREE_FOR`), not as new branches at call sites.
 *
 * A LEAF, on purpose: it imports nothing from this repo (pinned by
 * tests/unit/plan-allowance-leaf.test.js), so nothing it imports can import it
 * back. Plain functions only: no database, no network, no env read except
 * `readAllowanceEnv` (called once where `server.js` builds the store), and no
 * clock read except `wallClock`. Callers keep their own store calls, their own
 * `try`, and their own HTTP replies (LIN-3598): this module computes, it never
 * charges and never writes to `res`.
 *
 * Behaviour is today's, byte for byte. Where a function replaces code that fell
 * through on an off-path input (a null store answer, an unknown run-limit
 * code), it falls through the same way: no added guard, no default table.
 */

// ---------------------------------------------------------------------------
// Who counts as Free, for which purpose (LIN-3658, LIN-3663)
// ---------------------------------------------------------------------------

/**
 * Who counts as Free for each purpose the code has, as data. A row says which
 * facts must be absent (`requires`: fact name -> required boolean) and which of
 * the facts then make the caller Free (`anyOf`). Facts are
 * `{ hasSessionKey, hasPaidEnvKey, hasFreeKey, hasTestFlag }`, read by the
 * caller (this module reads no env). The four rows are the four distinct
 * predicates the code holds; they disagree on purpose (LIN-3658: merging them
 * would change which sessions are charged), and the disagreement is written
 * down here instead of being spread over call sites.
 *
 * What the table does NOT cover is a caller's own condition (test mode, mock
 * AI, a test token, an account being present, a store being present): those
 * stay at the call site and are listed in docs/plan-allowance-design.md.
 */
export const FREE_FOR = Object.freeze({
  keyed: Object.freeze({
    id: 'keyed',
    requires: Object.freeze({ hasSessionKey: false, hasPaidEnvKey: false }),
    anyOf: Object.freeze(['hasFreeKey']),
    reason: 'Spends the shared free key: no own key, no paid env key, a free key set. Prompt gate, run gate, quota, model clamp, AI available, proxy lane, precompute fallback.'
  }),
  label: Object.freeze({
    id: 'label',
    requires: Object.freeze({ hasSessionKey: false, hasPaidEnvKey: false }),
    anyOf: Object.freeze(['hasFreeKey', 'hasTestFlag']),
    reason: 'What the product says: as keyed, or the test-only session flag (LIN-405). Source label, recommendation enabled, prompt-options flag, footer and settings copy.'
  }),
  flagged: Object.freeze({
    id: 'flagged',
    requires: Object.freeze({ hasSessionKey: false, hasPaidEnvKey: false }),
    anyOf: Object.freeze(['hasTestFlag']),
    reason: 'The AI-mock charge (LIN-405): the test-only session flag, no own key, no paid env key. Ignores the free key on purpose.'
  }),
  offered: Object.freeze({
    id: 'offered',
    requires: Object.freeze({}),
    anyOf: Object.freeze(['hasFreeKey']),
    reason: 'A free tier is configured on this server, whoever is looking and whatever else is set. Landing copy.'
  })
});

/**
 * Whether `facts` make the caller Free for the purpose `rowId`, read from the
 * table (default `FREE_FOR`). An unknown row, or a row with no `anyOf`, is not
 * Free.
 *
 * @param {string} rowId
 * @param {{hasSessionKey?: *, hasPaidEnvKey?: *, hasFreeKey?: *, hasTestFlag?: *}} facts
 * @param {Object} [table=FREE_FOR]
 * @returns {boolean}
 */
export function isFreeFor(rowId, facts, table = FREE_FOR) {
  const row = table[rowId];
  if (!row) return false;
  for (const [fact, wanted] of Object.entries(row.requires)) {
    if (!!facts[fact] !== wanted) return false;
  }
  return row.anyOf.some((fact) => !!facts[fact]);
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * The plan table. Production ships one row: Free, 10 runs per UTC day and a
 * shared 50 prompts per UTC hour, a placeholder until the hosted free-tier /
 * pricing work (LIN-1645, LIN-3238 Q9) picks real numbers. `promptsUnlimited`
 * says prompts have no per-account cap (only the shared hourly net);
 * `clampsModel` says the plan's calls run on the clamped model. Neither flag
 * has a production reader yet: `forceDefault: isFreeTier` stays a plain boolean
 * at its call sites (docs/plan-allowance-design.md, 1(e)).
 */
export const PLANS = Object.freeze([
  Object.freeze({
    id: 'free',
    appliesTo: (facts) => isFreeFor('keyed', facts),
    runsPerDay: 10,
    promptsPerHour: 50,
    clampsModel: true,
    promptsUnlimited: true
  })
]);

/** The Free row, for the store and `server.js`, which have no facts to ask with. */
export const FREE_PLAN = PLANS[0];

/**
 * The first plan whose `appliesTo(facts)` is true, else `null`.
 *
 * @param {{hasSessionKey?: *, hasPaidEnvKey?: *, hasFreeKey?: *, hasTestFlag?: *}} facts
 * @param {Array} [plans=PLANS]
 * @returns {Object|null}
 */
export function planOf(facts, plans = PLANS) {
  return plans.find((plan) => plan.appliesTo(facts)) || null;
}

/**
 * The model clamp for `plan`: `resolve(plan)` when the plan clamps, else `null`.
 * The clamp VALUE stays with the caller (`resolveFreeTierModel` in
 * lib/openrouter.js); the row only says whether to apply one.
 *
 * @param {Object|null} plan
 * @param {(plan: Object) => *} resolve
 * @returns {*}
 */
export function modelClampOf(plan, resolve) {
  return plan && plan.clampsModel ? resolve(plan) : null;
}

// ---------------------------------------------------------------------------
// Allowance: env, clock, windows, remaining
// ---------------------------------------------------------------------------

/**
 * The one place the allowance env vars are read. Raw strings; `allowanceOf`
 * parses them. Called once where `server.js` builds the store, never per call.
 *
 * @param {Object} [env=process.env]
 * @returns {{runLimit: string|undefined, hourlyLimit: string|undefined}}
 */
export function readAllowanceEnv(env = process.env) {
  return { runLimit: env.FREE_TIER_RUN_LIMIT, hourlyLimit: env.FREE_TIER_HOURLY_LIMIT };
}

/**
 * The plan's allowance with the env override applied: `parseInt(x, 10)` then
 * the plan's number. `0`, junk and blank fall back to the plan's number (the
 * `||`), a negative number is kept, `'3.9'` reads as 3, `'1e2'` as 1.
 *
 * @param {{runsPerDay: number, promptsPerHour: number}} plan
 * @param {{runLimit?: string, hourlyLimit?: string}} [envLimits]
 * @returns {{runsPerDay: number, promptsPerHour: number}}
 */
export function allowanceOf(plan, envLimits = {}) {
  return {
    runsPerDay: parseInt(envLimits.runLimit, 10) || plan.runsPerDay,
    promptsPerHour: parseInt(envLimits.hourlyLimit, 10) || plan.promptsPerHour
  };
}

/**
 * The one clock read. `Date` is resolved when this runs, not when the module
 * loads, so a test that replaces the global `Date` still moves it. Every caller
 * keeps one read per place it read the clock before: a read before an `await`
 * and one after are two reads, never merged (a merge changes behaviour at an
 * hour boundary).
 *
 * @returns {Date}
 */
export function wallClock() {
  return new Date();
}

/**
 * The UTC day around `now`: `key` (YYYY-MM-DD), `start` (00:00:00.000Z of that
 * day) and `resetsAt` (ISO string of the next 00:00 UTC). The same expressions
 * the store used, not arithmetic: the result at 29 Feb 2028, 31 Dec and past
 * year 9999 is whatever `Date` gives. `start` and `resetsAt` are read lazily,
 * so asking only for `key` can throw no sooner than it did.
 *
 * @param {Date} now
 * @returns {{key: string, start: Date, resetsAt: string}}
 */
export function dayWindow(now) {
  const key = now.toISOString().slice(0, 10);
  return {
    key,
    get start() {
      return new Date(`${key}T00:00:00.000Z`);
    },
    get resetsAt() {
      const tomorrow = new Date(now.getTime());
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      return tomorrow.toISOString();
    }
  };
}

/**
 * The UTC hour around `now`: `key` (YYYY-MM-DDTHH), `start` (top of that hour)
 * and `resetsAt` (ISO string of the top of the next hour, LIN-3239 R2: a daily
 * reset here would overstate the wait by up to 23h).
 *
 * @param {Date} now
 * @returns {{key: string, start: Date, resetsAt: string}}
 */
export function hourWindow(now) {
  const key = now.toISOString().slice(0, 13);
  return {
    key,
    get start() {
      return new Date(`${key}:00:00.000Z`);
    },
    get resetsAt() {
      const next = new Date(now.getTime());
      next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
      return next.toISOString();
    }
  };
}

/**
 * What is left of `limit` after `used`. `null`/`undefined` used (a count that
 * could not be read) is 0, not a fabricated allowance; `NaN` stays `NaN`; a
 * negative limit stays 0.
 *
 * @param {number} limit
 * @param {number|null|undefined} used
 * @returns {number}
 */
export function remainingOf(limit, used) {
  return used == null ? 0 : Math.max(0, limit - used);
}

// ---------------------------------------------------------------------------
// Refusals and answers
// ---------------------------------------------------------------------------

/** Discriminator on the 429 run-limit refusal body (LIN-3238). */
export const RUN_LIMIT_CODE = 'RUN_LIMIT_REACHED';

/** Discriminator on the 503 unverified-run-count body (LIN-3238). */
export const RUN_LIMIT_UNVERIFIED_CODE = 'RUN_LIMIT_UNVERIFIED';

/** The three denial reasons `FreeTierStore.tryUse` records (prompt gate). */
export const USAGE_DENIAL_REASONS = Object.freeze({
  missingWorkspace: 'Missing workspace',
  busy: 'Service busy, try again later',
  unverified: 'Unable to verify usage limits, try again later'
});

/**
 * The prompt gate's denial record: `{allowed, reason, remaining, limit,
 * resetsAt}`, in that key order, `remaining` always 0.
 *
 * @param {string} reason - one of `USAGE_DENIAL_REASONS`
 * @param {number} limit
 * @param {string} resetsAt
 * @returns {{allowed: false, reason: string, remaining: 0, limit: number, resetsAt: string}}
 */
export function hourlyDenial(reason, limit, resetsAt) {
  return { allowed: false, reason, remaining: 0, limit, resetsAt };
}

/**
 * The `freeTier` block every prompt-refusal 429 carries, built from a
 * `checkFreeTierGate` denial record — only these four fields, in this order
 * (never `allowed` / `reason`; never `runsUsed`, that is the run block's).
 * Verbatim from `freeTierRefusalBlock` (LIN-3658): `denial.remaining` still
 * throws on a null denial.
 *
 * @param {{remaining: number, limit: number, resetsAt: string}} denial
 * @returns {{freeTier: {used: true, remaining: number, limit: number, resetsAt: string}}}
 */
export function promptRefusalBlock(denial) {
  return { freeTier: { used: true, remaining: denial.remaining, limit: denial.limit, resetsAt: denial.resetsAt } };
}

/** Whole seconds until `resetsAt`, at least 1. `NaN` when `resetsAt` is not a date. */
export function secondsUntil(resetsAt, nowMs) {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - nowMs) / 1000));
}

/**
 * The HTTP status a run-limit refusal code carries: 503 for the unverified
 * code, 429 for every other code, a missing one included (LIN-3470). An
 * equality, not a lookup table: a table answers `undefined` for a code it does
 * not list, and `retryAfter` would then be dropped with it.
 *
 * @param {string|undefined} code
 * @returns {429|503}
 */
export function runLimitStatus(code) {
  return code === RUN_LIMIT_UNVERIFIED_CODE ? 503 : 429;
}

/**
 * Whether a run-limit refusal is worth retrying: strict equality on
 * `RUN_LIMIT_UNVERIFIED_CODE` (the count could not be read), so any other code
 * is not retryable.
 *
 * @param {string|undefined} code
 * @returns {boolean}
 */
export function isRetryableRunLimit(code) {
  return code === RUN_LIMIT_UNVERIFIED_CODE;
}

/**
 * The run-limit refusal for a `checkRun` gate result: `{status, body}`.
 *
 * `gate.reason === 'limit'` is a 429 with the usage in the body; anything else
 * (the unverified reason, a null, a thrown-and-swallowed gate) is a 503 that
 * fails closed, with `retryAfter` computed from `resetsAt` when there is one
 * and 1 when there is not. Key order of both bodies is the wire order
 * (lib/dispatch-factory.js before LIN-3706 wrote them out inline).
 *
 * @param {Object|null|undefined} gate - `{allowed, reason?, runsUsed, limit, remaining, resetsAt}`
 * @param {number} nowMs - epoch ms from the caller's clock
 * @returns {{status: 429|503, body: Object}}
 */
export function runRefusal(gate, nowMs) {
  if (gate?.reason === 'limit') {
    const { limit, runsUsed, resetsAt } = gate;
    const message = `Daily run limit reached (${runsUsed} of ${limit} today). Resets at midnight UTC.`;
    return {
      status: 429,
      body: {
        error: message,
        code: RUN_LIMIT_CODE,
        freeTier: { used: true, remaining: 0, limit, resetsAt, runsUsed },
        retryAfter: secondsUntil(resetsAt, nowMs)
      }
    };
  }

  const resetsAt = gate?.resetsAt ?? null;
  const message = 'Unable to verify the run limit for this account';
  return {
    status: 503,
    body: {
      error: message,
      code: RUN_LIMIT_UNVERIFIED_CODE,
      freeTier: { used: true, remaining: 0, limit: gate?.limit ?? null, resetsAt, runsUsed: null },
      retryAfter: resetsAt ? secondsUntil(resetsAt, nowMs) : 1
    }
  };
}

/**
 * The quota route's answer (LIN-3238 Q6). `{limited: false, ...null}` ONLY when
 * the plan is absent (the caller is not Free). With a plan, `usage` is read
 * with no guard: a null or throwing `getRunUsage` answer must still throw
 * inside the route's `try` and come out as its 500 plus log, never as a 200.
 * The route keeps its own "no attributable account" short-circuit and calls
 * `quotaAnswer(null)` for it.
 *
 * @param {Object|null} plan
 * @param {{runsUsed: number|null, limit: number, remaining: number, resetsAt: string}} [usage]
 * @returns {{limited: boolean, runsUsed: number|null, limit: number|null, remaining: number|null, resetsAt: string|null}}
 */
export function quotaAnswer(plan, usage) {
  if (!plan) {
    return { limited: false, runsUsed: null, limit: null, remaining: null, resetsAt: null };
  }
  return {
    limited: true,
    runsUsed: usage.runsUsed,
    limit: usage.limit,
    remaining: usage.remaining,
    resetsAt: usage.resetsAt
  };
}
