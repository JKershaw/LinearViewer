// Pure data for the visual replay judge (LIN-3887): the page × state list, the masks (with the
// reason for each), and the check that maps changed stylesheets to the renderers that link them.
// No browser, no server, no I/O except the one `git grep` in `renderersOf`.
import { execFileSync } from 'node:child_process';

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
export const THEMES = ['light', 'dark'];

// Frozen browser clock for both sides.
export const FROZEN_TIME = '2026-01-15T12:00:00.000Z';

// Text the page prints about the server it runs on. Each side is its own server on its own port, so
// the Proxy page's curl examples differ by the port digits alone. The text is rewritten (same length,
// styling and layout kept) before the screenshot, on both sides, and printed in the summary.
export const NORMALISE = [
  { pattern: '127\\.0\\.0\\.1:\\d+', replacement: '127.0.0.1:00000', reason: "each side's own origin (port) appears in the Proxy page's curl examples" },
];

export const AREAS = ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account'];

// A server-rendered time ("Last poll", key expiry / last used, the change-log meta) does not follow
// the browser clock, and `formatWhen` prints proportional digits, so a one-minute tick can move the
// row's width. The CONTAINING ROW is masked, never the inline span.
const TIME_MASKS = {
  key: { selector: '[data-testid="settings-key-proxy"], [data-testid="settings-key-dispatch"]', reason: 'key expiry and last used are server-rendered times' },
  change: { selector: '[data-change-id]', reason: 'the change-log meta line carries a server-rendered time (WorkspaceChangeLogStore.record stamps new Date())' },
  poll: { selector: '[data-testid="settings-runner-last-poll"]', reason: 'Last poll is a server-rendered time' },
};

// LIN-3977: the Live Console's parts that move with the clock. Each mask names its reason; a mask that
// matches nothing fails the shot, so a state only lists the masks its page has.
const LIVE_STRIP = { selector: '.lc-pulse', reason: 'the activity strip is a canvas that repaints with the clock (heartbeat and event dots drift)' };
const LIVE_BARS = { selector: '.lc-timeline-viewport', reason: 'bar positions and widths are the window at the moment of the shot (a running bar ends at now)' };
const LIVE_AXIS = { selector: '.lc-timeline-axis', reason: 'the axis shows the window\'s own clock times' };
const LIVE_SINCE = { selector: '.lc-lane-since', optional: true, reason: 'how long a stage has run is relative to the shot (base has no such element: LIN-3977 adds it, so the mask is skipped there)' };
const LIVE_WHEN = { selector: '.lc-event-time', reason: 'a stream row\'s relative time is relative to the shot (its exact time is on hover)' };

// `state` names a set-up the spec performs identically on both sides (see replay.spec.js):
//   ask-open          open the periodic-reviews ask in place (a change that affects everyone)
//   key-open          mint a token, open its key row
//   change-log-entry  really submit the periodic-reviews ask once, so the log has one entry
//   paused            mint a queue token (a runner), pause runs in place; Running shows the Runs row and Resume
//   models-panel-open open a job row's change panel on Settings › Models (head only; base's forms have no row)
//   models-staged     the same row, with one model picked: the staged-change count shows (head only)
//   home-run-panel-opencode  the same panel with opencode chosen as the harness (LIN-3987): effort is off and says so, and
//                  Claude Code on the web is not offered. A new state: base has no opencode line, so it differs by design.
//   home-run-panel-open  Home's Change panel open (LIN-3962): the shared decision panel the server renders; `seed` gives run controls
//   swipe-dispatch-open  Swipe's card with Prompts open: expected to show no difference (Swipe has no run panel)
//   email-signin      a zero-workspace account: no local seed; signs in by email (one address per shot)
// `urlKey` is fixed per entry and identical on both sides. States that write data get their own
// urlKey so their writes never reach another page's sidebar counts.
// `renderers` are the files that emit the page, for the changed-stylesheet check below.
export const PAGES = [
  { id: 'home', urlKey: 'judge', path: (k) => `/workspace/${k}/`, renderers: ['lib/render.js'] },
  { id: 'task', urlKey: 'judge', path: (k) => `/workspace/${k}/task/LOCAL-1`, renderers: ['lib/render-task-page.js'] },
  { id: 'dispatch', urlKey: 'judge', path: (k) => `/workspace/${k}/dispatch`, renderers: ['lib/render-dispatch.js'] },
  { id: 'proxy', urlKey: 'judge', path: (k) => `/workspace/${k}/proxy`, renderers: ['lib/render-proxy.js'] },
  { id: 'audit', urlKey: 'judge', path: (k) => `/workspace/${k}/audit`, renderers: ['lib/render-audit.js'] },
  // Back links (LIN-3889, decision 14). The task edit id is the seeded local id (localSeedId).
  { id: 'task-create', urlKey: 'judge', path: (k) => `/workspace/${k}/task/new`, renderers: ['lib/render-task-create.js'] },
  { id: 'task-edit', urlKey: 'judge', path: (k) => `/workspace/${k}/task/${encodeURIComponent(`${k}--local-issue-1`)}/edit`, renderers: ['lib/render-task-edit.js'] },
  { id: 'session-missing', urlKey: 'judge', path: (k) => `/workspace/${k}/observation/session/judge-no-such-session`, renderers: ['lib/render-session.js'] },
  { id: 'settings-index', urlKey: 'judge', path: (k) => `/workspace/${k}/settings`, renderers: ['lib/render-settings.js'] },
  ...AREAS.map((area) => ({
    id: `settings-${area}`, urlKey: 'judge', path: (k) => `/workspace/${k}/settings/${area}`, renderers: ['lib/render-settings.js'],
  })),
  { id: 'styleguide', urlKey: 'judge', path: () => '/styleguide', renderers: ['lib/render-styleguide.js'] },
  // LIN-3950: the Legal pages on the Plain layout (brand shape). Public, so the path ignores the workspace.
  { id: 'privacy', urlKey: 'judge', path: () => '/privacy', renderers: ['lib/render-legal.js'] },
  { id: 'terms', urlKey: 'judge', path: () => '/terms', renderers: ['lib/render-legal.js'] },
  // LIN-3956: the not-found page (a bad urlKey, a 404 the judge still captures) carries the workspace-create
  // form, which moved onto the shared form markup. Its session is the seeded judge session.
  { id: 'workspace-not-found', urlKey: 'judge', path: () => '/workspace/judge-missing/', renderers: ['lib/render-pages.js'] },
  // States
  { id: 'running-ask-open', urlKey: 'judge', path: (k) => `/workspace/${k}/settings/running`, state: 'ask-open', renderers: ['lib/render-settings.js'] },
  { id: 'agent-access-key-open', urlKey: 'judge-key', path: (k) => `/workspace/${k}/settings/agent-access`, state: 'key-open', masks: [TIME_MASKS.key], renderers: ['lib/render-settings.js'] },
  { id: 'change-log-entry', urlKey: 'judge-log', path: (k) => `/workspace/${k}/settings/change-log`, state: 'change-log-entry', masks: [TIME_MASKS.change], renderers: ['lib/render-settings.js'] },
  // LIN-3890: a halted Running page (Runs row, Resume only). It writes data, so it has its own urlKey.
  // The remove and revoke asks have no base-side set-up (the base has no in-place panel), so they are
  // covered by tests/e2e/settings-providers.spec.js and settings-areas.spec.js, not by this comparison.
  { id: 'running-paused', urlKey: 'judge-halt', path: (k) => `/workspace/${k}/settings/running`, state: 'paused', renderers: ['lib/render-settings.js'] },
  // LIN-3889: Audit's report, with the rows the client builds with `.field` (teams, queue items,
  // projects). The fixture answers `/api/audit` on both sides, so the request never leaves the browser.
  { id: 'audit-report', urlKey: 'judge', path: (k) => `/workspace/${k}/audit`, state: 'audit-report', renderers: ['lib/render-audit.js'] },
  // LIN-3855: Settings › Models. At the phone viewport the open row is the full-screen sheet, so 'models-panel-open'
  // covers the sheet at 390px and the panel at 1280px. Both are read-only set-ups on the seeded 'judge' workspace.
  { id: 'models-panel-open', urlKey: 'judge', path: (k) => `/workspace/${k}/settings/models`, state: 'models-panel-open', renderers: ['lib/render-settings-models.js', 'lib/components/decision-panel.js'] },
  { id: 'models-staged', urlKey: 'judge', path: (k) => `/workspace/${k}/settings/models`, state: 'models-staged', renderers: ['lib/render-settings-models.js', 'lib/components/decision-panel.js'] },
  // LIN-3968: Home's opened task. The stage states have a runner (the strip and run control show) and seed their
  // sessions through the consumer API; the copy-first pair has no runner, and its write is a fixed stream. Each
  // state has its own urlKey, so one state's sessions or prompt memory never reach another.
  { id: 'home-stages-done', urlKey: 'judge-home-done', path: (k) => `/workspace/${k}/`, state: 'home-stages-done', runner: true, renderers: ['lib/render.js'] },
  { id: 'home-running', urlKey: 'judge-home-run', path: (k) => `/workspace/${k}/`, state: 'home-running', runner: true, renderers: ['lib/render.js'] },
  { id: 'home-failed', urlKey: 'judge-home-fail', path: (k) => `/workspace/${k}/`, state: 'home-failed', runner: true, renderers: ['lib/render.js'] },
  { id: 'home-failed-first', urlKey: 'judge-home-fail-first', path: (k) => `/workspace/${k}/`, state: 'home-failed-first', runner: true, renderers: ['lib/render.js'] },
  { id: 'home-copy-first', urlKey: 'judge-home-copy', path: (k) => `/workspace/${k}/`, state: 'home-copy-first', renderers: ['lib/render.js'] },
  { id: 'home-copy-written', urlKey: 'judge-home-write', path: (k) => `/workspace/${k}/`, state: 'home-copy-written', renderers: ['lib/render.js'] },
  // LIN-3962: the one decision panel on Home (desktop, and phone via the viewport pair) and Swipe's card with Prompts open.
  // Both seeds give run controls with a queue token (no runner credential). A queue token is a write, so each has its own
  // urlKey; the head must show the Change control, or the Home state fails.
  { id: 'home-run-panel-open', urlKey: 'judge-run', path: (k) => `/workspace/${k}/`, state: 'home-run-panel-open', seed: { openRouterConnected: true, queueToken: true }, renderers: ['lib/render.js', 'lib/components/decision-panel.js', 'public/decision-panel.js', 'public/prompt-section.js'] },
  // LIN-3987: the same Change panel with opencode chosen. Its own urlKey, since a queue token is a write.
  { id: 'home-run-panel-opencode', urlKey: 'judge-run-opencode', path: (k) => `/workspace/${k}/`, state: 'home-run-panel-opencode', seed: { openRouterConnected: true, queueToken: true }, renderers: ['lib/render.js', 'lib/components/decision-panel.js', 'public/decision-panel.js', 'public/prompt-section.js'] },
  { id: 'swipe-dispatch-open', urlKey: 'judge-swipe', path: (k) => `/workspace/${k}/swipe`, state: 'swipe-dispatch-open', seed: { openRouterConnected: true, queueToken: true }, renderers: ['lib/render-swipe.js'] },
  // LIN-3956: Account home, the first Plain page with rows and a form. It needs a zero-workspace account,
  // which no local seed can make, so the spec signs in by email. The judge's server runs the capture
  // transport (visual-replay.mjs), the same as Playwright's. Settings › Account then shows "Add email →"
  // on both sides, so it is identical on both and adds no difference.
  { id: 'account-home', urlKey: 'judge', path: () => '/account', state: 'email-signin', renderers: ['lib/render-account-home.js'] },
  // LIN-3977: the Live Console, its flag on. These shoot on the real clock (live-console-states.mjs seeds the
  // runs through the dispatch API), so the parts that move with the clock are masked, each with its reason.
  // The key, the detail line, the lanes' words and the stream's words are NOT masked: those are what changed.
  { id: 'live-console-quiet', urlKey: 'judge-live-quiet', path: (k) => `/workspace/${k}/live-console`, seed: { features: { liveConsole: true } }, masks: [LIVE_STRIP, LIVE_BARS, LIVE_AXIS], renderers: ['lib/render-live-console.js', 'public/live-console.js', 'public/live-console.css'] },
  { id: 'live-console-working', urlKey: 'judge-live-working', path: (k) => `/workspace/${k}/live-console`, state: 'live-working', seed: { features: { liveConsole: true } }, masks: [LIVE_STRIP, LIVE_BARS, LIVE_AXIS, LIVE_SINCE, LIVE_WHEN], renderers: ['lib/render-live-console.js', 'public/live-console.js', 'public/live-console.css'] },
  { id: 'live-console-history', urlKey: 'judge-live-history', path: (k) => `/workspace/${k}/live-console`, state: 'live-history', seed: { features: { liveConsole: true } }, masks: [LIVE_STRIP, LIVE_BARS, LIVE_AXIS, LIVE_SINCE, LIVE_WHEN], renderers: ['lib/render-live-console.js', 'public/live-console.js', 'public/live-console.css'] },
  // LIN-3980: the signed-out landing (no seed, so no session) and the email door it leads to. LIN-3973 owns the
  // email page's layout; this entry shows it as it is, so the step from the landing reads as one product.
  { id: 'landing', urlKey: null, path: () => '/', renderers: ['lib/render-landing.js', 'lib/components/landing-hero.js'] },
  { id: 'auth-email', urlKey: null, path: () => '/auth/email', renderers: ['lib/render-email-auth.js'] },
];

// Stated, not assumed: what the seed cannot reach.
export const NOT_COVERED = [
  'Running with a runner (Last poll row, Pause and Stop): needs a runner key, whose time is server-rendered; the judge runs the no-runner state and the paused state (a queue token is the runner)',
  'A change-log entry with a fixed time: the time is server-rendered and so masked, not seeded',
  'Home\'s run panel (See prompt, Another step, Change, Stop, the run-control repeats): LIN-3962 replaces it, so the stage states judge the opened task above it only',
  'Session with a run (the populated session page and its run view): needs a session record the local seed does not write; the not-found branch is judged instead, and renders the same back link',
  'Pages with no Settings-shared pieces (swim, swipe, ship, roadmap, library, KPIs)',
];

// Every page renders through renderPage, so its shell files are covered by any listed page.
export const SHARED_RENDERERS = ['lib/components/page.js'];

export const coveredRenderers = () => new Set([...SHARED_RENDERERS, ...PAGES.flatMap((p) => p.renderers)]);

export const cssNamesIn = (paths) => [...new Set(paths.filter((p) => /^public\/[^/]+\.css$/.test(p)).map((p) => p.slice('public/'.length)))].sort();

// Renderers (under lib/ and server.js) that link <name>.css, at a revision.
export const renderersOf = (repo, rev, cssName) => {
  try {
    return execFileSync('git', ['-C', repo, 'grep', '-l', '-F', cssName, rev, '--', 'lib', 'server.js'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map((l) => l.slice(rev.length + 1)).sort();
  } catch (e) {
    if (e.status === 1) return []; // no match
    throw e;
  }
};

// { changed: [css names], uncovered: [{ css, renderers }] }. Non-empty `uncovered` means the page
// list does not show a changed stylesheet's renderer, so the judge must not report zero.
export const coverageOfChange = (changedPaths, renderersFor, covered = coveredRenderers()) => {
  const changed = cssNamesIn(changedPaths);
  const uncovered = [];
  for (const css of changed) {
    const missing = renderersFor(css).filter((r) => !covered.has(r));
    if (missing.length) uncovered.push({ css, renderers: missing });
  }
  return { changed, uncovered };
};

// Pixel count out of Playwright's comparator message; null when it reports a size mismatch.
export const parsePixelDiff = (message) => {
  const m = /(\d+) pixels? \(ratio [\d.]+ of all image pixels\) (?:are|is) different/.exec(message);
  if (m) return { pixels: Number(m[1]) };
  if (/Expected an image \d+px by \d+px, received \d+px by \d+px/.test(message) || /size|dimensions/i.test(message)) return { sizeMismatch: true };
  return null;
};
