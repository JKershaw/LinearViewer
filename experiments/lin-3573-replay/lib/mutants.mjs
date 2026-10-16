// Gate 2: planted mutants. Each is a source transform applied to the BASE router text for the
// "new" slot of an old-vs-mutant replay; the replay must read red on it (or, for the one
// declared-equivalent control, must stay at zero differences).
function sub(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutant site "${label}" must occur exactly once in the base file, found ${n}`);
  return src.replace(from, to);
}
function subFirst(src, from, to, label) {
  if (!src.includes(from)) throw new Error(`mutant site "${label}" not found`);
  return src.replace(from, to);
}

const REFUSE_COMMENT = "if (await refuseIfTrashed(provider, token, issueId, req, res, '/api/proxy/issues/comments')) return;";
const REFUSE_ATTACH = 'if (await refuseIfTrashed(provider, token, issueId, req, res, endpoint)) return;';

export const MUTANTS = [
  { id: 'drop-skipWitness', file: 'writes', expect: 'red', origin: 'research', forms: ['W_COMMENT_NESTED', 'W_COMMENT_FLAT'],
    what: 'dedupe-hit logEvent loses { skipWitness: true }',
    apply: (s) => sub(s, "logEvent(req, '/api/proxy/issues/comments', 200, null, { skipWitness: true });", "logEvent(req, '/api/proxy/issues/comments', 200, null);", 'skipWitness') },
  { id: 'five-part-dedupe-key', file: 'writes', expect: 'red', origin: 'research', forms: ['W_COMMENT_NESTED', 'W_COMMENT_FLAT'],
    what: 'dedupe key gains a 5th part (token label)',
    apply: (s) => sub(s, 'dedupeKey(req.proxyUrlKey, issueId, body, commentDedupeGenerations.current(req.proxyUrlKey))', 'dedupeKey(req.proxyUrlKey, issueId, body, commentDedupeGenerations.current(req.proxyUrlKey), req.proxyTokenLabel)', 'dedupe key') },
  { id: 'trashed-after-dedupe', file: 'writes', expect: 'red', origin: 'research', forms: ['W_COMMENT_NESTED', 'W_COMMENT_FLAT'],
    what: 'comment create checks trashed after the dedupe lookup',
    apply: (s) => { const t = sub(s, `      ${REFUSE_COMMENT}\n`, '', 'trashed line'); return sub(t, "      const commentCreate = normalizeWritePayload(await provider.createComment(token, issueId, body), 'comment');\n\n      // Surface", `      ${REFUSE_COMMENT}\n      const commentCreate = normalizeWritePayload(await provider.createComment(token, issueId, body), 'comment');\n\n      // Surface`, 'create anchor'); } },
  { id: 'upload-before-trashed', file: 'writes', expect: 'red', origin: 'research', forms: ['W_ATTACH'],
    what: 'attachments upload the file before the trashed check',
    apply: (s) => { const t = sub(s, `      ${REFUSE_ATTACH}\n`, '', 'attach trashed'); return sub(t, "      const markdown = `![](${assetUrl})`;", `      ${REFUSE_ATTACH}\n      const markdown = \`![](\${assetUrl})\`;`, 'markdown anchor'); } },
  { id: 'no-generation-bump-on-delete', file: 'writes', expect: 'red', origin: 'research', forms: ['W_COMMENT_NESTED', 'W_COMMENT_FLAT', 'W_COMMENT_DELETE'],
    what: 'comment delete no longer bumps the dedupe generation',
    apply: (s) => sub(s, "      commentDedupeGenerations.bump(req.proxyUrlKey);\n      logEvent(req, '/api/proxy/issues/comments', 200);\n      res.json(commentDelete);", "      logEvent(req, '/api/proxy/issues/comments', 200);\n      res.json(commentDelete);", 'delete bump') },
  { id: 'no-generation-bump-on-edit', file: 'writes', expect: 'red', origin: 'research', forms: ['W_COMMENT_NESTED', 'W_COMMENT_FLAT', 'W_COMMENT_PATCH'],
    what: 'comment edit no longer bumps the dedupe generation',
    apply: (s) => sub(s, "      commentDedupeGenerations.bump(req.proxyUrlKey);\n      logEvent(req, '/api/proxy/issues/comments', 200);\n      res.status(200).json(commentUpdate);", "      logEvent(req, '/api/proxy/issues/comments', 200);\n      res.status(200).json(commentUpdate);", 'edit bump') },
  { id: 'onTicketWrite-before-response', file: 'writes', expect: 'red', origin: 'research', forms: ['W_ISSUE_PATCH'],
    what: 'PATCH awaits onTicketWrite before responding (a rejecting closer now changes the response)',
    apply: (s) => sub(s, `      res.json(issueUpdate);
      // Seam 1 (LIN-3366): a state write may have made the ticket terminal.
      if (onTicketWrite && input.stateId) {
        void Promise.resolve()
          .then(() => onTicketWrite({ urlKey: req.proxyUrlKey, written: issueUpdate.issue, readBack: () => provider.fetchIssueContext(token, issueId) }))
          .catch(e => console.error('[ticket-closer] seam 1 failure:', e?.message || e));
      }`, `      if (onTicketWrite && input.stateId) {
        await onTicketWrite({ urlKey: req.proxyUrlKey, written: issueUpdate.issue, readBack: () => provider.fetchIssueContext(token, issueId) });
      }
      res.json(issueUpdate);`, 'seam 1') },
  { id: 'drop-source-on-PATCH', file: 'writes', expect: 'red', origin: 'research+amendment', forms: ['W_ISSUE_PATCH'],
    what: 'PATCH /issues/:id stops forwarding { source } to resolveProviderAccess (amendment: must read red)',
    apply: (s) => sub(s, "router.patch('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {\n    try {\n      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source: req.query?.source });", "router.patch('/api/proxy/issues/:issueId', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {\n    try {\n      const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);", 'patch source') },
  { id: 'pass-source-on-POST-issues', file: 'writes', expect: 'red', origin: 'amendment', forms: ['W_ISSUE_CREATE'],
    what: 'POST /issues starts forwarding { source } (it must stay ignored)',
    apply: (s) => sub(s, "const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);\n      if (!token) {\n        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);", "const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source: req.query?.source });\n      if (!token) {\n        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);", 'post source') },
  { id: 'attachments-target-check-before-resolve', file: 'writes', expect: 'red', origin: 'amendment', forms: ['W_ATTACH'],
    what: 'attachments validates `target` before resolving the provider (a bad target now beats a 503 / capability refusal)',
    apply: (s) => sub(s, "    const endpoint = '/api/proxy/issues/:id/attachments';\n    try {\n", "    const endpoint = '/api/proxy/issues/:id/attachments';\n    try {\n      { const t = (req.body || {}).target; if (t !== undefined && t !== 'comment' && t !== 'description') { logEvent(req, endpoint, 400); return badRequest.json(res, 'target must be \"comment\" or \"description\"'); } }\n", 'attach top') },
  { id: 'drop-periodical-report-gate', file: 'writes', expect: 'red', origin: 'amendment', forms: ['W_ISSUE_PATCH'],
    what: 'PATCH never refuses a periodical task on the report gate',
    apply: (s) => sub(s, 'if (gateResult.applies && !gateResult.ok) {', 'if (false) {', 'gate') },
  { id: 'label-add-noop-writes', file: 'writes', expect: 'red', origin: 'amendment', forms: ['W_LABEL_ADD'],
    what: 'adding an already-present label writes instead of returning the 200 no-op',
    apply: (s) => sub(s, "      if (currentLabelIds.includes(resolvedLabelId)) {\n        logEvent(req, '/api/proxy/issues/labels', 200);\n        return res.json({ success: true, message: 'Label already present' });\n      }\n", '', 'label add noop') },
  { id: 'label-remove-noop-writes', file: 'writes', expect: 'red', origin: 'amendment', forms: ['W_LABEL_REMOVE'],
    what: 'removing an absent label writes instead of returning the 200 no-op',
    apply: (s) => sub(s, "      if (filtered.length === currentLabelIds.length) {\n        logEvent(req, '/api/proxy/issues/labels', 200);\n        return res.json({ success: true, message: 'Label not present' });\n      }\n", '', 'label remove noop') },
  { id: 'unlogged-400-now-logged', file: 'writes', expect: 'red', origin: 'research', forms: ['W_COMMENT_NESTED', 'W_COMMENT_FLAT'],
    what: 'comment create invalid-issueId 400 (unlogged today) is now logged',
    apply: (s) => subFirst(s, "if (!isValidIssueId(issueId)) {\n        return badRequest.json(res, 'Invalid issue ID format');", "if (!isValidIssueId(issueId)) {\n        logEvent(req, '/api/proxy/issues/comments', 400);\n        return badRequest.json(res, 'Invalid issue ID format');", 'unlogged 400') },
  { id: 'endpoint-string-change', file: 'writes', expect: 'red', origin: 'research', forms: ['W_REL_CREATE'],
    what: "relation create logs '/api/proxy/issues/relation' (typo) on success",
    apply: (s) => sub(s, "logEvent(req, '/api/proxy/issues/relations', 201);", "logEvent(req, '/api/proxy/issues/relation', 201);", 'endpoint') },
  { id: 'missing-cache-clear-dismissal', file: 'rulings', expect: 'red', origin: 'research', forms: ['R_DISMISS'],
    what: 'suggest-dismissal no longer clears the sessions feed cache',
    apply: (s) => subFirst(s, "        if (sessionsFeedCache) sessionsFeedCache.clear(req.proxyUrlKey);\n        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 201);", "        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 201);", 'clear dismissal') },
  { id: 'missing-cache-clear-answer', file: 'rulings', expect: 'red', origin: 'research', forms: ['R_ANSWER'],
    what: 'suggest-answer no longer clears the sessions feed cache',
    apply: (s) => sub(s, "        if (sessionsFeedCache) sessionsFeedCache.clear(req.proxyUrlKey);\n        logEvent(req, routeLabel, 201);", "        logEvent(req, routeLabel, 201);", 'clear answer') },
  { id: 'includeResolved-truthy', file: 'rulings', expect: 'red', origin: 'research', forms: ['R_GET'],
    what: "includeResolved is truthy instead of === 'true'",
    apply: (s) => sub(s, "req.query.includeResolved === 'true'", '!!req.query.includeResolved', 'includeResolved') },
  { id: 'cache-namespace', file: 'rulings', expect: 'red', origin: 'research', forms: ['R_GET', 'R_DISMISS', 'R_ANSWER'],
    what: "sessionsFeedCache namespace 'rulings' instead of 'proxy-rulings'",
    apply: (s) => sub(s, "sessionsFeedCache.keyFor([{ urlKey }], 'proxy-rulings')", "sessionsFeedCache.keyFor([{ urlKey }], 'rulings')", 'namespace') },
  { id: 'route-trims-reason', file: 'rulings', expect: 'red', origin: 'research', forms: ['R_DISMISS'],
    what: 'suggest-dismissal trims the reason before the store call',
    apply: (s) => subFirst(s, "          decisionLoopId: decisionLoopId || undefined,\n          reason,\n          suggestedBy\n", "          decisionLoopId: decisionLoopId || undefined,\n          reason: reason.trim(),\n          suggestedBy\n", 'trim reason') },
  { id: '503-after-lookup', file: 'rulings', expect: 'red', origin: 'research', forms: ['R_DISMISS'],
    what: 'suggest-dismissal checks the store (503) after the ruling lookup instead of before',
    apply: (s) => { const t = subFirst(s, "      if (!dismissalSuggestionsStore) {\n        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 503);\n        return jsonError(res, 503, 'Dismissal-suggestions store not configured');\n      }\n", '', '503 block'); return subFirst(t, "        if (!row) return; // resolveTargetRuling already sent the 404\n", "        if (!row) return; // resolveTargetRuling already sent the 404\n        if (!dismissalSuggestionsStore) {\n          logEvent(req, '/api/proxy/rulings/suggest-dismissal', 503);\n          return jsonError(res, 503, 'Dismissal-suggestions store not configured');\n        }\n", '503 anchor'); } },
  // The one control that must NOT read red: `{ source: undefined }` and no 4th argument are the same call.
  { id: 'equivalent-POST-issues-source-undefined', file: 'writes', expect: 'equivalent', origin: 'control', forms: [],
    what: 'POST /issues passes { source: undefined } (identical to passing nothing: resolveProviderAccess destructures it either way)',
    apply: (s) => sub(s, "const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req);\n      if (!token) {\n        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);", "const { token, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source: undefined });\n      if (!token) {\n        return workspaceUnavailable(req, res, '/api/proxy/issues', reason);", 'equiv') },
];
