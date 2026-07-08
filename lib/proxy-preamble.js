/**
 * Shared proxy-context preamble for dispatched prompts.
 *
 * Extracted from routes/proxy.js (LIN-733) so non-proxy dispatch seams — the
 * feedback-triage enqueue in routes/workspace-api.js — append the SAME
 * "Workspace API access" block as the proxy dispatch endpoints, byte-identical,
 * rather than re-typing the prose. One source of truth for the access block.
 */

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
