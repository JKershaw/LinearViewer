/**
 * Shared proxy-context preamble for dispatched prompts.
 *
 * Extracted from routes/proxy.js (LIN-733) so non-proxy dispatch seams — the
 * feedback-triage enqueue in routes/workspace-api.js — append the SAME
 * "Workspace API access" block as the proxy dispatch endpoints, byte-identical,
 * rather than re-typing the prose. One source of truth for the access block.
 */

import { BOOTSTRAP_TOKEN_TTL_SECONDS } from './proxy-tokens.js';
import { ownerlessCompatEnabled } from './ownerless-token-policy.js';

/**
 * Single source of truth for the claude-code MCP-token branch (LIN-1155).
 *
 * Returns true ONLY for an explicit, resolved harness of `claude-code`
 * (case-insensitive, trimmed). A null/absent/empty harness returns FALSE by
 * design (decision A): null means "the consumer's own default", and until the
 * Simple Dispatcher MCP server (LIN-1156) is live there is no out-of-band channel
 * to deliver the token — so an unspecified harness keeps the historical prose
 * block, byte-identical, with zero blast radius. Flipping the default so an absent
 * harness resolves to claude-code is the deliberately-separate LIN-1159 (blocked
 * on LIN-1155 + LIN-1156), not this predicate.
 *
 * @param {string|null|undefined} harness - The RESOLVED execution harness
 * @returns {boolean} true iff the token should travel as the structured field + MCP
 */
export function shouldUseMcpTokenField(harness) {
  return typeof harness === 'string' && harness.trim().toLowerCase() === 'claude-code';
}

/**
 * The default execution harness Harbour interposes at the proxy dispatch boundary
 * when a dispatch resolves with no explicit harness and no workspace default
 * (LIN-1159 — the deliberately-separate "flip the default" step referenced in the
 * shouldUseMcpTokenField note above).
 *
 * Before this, an absent/null resolved harness meant "the consumer's own default"
 * and kept the historical token-in-prose block — which is the COMMON dispatch case
 * and exactly the path the 2026-07-07 injection refusal tripped. Interposing
 * `claude-code` makes the LIN-1155 shouldUseMcpTokenField gate fire on that common
 * path, so the bootstrap token travels out-of-band as the structured MCP field
 * instead of injectable prose. Gated on LIN-1155 (the field + gate) and LIN-1156
 * (Simple Dispatcher's MCP token exchange) both being live — flipping earlier would
 * strip token delivery with no replacement channel.
 */
export const DEFAULT_DISPATCH_HARNESS = 'claude-code';

/**
 * Applies the LIN-1159 default to an already-resolved harness. Returns the harness
 * unchanged when it is a non-empty string — an explicit dispatch harness or a
 * workspace default, INCLUDING non-claude-code values like `opencode`, which stay
 * untouched — else DEFAULT_DISPATCH_HARNESS. This is the single boundary seam that
 * flips the common (null-harness) proxy dispatch onto the MCP token-field path; it
 * must be applied AFTER explicit/workspace resolution and BEFORE the value is
 * threaded into attachProxyContext + the dispatch item.
 *
 * @param {string|null|undefined} resolvedHarness - harness after explicit/workspace resolution
 * @returns {string} the harness to use for the dispatch
 */
export function applyDefaultDispatchHarness(resolvedHarness) {
  return (typeof resolvedHarness === 'string' && resolvedHarness.trim())
    ? resolvedHarness
    : DEFAULT_DISPATCH_HARNESS;
}

/**
 * The affirmative half of the authn≠authz split (LIN-1409). Both `exchangeLines`
 * branches below state only what the channel does NOT authorize (irreversible
 * actions); nothing told the worker what the dispatch DOES authorize, so a worker
 * could form the false belief "I have no authorization to begin" and stop before
 * doing the reversible work it was dispatched to do — the gap LIN-1365 left one
 * step earlier in the lifecycle (it added the negative half here and the
 * affirmative half only to the orchestrator kickoff, `autopilot-kickoff.js:346-355`,
 * which a dispatched worker never sees). This mirrors that kickoff wording without
 * importing it (LIN-1269 owns that file live).
 *
 * Drafted as a plain statement of what reversible work the dispatch authorizes —
 * NOT as reassurance about the channel's trustworthiness. LIN-1365's commit
 * message records why: over-asserting trustworthiness ("live proof", "already
 * authenticated", "itself the proof") pattern-matches an injection pre-warm, so a
 * careful model discounts the whole authority story, including the legitimate
 * review Approve. Adding that flavor of sentence here would recreate the exact
 * defect LIN-1365 fixed, one step earlier.
 */
const REVERSIBLE_WORK_MANDATE = 'Being dispatched here is your mandate for the reversible work — investigate, edit, open PRs, comment: do not hold your first call, or any call, waiting for a live reply before you start.';

/**
 * Builds the proxy-context block appended to a dispatched prompt so the worker
 * inherits this workspace's API access — the richer replacement for the
 * old local MCP. The wording is source-neutral (the proxy is one contract
 * across providers; this workspace happens to be Linear-backed today). It does
 * NOT teach phone-home: the dispatch runner's own Stop
 * hook reports back automatically when the session ends, so reporting is a
 * harness concern, not a prompt concern. We only ask the worker to END with an
 * evidence-rich summary, so whatever the hook forwards carries proof rather
 * than a bare "done" (the invariant-2 / LIN-292 discipline, applied at source).
 *
 * CREDENTIAL CONTAINMENT (LIN-376): the embedded `token` is a SINGLE-USE BOOTSTRAP,
 * not a working token and never the caller's own standing credential. The worker's
 * first call exchanges it at POST /api/proxy/token for a multi-use working token;
 * the bootstrap is spent by that exchange. So this durable prompt (queue, history,
 * log, clipboard, and GET .../dispatch/:id/prompt) carries a credential that is
 * inert the instant the agent starts. A leaked prompt leaks only an already-spent
 * bootstrap.
 *
 * TOKEN DELIVERY (LIN-1155): `tokenDelivery` selects how the worker is told to
 * reach this workspace's API. `'prose'` (default) embeds the single-use bootstrap
 * inline and instructs a curl exchange — the historical behaviour, kept
 * byte-identical for every non-claude-code harness. `'mcp'` embeds NO token and
 * NO curl exchange: the claude-code harness instead reaches the API through its
 * own localhost credential-injecting broker (`HARBOUR_LOCAL_BASE`, LIN-1375) with
 * ordinary unauthenticated calls, so the prompt text carries no credential for a
 * prompt-injection guard to trip on. The contextual guidance (brief endpoint,
 * evidence discipline, catalog) is identical across both modes — only the "how
 * you reach the API" block swaps.
 *
 * @param {Object} params
 * @param {string} params.baseUrl - e.g. https://host
 * @param {string} params.token - Single-use BOOTSTRAP token to embed (prose mode only)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42"
 * @param {'prose'|'mcp'} [params.tokenDelivery='prose'] - How the worker reaches this workspace's API
 * @returns {string} Block to append to the prompt
 */
export function buildProxyContextPreamble({ baseUrl, token, issueIdentifier, tokenDelivery = 'prose' }) {
  // ONE channel per mode (LIN-1372 / LIN-1362 residue). In mcp/broker mode the worker
  // is told to reach the API through its localhost credential-injecting broker
  // ($HARBOUR_LOCAL_BASE, LIN-1375), so EVERY endpoint reference below must use that
  // same base. A block that says "call the local proxy" but then hands out external
  // ${baseUrl} URLs reads as a channel contradiction and trips the agent's injection
  // guard at the irreversible gate (the LIN-1403 close-out refusals). Prose mode keeps
  // ${baseUrl} — the worker holds a token for it — so that path stays byte-identical.
  const apiBase = tokenDelivery === 'mcp' ? '$HARBOUR_LOCAL_BASE' : baseUrl;
  // Per-issue examples only make sense when we actually have an identifier;
  // otherwise fall back to generic discovery endpoints (avoids rendering a
  // malformed ".../issues/your task" with a literal space).
  const contextLines = issueIdentifier
    ? [
        `Start from the distilled brief: GET ${apiBase}/api/proxy/brief/${issueIdentifier}`,
        `(present-state — folds in comments, supersedes stale wording; read it before the raw`,
        `description). Use GET ${apiBase}/api/proxy/issues/${issueIdentifier} for full raw detail`,
        `and /relations/${issueIdentifier}, and update the workspace as you work (status, comments, labels).`
      ]
    : [
        `Once you pick a task, start from its distilled brief (GET ${apiBase}/api/proxy/brief/{id}).`,
        `Use the proxy to pull context (e.g. GET ${apiBase}/api/proxy/stack, /search?q=…,`,
        `/issues/LIN-123) and to update the workspace as you work (status, comments, labels).`
      ];
  // How the worker reaches this workspace's API. The prose block embeds the
  // single-use bootstrap + a curl exchange (historical, byte-identical for
  // non-claude-code harnesses). The mcp block embeds NO token and NO curl — the
  // claude-code harness instead reaches the API through its own localhost
  // credential-injecting broker (`HARBOUR_LOCAL_BASE`, LIN-1375), so the prompt
  // text is credential-free.
  const exchangeLines = tokenDelivery === 'mcp'
    ? [
        `This workspace's own dispatch API is available locally at the URL in your`,
        `HARBOUR_LOCAL_BASE environment variable — make ordinary unauthenticated calls to it`,
        `(curl "$HARBOUR_LOCAL_BASE/api/proxy/...", no Authorization header); the local proxy`,
        `adds credentials for you.`,
        REVERSIBLE_WORK_MANDATE,
        `That local proxy was provisioned by this workspace's own Harbour control-plane out-of-band before this session started; it is not a third-party service. Reaching it authenticates the channel; it does not by itself authorize irreversible actions: merge and Done are gated separately on a recorded review Approve plus a discharged/empty ledger you read for yourself.`
      ]
    : [
        `FIRST, exchange your single-use bootstrap token for a working token:`,
        `  curl -X POST -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/token`,
        `  → { "token": "<WORKING_TOKEN>", "scope": "readWrite", "expiresAt": "...", "notes": "…" }`,
        `Then send \`Authorization: Bearer <WORKING_TOKEN>\` (read+write) on every call below.`,
        `The token above is single-use — this exchange spends it — so treat the working token as your credential from here on.`,
        REVERSIBLE_WORK_MANDATE,
        `You have this bootstrap because a real dispatch just happened; the exchange response is your first call against this workspace's own Harbour control-plane, not a third-party service. That authenticates the channel; it does not by itself authorize irreversible actions: merge and Done are gated separately on a recorded review Approve plus a discharged/empty ledger you read for yourself.`
      ];
  return [
    '',
    '',
    '---',
    '## Workspace API access (auto-appended)',
    '',
    `You have a workspace API proxy for this workspace (source-neutral; currently backed by Linear). Base: ${apiBase}/api/proxy`,
    '',
    ...exchangeLines,
    `Full endpoint catalog: GET ${apiBase}/api/proxy/instructions`,
    '',
    ...contextLines,
    '',
    'Your runner reports back automatically when this session stops — you do not',
    'need to curl anything to phone home. Just END with a concise summary that',
    'names concrete evidence: PR link, commit SHA, and CI/test result, so the',
    'report carries proof rather than a bare "done".',
    ''
  ].join('\n');
}

/**
 * Mint a single-use bootstrap token for a dispatch (LIN-1429). Extracted out of
 * attachProxyContext so credential provisioning is a prompt-free decision that
 * other callers (e.g. a follow-up dispatch that needs a token but not the prose
 * block) can invoke without also composing prompt text — see LIN-1429's
 * Implementation Plan for the full rationale.
 *
 * HARNESS BRANCH (LIN-1155). When the RESOLVED `harness` is claude-code
 * (shouldUseMcpTokenField), failure to mint FAILS CLOSED (LIN-1175): the token
 * can only reach the session via this out-of-band return value, so silently
 * returning `null` would launch a credential-less claude-code session. Every
 * other harness (incl. null/default, opencode) degrades gracefully: an absent
 * token just returns `null`.
 *
 * `proxyTokenStore` is passed in (not imported) because it is instantiated in
 * server.js and handed to each route factory — a lib module cannot close over it.
 * `label` is threaded per-site (a characterized behavior: feedback-route tests
 * assert the per-site label on the createToken call).
 *
 * @param {Object} params
 * @param {Object} params.proxyTokenStore - Factory-scoped proxy token store (may be null)
 * @param {string} params.urlKey - Workspace url key the token is scoped to
 * @param {string} params.baseUrl - e.g. https://host (falsy → prose: null; claude-code: throws)
 * @param {string} [params.label] - Per-site token label (default 'dispatch-bootstrap')
 * @param {string|null} [params.harness] - RESOLVED execution harness; gates the fail-closed branch
 * @param {string|null} [params.createdBy] - Dispatching owner stamp (LIN-1376)
 * @returns {Promise<string|null>} The minted bootstrap token, or null on graceful
 *   (non-claude-code) degradation
 * @throws {Error} FAIL CLOSED (LIN-1175): in MCP mode (resolved harness claude-code)
 *   any inability to mint — no store/baseUrl, mint returns no token, or mint
 *   throws — throws instead of returning null, so the dispatch is refused rather
 *   than launching a credential-less session. Prose mode never throws.
 */
export async function provisionBootstrapToken({
  proxyTokenStore,
  urlKey,
  baseUrl,
  label = 'dispatch-bootstrap',
  harness = null,
  createdBy = null
}) {
  // FAIL CLOSED for out-of-band (MCP) delivery (LIN-1175). When the resolved
  // harness is claude-code the token is stripped from the prompt and can ONLY
  // reach the session via the structured `bootstrapToken` field + MCP tool —
  // there is no in-prompt fallback. So if the token cannot be established, we must
  // NOT silently return null: that launches a credential-less claude-code session
  // whose prompt still claims a token was "supplied alongside" it (the LIN-1175
  // dead-session bug). We throw instead, so the dispatch is refused upstream
  // (createDispatchItem propagates the throw BEFORE addItem; every call site
  // either surfaces the error to its caller or — for a best-effort feedback
  // side-effect — swallows it and simply skips the dispatch). Prose mode
  // (non-claude-code) keeps the historical graceful degradation: an absent token
  // there just means no proxy access and the prompt never claims otherwise, so a
  // no-op is honest.
  const useMcp = shouldUseMcpTokenField(harness);
  // The fail-closed error carries the `proxyAttachFailed` flag — the same
  // cross-route convention dispatch.js already uses (LIN-1162) — so every route's
  // catch maps it to a transient 503 ("proxy token could not be created, retry")
  // uniformly, rather than a generic 500.
  const failClosed = (reason) => {
    const err = new Error(
      `attachProxyContext: cannot attach an out-of-band bootstrap token for a ` +
      `claude-code dispatch (${reason}). Refusing to dispatch a credential-less ` +
      `session (LIN-1175).`
    );
    err.proxyAttachFailed = true;
    return err;
  };
  const missing = (reason) => {
    if (useMcp) throw failClosed(reason);
    return null;
  };

  if (!proxyTokenStore || !baseUrl) return missing('proxy token store or baseUrl unavailable');

  // LIN-1448 — ownerless mints. A bootstrap with no `createdBy` cannot resolve a
  // workspace credential (LIN-1366's fail-closed null-owner guard), and the
  // defect is INHERITED: the exchange copies the null, and a worker holding the
  // exchanged token mints its children ownerless too. That is how two bad mints
  // halted four autopilot trees on 2026-07-25 (LIN-1576). This function is the
  // choke point every bootstrap mint passes through — including the
  // ownerless-worker-mints-a-child case (routes/proxy.js's kickoff seam, which
  // threads `req.proxyCreatedBy || null`).
  //
  // Gated on the LIN-1447 compat switch, and the ordering is deliberate. While
  // the compat lane is on, ownerless tokens are a SUPPORTED population (the host
  // runner is one), so refusing their mints here would half-remove that lane
  // through a side door — the "part 2 before part 1" LIN-1448 explicitly forbids.
  // Compat on: mint, but say so, so the population is countable while it drains.
  // Compat off: refuse, which makes inheritance impossible rather than merely
  // unused. Either way an OWNER-STAMPED mint is untouched and silent.
  if (!createdBy) {
    if (!ownerlessCompatEnabled()) {
      return missing('the dispatching caller has no owner — an ownerless token cannot resolve a workspace credential (LIN-1448)');
    }
    console.warn(
      `Bootstrap mint with no owner (label=${label} urlKey=${urlKey}): the minted token, ` +
      `and anything it is exchanged for, cannot resolve a workspace credential (LIN-1448)`
    );
  }

  let minted;
  try {
    minted = await proxyTokenStore.createToken(urlKey, {
      kind: 'bootstrap',
      scope: 'readWrite',
      label,
      ttl: BOOTSTRAP_TOKEN_TTL_SECONDS,
      // LIN-1376: stamp the dispatching owner so the exchanged working token
      // resolves under LIN-1366's owner-scoped Linear-token selection. Without
      // this the bootstrap (and the token the exchange inherits from it) is
      // createdBy:null, which the null-owner guard fails closed → every
      // dispatched session hits WORKSPACE_NOT_CONNECTED.
      createdBy
    });
  } catch (err) {
    if (useMcp) throw failClosed(`token mint failed: ${err.message}`);
    console.error(`Proxy context bootstrap mint failed (${label}):`, err.message);
    return null;
  }
  if (!minted?.token) return missing('token mint returned no token');

  return minted.token;
}

/**
 * Mint a single-use bootstrap token and append the proxy-context block to a
 * dispatched prompt (LIN-1157). Consolidates the six inline "mint bootstrap →
 * append preamble" sequences that previously lived at four sites in
 * routes/proxy.js (via the private mintHandoffBootstrap helper) and two in
 * routes/workspace-api.js (inline createToken + try/catch). Same token args
 * (kind:'bootstrap', scope:'readWrite', ttl: BOOTSTRAP_TOKEN_TTL_SECONDS), and the
 * same graceful degradation — if the store is absent, baseUrl is missing, minting
 * throws, or no token comes back, the original prompt is returned unchanged and
 * dispatch proceeds.
 *
 * HARNESS BRANCH (LIN-1155). When the RESOLVED `harness` is claude-code
 * (shouldUseMcpTokenField), the appended block carries NO token/curl (mcp mode)
 * and the minted bootstrap is returned as `bootstrapToken` so the call site can
 * put it on the dispatch item — the token travels out-of-band, not in prompt
 * text. For every other harness (incl. null/default, opencode) the block is the
 * historical prose with the token embedded and `bootstrapToken` is null — the
 * prompt is byte-identical to before, which is why the existing prose tests stay
 * green. Callers MUST resolve harness BEFORE calling this (5 of 6 sites had to
 * hoist their resolveDispatchDefaults block above the append).
 *
 * Provisioning (the mint, LIN-1175 fail-closed included) now lives in
 * `provisionBootstrapToken` (LIN-1429); this wrapper composes it with prompt
 * shaping only — its own signature and fresh-dispatch output are unchanged.
 *
 * @param {Object} params
 * @param {Object} params.proxyTokenStore - Factory-scoped proxy token store (may be null)
 * @param {string} params.urlKey - Workspace url key the token is scoped to
 * @param {string} params.baseUrl - e.g. https://host (falsy → prose: unchanged; claude-code: throws)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42" (null → generic discovery endpoints)
 * @param {string} params.prompt - Base prompt to append the block to
 * @param {string} [params.label] - Per-site token label (default 'dispatch-bootstrap')
 * @param {string|null} [params.harness] - RESOLVED execution harness; gates the MCP branch
 * @returns {Promise<{prompt: string, bootstrapToken: string|null}>} The (possibly appended)
 *   prompt and, for the claude-code branch only, the minted bootstrap to carry as a field
 * @throws {Error} FAIL CLOSED (LIN-1175): in MCP mode (resolved harness claude-code)
 *   any inability to attach a token — no store/baseUrl, mint returns no token, or
 *   mint throws — throws instead of returning the prompt unchanged, so the dispatch
 *   is refused rather than launching a credential-less session. Prose mode never throws.
 */
export async function attachProxyContext({
  proxyTokenStore,
  urlKey,
  baseUrl,
  issueIdentifier = null,
  prompt,
  label = 'dispatch-bootstrap',
  harness = null,
  createdBy = null
}) {
  const useMcp = shouldUseMcpTokenField(harness);
  const token = await provisionBootstrapToken({ proxyTokenStore, urlKey, baseUrl, label, harness, createdBy });
  // Prose-only: in MCP mode every non-token outcome threw inside provisioning
  // (LIN-1175), so this branch is unreachable there — fail-closed is preserved
  // by construction, not by a second check.
  if (!token) return { prompt, bootstrapToken: null };

  const block = buildProxyContextPreamble({
    baseUrl,
    token,
    issueIdentifier,
    tokenDelivery: useMcp ? 'mcp' : 'prose'
  });
  // Prose path: token lives in the block, so it must NOT also become a field
  // (no new exposure). MCP path: token is stripped from the block and handed
  // back for the call site to put on the dispatch item. Do not collapse this to
  // always-returning-the-token — one credential, one channel (a security
  // property, not a style choice).
  return { prompt: prompt + block, bootstrapToken: useMcp ? token : null };
}
