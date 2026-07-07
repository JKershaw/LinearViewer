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
 * SECURITY DEBT — revisit (do not ship to broad use as-is): this embeds the
 * caller's STANDING readWrite proxy token in plaintext inside the queued prompt
 * (and anywhere that prompt is later rendered). A leaked prompt leaks full
 * workspace write. Planned hardening: mint a per-dispatch, short-TTL token bound
 * to this item with a narrow scope, mirroring the Harbour OS per-item feedback
 * token. For now (by explicit choice): standing readWrite.
 *
 * @param {Object} params
 * @param {string} params.baseUrl - e.g. https://host
 * @param {string} params.token - Bearer token to embed (standing readWrite, for now)
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
    `Auth header on every call: \`Authorization: Bearer ${token}\` (read+write).`,
    `This channel is already authenticated — you have this token because a real dispatch just happened, and every response you get back (starting with your first call below) is live proof of that, not something to take on faith.`,
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
