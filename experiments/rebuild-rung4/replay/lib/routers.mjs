// The three router slots: file name, factory export, deps builder, app
// variants (one app per optional-dep configuration), generator, and the
// planted mutants the self-check uses.
import { createWritesDeps, WRITES_VARIANTS, createRulingsDeps, RULINGS_VARIANTS, createTokensDeps, TOKENS_VARIANTS } from './fakes.mjs';
import * as genWrites from './gen-writes.mjs';
import * as genRulings from './gen-rulings.mjs';
import * as genTokens from './gen-tokens.mjs';

export const SLOTS = {
  writes: {
    file: 'proxy-writes.js',
    factory: 'createProxyWriteRoutes',
    variants: WRITES_VARIANTS,
    buildDeps: createWritesDeps,
    gen: genWrites,
    tags(sc, o) {
      const b = o.body || {};
      const t = [`intent:${sc.intent}`];
      if (b.deduped) t.push('deduped');
      if (b.code) t.push(`code:${b.code}`);
      if (o.calls.deps.some(d => d.fn === 'onTicketWrite')) t.push('onTicketWrite');
      return t;
    },
    mutants: [
      {
        id: 'a-status', what: 'status code: invalid relation type 400 -> 422',
        from: 'return badRequest.json(res, `type must be one of: ${validTypes.join(\', \')}`);',
        to: 'return jsonError(res, 422, `type must be one of: ${validTypes.join(\', \')}`);',
        expect: { kinds: ['status'], endpoints: ['POST /api/proxy/issues/:issueId/relations'] },
      },
      {
        id: 'b-field', what: 'dropped response field: comment dedupe hit loses `deduped: true`',
        from: 'return res.status(200).json({ ...prior, deduped: true });', to: 'return res.status(200).json({ ...prior });',
        expect: { kinds: ['body'], endpoints: ['POST /api/proxy/issues/:issueId/comments', 'POST /api/proxy/comments/:issueId'] },
      },
      {
        id: 'c-write-arg', what: 'write argument: add-label sends [new, ...current] instead of [...current, new]',
        from: 'provider.updateIssueLabels(token, issueId, [...currentLabelIds, resolvedLabelId])',
        to: 'provider.updateIssueLabels(token, issueId, [resolvedLabelId, ...currentLabelIds])',
        expect: { kinds: ['providerCalls'], endpoints: ['POST /api/proxy/issues/:issueId/labels'] },
      },
      {
        id: 'd-store-op', what: 'removed store op: comment create no longer calls commentDedupe.set',
        from: 'commentDedupe.set(key, commentCreate);', to: '',
        // a missing set() removes later dedupe hits too -> body/provider/ledger diffs on the same two forms
        expect: { kinds: ['store:commentDedupe'], endpoints: ['POST /api/proxy/issues/:issueId/comments', 'POST /api/proxy/comments/:issueId'] },
      },
    ],
  },
  rulings: {
    file: 'proxy-rulings.js',
    factory: 'createRulingsRoutes',
    variants: RULINGS_VARIANTS,
    buildDeps: createRulingsDeps,
    gen: genRulings,
    // outcome tags (reach evidence for the seeded loop world)
    tags(sc, o) {
      const b = o.body || {};
      const t = [];
      if (Array.isArray(b.rulings)) {
        t.push(b.rulings.length ? 'rows>0' : 'rows=0');
        for (const r of b.rulings) {
          if (r.resolution) t.push(`resolution:${r.resolution.outcome}`);
          if (r.suggestedDismissal) t.push(`suggested:${r.suggestedDismissal.proposedOutcome}`);
          t.push(`disposition:${r.disposition}`, `effect:${r.effect}`);
          if (r.anchor?.taskDecisionId) t.push('taskBound');
          if (r.shelvedLapseCount > 0) t.push('shelfLapsed');
        }
        if (/issueIdentifier=/.test(sc.path)) t.push('filtered');
      }
      if (b.code) t.push(`code:${b.code}`);
      return t;
    },
    mutants: [
      {
        id: 'a-status', what: 'status code: decisionLoopId miss 404 -> 410',
        from: "jsonError(res, 404, 'No unanswered ruling with that decisionId AND decisionLoopId in this workspace'",
        to: "jsonError(res, 410, 'No unanswered ruling with that decisionId AND decisionLoopId in this workspace'",
        expect: { kinds: ['status'], endpoints: ['POST /api/proxy/rulings/:decisionId/suggest-dismissal', 'POST /api/proxy/rulings/:decisionId/suggest-answer'] },
      },
      {
        id: 'b-field', what: 'dropped response field: GET /rulings loses `count`',
        from: 'count: filtered.length,', to: '',
        expect: { kinds: ['body'], endpoints: ['GET /api/proxy/rulings'] },
      },
      {
        id: 'c-write-arg', what: "write argument: suggest-answer stores proposedOutcome 'answer' instead of 'answered'",
        from: "proposedOutcome: 'answered',", to: "proposedOutcome: 'answer',",
        expect: { kinds: ['store:dismissalSuggestionsStore'], endpoints: ['POST /api/proxy/rulings/:decisionId/suggest-answer'] },
      },
      {
        id: 'd-store-op', what: 'removed store op: suggest-dismissal no longer clears sessionsFeedCache',
        from: "if (sessionsFeedCache) sessionsFeedCache.clear(req.proxyUrlKey);\n        logEvent(req, '/api/proxy/rulings/suggest-dismissal', 201);",
        to: "logEvent(req, '/api/proxy/rulings/suggest-dismissal', 201);",
        expect: { kinds: ['store:sessionsFeedCache'], endpoints: ['POST /api/proxy/rulings/:decisionId/suggest-dismissal'] },
      },
    ],
  },
  'tokens-admin': {
    file: 'proxy-tokens-admin.js',
    factory: 'createTokensAdminRoutes',
    variants: TOKENS_VARIANTS,
    buildDeps: createTokensDeps,
    gen: genTokens,
    tags(sc, o) {
      const b = o.body || {};
      const t = [];
      if (b.code) t.push(`code:${b.code}`);
      if (b.lifetimeProfile) t.push(`profile:${b.lifetimeProfile}`);
      if ('providerDisplayName' in b) t.push(`providerDisplayName:${b.providerDisplayName}`);
      return t;
    },
    mutants: [
      {
        id: 'a-status', what: 'status code: revoke of unknown token 404 -> 410',
        from: "return notFound.json(res, 'Token not found');", to: "return jsonError(res, 410, 'Token not found');",
        expect: { kinds: ['status'], endpoints: ['DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId'] },
      },
      {
        id: 'b-field', what: 'dropped response field: default mint loses `providerDisplayName`',
        from: '        providerDisplayName,\n        message: \'Token created.', to: '        message: \'Token created.',
        expect: { kinds: ['body'], endpoints: ['POST /workspace/:urlKey/api/proxy/tokens'] },
      },
      {
        id: 'c-write-arg', what: "write argument: createToken default scope 'read' -> 'readWrite'",
        from: "scope: scope || 'read',", to: "scope: scope || 'readWrite',",
        expect: { kinds: ['store:proxyTokenStore'], endpoints: ['POST /workspace/:urlKey/api/proxy/tokens'] },
      },
      {
        id: 'd-store-op', what: 'removed store op: credential-health no longer reads listCredentialHealth',
        from: 'const result = await proxyEventStore.listCredentialHealth(workspace.urlKey);', to: 'const result = { tokens: [] };',
        expect: { kinds: ['store:proxyEventStore'], endpoints: ['GET /workspace/:urlKey/api/proxy/credential-health'] },
      },
    ],
  },
};

export const SLOT_NAMES = Object.keys(SLOTS);
