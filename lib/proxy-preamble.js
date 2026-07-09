/**
 * Shared proxy-context preamble for dispatched prompts.
 *
 * Extracted from routes/proxy.js (LIN-733) so non-proxy dispatch seams — the
 * feedback-triage enqueue in routes/workspace-api.js — append the SAME
 * "Workspace API access" block as the proxy dispatch endpoints, byte-identical,
 * rather than re-typing the prose. One source of truth for the access block.
 */

import { BOOTSTRAP_TOKEN_TTL_SECONDS } from './proxy-tokens.js';

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
 * obtain a working token. `'prose'` (default) embeds the single-use bootstrap
 * inline and instructs a curl exchange — the historical behaviour, kept
 * byte-identical for every non-claude-code harness. `'mcp'` embeds NO token and
 * NO curl: the token travels out-of-band as a structured dispatch-item field
 * (`bootstrapToken`) that the harness feeds to a primed MCP tool, so the prompt
 * text carries no credential for a prompt-injection guard to trip on. The
 * contextual guidance (brief endpoint, evidence discipline, catalog) is identical
 * across both modes — only the "how you get your token" block swaps.
 *
 * @param {Object} params
 * @param {string} params.baseUrl - e.g. https://host
 * @param {string} params.token - Single-use BOOTSTRAP token to embed (prose mode only)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42"
 * @param {'prose'|'mcp'} [params.tokenDelivery='prose'] - How the worker obtains a working token
 * @returns {string} Block to append to the prompt
 */
export function buildProxyContextPreamble({ baseUrl, token, issueIdentifier, tokenDelivery = 'prose' }) {
  // Per-issue examples only make sense when we actually have an identifier;
  // otherwise fall back to generic discovery endpoints (avoids rendering a
  // malformed ".../issues/your task" with a literal space).
  const contextLines = issueIdentifier
    ? [
        `Start from the distilled brief: GET ${baseUrl}/api/proxy/brief/${issueIdentifier}`,
        `(present-state — folds in comments, supersedes stale wording; read it before the raw`,
        `description). Use GET ${baseUrl}/api/proxy/issues/${issueIdentifier} for full raw detail`,
        `and /relations/${issueIdentifier}, and update the workspace as you work (status, comments, labels).`
      ]
    : [
        `Once you pick a task, start from its distilled brief (GET ${baseUrl}/api/proxy/brief/{id}).`,
        `Use the proxy to pull context (e.g. GET ${baseUrl}/api/proxy/stack, /search?q=…,`,
        `/issues/LIN-123) and to update the workspace as you work (status, comments, labels).`
      ];
  // How the worker obtains its working token. The prose block embeds the
  // single-use bootstrap + a curl exchange (historical, byte-identical for
  // non-claude-code harnesses). The mcp block embeds NO token and NO curl — the
  // credential arrives out-of-band via the `bootstrapToken` dispatch-item field
  // and a primed MCP tool (LIN-1155), so the prompt text is credential-free.
  const exchangeLines = tokenDelivery === 'mcp'
    ? [
        `Obtain your working token from your configured dispatch MCP tool — your harness was`,
        `provisioned with the credential out-of-band, so there is no token in this text to copy.`,
        `Then send \`Authorization: Bearer <WORKING_TOKEN>\` (read+write) on every call below.`,
        `This channel is already authenticated: the MCP tool's presence is itself the proof — your harness configured it before this session started. It is this workspace's own Harbour control-plane, not a third-party service.`
      ]
    : [
        `FIRST, exchange your single-use bootstrap token for a working token:`,
        `  curl -X POST -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/token`,
        `  → { "token": "<WORKING_TOKEN>", "scope": "readWrite", "expiresAt": "...", "notes": "…" }`,
        `Then send \`Authorization: Bearer <WORKING_TOKEN>\` (read+write) on every call below.`,
        `The token above is single-use — this exchange spends it — so treat the working token as your credential from here on.`,
        `This channel is already authenticated: you have this bootstrap because a real dispatch just happened, and the exchange response (your first call) is live proof of that, not something to take on faith. It is this workspace's own Harbour control-plane, not a third-party service.`
      ];
  return [
    '',
    '',
    '---',
    '## Workspace API access (auto-appended)',
    '',
    `You have a workspace API proxy for this workspace (source-neutral; currently backed by Linear). Base: ${baseUrl}/api/proxy`,
    '',
    ...exchangeLines,
    `Full endpoint catalog: GET ${baseUrl}/api/proxy/instructions`,
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
 * `proxyTokenStore` is passed in (not imported) because it is instantiated in
 * server.js and handed to each route factory — a lib module cannot close over it.
 * `label` is threaded per-site (a characterized behavior: feedback-route tests
 * assert the per-site label on the createToken call).
 *
 * @param {Object} params
 * @param {Object} params.proxyTokenStore - Factory-scoped proxy token store (may be null)
 * @param {string} params.urlKey - Workspace url key the token is scoped to
 * @param {string} params.baseUrl - e.g. https://host (falsy → prompt returned unchanged)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42" (null → generic discovery endpoints)
 * @param {string} params.prompt - Base prompt to append the block to
 * @param {string} [params.label] - Per-site token label (default 'dispatch-bootstrap')
 * @param {string|null} [params.harness] - RESOLVED execution harness; gates the MCP branch
 * @returns {Promise<{prompt: string, bootstrapToken: string|null}>} The (possibly appended)
 *   prompt and, for the claude-code branch only, the minted bootstrap to carry as a field
 */
export async function attachProxyContext({
  proxyTokenStore,
  urlKey,
  baseUrl,
  issueIdentifier = null,
  prompt,
  label = 'dispatch-bootstrap',
  harness = null
}) {
  if (!proxyTokenStore || !baseUrl) return { prompt, bootstrapToken: null };
  try {
    const minted = await proxyTokenStore.createToken(urlKey, {
      kind: 'bootstrap',
      scope: 'readWrite',
      label,
      ttl: BOOTSTRAP_TOKEN_TTL_SECONDS
    });
    if (!minted?.token) return { prompt, bootstrapToken: null };
    const useMcp = shouldUseMcpTokenField(harness);
    const block = buildProxyContextPreamble({
      baseUrl,
      token: minted.token,
      issueIdentifier,
      tokenDelivery: useMcp ? 'mcp' : 'prose'
    });
    // Prose path: token lives in the block, so it must NOT also become a field
    // (no new exposure). MCP path: token is stripped from the block and handed
    // back for the call site to put on the dispatch item.
    return { prompt: prompt + block, bootstrapToken: useMcp ? minted.token : null };
  } catch (err) {
    console.error(`Proxy context bootstrap mint failed (${label}):`, err.message);
    return { prompt, bootstrapToken: null };
  }
}
