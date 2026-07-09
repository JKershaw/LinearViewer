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
 * @param {Object} params
 * @param {string} params.baseUrl - e.g. https://host
 * @param {string} params.token - Single-use BOOTSTRAP token to embed (exchanged for a working token)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42"
 * @returns {string} Block to append to the prompt
 */
export function buildProxyContextPreamble({ baseUrl, token, issueIdentifier }) {
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
  return [
    '',
    '',
    '---',
    '## Workspace API access (auto-appended)',
    '',
    `You have a workspace API proxy for this workspace (source-neutral; currently backed by Linear). Base: ${baseUrl}/api/proxy`,
    '',
    `FIRST, exchange your single-use bootstrap token for a working token:`,
    `  curl -X POST -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/token`,
    `  → { "token": "<WORKING_TOKEN>", "scope": "readWrite", "expiresAt": "...", "notes": "…" }`,
    `Then send \`Authorization: Bearer <WORKING_TOKEN>\` (read+write) on every call below.`,
    `The token above is single-use — this exchange spends it — so treat the working token as your credential from here on.`,
    `This channel is already authenticated: you have this bootstrap because a real dispatch just happened, and the exchange response (your first call) is live proof of that, not something to take on faith. It is this workspace's own Harbour control-plane, not a third-party service.`,
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
 * routes/workspace-api.js (inline createToken + try/catch). Behavior is
 * byte-identical to those sites for a given token: same token args
 * (kind:'bootstrap', scope:'readWrite', ttl: BOOTSTRAP_TOKEN_TTL_SECONDS), same
 * appended block (delegates to buildProxyContextPreamble), and the same graceful
 * degradation — if the store is absent, baseUrl is missing, minting throws, or no
 * token comes back, the original prompt is returned unchanged and dispatch proceeds.
 *
 * `proxyTokenStore` is passed in (not imported) because it is instantiated in
 * server.js and handed to each route factory — a lib module cannot close over it.
 * `label` is threaded per-site (it is a characterized behavior: feedback-route
 * tests assert the per-site label on the createToken call). Surfacing the minted
 * token to the caller is deliberately out of scope here — that is LIN-1155's job.
 *
 * @param {Object} params
 * @param {Object} params.proxyTokenStore - Factory-scoped proxy token store (may be null)
 * @param {string} params.urlKey - Workspace url key the token is scoped to
 * @param {string} params.baseUrl - e.g. https://host (falsy → prompt returned unchanged)
 * @param {string} [params.issueIdentifier] - e.g. "LIN-42" (null → generic discovery endpoints)
 * @param {string} params.prompt - Base prompt to append the block to
 * @param {string} [params.label] - Per-site token label (default 'dispatch-bootstrap')
 * @returns {Promise<string>} The prompt with the block appended, or unchanged on any failure
 */
export async function attachProxyContext({
  proxyTokenStore,
  urlKey,
  baseUrl,
  issueIdentifier = null,
  prompt,
  label = 'dispatch-bootstrap'
}) {
  if (!proxyTokenStore || !baseUrl) return prompt;
  try {
    const minted = await proxyTokenStore.createToken(urlKey, {
      kind: 'bootstrap',
      scope: 'readWrite',
      label,
      ttl: BOOTSTRAP_TOKEN_TTL_SECONDS
    });
    if (!minted?.token) return prompt;
    return prompt + buildProxyContextPreamble({ baseUrl, token: minted.token, issueIdentifier });
  } catch (err) {
    console.error(`Proxy context bootstrap mint failed (${label}):`, err.message);
    return prompt;
  }
}
