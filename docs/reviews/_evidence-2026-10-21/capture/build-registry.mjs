/**
 * LIN-3748 beat 1: build registry.json from the LIVE route grep (never from ticket prose).
 *
 *   node docs/reviews/_evidence-2026-10-21/capture/build-registry.mjs   (repo root)
 *
 * Sources, all re-derived at run time at the checked-out HEAD:
 *   - page GET handlers:  git grep over server.js + routes/*.js + the provider basePath
 *     routers (lib/github-install-flow.js), excluding /api/, /test/, assets, raw .md,
 *     /health, sitemap/robots, library figures, runner-kit, /t/:token/state
 *   - archives:           ls docs/archive (+ /archive/999 for the 404)
 *   - experimental views: EXPERIMENTAL_VIEWS (lib/feature-defaults.js)
 *   - renderers:          git grep -P "^export (async )?function render\w*Page\b"
 *   - library documents:  loadLibrary catalog, enumerated at census time (id prefix library-doc:)
 * The SAME grep runs at the prior review's grounding sha (6e8bf424) to split carried vs new.
 *
 * A route that the grep finds but the CURATED table does not know is written as
 * `excluded:unmapped-route` and counted in `differences`, so a new route can never
 * silently drop out of the census (plan: "report any difference, never trim it").
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTAL_VIEWS } from '../../../../lib/feature-defaults.js';
import { RENDERERS, STATES } from './renderer-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..');
const PRIOR = '6e8bf424';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
// grounding commit = where this branch left origin/main (the branch only adds evidence files, so HEAD would name the checkpoint, not the code surveyed)
const GROUND = git('merge-base', 'HEAD', 'origin/main').trim().slice(0, 8);

// ---- seeds -----------------------------------------------------------------
const FEATURES = encodeURIComponent(JSON.stringify({
  dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true,
  nextRun: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true,
  liveConsole: true, shipJourney: true, feedbackWidget: true,
}));
const SEEDS = {
  none: null,
  app: `/test/set-session?features=${FEATURES}`,
  github: '/test/set-github-session',
  ghp: '/test/set-github-projects-session',
  jira: '/test/set-jira-session',
  local: '/test/set-local-session',
};
const W = '/workspace/test-workspace';

// ---- route discovery ---------------------------------------------------------
const FILES = ['server.js', ...readdirSync('routes').filter(f => f.endsWith('.js') && f !== 'test.js').map(f => `routes/${f}`)];
function discover(rev) {
  const found = new Set();
  const show = f => { try { return rev ? git('show', `${rev}:${f}`) : git('show', `HEAD:${f}`); } catch { return ''; } };
  for (const f of FILES) {
    for (const line of show(f).split('\n')) {
      const m = line.match(/\b(?:app|router)\.get\(\s*'(\/[^']*)'/);
      if (m) found.add(m[1]);
    }
  }
  // provider routers: basePath + `${basePath}/callback`
  for (const f of ['routes/github-auth.js', 'routes/github-projects-auth.js']) {
    const m = show(f).match(/basePath:\s*'([^']+)'/);
    if (m) { found.add(m[1]); found.add(`${m[1]}/callback`); }
  }
  return found;
}
const NOT_PAGES = (p) => /^\/(api|test)\b|\/api\/|\.md$|\.md\)|^\/health$|^\/sitemap\.xml$|^\/robots\.txt$|^\/library\/figures\/|^\/runner-kit\/|^\/t\/:token\/state$/.test(p) || /:slug\.md$/.test(p);

// ---- curated route table (pattern -> how to render it) -------------------------
// kind: page (renders HTML for the visitor) | hop (redirect / OAuth hop: recorded, no sweep target)
const R = (id, kind, o = {}) => ({ id, kind, seed: 'app', theme: 'cookie', ...o });
const CURATED = {
  '/': R('landing', 'page', { seed: 'none', theme: 'media', path: '/', standalone: true }),
  '/swipe/:identifier?': R('swipe-public', 'page', { seed: 'none', theme: 'media', path: '/swipe', standalone: true }),
  '/swim': R('swim-public', 'page', { seed: 'none', theme: 'media', path: '/swim', standalone: true }),
  '/ship': R('ship-public', 'page', { seed: 'none', theme: 'media', path: '/ship', standalone: true }),
  '/privacy': R('privacy', 'page', { seed: 'none', theme: 'media', path: '/privacy', standalone: true }),
  '/terms': R('terms', 'page', { seed: 'none', theme: 'media', path: '/terms', standalone: true }),
  '/styleguide': R('styleguide', 'page', { seed: 'none', theme: 'media', path: '/styleguide', standalone: true }),
  '/templates': R('templates', 'page', { seed: 'none', theme: 'media', path: '/templates', standalone: true }),
  '/kpis': R('kpis-public', 'page', { seed: 'none', theme: 'media', path: '/kpis', standalone: true, isNew: true }),
  '/archive/:n(\\\\d+)': R('archive', 'page', { seed: 'none', theme: 'media', path: '/archive/1', standalone: true, expand: 'archives' }),
  '/library': R('library-index', 'page', { seed: 'none', theme: 'media', path: '/library', standalone: true }),
  '/library/:slug': R('library-paper', 'page', { seed: 'none', theme: 'media', path: '/library/@paper', standalone: true, expand: 'library' }),
  '/library/doc/:slug': R('library-doc', 'page', { seed: 'none', theme: 'media', path: '/library/doc/@doc', standalone: true, expand: 'library' }),
  '/t/:token': R('guest-share', 'page', { seed: 'none', theme: 'media', path: '/t/not-a-real-token', note: 'unknown-token 404 body; live mint/revoke states are beat 2', standalone: true }),
  '/auth/email': R('email-signin', 'page', { seed: 'none', theme: 'media', path: '/auth/email', standalone: true }),
  '/auth/email/register': R('email-register', 'page', { seed: 'none', theme: 'media', path: '/auth/email/register', standalone: true }),
  '/auth/email/reproof': R('email-reproof', 'page', { seed: 'none', theme: 'media', path: '/auth/email/reproof', standalone: true }),
  '/auth/email/confirm': R('email-confirm', 'page', { seed: 'none', theme: 'media', path: '/auth/email/confirm', standalone: true, note: 'no token: renders the expired/invalid body' }),
  '/account': R('account', 'page', { seed: 'none', theme: 'media', path: '/account', standalone: true, note: 'signed-out: expect redirect; signed-in via /test/session-account is beat 2' }),
  '/connect/:provider/held': R('held-connection', 'page', { seed: 'none', theme: 'media', path: '/connect/github/held', standalone: true, note: 'no heldEntry: session-expired body' }),
  '/auth/openrouter': R('openrouter-consent', 'hop', { path: '/auth/openrouter', seed: 'app' }),
  '/auth/openrouter/callback': R('openrouter-callback', 'hop', { path: '/auth/openrouter/callback' }),
  '/auth/linear': R('auth-linear', 'hop', { path: '/auth/linear' }),
  '/auth/callback': R('auth-callback', 'hop', { path: '/auth/callback' }),
  '/logout': R('logout', 'hop', { path: '/logout' }),
  '/auth/jira': R('auth-jira-form', 'page', { seed: 'none', theme: 'media', path: '/auth/jira', standalone: true }),
  '/auth/jira/oauth': R('auth-jira-oauth', 'hop', { path: '/auth/jira/oauth' }),
  '/auth/jira/oauth/callback': R('auth-jira-oauth-callback', 'hop', { path: '/auth/jira/oauth/callback' }),
  '/auth/github': R('auth-github', 'hop', { path: '/auth/github' }),
  '/auth/github/callback': R('auth-github-callback', 'hop', { path: '/auth/github/callback' }),
  '/auth/github-projects': R('auth-github-projects', 'hop', { path: '/auth/github-projects' }),
  '/auth/github-projects/callback': R('auth-github-projects-callback', 'hop', { path: '/auth/github-projects/callback' }),
  '/audit': R('legacy-audit', 'hop', { legacy: true, path: '/audit', note: 'legacy redirect' }),
  '/settings': R('legacy-settings', 'hop', { legacy: true, path: '/settings', note: 'legacy redirect' }),
  '/prompts': R('legacy-prompts', 'hop', { legacy: true, path: '/prompts', note: 'legacy redirect' }),
  '/workspace/:urlKey/': R('ws-tree', 'page', { path: `${W}/` }),
  '/workspace/:urlKey/swipe/:identifier?': R('ws-swipe', 'page', { path: `${W}/swipe` }),
  '/workspace/:urlKey/swim': R('ws-swim', 'page', { path: `${W}/swim` }),
  '/workspace/:urlKey/ship': R('ws-ship', 'page', { path: `${W}/ship`, experimental: 'ship' }),
  '/workspace/:urlKey/roadmap': R('ws-roadmap', 'page', { path: `${W}/roadmap` }),
  '/workspace/:urlKey/audit': R('ws-audit', 'page', { path: `${W}/audit` }),
  '/workspace/:urlKey/settings': R('ws-settings', 'page', { path: `${W}/settings` }),
  '/workspace/:urlKey/prompts': R('ws-prompts', 'page', { path: `${W}/prompts` }),
  '/workspace/:urlKey/prompts/custom': R('ws-prompts-custom', 'page', { path: `${W}/prompts/custom` }),
  '/workspace/:urlKey/dispatch': R('ws-dispatch', 'page', { path: `${W}/dispatch`, settleMs: 4000 }),
  '/workspace/:urlKey/proxy': R('ws-proxy', 'page', { path: `${W}/proxy` }),
  '/workspace/:urlKey/collective': R('ws-collective', 'page', { path: `${W}/collective`, settleMs: 4000, experimental: 'collective' }),
  '/workspace/:urlKey/observation': R('ws-observation', 'page', { path: `${W}/observation` }),
  '/workspace/:urlKey/observation/session/:sessionId': R('ws-observation-session', 'page', { path: `${W}/observation/session/none` }),
  '/workspace/:urlKey/dashboard': R('ws-dashboard', 'page', { path: `${W}/dashboard` }),
  '/workspace/:urlKey/escalation-kpis': R('ws-escalation-kpis', 'page', { path: `${W}/escalation-kpis` }),
  '/workspace/:urlKey/effort-readout': R('ws-effort-readout', 'page', { path: `${W}/effort-readout` }),
  '/workspace/:urlKey/flight-companion': R('ws-flight-companion', 'page', { path: `${W}/flight-companion`, experimental: 'flight-companion' }),
  '/workspace/:urlKey/live-console': R('ws-live-console', 'page', { path: `${W}/live-console`, experimental: 'live-console' }),
  '/workspace/:urlKey/next-run': R('ws-next-run', 'page', { path: `${W}/next-run`, experimental: 'next-run' }),
  '/workspace/:urlKey/passage-planner': R('ws-passage-planner', 'page', { path: `${W}/passage-planner`, experimental: 'passage-planner' }),
  '/workspace/:urlKey/ship-biscuit': R('ws-ship-biscuit', 'page', { path: `${W}/ship-biscuit`, experimental: 'ship-biscuit' }),
  '/workspace/:urlKey/ship-journey': R('ws-ship-journey', 'page', { path: `${W}/ship-journey`, experimental: 'ship-journey' }),
  '/workspace/:urlKey/task-chat': R('ws-task-chat', 'page', { path: `${W}/task-chat`, experimental: 'task-chat' }),
  '/workspace/:urlKey/task/new': R('ws-task-new', 'page', { path: `${W}/task/new` }),
  '/workspace/:urlKey/task/:issueId/edit': R('ws-task-edit', 'page', { path: `${W}/task/123/edit` }),
  '/workspace/:urlKey/task/:identifier': R('ws-task-page', 'page', { path: `${W}/task/TEST-1`, isNew: true, note: 'default seed renders the 503 "Task unavailable — could not read this task from the tracker" page (tracker read fails), not an empty/not-found state; a populated 200 state is beat 3' }),
  '/workspace/:urlKey/kpis': R('ws-kpis', 'page', { path: `${W}/kpis`, isNew: true }),
  '/workspace/:urlKey/runner': R('ws-runner', 'page', { path: `${W}/runner`, isNew: true }),
};
// Provider-backed twins of existing workspace pages (09-26 keep24 set): same routes, other seeds.
const PROVIDER_TWINS = [
  { id: 'ws-tree-github', seed: 'github', path: '/workspace/github-workspace/' },
  { id: 'ws-tree-ghp', seed: 'ghp', path: '/workspace/github-projects-workspace/' },
  { id: 'ws-tree-jira', seed: 'jira', path: '/workspace/jira-workspace/' },
  { id: 'ws-settings-jira', seed: 'jira', path: '/workspace/jira-workspace/settings' },
  { id: 'ws-roadmap-local', seed: 'local', path: '/workspace/local-workspace/roadmap' },
];

// renderer -> the registry id of the live route that already renders it (swept there)
const COVERED_BY_ROUTE = {
  renderPage: 'ws-tree (page shell: lib/render.js + lib/components/page.js)', renderAuditPage: 'ws-audit', renderCollectivePage: 'ws-collective',
  renderCustomPromptsPage: 'ws-prompts-custom', renderDispatchPage: 'ws-dispatch', renderEffortReadoutPage: 'ws-effort-readout',
  renderEscalationKpisPage: 'ws-escalation-kpis', renderFlightCompanionPage: 'ws-flight-companion', renderKpisPage: 'kpis-public',
  renderLandingPage: 'landing', renderLiveConsolePage: 'ws-live-console', renderNextRunPage: 'ws-next-run',
  renderObservationPage: 'ws-observation', renderPassagePlannerPage: 'ws-passage-planner', renderPromptsPage: 'ws-prompts',
  renderProxyPage: 'ws-proxy', renderRoadmapPage: 'ws-roadmap', renderRunnerSetupPage: 'ws-runner', renderSessionPage: 'ws-observation-session',
  renderSettingsPage: 'ws-settings', renderShipBiscuitPage: 'ws-ship-biscuit', renderShipJourneyPage: 'ws-ship-journey',
  renderShipPage: 'ws-ship', renderSwimPage: 'ws-swim', renderSwipePage: 'ws-swipe', renderTaskChatPage: 'ws-task-chat',
  renderTaskCreatePage: 'ws-task-new', renderTaskEditPage: 'ws-task-edit', renderTaskPage: 'ws-task-page',
  renderTemplatesPage: 'templates', renderWorkspaceKpisPage: 'ws-kpis',
};

// ---- build -------------------------------------------------------------------
const nowRoutes = [...discover(null)].filter(p => !NOT_PAGES(p)).sort();
const priorRoutes = new Set([...discover(PRIOR)].filter(p => !NOT_PAGES(p)));
const entries = [];
const differences = [];

for (const pattern of nowRoutes) {
  const spec = CURATED[pattern];
  const isNewRoute = !priorRoutes.has(pattern);
  if (!spec) {
    entries.push({ id: `route:${pattern}`, class: 'page-get', route: pattern, method: 'excluded:unmapped-route', isNew: isNewRoute });
    differences.push(`route ${pattern} found by grep but absent from the curated table (excluded:unmapped-route)`);
    continue;
  }
  entries.push({ ...spec, class: 'page-get', route: pattern, isNew: spec.isNew ?? isNewRoute, method: spec.kind === 'hop' ? 'hop' : 'route' });
}
for (const pattern of Object.keys(CURATED)) {
  if (!nowRoutes.includes(pattern)) differences.push(`curated route ${pattern} no longer found by the grep (stale entry)`);
}
for (const t of PROVIDER_TWINS) entries.push({ id: t.id, class: 'provider-twin', kind: 'page', seed: t.seed, theme: 'cookie', path: t.path, method: 'route', isNew: false });

// archives
const archives = readdirSync('docs/archive').filter(f => /^\d+\.html$/.test(f)).map(f => parseInt(f, 10)).sort((a, b) => a - b);
const archIdx = entries.findIndex(e => e.id === 'archive');
entries.splice(archIdx, 1);
for (const n of archives) entries.push({ id: `archive-${n}`, class: 'archive', kind: 'page', seed: 'none', theme: 'media', standalone: true, path: `/archive/${n}`, method: 'route', isNew: n >= 8 });
entries.push({ id: 'archive-999', class: 'archive', kind: 'page', seed: 'none', theme: 'media', standalone: true, path: '/archive/999', method: 'route', note: '404 body via renderErrorPage' });

// experimental views: assert the flag list == the tagged route entries
const expRegistry = EXPERIMENTAL_VIEWS.map(v => v.path).sort();
const expTagged = entries.filter(e => e.experimental).map(e => e.experimental).sort();
if (JSON.stringify(expRegistry) !== JSON.stringify(expTagged)) differences.push(`EXPERIMENTAL_VIEWS ${JSON.stringify(expRegistry)} != tagged routes ${JSON.stringify(expTagged)}`);

// renderers
const rendererSites = git('grep', '-oP', '^export (async )?function \\Krender\\w*Page\\b', '--', 'lib', 'routes', 'server.js').trim().split('\n').map(l => { const i = l.lastIndexOf(':'); return { file: l.slice(0, i).replace(/:\d+$/, ''), name: l.slice(i + 1) }; }).sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
const renderers = rendererSites.map(r => r.name);
const dupNames = new Set(renderers.filter((n, i) => renderers.indexOf(n) !== i));
const renderersPrior = git('grep', '-hoP', '^export (async )?function \\Krender\\w*Page\\b', PRIOR, '--', 'lib', 'routes', 'server.js').trim().split('\n').map(l => l.replace(/^[^:]+:/, '')).sort();
for (const { name, file } of rendererSites) {
  // two exports share the name `renderPage` (lib/components/page.js, lib/render.js): disambiguate by file
  const base = { id: dupNames.has(name) ? `renderer:${file}#${name}` : `renderer:${name}`, file, class: 'renderer', renderer: name, isNew: !renderersPrior.includes(name) };
  if (RENDERERS[name]) entries.push({ ...base, kind: 'page', method: 'intercept', theme: 'cookie', standalone: true });
  else if (COVERED_BY_ROUTE[name]) entries.push({ ...base, method: `excluded:covered-by-route:${COVERED_BY_ROUTE[name].split(' ')[0]}` });
  else { entries.push({ ...base, method: 'excluded:no-sample-args' }); differences.push(`renderer ${name} has neither sample args nor a covering route`); }
}
// unlisted states (renderErrorPage family)
for (const id of Object.keys(STATES)) entries.push({ id, class: 'state', kind: 'page', method: 'intercept-state', theme: 'cookie', standalone: true, isNew: true });
// library documents are expanded at census time from the live catalog
entries.push({ id: 'library-doc:*', class: 'library', method: 'expand:library-catalog', note: 'every catalog slug is swept at census time and listed per-slug in census.json' });

// ---- counts vs baseline ---------------------------------------------------------
const pageRoutes = entries.filter(e => e.class === 'page-get');
const counts = {
  routeHandlersFound: nowRoutes.length,
  routeHandlersAtPrior: priorRoutes.size,
  routeHandlersNew: nowRoutes.filter(p => !priorRoutes.has(p)).length,
  // The baseline's "53 page-GET destinations" is reproduced exactly as: every route handler
  // except the OAuth/logout hops (legacy redirects stay in, research §2 lists them as destinations).
  pageGetDestinations: nowRoutes.length - pageRoutes.filter(e => e.kind === 'hop' && !e.legacy).length,
  pageGetDestinationsCarried: nowRoutes.filter(p => priorRoutes.has(p)).length - pageRoutes.filter(e => e.kind === 'hop' && !e.legacy && !e.isNew).length,
  pageGetRenderingHtml: pageRoutes.filter(e => e.kind === 'page').length,
  pageGetLegacyRedirects: pageRoutes.filter(e => e.legacy).length,
  pageGetOauthHops: pageRoutes.filter(e => e.kind === 'hop' && !e.legacy).length,
  archives: archives.length, archive404: 1,
  experimentalViews: EXPERIMENTAL_VIEWS.length,
  renderPageRenderers: renderers.length,
  emailRenderers: renderers.filter(n => /^renderEmail/.test(n)).length,
  interceptedRenderers: entries.filter(e => e.method === 'intercept').length,
  interceptedStates: entries.filter(e => e.method === 'intercept-state').length,
  entries: entries.length,
};
const baseline = { pageGets: 53, carried: 40, new: 13, archives: 9, experimentalViews: 9, renderPageRenderers: 59, emailRenderers: 13 };
// Step 6: grep routes/test.js for the effort-readout / Task Chat / Scan-due seams. A SEED seam
// writes state the page reads; a bare /test/clear-* or read-back route is not one.
const testSrc = git('show', 'HEAD:routes/test.js').split('\n');
const testRoutes = testSrc.map((l, i) => { const m = l.match(/router\.(get|post)\('(\/test\/[^']+)'/); return m ? { line: i + 1, verb: m[1], route: m[2] } : null; }).filter(Boolean);
const probe = (re) => testRoutes.filter(r => re.test(r.route));
const seams = {
  'effort-readout': { matches: probe(/effort/i), verdict: probe(/effort/i).length ? 'found' : 'none: empty state only (named limit)' },
  'task-chat': { matches: probe(/chat/i), verdict: probe(/seed.*chat|chat.*seed/i).length ? 'found' : 'none: only /test/clear-saved-chats (no seed); empty/default state only (named limit)' },
  'scan-due': { matches: probe(/scan|decision|due/i), verdict: probe(/seed.*(scan|decision|due)/i).length ? 'found' : 'none: only /test/clear-task-decisions + read-back /test/task-decisions (no seed for a due scan); Scan-due tab renders its empty state (named limit)' },
};
// F3 (LIN-3748 review): intended outcomes. census.mjs labels any entry whose final status/path
// differs from this (default: 200 at its own path) measured:redirected->... / measured:error-<n>,
// so a page that bounced elsewhere or errored is never counted as the surface it names.
const EXPECT = {
  'email-confirm': { status: 410 }, 'auth-jira-form': { status: 400 }, 'held-connection': { status: 400 },
  'guest-share': { status: 404 }, 'ws-observation-session': { status: 404 }, 'archive-999': { status: 404 },
  'swipe-public': { finalPathPrefix: '/swipe/' }, 'ws-swipe': { finalPathPrefix: `${W}/swipe/` },
  'ws-dashboard': { finalPath: `${W}/observation` },
};
for (const e of entries) if (EXPECT[e.id]) e.expect = EXPECT[e.id];
const registry = { generatedFrom: { head: GROUND, priorReview: PRIOR }, baseline, counts, differences, seams, entries };
writeFileSync(path.join(OUT, 'registry.json'), JSON.stringify(registry, null, 2));
console.log(JSON.stringify({ counts, differences }, null, 1));
