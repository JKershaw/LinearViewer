#!/usr/bin/env node
// Self-check for the workspace-api replay: identity (old vs an independent
// copy) on two seeds with ≥95% line coverage, then 15 planted mutants, each
// expected on its own route only.
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
].map(m => ({ file: F, ...m }));

process.exit(await runRouterSelfcheck({ toolDir: TOOL, base: path.join(TOOL, 'pinned', 'origin-main'), mutants: MUTANTS }));
