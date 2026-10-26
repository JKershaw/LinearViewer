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
 *     connect OpenRouter (or use the free tier, when configured), and let
 *     Harbour write a prompt for pennies (LIN-3995: in plain words). Priced
 *     off the same `AVAILABLE_MODELS` rate card the Settings page uses, never
 *     a second hardcoded figure.
 *   - A providers strip — "any backend, one cockpit".
 *   - A DISTINCT Harbour OS section — the workstation Harbour dispatches into
 *     (parent/child framing), linking os.harbour.cat.
 *   - The archive section — a link to the latest edition of the standalone
 *     Harbour Archive museum page (served verbatim from docs/archive/).
 *   - The shared landing footer.
 *
 * Dark-safe by construction: every colour comes from the semantic token layer
 * (`--text/--muted/--card/--line/--brand/--amber/--green/--slate` …), which is
 * re-bound by `.theme-dark` alone. The landing opts in to following the system
 * scheme (`followSystemTheme`), so a signed-out visitor with no stored theme gets
 * dark from the shared pre-paint script, and a stored preference still wins
 * (LIN-3980: one dark mechanism). No raw hex here.
 * Styling lives in `public/landing.css`; typography rides the shared split
 * (`--font-structural` mono for machine facts, `--font-content` sans for prose).
 */

import { renderPage as renderPageShell } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderLandingHero, renderSignInCtas, HARBOUR_PLAIN_SENTENCE } from './components/landing-hero.js';
import { canonicalTag, descriptionTag, socialPreviewTags } from './components/head-meta.js';
import { renderStatusPill } from './components/status-pill.js';
import { renderButton } from './components/button.js';
import { escapeHtml } from './utils/html.js';
import { DEFAULT_MODEL, AVAILABLE_MODELS, formatModelPricing } from './openrouter.js';
import { getAllProviders } from './providers/index.js';
import { START_HERE } from './library-metadata.js';
import { STAGE_LABELS } from './run-view.js';

/**
 * The glimpses show the app's own words, not hand-typed copies of them, so they
 * can't age (LIN-3980, outcome 2). A stage shows its label from the shared
 * `STAGE_LABELS` map. Family names are typed as a fallback until LIN-3952 owns
 * one display name with no version (`getModelDisplayName` now returns the
 * model an alias runs, version included). The sample data carries only kinds
 * and family names.
 */
function stageWord(kind) {
  return STAGE_LABELS[kind] || kind;
}
function modelWord(family) {
  return family.charAt(0).toUpperCase() + family.slice(1);
}

/**
 * The Harbour loop — the one-human-steering-a-fleet story, as four steps. Kept
 * as data so the markup stays a single map and the copy is easy to tune.
 */
const LOOP_STEPS = [
  {
    n: '01',
    title: 'Read the backlog',
    body: 'Point Harbour at Linear, GitHub Issues or Projects, Jira, or a local store. It reads the whole backlog and picks out the work that is ready to move.',
  },
  {
    n: '02',
    title: 'Write the next prompt',
    body: 'The next task becomes a prompt, checked against your code as it is now. The files it names are re-read, and an old plan is questioned rather than trusted.',
  },
  {
    n: '03',
    title: 'Run it on an agent',
    body: 'A coding agent picks it up and runs it, or a whole batch goes out at once. One person, many agents at work.',
  },
  {
    n: '04',
    title: 'Check the result',
    body: 'Work counts when it has real proof behind it: CI results, merged changes, diffs. Not the agent’s say-so. The live run view shows each run as it happens.',
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
    model: 'opus',
    runs: [
      { kind: 'research', done: true },
      { kind: 'plan', done: true },
      { kind: 'implementation', done: false, active: true },
      { kind: 'review', done: false },
    ],
  },
  {
    state: 'done',
    label: 'done',
    id: 'HAR-408',
    summary: 'Fixed the 401 refresh loop; token now refreshes once and retries the request.',
    runtime: '11m 03s',
    model: 'sonnet',
    runs: [
      { kind: 'research', done: true },
      { kind: 'implementation', done: true },
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
      { kind: 'implementation', done: false },
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
 * Scoped deliberately to *writing the next prompt*, never running it — having
 * Harbour run the work on a coding agent (full dispatch) bills a separate,
 * far pricier execution model and can run long, so a claim that covered it
 * would be misleading. LIN-3995: the copy names no internal product or
 * mechanism ("AI Generated Prompts", "autopilot dispatch"); it says what the
 * visitor gets and what costs more. The dollar figure is
 * NOT a second hardcoded price: it is `formatModelPricing(DEFAULT_MODEL)` read
 * straight from the `AVAILABLE_MODELS` rate card in `lib/openrouter.js`, the
 * same source of truth the Settings pricing hint (LIN-993) already renders —
 * so this section can never disagree with what a logged-in user sees.
 *
 * `freeTierEnabled` forks the lead line (open question in the plan): when the
 * operator has configured `OPENROUTER_FREE_TIER_KEY`, lead with the free path
 * (never say "you must pay to try"); otherwise lead with BYOK. Threaded in by
 * the caller as `isFreeTierOffered()` (`lib/chat-request.js`, the `offered` row
 * of `FREE_FOR`; trimmed, so a whitespace-only key is not configured —
 * LIN-3664) so the copy resolves correctly on whichever deployment renders it,
 * rather than a value guessed at implementation time.
 */
function renderTrySection({ freeTierEnabled, githubEnabled = false, jiraEnabled = false, emailEnabled = false }) {
  const model = AVAILABLE_MODELS.find((m) => m.id === DEFAULT_MODEL);
  const pricingHint = formatModelPricing(model);

  const lede = freeTierEnabled
    ? 'Log in and let Harbour write the next prompt for a task, free to start, with no OpenRouter key needed. Want more? Connect your own key and keep going for pennies.'
    : 'Log in, connect your own OpenRouter key, and let Harbour write the next prompt for a task. You pay OpenRouter a few cents; Harbour charges nothing.';

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
        <p class="lx-try__scope">That covers writing prompts. Having Harbour run the work on a coding agent uses a larger, pricier model and can take a while, though it stays modest.</p>
        <div class="landing-ctas lx-try__ctas" data-testid="landing-try-ctas">
          ${renderSignInCtas({ githubEnabled, jiraEnabled, emailEnabled, idPrefix: 'landing-try-cta' })}
        </div>
      </div>
    </section>`;
}

/**
 * The Library section (LIN-3345, Part B of LIN-3342) — the discoverability
 * link from the homepage. Reads the same `START_HERE` data the Library index
 * uses (data-only, so the landing path builds no catalog) and lists the catalog
 * documents (`slug` items). The Archive item is skipped here (LIN-3980); the
 * Archive section below links it. Sits immediately above the Archive section.
 */
function renderLibrarySection() {
  // LIN-3980 outcome 5: the Archive item (`href`, START_HERE[0]) is left off
  // here. It led the Library list and the Archive section below linked the same
  // edition, so both led with one document. START_HERE, /library and llms.txt
  // still carry it.
  const items = START_HERE.filter(item => item.slug).map(item => {
    const href = `/library/${item.slug}`;
    return `<li class="lx-library__item">
        <a class="lx-library__link" href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>
        <span class="lx-library__note">${escapeHtml(item.note)}</span>
      </li>`;
  }).join('\n      ');
  return `<section class="lx-section lx-library" data-testid="landing-library" aria-labelledby="lx-library-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">the library</p>
        <h2 id="lx-library-h" class="lx-section__title">Read the work behind Harbour</h2>
        <p class="lx-section__lede">The papers and essays written while building Harbour — the ideas, the loops, and what it took to get the work done.</p>
      </div>
      <ol class="lx-library__list">
      ${items}
      </ol>
      <div class="lx-actions">${renderButton({ label: 'Visit the Library →', as: 'a', attrs: 'href="/library" data-testid="landing-library-link"' })}</div>
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
      const word = stageWord(r.kind);
      return `<span class="${cls}" title="${escapeHtml(word)}"><span class="lx-run__label">${escapeHtml(word)}</span></span>`;
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
        <span class="lx-meta"><span class="lx-meta__k">model</span> ${escapeHtml(s.model === 'opus' || s.model === 'sonnet' ? modelWord(s.model) : s.model)}</span>
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

/** The landing's `<title>`, and its shared-link title (LIN-3980). */
const LANDING_TITLE = 'Harbour — keep human intent in command of AI execution';

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
 * @param {boolean} [opts.emailEnabled] - Whether email sign-in is available
 *   (gates the hero email CTA; LIN-1892).
 * @param {string|null} [opts.setupNotice] - When 'setup', show the localhost
 *   getting-started notice (parity with the old landing).
 * @param {string|null} [opts.origin] - LIN-3980: the request's absolute origin
 *   (`requestOriginOrNull(req)`), for the canonical and social-preview tags.
 *   Null (the logout render has no request) leaves those tags out.
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
  emailEnabled = false,
  setupNotice = null,
  freeTierEnabled = false,
  origin = null,
} = {}) {
  // Homepage top bar removed (LIN-1508): `minimalNav` suppresses the shared
  // landing sign-in bar here only — the hero below is the homepage's sign-in
  // path — while swipe/swim/ship keep the same bar as their sole sign-in route.
  const navHtml = renderNavBar({ isLanding: true, minimalNav: true, featureFlags });
  const heroHtml = renderLandingHero({ githubEnabled, jiraEnabled, emailEnabled });
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
        <p class="lx-eyebrow">live runs</p>
        <h2 id="lx-obs-h" class="lx-section__title">Watch the work happen</h2>
        <p class="lx-section__lede">Every run you send out, live: what it is doing, how long it has taken, and the proof it has produced. Not a spinner, the actual work.</p>
      </div>
      <div class="lx-glimpse lx-obs" role="img" aria-label="Example live feed of three agent runs">
      ${observationHtml}
      </div>
    </section>

    <section class="lx-section lx-showcase" data-testid="landing-swim" aria-labelledby="lx-swim-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">swim lanes</p>
        <h2 id="lx-swim-h" class="lx-section__title">See the whole board at a glance</h2>
        <p class="lx-section__lede">Parallel tracks, with the dependencies drawn in. See what is ready, what is moving and what is held, before you send anything out.</p>
      </div>
      <div class="lx-glimpse lx-swim" role="img" aria-label="Example swim-lanes board with three lanes and a blocking dependency">
      ${swimHtml}
      </div>
    </section>

    <section class="lx-section lx-showcase" data-testid="landing-prompt" aria-labelledby="lx-prompt-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">checked prompts</p>
        <h2 id="lx-prompt-h" class="lx-section__title">Prompts that re-check your code first</h2>
        <p class="lx-section__lede">Each prompt is built from a fixed template, picked to fit the task, and checked against the repo as it is now before it runs.</p>
      </div>
      <div class="lx-glimpse lx-terminal" role="img" aria-label="Example prompt excerpt that checks the ticket against current code">
        <div class="lx-terminal__bar"><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__name">HAR-412 · ${escapeHtml(stageWord('implementation'))}</span></div>
        <pre class="lx-terminal__body"><span class="lx-c-dim"># Check the ticket against current code</span>
Before trusting the ticket, list the files it names and check
<span class="lx-c-key">git log -- lib/swim-graph.js</span> for changes since it was written.

<span class="lx-c-dim">## Task</span>
Cache the swim dependency graph so lanes stop recomputing
per request. Referenced: <span class="lx-c-path">lib/swim-graph.js</span>,
<span class="lx-c-path">lib/graph-features.js</span>.

<span class="lx-c-dim">## What CI cannot prove</span>
The cache invalidates on issue write — verify against a real
mutation, not a green build.</pre>
      </div>
    </section>

    ${renderTrySection({ freeTierEnabled, githubEnabled, jiraEnabled, emailEnabled })}

    <section class="lx-section lx-providers" data-testid="landing-providers" aria-labelledby="lx-prov-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">any backend</p>
        <h2 id="lx-prov-h" class="lx-section__title">One place, whatever tracks the work</h2>
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
          <p class="lx-section__lede">Harbour decides what work to do; <strong>Harbour OS</strong> is the in-browser workstation where the agent sessions run. Parent and child, like Apple and macOS: Harbour picks the work, Harbour OS runs it.</p>
          <div class="lx-actions">${renderButton({ label: 'Open Harbour OS →', variant: 'primary', as: 'a', attrs: 'href="https://os.harbour.cat" data-testid="landing-os-link"' })}</div>
        </div>
        <div class="lx-glimpse lx-terminal lx-os__glimpse" role="img" aria-label="Example dispatched session running in Harbour OS">
          <div class="lx-terminal__bar"><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__dot"></span><span class="lx-terminal__name">harbour os · session</span></div>
          <pre class="lx-terminal__body"><span class="lx-c-key">$</span> harbour dispatch HAR-412 --target local
<span class="lx-c-dim">→ session spawned, agent claimed the item</span>
<span class="lx-c-key">◐</span> ${escapeHtml(stageWord('implementation'))}  running   4m 12s
<span class="lx-c-dim">  [evidence] 3 files changed · tests green</span>
<span class="lx-c-key">$</span> _</pre>
        </div>
      </div>
    </section>

    ${renderLibrarySection()}

    <section class="lx-section lx-archive" data-testid="landing-archive" aria-labelledby="lx-archive-h">
      <div class="lx-section__head">
        <p class="lx-eyebrow">the archive</p>
        <h2 id="lx-archive-h" class="lx-section__title">Six months, preserved</h2>
        <p class="lx-section__lede">A museum of the Harbour project — two repositories and the machines that built them, January to July 2026.</p>
      </div>
      <div class="lx-actions">${renderButton({ label: 'Visit the Harbour Archive →', as: 'a', attrs: 'href="/archive/2" data-testid="landing-archive-link"' })}</div>
    </section>
  </main>
  ${footerHtml}`;

  return renderPageShell({
    title: LANDING_TITLE,
    stylesheets: ['/style.css', '/landing.css'],
    htmlComment: 'AI agents: see /llms.txt for navigation guidance',
    bodyClass: 'is-landing',
    nav: navHtml,
    scripts: ['/common.js', '/app.js'],
    content,
    followSystemTheme: true,
    headExtra: [
      descriptionTag(HARBOUR_PLAIN_SENTENCE),
      canonicalTag(origin ? `${origin}/` : ''),
      socialPreviewTags({ title: LANDING_TITLE, description: HARBOUR_PLAIN_SENTENCE, origin, path: '/' }),
    ].filter(Boolean).join('\n  '),
  });
}
