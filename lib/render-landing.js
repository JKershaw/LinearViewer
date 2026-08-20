/**
 * Bespoke Landing Showcase (LIN-980, UI audit G)
 *
 * The unauthenticated home page (`/`). This is a *design-led* showcase, NOT the
 * project-tree renderer: the old landing was marketing copy dressed as a fake
 * `render.js` projects tree (`content/landing.md` → `renderPage(isLanding)`),
 * and the wanted Harbour + Harbour OS story cannot be expressed through tree
 * rows. So this module composes a purpose-built page instead.
 *
 * Structure (top → bottom):
 *   - D's shared header nav (`renderNavBar({ isLanding })`) — the SAME chrome the
 *     unauthenticated swipe/swim/ship previews use, so we don't invent our own.
 *   - The Harbour brand hero (`renderLandingHero`) — the settled top area.
 *   - "The loop" — how Harbour works, as four terminal-flavoured steps.
 *   - Fake-data glimpses of REAL surfaces so a first-timer sees Harbour in
 *     action: a live Observation session feed, a Swim dependency board, and a
 *     grounded-prompt terminal excerpt. The data is illustrative (no provider
 *     seed needed — this page is public and static).
 *   - "Try it yourself" (LIN-1161) — the honest low-cost trial hook: log in,
 *     connect OpenRouter (or use the free tier, when configured), and try AI
 *     Generated Prompts for pennies. Priced off the same `AVAILABLE_MODELS`
 *     rate card the Settings page uses, never a second hardcoded figure.
 *   - A providers strip — "any backend, one cockpit".
 *   - A DISTINCT Harbour OS section — the workstation Harbour dispatches into
 *     (parent/child framing), linking os.harbour.cat.
 *   - The archive section — a link to the latest edition of the standalone
 *     Harbour Archive museum page (served verbatim from docs/archive/).
 *   - The shared landing footer.
 *
 * Dark-safe by construction: every colour comes from the semantic token layer
 * (`--text/--muted/--card/--line/--brand/--amber/--green/--slate` …), which is
 * re-bound for dark by BOTH `.theme-dark` (global toggle) and the landing's
 * `@media (prefers-color-scheme: dark) body.is-landing` remap — no raw hex here.
 * Styling lives in `public/landing.css`; typography rides the shared split
 * (`--font-structural` mono for machine facts, `--font-content` sans for prose).
 */

import { renderPage as renderPageShell } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderLandingHero } from './components/landing-hero.js';
import { renderStatusPill } from './components/status-pill.js';
import { escapeHtml } from './utils/html.js';
import { DEFAULT_MODEL, AVAILABLE_MODELS, formatModelPricing } from './openrouter.js';
import { getAllProviders } from './providers/index.js';

/**
 * The Harbour loop — the one-human-steering-a-fleet story, as four steps. Kept
 * as data so the markup stays a single map and the copy is easy to tune.
 */
const LOOP_STEPS = [
  {
    n: '01',
    title: 'Read the backlog',
    body: 'Point Harbour at Linear, GitHub, or a local store. It reads the whole tree and ranks the frontier — what is actually ready to move.',
  },
  {
    n: '02',
    title: 'Ground a prompt',
    body: 'The right next task becomes a prompt, re-grounded against your code at HEAD — referenced files re-read, stale plans challenged, not trusted blind.',
  },
  {
    n: '03',
    title: 'Dispatch to an agent',
    body: 'Queue it for a coding agent to poll, claim, and run — or fan a whole cohort out at once. One human, a fleet of sessions.',
  },
  {
    n: '04',
    title: 'Verify on evidence',
    body: 'Work lands against real proof — CI, merges, diffs — not the agent’s say-so. Observation shows every run as it happens.',
  },
];

/**
 * Illustrative Observation session feed. Mirrors the real feed’s vocabulary —
 * a run-status pill, a one-sentence summary, runtime + model, a per-run progress
 * bar — so the glimpse reads as the genuine surface, with fake data.
 */
const OBSERVATION_SESSIONS = [
  {
    state: 'running',
    label: 'running',
    id: 'HAR-412',
    summary: 'Adding the dependency-graph cache so swim lanes stop recomputing per request.',
    runtime: '4m 12s',
    model: 'claude-opus-4-8',
    runs: [
      { kind: 'research', done: true },
      { kind: 'plan', done: true },
      { kind: 'implement', done: false, active: true },
      { kind: 'review', done: false },
    ],
  },
  {
    state: 'done',
    label: 'done',
    id: 'HAR-408',
    summary: 'Fixed the 401 refresh loop; token now refreshes once and retries the request.',
    runtime: '11m 03s',
    model: 'claude-sonnet-5',
    runs: [
      { kind: 'research', done: true },
      { kind: 'implement', done: true },
      { kind: 'review', done: true },
      { kind: 'close-out', done: true },
    ],
  },
  {
    state: 'queued',
    label: 'queued',
    id: 'HAR-415',
    summary: 'Extend the proxy wire contract with a source badge for merged workspaces.',
    runtime: '—',
    model: 'awaiting a free agent',
    runs: [
      { kind: 'research', done: false },
      { kind: 'plan', done: false },
      { kind: 'implement', done: false },
      { kind: 'review', done: false },
    ],
  },
];

/**
 * Illustrative Swim board — three lanes of parallel tracks with a blocking edge,
 * the same at-a-glance dependency read the real swim view gives.
 */
const SWIM_LANES = [
  {
    name: 'auth',
    tasks: [
      { state: 'done', id: 'HAR-390', title: 'GitHub App install flow' },
      { state: 'in-progress', id: 'HAR-408', title: 'Token refresh retry' },
    ],
  },
  {
    name: 'views',
    tasks: [
      { state: 'in-progress', id: 'HAR-412', title: 'Swim lane cache' },
      { state: 'todo', id: 'HAR-419', title: 'Roadmap trajectory band', blockedBy: 'HAR-412' },
    ],
  },
  {
    name: 'proxy',
    tasks: [
      { state: 'done', id: 'HAR-377', title: 'Source-neutral wire' },
      { state: 'todo', id: 'HAR-415', title: 'Merged-source badge' },
    ],
  },
];

/**
 * "Try it for less than $1" section (LIN-1161).
 *
 * Scoped deliberately to *trying AI Generated Prompts*, never full dispatch/
 * autopilot — those bill a separate, far pricier execution model and can run
 * long, so a claim that covered them would be misleading. The dollar figure is
 * NOT a second hardcoded price: it is `formatModelPricing(DEFAULT_MODEL)` read
 * straight from the `AVAILABLE_MODELS` rate card in `lib/openrouter.js`, the
 * same source of truth the Settings pricing hint (LIN-993) already renders —
 * so this section can never disagree with what a logged-in user sees.
 *
 * `freeTierEnabled` forks the lead line (open question in the plan): when the
 * operator has configured `OPENROUTER_FREE_TIER_KEY`, lead with the free path
 * (never say "you must pay to try"); otherwise lead with BYOK. Threaded in by
 * the caller as `!!process.env.OPENROUTER_FREE_TIER_KEY` so the copy resolves
 * correctly on whichever deployment renders it, rather than a value guessed at
 * implementation time.
 */
function renderTrySection({ freeTierEnabled }) {
  const model = AVAILABLE_MODELS.find((m) => m.id === DEFAULT_MODEL);
  const pricingHint = formatModelPricing(model);

  const lede = freeTierEnabled
    ? 'Log in and try AI Generated Prompts free — no OpenRouter connection needed to start. Want more? Connect your own OpenRouter key and keep going for pennies.'
    : 'Log in, connect OpenRouter with your own key, and try AI Generated Prompts for pennies. No Harbour charge — you spend a few cents of your own OpenRouter tokens.';

  const pricingLine = pricingHint
    ? `The default model runs at ${escapeHtml(pricingHint)} — a single generated prompt costs a cent or two, so dozens fit under $1.`
    : 'A single generated prompt costs a cent or two, so dozens fit under $1.';

  return `<section class="lx-section lx-try" data-testid="landing-try" aria-labelledby="lx-try-h">
      <div class="lx-try__inner">
        <div class="lx-section__head">
          <p class="lx-eyebrow">try it yourself</p>
          <h2 id="lx-try-h" class="lx-section__title">See the value for well under $1</h2>
          <p class="lx-section__lede">${lede}</p>
        </div>
        <p class="lx-try__pricing">${pricingLine}</p>
        <p class="lx-try__scope">This covers trying AI Generated Prompts — running full autopilot dispatch uses a separate, pricier model and can run long, though even that model stays relatively cheap.</p>
      </div>
    </section>`;
}

/** One loop step. */
function renderLoopStep({ n, title, body }) {
  return `<li class="lx-step">
      <span class="lx-step__n">${escapeHtml(n)}</span>
      <h3 class="lx-step__title">${escapeHtml(title)}</h3>
      <p class="lx-step__body">${escapeHtml(body)}</p>
    </li>`;
}

/** One Observation session card. */
function renderObservationCard(s) {
  const pill = renderStatusPill({ state: s.state, label: s.label, dot: true });
  const runsHtml = s.runs
    .map((r) => {
      const cls = r.done ? 'lx-run lx-run--done' : (r.active ? 'lx-run lx-run--active' : 'lx-run');
      return `<span class="${cls}" title="${escapeHtml(r.kind)}"><span class="lx-run__label">${escapeHtml(r.kind)}</span></span>`;
    })
    .join('');
  return `<article class="lx-session" data-state="${escapeHtml(s.state)}">
      <div class="lx-session__head">
        ${pill}
        <span class="lx-session__id">${escapeHtml(s.id)}</span>
      </div>
      <p class="lx-session__summary">${escapeHtml(s.summary)}</p>
      <div class="lx-session__runs">${runsHtml}</div>
      <div class="lx-session__meta">
        <span class="lx-meta"><span class="lx-meta__k">runtime</span> ${escapeHtml(s.runtime)}</span>
        <span class="lx-meta"><span class="lx-meta__k">model</span> ${escapeHtml(s.model)}</span>
      </div>
    </article>`;
}

/** One swim lane column. */
function renderSwimLane(lane) {
  const tasks = lane.tasks
    .map((t) => {
      const pill = renderStatusPill({ state: t.state, variant: 'bare' });
      const blocked = t.blockedBy
        ? `<span class="lx-swim-block" title="blocked by ${escapeHtml(t.blockedBy)}">⇠ ${escapeHtml(t.blockedBy)}</span>`
        : '';
      return `<div class="lx-swim-task" data-state="${escapeHtml(t.state)}">
          <div class="lx-swim-task__top">${pill}<span class="lx-swim-task__id">${escapeHtml(t.id)}</span></div>
          <div class="lx-swim-task__title">${escapeHtml(t.title)}</div>
          ${blocked}
        </div>`;
    })
    .join('\n        ');
  return `<div class="lx-swim-lane">
        <div class="lx-swim-lane__name">${escapeHtml(lane.name)}</div>
        ${tasks}
      </div>`;
}

/**
 * Render the bespoke landing showcase page.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.deployInfo] - Deploy information (see lib/deploy-info.js), for the footer.
 * @param {Object} [opts.featureFlags] - Feature flags (threaded to the nav).
 * @param {boolean} [opts.githubEnabled] - Whether the GitHub App is configured
 *   (gates the hero + nav GitHub CTAs).
 * @param {boolean} [opts.jiraEnabled] - Whether Jira OAuth 3LO is configured
 *   (gates the hero Jira CTA; LIN-1890).
 * @param {string|null} [opts.setupNotice] - When 'setup', show the localhost
 *   getting-started notice (parity with the old landing).
 * @param {boolean} [opts.freeTierEnabled] - Whether OPENROUTER_FREE_TIER_KEY is
 *   configured on this deployment (LIN-1161) — forks the "try it" section's
 *   lead line between the free path and BYOK.
 * @returns {string} Complete HTML document.
 */
export function renderLandingPage({
  deployInfo = {},
  featureFlags = {},
  githubEnabled = false,
  jiraEnabled = false,
  setupNotice = null,
  freeTierEnabled = false,
} = {}) {
  // Homepage top bar removed (LIN-1508): `minimalNav` suppresses the shared
  // landing sign-in bar here only — the hero below is the homepage's sign-in
  // path — while swipe/swim/ship keep the same bar as their sole sign-in route.
  const navHtml = renderNavBar({ isLanding: true, minimalNav: true, featureFlags });
  const heroHtml = renderLandingHero({ githubEnabled, jiraEnabled });
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/' });

  const setupHtml = setupNotice === 'setup'
    ? `<div class="setup-notice">
      <p>┌─ Getting started</p>
      <p>│  Set <code>LINEAR_ACCESS_TOKEN</code> in your <code>.env</code> file to log in automatically.</p>
      <p>│  Get a token from <a href="https://linear.app/settings/api">linear.app/settings/api</a></p>
      <p>└─ Or configure OAuth — see <code>.env.example</code> for details.</p>
    </div>`
    : '';

  const loopHtml = LOOP_STEPS.map(renderLoopStep).join('\n    ');
  const observationHtml = OBSERVATION_SESSIONS.map(renderObservationCard).join('\n      ');
  const swimHtml = SWIM_LANES.map(renderSwimLane).join('\n      ');
  const providersHtml = [...getAllProviders()]
    .sort((a, b) => (a.landingCatalogue?.order ?? Infinity) - (b.landingCatalogue?.order ?? Infinity))
    .map((p) => ({ name: p.ui.displayName, note: p.landingCatalogue?.blurb || '' }))
    .map((p) => `<li class="lx-provider"><span class="lx-provider__name">${escapeHtml(p.name)}</span><span class="lx-provider__note">${escapeHtml(p.note)}</span></li>`)
    .join('\n      ');

  const content = `${heroHtml}
  <main class="landing-showcase">
    ${setupHtml}

    <section class="lx-section lx-loop" data-testid="landing-loop" aria-labelledby="lx-loop-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">the loop</p>
        <h2 id="lx-loop-h" class="lx-section__title">One human, steering a fleet of agents</h2>
        <p class="lx-section__lede">AI made writing code cheap — it didn’t make knowing what to build any faster. Harbour keeps human intent in command of AI execution, one turn of the loop at a time.</p>
      </div>
      <ol class="lx-steps">
    ${loopHtml}
      </ol>
    </section>

    <section class="lx-section lx-showcase" data-testid="landing-observation" aria-labelledby="lx-obs-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">observation</p>
        <h2 id="lx-obs-h" class="lx-section__title">Watch the work happen</h2>
        <p class="lx-section__lede">Every dispatched run, live: what it is doing, how long it has taken, and the evidence it produced — not a spinner, the actual work.</p>
      </div>
      <div class="lx-glimpse lx-obs" role="img" aria-label="Example Autopilot observation feed with three agent sessions">
      ${observationHtml}
      </div>
    </section>

    <section class="lx-section lx-showcase" data-testid="landing-swim" aria-labelledby="lx-swim-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">swim lanes</p>
        <h2 id="lx-swim-h" class="lx-section__title">See the whole board at a glance</h2>
        <p class="lx-section__lede">Parallel tracks, with the dependencies drawn in. Know what is ready, what is moving, and what is held — before you dispatch.</p>
      </div>
      <div class="lx-glimpse lx-swim" role="img" aria-label="Example swim-lanes board with three lanes and a blocking dependency">
      ${swimHtml}
      </div>
    </section>

    <section class="lx-section lx-showcase" data-testid="landing-prompt" aria-labelledby="lx-prompt-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">grounded prompts</p>
        <h2 id="lx-prompt-h" class="lx-section__title">Prompts that re-check your code first</h2>
        <p class="lx-section__lede">Two paths — 14 deterministic templates and an LLM meta-prompt — both re-grounded against the repo at HEAD before they run.</p>
      </div>
      <div class="lx-glimpse lx-terminal" role="img" aria-label="Example grounded prompt excerpt">
        <div class="lx-terminal__bar"><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__name">HAR-412 · implement</span></div>
        <pre class="lx-terminal__body"><span class="lx-c-dim"># Re-ground against current code (staleness check)</span>
Before trusting the ticket, list the files it references and
<span class="lx-c-key">git log --since=2026-06-30</span> — re-read them at HEAD.

<span class="lx-c-dim">## Task</span>
Cache the swim dependency graph so lanes stop recomputing
per request. Referenced: <span class="lx-c-path">lib/swim-graph.js</span>,
<span class="lx-c-path">lib/graph-features.js</span>.

<span class="lx-c-dim">## What CI cannot prove</span>
The cache invalidates on issue write — verify against a real
mutation, not a green build.</pre>
      </div>
    </section>

    ${renderTrySection({ freeTierEnabled })}

    <section class="lx-section lx-providers" data-testid="landing-providers" aria-labelledby="lx-prov-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">any backend</p>
        <h2 id="lx-prov-h" class="lx-section__title">One cockpit, whatever tracks the work</h2>
      </div>
      <ul class="lx-provider-list">
      ${providersHtml}
      </ul>
    </section>

    <section class="lx-section lx-os" data-testid="landing-os" aria-labelledby="lx-os-h">
      <div class="lx-os__inner">
        <div class="lx-os__lead">
          <p class="lx-eyebrow lx-eyebrow--os">the workstation</p>
          <div class="lx-os__heading">
            <h2 id="lx-os-h" class="lx-section__title">Harbour OS</h2>
            ${renderStatusPill({ label: 'experimental', variant: 'tag', className: 'lx-os__badge' })}
          </div>
          <p class="lx-section__lede">Harbour is the control plane; <strong>Harbour OS</strong> is the in-browser workstation it dispatches sessions into. Parent and child, like Apple and macOS — Harbour picks the work, Harbour OS runs it.</p>
          <a href="https://os.harbour.cat" class="lx-os__cta" data-testid="landing-os-link">Open Harbour OS →</a>
        </div>
        <div class="lx-glimpse lx-terminal lx-os__glimpse" role="img" aria-label="Example dispatched session running in Harbour OS">
          <div class="lx-terminal__bar"><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__name">harbour os · session</span></div>
          <pre class="lx-terminal__body"><span class="lx-c-key">$</span> harbour dispatch HAR-412 --target local
<span class="lx-c-dim">→ session spawned, agent claimed the item</span>
<span class="lx-c-key">◐</span> implement  running   4m 12s
<span class="lx-c-dim">  [evidence] 3 files changed · tests green</span>
<span class="lx-c-key">$</span> _</pre>
        </div>
      </div>
    </section>

    <section class="lx-section lx-archive" data-testid="landing-archive" aria-labelledby="lx-archive-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">the archive</p>
        <h2 id="lx-archive-h" class="lx-section__title">Six months, preserved</h2>
        <p class="lx-section__lede">A museum of the Harbour project — two repositories and the machines that built them, January to July 2026.</p>
      </div>
      <a href="/archive/2" class="lx-archive__link" data-testid="landing-archive-link">Visit the Harbour Archive →</a>
    </section>
  </main>
  ${footerHtml}`;

  return renderPageShell({
    title: 'Harbour — keep human intent in command of AI execution',
    stylesheets: ['/style.css', '/landing.css'],
    htmlComment: 'AI agents: see /llms.txt for navigation guidance',
    bodyClass: 'is-landing',
    nav: navHtml,
    scripts: ['/common.js', '/app.js'],
    content,
  });
}
