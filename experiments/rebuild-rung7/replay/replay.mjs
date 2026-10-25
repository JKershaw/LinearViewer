#!/usr/bin/env node
// Behavioural replay of two versions of routes/workspace-api.js
// (createWorkspaceApiRoutes + its exported helpers). See README.md.
//
//   node replay.mjs --old <dirOrFile> --new <dirOrFile> [--n 3000] [--seed 1] [--out f]
//                   [--coverage] [--lib DIR] [--tiers gen,edge,test] [--only <id>] [--quiet]
//                   [--ai-floor fail|warn|off]   (default fail: exit 3 when the AI path was not exercised)
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runRouterReplay } from '../../replay-kit/lib/router/harness.mjs';
import { setStateGetter, snap } from '../../replay-kit/lib/router/common.mjs';
import * as fakes from './lib/fakes.mjs';
import * as gen from './lib/gen.mjs';
import * as edge from './lib/edge.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(TOOL_DIR, '../../replay-kit/snapshots/16e7ae77');

await runRouterReplay({
  name: 'workspace-api router behavioural replay (rung 7)',
  toolDir: TOOL_DIR,
  defaultOld: path.join(TOOL_DIR, 'pinned', 'origin-main'),
  defaultLib: SNAPSHOT,
  fallbackRoot: '/home/user/LinearViewer',
  defaultN: 3000,
  subdir: 'routes',
  slots: { main: { file: 'workspace-api.js', factory: 'createWorkspaceApiRoutes' } },
  seams: {
    'lib/openrouter.js': ['getRecommendation', 'getRecommendationStream', 'streamChat', 'streamChatWithTools'],
    'lib/audit.js': ['runAudit'],
    'lib/prompts/autopilot-manual.js': ['extractPrincipleZeroSection'],
  },
  scrubEnv: ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY', 'FEEDBACK_TEAM_ID', 'FEEDBACK_PROJECT_ID', 'MONGODB_URI', 'LINEAR_API_KEY', 'LINEAR_ACCESS_TOKEN', 'GITHUB_TOKEN', 'OPENROUTER_MODEL', 'FREE_TIER_RUN_LIMIT'],
  managedEnv: ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY', 'FEEDBACK_TEAM_ID', 'FEEDBACK_PROJECT_ID'],
  variants: fakes.VARIANTS,
  loadSideLibs: fakes.loadSideLibs,
  onSideLibs: (holder, libs) => fakes.patchRegistry(holder, libs),
  seamHandler: fakes.seamHandler,
  aiCounters: (sc, o) => fakes.aiCountersFor(sc, o),
  aiFloors: fakes.AI_FLOORS,
  fetchHandler: (ctx, entry) => fakes.fetchHandler(ctx, entry),
  describeFetchHeaders: fakes.describeFetchHeaders,
  async loadVocabulary({ libUrl }) {
    const pt = await import(libUrl('lib/prompt-templates.js'));
    const md = await import(libUrl('lib/sample-data/mock-data.js'));
    return { TEMPLATE_KEYS: Object.keys(pt.PROMPT_TEMPLATES), mockIds: md.testMockData.issues.map(i => i.id), mockIssue: JSON.parse(JSON.stringify(md.testMockData.issues[1])) };
  },
  buildRouters({ holder, libs, imported, variant }) {
    const mem = { items: [] };
    const deps = fakes.buildDeps(holder, libs, variant, mem);
    return [imported.main.factory(deps)];
  },
  globalMiddleware({ express, holder }) {
    return [
      express.urlencoded({ extended: false }),
      express.json({ limit: '250kb' }),
      (req, res, next) => {
        req.session = fakes.buildSession(holder, holder.ctx?.sc.session);
        holder.ctx.sessionObj = req.session;
        // models an upstream middleware stamping proxy-token identity (the
        // close-out routes refuse it); never set by server.js on this lane
        if (holder.ctx?.sc.reqFlags) Object.assign(req, holder.ctx.sc.reqFlags);
        next();
      },
    ];
  },
  // Transcription of server.js's final error handler (origin/main :4457). HTML pages stubbed.
  finalErrorHandler({ holder, libs, normalise }) {
    const e = libs.errors;
    // eslint-disable-next-line no-unused-vars
    return (err, req, res, next) => {
      holder.ctx?.rec.expressErrors.push({ name: err?.name, message: normalise(String(err?.message)), status: err?.status ?? err?.statusCode, type: err?.type });
      if (res.headersSent) return next(err);
      const wantsJson = req.path.includes('/api/') || req.xhr || (req.headers.accept || '').includes('application/json');
      const clientStatus = e.clientErrorStatus(err);
      if (clientStatus !== null) {
        console.warn('Client request error:', req.method, req.originalUrl, '-', clientStatus, err?.type || err?.message);
        const message = e.clientErrorMessage(clientStatus, err);
        if (wantsJson) e.jsonError(res, clientStatus, message);
        else res.status(clientStatus).send(`<!doctype html><title>stub:error-page</title>${message}`);
        return;
      }
      console.error('Unhandled route error:', req.method, req.originalUrl, '-', `${err?.name}: ${err?.message}`);
      if (wantsJson) e.serverError.json(res, 'Internal server error');
      else res.status(500).send('<!doctype html><title>stub:error-page</title>');
    };
  },
  beforeRequest(ctx) { setStateGetter(() => ctx.state); },
  afterRequest(ctx) {
    // session mutations: the final session data (functions dropped), compared as kind `session`
    const s = ctx.sessionObj;
    ctx.rec.session = s ? snap(JSON.parse(JSON.stringify(s))) : null;
    if (ctx.rec.session && JSON.stringify(ctx.rec.session) === JSON.stringify(snap(JSON.parse(JSON.stringify(ctx.sc.session || {}))))) ctx.rec.session = '<unchanged>';
  },
  *scenarios({ opts, K, toolDir }) {
    const tiers = opts.tiers.split(',').map(s => s.trim());
    if (tiers.includes('gen')) {
      const sched = gen.schedule(opts.seed, opts.n);
      for (let i = 0; i < sched.length; i++) yield () => gen.generateScenario(opts.seed, i, K, sched[i]);
    }
    if (tiers.includes('edge')) for (const sc of edge.edgeScenarios(opts.seed, K)) yield () => sc;
    if (tiers.includes('test')) for (const sc of edge.testScenarios(opts.seed, K, path.join(toolDir, 'pinned', 'test-calls.json'))) yield () => sc;
  },
  statusKey(sc, o, s) {
    const b = o.body || {};
    const code = typeof b.code === 'string' ? ` ${b.code}` : '';
    const flushed = b.statusCode ? ` (flushed ${b.statusCode})` : '';
    const sse = b.__sse ? ` sse:${b.__sse.map(e => e.event).filter(Boolean).slice(-1)[0] || '-'}` : '';
    return `${s}${code}${flushed}${sse}`;
  },
  outcomeTags(sc, o) {
    const t = [`variant:${sc.variant ?? '-'}`, `ws:${sc.wsKey ?? '-'}`];
    if (sc.intent) t.push(`intent:${sc.intent}`);
    if (o.calls.store?.some(s => s.op === 'addItem')) t.push('enqueued');
    if (o.calls.seams?.length) t.push(`seam:${[...new Set(o.calls.seams.map(x => x.seam))].join('+')}`);
    if (o.calls.fetch?.length) t.push('fetch');
    if (o.calls.session && o.calls.session !== '<unchanged>') t.push('sessionMutated');
    if (o.calls.deps?.some(d => d.fn === 'client.abort')) t.push('clientGone');
    return t;
  },
});
