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
  // Optional: base is shot unsaved and its Models page may emit no log row.
  modelsLog: { selector: '[data-testid^="models-log-"] > .settings-row-label', optional: true, reason: 'the Models log label carries a server-rendered relative time (formatRelativeTime in logBody)' },
};

// LIN-3977: the Live Console's parts that move with the clock. Each mask names its reason; a mask that
// matches nothing fails the shot, so a state only lists the masks its page has.
const LIVE_STRIP = { selector: '.lc-pulse', reason: 'the activity strip is a canvas that repaints with the clock (heartbeat and event dots drift)' };
const LIVE_BARS = { selector: '.lc-timeline-viewport', reason: 'bar positions and widths are the window at the moment of the shot (a running bar ends at now)' };
const LIVE_AXIS = { selector: '.lc-timeline-axis', reason: 'the axis shows the window\'s own clock times' };
const LIVE_SINCE = { selector: '.lc-lane-since', optional: true, reason: 'how long a stage has run is relative to the shot (base has no such element: LIN-3977 adds it, so the mask is skipped there)' };
const LIVE_WHEN = { selector: '.lc-event-time', reason: 'a stream row\'s relative time is relative to the shot (its exact time is on hover)' };

// LIN-3975: the task page's renderers, and its clock. A moment is its relative words ("2 hours ago"), which follow the
// server's clock, not the frozen browser clock; a run's "for N minutes" sentence does too. Both are masked, each with its
// reason, so a difference in the words' place or style still shows. Optional, as a state may show none of them.
const TASK_RENDERERS = ['lib/render-task-page.js', 'public/prompt-section.js'];
const TASK_CLOCK = [
  { selector: 'time.task-time', optional: true, reason: 'a moment is its relative words, which follow the server clock (the frozen browser clock does not move them)' },
  { selector: '.task-stage-ago', optional: true, reason: 'how long ago a stage started is relative to the shot (server clock)' },
  { selector: '[data-testid="task-page-sentence-at"]', optional: true, reason: 'the exact time beside a state sentence is the zoned piece; its text is the server\'s UTC fallback' },
];
// LIN-3983: Observation's times are relative to the real clock (its runs are seeded on it, see observation-states.mjs),
// so the words that carry them move between the two shots. The masks are the containing rows, never the inline span.
// Only the time-bearing nodes are masked, never the rows around them: a row's pill, title, workspace, actions and
// answer choices are what this PR changes, so a mask on the row would hide the very difference the judge must class.
const OBS_TIMES = [
  { selector: '.obs-session-time', reason: 'the card\'s "updated … ago" stamp is relative to the real clock the seed runs on' },
  { selector: '.obs-ruling-suggestion-meta', reason: 'the proposal\'s "by …, ago" stamp is relative to the real clock the seed runs on' },
  { selector: '.obs-session-started', optional: true, reason: 'an untitled run\'s "Started …" is a relative time (base has no such line: LIN-3983 PR 2 adds it)' },
  { selector: '.obs-summary-elapsed', optional: true, reason: 'a running stage\'s "… in" is the clock at the shot (base has no such span: PR 2 wraps it)' },
  { selector: '.obs-meta-runtime', optional: true, reason: 'a run\'s runtime is the clock at the shot (base has no such class: PR 2 adds it)' },
];
// The Rulings tab shows no session cards, so only the proposal's stamp is on screen there.
const OBS_RULING_TIMES = OBS_TIMES.filter((m) => m.selector === '.obs-ruling-suggestion-meta');

// `state` names a set-up the spec performs identically on both sides (see replay.spec.js):
//   ask-open          open the periodic-reviews ask in place (a change that affects everyone)
//   key-open          mint a token, open its key row
//   change-log-entry  really submit the periodic-reviews ask once, so the log has one entry
//   paused            mint a queue token (a runner), pause runs in place; Running shows the Runs row and Resume
//   models-panel-open open a job row's change panel on Settings › Models (head only; base's forms have no row)
//   models-staged     the same row, with one model picked: the staged-change count shows (head only)
//   models-group-open  the Judge group opened on head (LIN-3952); base's groups are the old forms, so base is shot as it is
//   models-spend      a runner and priced agent runs seeded through the dispatch API: every row shows its figures (LIN-3952)
//   models-saved      a row changed and saved (head only): the row is marked, and the save's one Undo is offered (LIN-3952)
//   home-run-panel-opencode  the same panel with opencode chosen as the harness (LIN-3987): effort is off and says so, and
//                  Claude Code on the web is not offered. A new state: base has no opencode line, so it differs by design.
//   home-run-panel-pick  the same panel with the "Claude Opus 5.5" suggestion picked (LIN-3992): the summary names it. Base's summary
//                  still says the old thing, so it differs by design.
//   home-run-panel-open  Home's Change panel open (LIN-3962): the shared decision panel the server renders; `seed` gives run controls
//   swipe-dispatch-open  Swipe's card with Prompts open: expected to show no difference (Swipe has no run panel)
//   email-signin      a zero-workspace account: no local seed; signs in by email (one address per shot)
// `urlKey` is fixed per entry and identical on both sides. States that write data get their own
// urlKey so their writes never reach another page's sidebar counts.
// `renderers` are the files that emit the page, for the changed-stylesheet check below.
export const PAGES = [
  { id: 'home', urlKey: 'judge', path: (k) => `/workspace/${k}/`, renderers: ['lib/render.js'] },
  { id: 'task', urlKey: 'judge', path: (k) => `/workspace/${k}/task/LOCAL-1`, renderers: ['lib/render-task-page.js'] },
  // LIN-3975: the task page's states (tests/judge/task-states.mjs). Each has its own workspace: a runner token, an
  // ownership edge and a share are per workspace. A state's words that follow the server's clock are masked (TASK_CLOCK).
  { id: 'task-build-done', urlKey: 'judge-task-build', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-build-done', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-running', urlKey: 'judge-task-running', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-running', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-failed', urlKey: 'judge-task-failed', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-failed', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-waiting', urlKey: 'judge-task-waiting', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-waiting', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-ready', urlKey: 'judge-task-ready', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-ready', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-chat-open', urlKey: 'judge-task-chat', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-chat-open', runner: true, seed: { features: { taskChat: true } }, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-member', urlKey: 'judge-task-member', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-member', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-guest', urlKey: 'judge-task-guest', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-guest', runner: true, masks: TASK_CLOCK, renderers: TASK_RENDERERS },
  { id: 'task-no-runner', urlKey: 'judge-task-norunner', path: (k) => `/workspace/${k}/task/LOCAL-JT1`, state: 'task-no-runner', masks: TASK_CLOCK, renderers: TASK_RENDERERS },
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
  { id: 'models-panel-open', urlKey: 'judge', path: (k) => `/workspace/${k}/settings/models`, state: 'models-panel-open', masks: [TIME_MASKS.modelsLog], renderers: ['lib/render-settings-models.js', 'lib/components/decision-panel.js'] },
  { id: 'models-staged', urlKey: 'judge', path: (k) => `/workspace/${k}/settings/models`, state: 'models-staged', masks: [TIME_MASKS.modelsLog], renderers: ['lib/render-settings-models.js', 'lib/components/decision-panel.js'] },
  // LIN-3952: a group opened (head only: base's groups are the old forms), the list with spend (a runner and priced runs,
  // seeded through the dispatch API on both sides), and a saved change with the row marked and one Undo for the save.
  // The save writes, so it has its own urlKey. Head only: base's save redirects elsewhere, so base is shot unsaved.
  { id: 'models-group-open', urlKey: 'judge', path: (k) => `/workspace/${k}/settings/models`, state: 'models-group-open', masks: [TIME_MASKS.modelsLog], renderers: ['lib/render-settings-models.js', 'lib/components/decision-panel.js'] },
  { id: 'models-spend', urlKey: 'judge-spend', path: (k) => `/workspace/${k}/settings/models`, state: 'models-spend', masks: [TIME_MASKS.modelsLog], seed: { runnerKey: true }, renderers: ['lib/render-settings-models.js', 'lib/components/settings-row.js', 'lib/components/settings-spend-bar.js'] },
  { id: 'models-saved', urlKey: 'judge-saved', path: (k) => `/workspace/${k}/settings/models`, state: 'models-saved', masks: [TIME_MASKS.modelsLog], renderers: ['lib/render-settings-models.js', 'lib/components/decision-panel.js'] },
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
  // LIN-3992: the same Change panel with a suggestion picked. Its own urlKey, since a queue token is a write.
  { id: 'home-run-panel-pick', urlKey: 'judge-run-pick', path: (k) => `/workspace/${k}/`, state: 'home-run-panel-pick', seed: { openRouterConnected: true, queueToken: true }, renderers: ['lib/render.js', 'lib/components/decision-panel.js', 'public/decision-panel.js', 'public/prompt-section.js'] },
  { id: 'swipe-dispatch-open', urlKey: 'judge-swipe', path: (k) => `/workspace/${k}/swipe`, state: 'swipe-dispatch-open', seed: { openRouterConnected: true, queueToken: true }, renderers: ['lib/render-swipe.js'] },
  // LIN-3983 PR 2: Observation. `obs-two-runs` seeds one run waiting on a question and one working run (on the
  // own urlKey per entry: the seed is once per worker process, so two entries sharing a key can seed twice and the dispatch guard refuses the second;
  // real clock, so the times are masked). The Runs view shows the waiting block above the feed; the Rulings tab
  // lists the same question with its proposal; Scan-due and a new user (nothing running) use the seeded local
  // workspace with no runs of its own. The two tabs and the default view each name their own state in the list.
  { id: 'observation-runs', urlKey: 'judge-obs-runs', path: (k) => `/workspace/${k}/observation`, state: 'obs-two-runs', masks: OBS_TIMES, renderers: ['lib/render-observation.js'] },
  // The default filter (autopilot) hides the standalone working run, so its card and pill never reach the default shot.
  // The all-runs filter shows both cards, so a change to the pill words has somewhere to show.
  { id: 'observation-runs-all', urlKey: 'judge-obs-runs-all', path: (k) => `/workspace/${k}/observation?filter=all`, state: 'obs-two-runs', masks: OBS_TIMES, renderers: ['lib/render-observation.js'] },
  { id: 'observation-rulings', urlKey: 'judge-obs-rulings', path: (k) => `/workspace/${k}/observation?view=rulings`, state: 'obs-two-runs', masks: OBS_RULING_TIMES, renderers: ['lib/render-observation.js'] },
  { id: 'observation-due', urlKey: 'judge', path: (k) => `/workspace/${k}/observation?view=due`, renderers: ['lib/render-observation.js'] },
  { id: 'observation-new-user', urlKey: 'judge', path: (k) => `/workspace/${k}/observation`, renderers: ['lib/render-observation.js'] },
  // LIN-3983 PR 2: the three pages that still load observation.css (Live Console no longer does). Each is behind its
  // experimental flag, so the seed turns the flag on. Their renderers are listed so a change to observation.css is
  // checked against them.
  { id: 'flight-companion', urlKey: 'judge', path: (k) => `/workspace/${k}/flight-companion`, seed: { features: { flightCompanion: true } }, renderers: ['lib/render-flight-companion.js'] },
  { id: 'passage-planner', urlKey: 'judge', path: (k) => `/workspace/${k}/passage-planner`, seed: { features: { passagePlanner: true } }, renderers: ['lib/render-passage-planner.js'] },
  { id: 'ship-biscuit', urlKey: 'judge', path: (k) => `/workspace/${k}/ship-biscuit`, seed: { features: { shipBiscuit: true } }, renderers: ['lib/render-ship-biscuit.js'] },
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
  // LIN-3995: a signed-out preview (its sample-tasks line, the back link and the footer row) and an unconfigured
  // sign-in door (the Plain page's Brand variant). Both are public. The judge server runs NODE_ENV=test with the
  // Jira variables unset, so /auth/jira/oauth answers 503 with the door page on both sides; Playwright's goto
  // does not treat a 503 as a failure, so the page is captured as it is.
  { id: 'swipe-preview', urlKey: null, path: () => '/swipe', renderers: ['lib/render-swipe.js', 'lib/components/navbar.js', 'lib/components/footer.js'] },
  { id: 'sign-in-door', urlKey: null, path: () => '/auth/jira/oauth', renderers: ['lib/render-pages.js', 'lib/components/plain-page.js'] },
];

// Stated, not assumed: what the seed cannot reach.
export const NOT_COVERED = [
  'Running with a runner (Last poll row, Pause and Stop): needs a runner key, whose time is server-rendered; the judge runs the no-runner state and the paused state (a queue token is the runner)',
  'A change-log entry with a fixed time: the time is server-rendered and so masked, not seeded',
  'Home\'s run panel (See prompt, Another step, Change, Stop, the run-control repeats): LIN-3962 replaces it, so the stage states judge the opened task above it only',
  'Session with a run (the populated session page and its run view): needs a session record the local seed does not write; the not-found branch is judged instead, and renders the same back link',
  'Pages with no Settings-shared pieces (swim, ship, roadmap, library, KPIs); the signed-out swipe preview is judged as swipe-preview (LIN-3995)',
  'LIN-3975: a task whose run is older than 30 days (its attempt is unlinked, with its plain reason): the store stamps every dispatch with now, so the seed cannot age a row; the window is pinned by unit tests',
  'LIN-3975: the run control while it generates or has failed: both follow a press that calls the prompt generator (an LLM), which a judge run never makes; the judge stops before a press',
  'LIN-3975: Swipe\'s card naming the same next step as the task page: LIN-3982 owns the Swipe card and is Todo, so the Swipe half of that check is not run',
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

// A PNG's own size, from its IHDR chunk (LIN-3975). Null when the buffer is not a PNG.
export const pngSize = (buf) => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

// The class of a non-equal pair, from the two images' sizes. The comparator's text is not used: it can carry a pixel
// count for a pair whose pages differ in height, which the message-based class labelled "paint (same size)" (LIN-3975).
export const layoutClass = (base, head) => {
  const a = pngSize(base);
  const b = pngSize(head);
  if (!a || !b) return 'unknown (not a PNG)';
  if (a.width === b.width && a.height === b.height) return 'paint (same size)';
  return `layout (page size ${a.width}x${a.height} -> ${b.width}x${b.height})`;
};

// Pixel count out of Playwright's comparator message; null when it reports a size mismatch.
export const parsePixelDiff = (message) => {
  const m = /(\d+) pixels? \(ratio [\d.]+ of all image pixels\) (?:are|is) different/.exec(message);
  if (m) return { pixels: Number(m[1]) };
  if (/Expected an image \d+px by \d+px, received \d+px by \d+px/.test(message) || /size|dimensions/i.test(message)) return { sizeMismatch: true };
  return null;
};
