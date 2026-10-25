#!/usr/bin/env node
// Self-check for the workspace-api replay: identity (old vs an independent
// copy) on two seeds with ≥95% line coverage and an AI-path floor pass, then
// 24 planted mutants, each expected on its own route only, then one vacuity
// witness (today's stale fakes must be refused, exit 3; LIN-3880).
//   node selfcheck.mjs [--n 3000] [--seeds 1,7] [--mutant-n 1500] [--jobs 4] [--lib DIR]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRouterSelfcheck } from '../../replay-kit/lib/router/selfcheck.mjs';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const F = 'workspace-api.js';
const W = (p) => `/workspace/:urlKey/api${p}`;
const MUTANTS = [
  { id: 'm01-egress', what: 'image proxy sends the workspace credential for every provider (LIN-1899 guard dropped)',
    from: 'const fetchHeaders = isActiveProviderLinear(workspace)', to: 'const fetchHeaders = true',
    expect: { kinds: ['egressFetch'], endpoints: [`GET ${W('/image')}`] } },
  { id: 'm02-attribution', what: "comment attribution 'via Harbour' → 'by Harbour'",
    from: '— Ruling recorded via Harbour', to: '— Ruling recorded by Harbour',
    expect: { kinds: ['depCalls', 'body'], endpoints: [`POST ${W('/comments/:issueId')}`] } },
  { id: 'm03-owner-gate', what: 'feedback triage/autopilot lane loses its owner gate (LIN-3383)',
    from: 'const laneRefusal = lane\n', to: 'const laneRefusal = false\n',
    expect: { kinds: ['body', 'depCalls', 'store:dispatchQueueStore', 'store:proxyTokenStore', 'store:workspacePreferencesStore', 'console', 'store:freeTierStore', 'store:accountStore'], endpoints: [`POST ${W('/feedback')}`] } },
  { id: 'm04-page-size', what: 'scan-due page size 40 → 39',
    from: 'limit: DUE_CHECK_PAGE_SIZE', to: 'limit: DUE_CHECK_PAGE_SIZE - 1',
    expect: { kinds: ['store:taskDecisionsStore'], endpoints: [`GET ${W('/scan-due')}`] } },
  { id: 'm05-order', what: 'sessions served oldest-first',
    from: '.map(toSessionView).reverse()', to: '.map(toSessionView)',
    expect: { kinds: ['body'], endpoints: [`GET ${W('/sessions/:identifier')}`] } },
  { id: 'm06-code', what: 'press 409 code renamed',
    from: "'CLOSE_OUT_ALREADY_MERGED'", to: "'CLOSE_OUT_MERGED'",
    expect: { kinds: ['body'], endpoints: [`POST ${W('/run-evidence/:issueIdentifier/close-out-press')}`] } },
  { id: 'm07-fire-and-forget', what: 'PATCH fires onTicketWrite on every write, not only state writes',
    from: 'if (onTicketWrite && stateId)', to: 'if (onTicketWrite)',
    expect: { kinds: ['depCalls', 'console'], endpoints: [`PATCH ${W('/issues/:issueId')}`] } },
  { id: 'm08-sse', what: "stream drops its 'fetching_context' phase event",
    from: "// Phase 1: Fetch context from Linear\n      sendSSE(res, 'phase', { phase: 'fetching_context' });", to: '// Phase 1: Fetch context from Linear',
    expect: { kinds: ['body', 'header-derived:content-length'], endpoints: [`GET ${W('/recommend/:issueId/stream')}`] } },
  { id: 'm09-capability', what: "audit 422 capability 'audit' → 'Audit'",
    from: "capability: 'audit',", to: "capability: 'Audit',",
    expect: { kinds: ['body'], endpoints: [`GET ${W('/audit')}`] } },
  { id: 'm10-free-clamp', what: 'recap POST free tier no longer clamped to the default model (LIN-513)',
    from: "opKind: 'recap', forceDefault: isFreeTier", to: "opKind: 'recap', forceDefault: false",
    expect: { kinds: ['store:workspacePreferencesStore', 'seamCalls', 'body'], endpoints: [`POST ${W('/recap/:issueId')}`] } },
  { id: 'm11-store-arg', what: 'retire stamps outcomeBasisHash null',
    from: 'outcomeBasisHash: inputHash', to: 'outcomeBasisHash: null',
    expect: { kinds: ['store:taskDecisionsStore', 'body'], endpoints: [`POST ${W('/scan/:issueId/retire')}`] } },
  { id: 'm12-header', what: "image Cache-Control 'private' → 'public'",
    from: "'private, max-age=3600'", to: "'public, max-age=3600'",
    expect: { kinds: ['header:cache-control'], endpoints: [`GET ${W('/image')}`] } },
  { id: 'm13-whitelist', what: "detail section whitelist drops 'recent-activity'",
    from: "'project', 'in-progress', 'recent-activity'", to: "'project', 'in-progress'",
    expect: { kinds: ['body', 'header-derived:content-length', 'header-derived:etag'], endpoints: [`GET ${W('/detail/:issueId')}`] } },
  { id: 'm14-stamp-arg', what: 'decision stamp drops the optionId argument',
    from: 'decisionId, undefined, optionId)', to: 'decisionId, undefined, undefined)',
    expect: { kinds: ['store:dispatchQueueStore'], endpoints: [`POST ${W('/comments/:issueId')}`] } },
  { id: 'm15-session', what: 'LIN-2933 recovery mirrors the adopted token without its expiry (session mutation)',
    from: 'applyAccessTokenToWorkspace(workspace, adopted.token, adopted.expiresAt)', to: 'applyAccessTokenToWorkspace(workspace, adopted.token, null)',
    expect: { kinds: ['session'], endpoints: [`POST ${W('/comments/:issueId')}`] } },
  // LIN-3880: the AI-path routes the vacuity hid. Each mutant changes one route's model
  // key, stamp or fail-closed arm; the replay must flag it on that route only.
  { id: 'm16-scan-model', what: 'scan POST resolves the recap model key instead of the scan key',
    from: "const inputHash = hashContext(context);\n      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'scan', forceDefault: isFreeTier });\n\n      let scanResult;",
    to: "const inputHash = hashContext(context);\n      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recap', forceDefault: isFreeTier });\n\n      let scanResult;",
    expect: { kinds: ['seamCalls', 'body'], endpoints: [`POST ${W('/scan/:issueId')}`] } },
  { id: 'm17-scan-stamp', what: 'scan POST drops the inputHash stamp from its recordScan row',
    from: "        issueIdentifier: context.issue?.identifier || issueId,\n        inputHash,\n",
    to: "        issueIdentifier: context.issue?.identifier || issueId,\n",
    expect: { kinds: ['store:taskDecisionsStore'], endpoints: [`POST ${W('/scan/:issueId')}`] } },
  { id: 'm18-scan-p0-arm', what: 'scan POST fail-closed arm code renamed (PRINCIPLE_ZERO_UNAVAILABLE)',
    from: "\n        return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {\n          code: 'PRINCIPLE_ZERO_UNAVAILABLE'",
    to: "\n        return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {\n          code: 'PRINCIPLE_ZERO_OFF'",
    expect: { kinds: ['body'], endpoints: [`POST ${W('/scan/:issueId')}`] } },
  { id: 'm19-retire-p0-arm', what: 'retire fail-closed arm code renamed (PRINCIPLE_ZERO_UNAVAILABLE)',
    from: "\n          return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {\n            code: 'PRINCIPLE_ZERO_UNAVAILABLE'",
    to: "\n          return keepaliveError(keepalive, 503, 'Scan rubric is temporarily unavailable; nothing was evaluated', {\n            code: 'PRINCIPLE_ZERO_OFF'",
    expect: { kinds: ['body'], endpoints: [`POST ${W('/scan/:issueId/retire')}`] } },
  { id: 'm20-brief-model', what: 'brief POST resolves the recap model key instead of the brief key',
    from: "opKind: 'brief', forceDefault: isFreeTier",
    to: "opKind: 'recap', forceDefault: isFreeTier",
    expect: { kinds: ['seamCalls', 'body'], endpoints: [`POST ${W('/brief/:issueId')}`] } },
  { id: 'm21-recommend-model', what: 'GET recommend (JSON) resolves the brief model key instead of the recommend key',
    from: "      // (above, before this point), not per hop.\n      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier })",
    to: "      // (above, before this point), not per hop.\n      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'brief', forceDefault: isFreeTier })",
    expect: { kinds: ['seamCalls', 'body'], endpoints: [`GET ${W('/recommend/:issueId')}`] } },
  { id: 'm22-recap-unconfigured', what: 'recap not-configured arm code renamed (AI_NOT_CONFIGURED)',
    from: "'AI recap is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_NOT_CONFIGURED' }",
    to: "'AI recap is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_RECAP_OFF' }",
    expect: { kinds: ['body'], endpoints: [`POST ${W('/recap/:issueId')}`] } },
  { id: 'm23-brief-unconfigured', what: 'brief not-configured arm code renamed (AI_NOT_CONFIGURED)',
    from: "'AI brief is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_NOT_CONFIGURED' }",
    to: "'AI brief is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_BRIEF_OFF' }",
    expect: { kinds: ['body'], endpoints: [`POST ${W('/brief/:issueId')}`] } },
  { id: 'm24-scan-unconfigured', what: 'scan POST not-configured arm code renamed (AI_NOT_CONFIGURED)',
    from: "'AI scan is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_NOT_CONFIGURED' });\n    }\n\n    if (!mockAi && isFreeTier) {",
    to: "'AI scan is not configured. Connect OpenRouter or set OPENROUTER_API_KEY.', { code: 'AI_SCAN_OFF' });\n    }\n\n    if (!mockAi && isFreeTier) {",
    expect: { kinds: ['body'], endpoints: [`POST ${W('/scan/:issueId')}`] } },
].map(m => ({ file: F, ...m }));

// LIN-3880: today's kit (REPLAY_STALE_FAKES=1) reports no difference, and the AI-path floor must refuse it.
const WITNESSES = [
  { id: 'w1-vacuity-stale-fakes', what: 'stale fakes (REPLAY_STALE_FAKES=1): 0 differing, refused by the AI-path floor (exit 3)', env: { REPLAY_STALE_FAKES: '1' }, expectExit: 3 },
];

process.exit(await runRouterSelfcheck({ toolDir: TOOL, base: path.join(TOOL, 'pinned', 'origin-main'), mutants: MUTANTS, witnesses: WITNESSES }));
