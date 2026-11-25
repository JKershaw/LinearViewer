/**
 * The page frame (LIN-4342, piece 1: LIN-4562).
 *
 * One renderer owns the chrome every page wears, so headings, tab titles, footers, the way back and search cannot
 * drift page by page again (the cause: ~35 renderers each assembled their own bar, header, footer and `<title>`).
 * A page hands `renderFrame` its place key, its name and its body, and keeps its own stylesheets and scripts.
 *
 * Signed in (`renderFrame`):
 *   - a skip link, the first Tab stop, landing in `<main id="main">`;
 *   - the rail (`<nav id="frame-rail">`): the wordmark, the workspace button (its menu switches and adds, never removes:
 *     removing lives in Settings), the search form, the places in their groups from lib/places.js, Settings at the foot,
 *     then the quiet AI status and the feedback trigger;
 *   - the phone band (shown below 760px by public/frame.css): ☰, the page's name, what is waiting, and search;
 *   - `<main>`: the "← <parent>" way back on a drilled-in page, one h1 (the page's name) and its subtitle, the optional
 *     `filters` line, then the page's body;
 *   - the footer, identical on every page, public ones included (`renderFrameFooter`);
 *   - the tab title `<Page> · <Workspace>`.
 * Exactly one rail item carries `aria-current`: the page itself, else its parent.
 *
 * Signed out or public (`renderPublicFrame`): no rail; a band with the wordmark (to `/`, or to the viewer's Home when
 * signed in), a way back, and Sign in or "Open your workspace"; the same `<main>` and footer; the tab title
 * `<Page> · Harbour`. The viewer comes from one helper, `frameViewer(session)`, so a route never decides it page by page.
 *
 * The questions count and the queue count are drawn wherever they show (rail and band) with the same hooks
 * (`data-rulings-badge`, `data-queue-badge`), and public/common.js's updaters write every copy.
 */
import { escapeHtml } from '../utils/html.js';
import { renderPage } from './page.js';
import { renderPageHeader } from './page-header.js';
import { renderWordmark } from './wordmark.js';
import { renderDeployInfo, renderAiStatus, renderFeedbackMount } from './footer.js';
import { workspaceAddProviders } from './navbar.js';
import { findWorkspaceByUrlKey } from '../workspace-lookup.js';
import { withHeldMarker } from '../held-connection-entry.js';
import { placeFor, litPlaceFor, placeHref, railFor, isDrilled } from '../places.js';

/** The repository the footer's Source link and the deploy stamp's commit point at. */
const SOURCE_URL = 'https://github.com/JKershaw/LinearViewer';

/** The footer's reading links, in order. The same on every page; the page you are on is not marked here. */
const FOOTER_LINKS = Object.freeze([
  { href: '/library', text: 'Library', key: 'library' },
  { href: '/templates', text: 'Templates', key: 'templates' },
  { href: '/privacy', text: 'Privacy', key: 'privacy' },
  { href: '/terms', text: 'Terms', key: 'terms' },
  { href: SOURCE_URL, text: 'Source', key: 'source' },
]);

const SEPARATOR = ' · ';

/** De-duplicates a list, keeping the first of each. */
const unique = (list) => [...new Set(list)];

/**
 * The footer: Library, Templates, Privacy, Terms, Source, and the deploy stamp. Identical on every page, signed in or
 * not; nothing in it depends on the page, the viewer or the workspace.
 * @param {Object} [deployInfo] - lib/deploy-info.js
 * @returns {string}
 */
export function renderFrameFooter(deployInfo = {}) {
  const links = FOOTER_LINKS.map(link => `<a href="${escapeHtml(link.href)}" class="frame-footer__link" data-testid="frame-footer-${link.key}">${escapeHtml(link.text)}</a>`)
    .join(SEPARATOR);
  // The stamp only when the deploy says what it is; with neither, Source already links the repository.
  const stamp = (deployInfo.version || deployInfo.commit)
    ? `<span class="frame-footer__stamp" data-testid="frame-footer-stamp">${renderDeployInfo(deployInfo)}</span>`
    : '';
  return `<footer class="frame-footer" data-testid="frame-footer">
      <nav class="frame-footer__links" aria-label="About Harbour">${links}</nav>${stamp}
    </footer>`;
}

/**
 * The questions count: "N questions", linking to the questions on Home. Drawn hidden; public/common.js
 * (updateRulingsBadge, questionsWords) fills and shows every copy, and hides it at zero. Owner with run controls only.
 */
function questionsCount(urlKey, where) {
  const href = `/workspace/${encodeURIComponent(urlKey)}/#waiting-on-you`;
  return `<a class="frame-count frame-count--needs-you rulings-badge hidden" data-rulings-badge data-url-key="${escapeHtml(urlKey)}" data-testid="${where}-questions" href="${escapeHtml(href)}" title="Open the questions waiting for you"><span class="rulings-count">0 questions</span></a>`;
}

/** The queue count on the Dispatch item, filled and shown by public/common.js (updateQueueBadge), hidden at zero. */
function queueCount(urlKey) {
  return `<span class="frame-count queue-count-badge hidden" data-queue-badge data-url-key="${escapeHtml(urlKey)}" data-testid="rail-queued"><span class="queue-count">0</span> queued</span>`;
}

/** One rail item. The lit place carries `aria-current`: `page` when it is the page, `true` when it is the parent. */
function railItem(place, { urlKey, lit, current, featureFlags }) {
  const isLit = lit && lit.key === place.key;
  const aria = isLit ? ` aria-current="${current ? 'page' : 'true'}"` : '';
  const counts = (place.key === 'dispatch' && featureFlags.runControls === true) ? ` ${queueCount(urlKey)}` : '';
  const link = `<a href="${escapeHtml(placeHref(place, urlKey))}" class="frame-rail__item${isLit ? ' is-lit' : ''}" data-testid="rail-place-${escapeHtml(place.key)}" data-place="${escapeHtml(place.key)}"${aria}><span class="frame-rail__label">${escapeHtml(place.label)}</span>${counts}</a>`;
  // Home carries what is waiting on you, as its own link beside the item (a link cannot hold a link).
  const beside = (place.key === 'home' && featureFlags.runControls === true) ? questionsCount(urlKey, 'rail') : '';
  return `<li class="frame-rail__row">${link}${beside}</li>`;
}

/**
 * The workspace menu: switch to another workspace, or add one. Removing a workspace is not here (Settings ›
 * Workspace). Switching keeps the place when everyone can reach it there, else lands on Home.
 */
function workspaceMenu({ workspaces, urlKey, lit }) {
  const list = Array.isArray(workspaces) ? workspaces.filter(Boolean) : [];
  const active = findWorkspaceByUrlKey(list, urlKey);
  const name = active?.name || urlKey || 'Workspace';
  // A place every viewer reaches keeps its path on switch; a gated one may not exist for them there.
  const keepPath = lit && !isDrilled(lit.key) && lit.who({}) ? lit.path : '/';
  const switchRows = list.map(ws => {
    const isActive = ws === active;
    return `<li><a href="/workspace/${encodeURIComponent(ws.urlKey)}${keepPath}" class="frame-menu__row" data-testid="rail-workspace-${escapeHtml(ws.urlKey)}"${isActive ? ' aria-current="true"' : ''}><span class="frame-menu__mark" aria-hidden="true">${isActive ? '●' : '○'}</span>${escapeHtml(ws.name || ws.urlKey)}</a></li>`;
  }).join('');
  // The add rows share one class and one spacing (the old menu spaced "+ Linear" and "+local workspace" differently).
  const addRows = workspaceAddProviders(list).map(p =>
    `<li><a href="${escapeHtml(withHeldMarker(p.entryCta.href, p))}" class="frame-menu__row frame-menu__add" data-testid="rail-workspace-add-${escapeHtml(p.name)}">+ ${escapeHtml(p.ui.displayName)}</a></li>`).join('');
  const localRow = `<li><form action="/workspace/new" method="POST" class="frame-menu__form"><button type="submit" class="frame-menu__row frame-menu__add" data-testid="rail-workspace-add-local">+ Local workspace</button></form></li>`;
  return `<div class="frame-workspace">
        <button type="button" class="frame-workspace__toggle" id="frame-workspace-toggle" aria-expanded="false" aria-controls="frame-workspace-menu" data-testid="rail-workspace-toggle"><span class="frame-workspace__label">Workspace</span> <span class="frame-workspace__name">${escapeHtml(name)}</span></button>
        <div class="frame-menu" id="frame-workspace-menu" hidden data-testid="rail-workspace-menu">
          <ul class="frame-menu__list" aria-label="Switch workspace">${switchRows}</ul>
          <ul class="frame-menu__list" aria-label="Add a workspace">${addRows}${localRow}</ul>
        </div>
      </div>`;
}

/** The search form in the rail: it goes to the search page, which finds tasks across the workspace. */
function railSearch(urlKey, q = '') {
  return `<form class="frame-search" role="search" action="/workspace/${encodeURIComponent(urlKey)}/search" method="get" data-testid="rail-search">
        <input type="search" name="q" class="frame-search__input" aria-label="Search tasks" placeholder="Search tasks" value="${escapeHtml(q)}" maxlength="200" autocomplete="off" data-testid="rail-search-input">
      </form>`;
}

/** The feedback trigger (LIN-2298), moved from the bar to the rail's foot. Same gate, test id and contract. */
function feedbackTrigger() {
  return '<button type="button" class="frame-rail__feedback nav-feedback-trigger" data-testid="nav-feedback-trigger" aria-expanded="false" aria-label="Give feedback" title="Give feedback" disabled>feedback</button>';
}

/**
 * The rail for one page and one person.
 * @returns {string}
 */
export function renderRail({ urlKey, workspaces = [], featureFlags = {}, openRouterSource = null, lit = null, current = false, q = '' } = {}) {
  const groups = railFor(featureFlags);
  const body = groups.filter(g => g.key !== 'settings').map(group => {
    const id = `frame-group-${group.key}`;
    const items = group.places.map(place => railItem(place, { urlKey, lit, current, featureFlags })).join('');
    return `<div class="frame-rail__group" data-group="${group.key}">
        <span class="frame-rail__group-title" id="${id}">${escapeHtml(group.label)}</span>
        <ul class="frame-rail__list" aria-labelledby="${id}">${items}</ul>
      </div>`;
  }).join('\n      ');
  const foot = groups.find(g => g.key === 'settings');
  const footItems = foot ? foot.places.map(place => railItem(place, { urlKey, lit, current, featureFlags })).join('') : '';
  const feedback = featureFlags.feedbackWidget === true ? feedbackTrigger() : '';
  return `<nav class="frame-rail" id="frame-rail" aria-label="Places" data-testid="frame-rail">
      <div class="frame-rail__top">
        ${renderWordmark({ context: 'rail', href: `/workspace/${encodeURIComponent(urlKey)}/` })}
        ${workspaceMenu({ workspaces, urlKey, lit })}
        ${railSearch(urlKey, q)}
      </div>
      ${body}
      <div class="frame-rail__foot">
        <ul class="frame-rail__list" aria-label="Settings">${footItems}</ul>
        <div class="frame-rail__status">${renderAiStatus(openRouterSource, urlKey)}${feedback}</div>
      </div>
    </nav>`;
}

/** The phone band: ☰, the page's name, what is waiting, and search. Hidden on desktop by public/frame.css. */
function band({ urlKey, pageName, featureFlags }) {
  const waiting = featureFlags.runControls === true ? questionsCount(urlKey, 'band') : '';
  return `<header class="frame-band" data-testid="frame-band">
      <button type="button" class="frame-band__menu" aria-label="Open the menu" aria-controls="frame-rail" aria-expanded="false" data-testid="frame-band-menu">☰</button>
      <span class="frame-band__name" data-testid="frame-band-name">${escapeHtml(pageName)}</span>
      ${waiting}
      <a class="frame-band__search" href="/workspace/${encodeURIComponent(urlKey)}/search" data-testid="frame-band-search">Search</a>
    </header>`;
}

/** `<main>`: the way back, the page's one h1 and subtitle, the filter line, then the body. */
function main({ pageName, subtitle, subtitleHtml, back, filters, content }) {
  const backHtml = back
    ? `<a class="frame-back" href="${escapeHtml(back.href)}" data-testid="frame-back">← ${escapeHtml(back.label)}</a>`
    : '';
  const filtersHtml = filters ? `\n      ${filters}` : '';
  return `<main id="main" class="frame-main" tabindex="-1" data-testid="frame-main">
      ${backHtml}${renderPageHeader({ title: pageName, subtitle, subtitleHtml, headerClass: 'frame-head' })}${filtersHtml}
      ${content}
    </main>`;
}

const SKIP_LINK = '<a class="frame-skip" href="#main" data-testid="frame-skip">Skip to the page</a>';

/** The page's own scripts with common.js first (the counts' updaters live there) and frame.js last. */
function frameScripts(scripts) {
  const rest = scripts.filter(s => s !== '/common.js');
  return ['/common.js', ...rest, { module: '/frame.js' }];
}

/** The page's own sheets with style.css first and frame.css last, so the frame's layout has the last word. */
function frameSheets(stylesheets) {
  return unique(['/style.css', ...stylesheets, '/frame.css']);
}

/**
 * Render a signed-in page in the frame.
 *
 * @param {Object} opts
 * @param {string} opts.place - a place or drilled-in key from lib/places.js (an unknown key throws)
 * @param {string} [opts.title] - the page's name: the h1, the band and the tab title. Defaults to the registry label.
 * @param {string} [opts.subtitle] - the line under the h1 (escaped)
 * @param {string} [opts.subtitleHtml] - the line under the h1, pre-built (raw)
 * @param {string} [opts.from] - a task page's parent: 'home' or 'backlog' (where the person came from)
 * @param {string} opts.urlKey - the workspace
 * @param {string} [opts.workspaceName] - the workspace's name, for the tab title
 * @param {Array} [opts.workspaces] - the session's workspaces, for the menu
 * @param {Object} [opts.featureFlags] - requestFeatureFlags(req)
 * @param {string|null} [opts.openRouterSource]
 * @param {Object} [opts.deployInfo]
 * @param {Object} [opts.dispatchDefaults] - for the feedback widget's mount
 * @param {string} [opts.filters] - the page filter line (navbar.js renderFilterLine)
 * @param {string} [opts.q] - the search text, echoed in the rail's field (the search page)
 * @param {string} [opts.content] - the page's body
 * @param {string[]} [opts.stylesheets] - the page's sheets (style.css is added first, frame.css last)
 * @param {Array<string|{module: string}>} [opts.scripts] - the page's scripts (common.js first, frame.js last)
 * @param {string} [opts.bodyClass]
 * @param {string} [opts.bodyAttrs]
 * @param {string} [opts.headExtra]
 * @param {{globalVar: string, value: *}} [opts.embeddedData]
 * @returns {string} the complete document
 */
export function renderFrame({
  place, title, subtitle, subtitleHtml, from,
  urlKey, workspaceName, workspaces = [], featureFlags = {}, openRouterSource = null, deployInfo = {}, dispatchDefaults = {},
  filters = '', q = '', content = '', stylesheets = [], scripts = [], bodyClass, bodyAttrs, headExtra, embeddedData,
} = {}) {
  const entry = placeFor(place);
  if (!entry) throw new Error(`renderFrame: ${JSON.stringify(place)} is not in lib/places.js`);
  if (!urlKey) throw new Error('renderFrame: a signed-in page needs its urlKey (renderPublicFrame draws the public frame)');
  const pageName = title || entry.label;
  const lit = litPlaceFor(entry.key, { from, flags: featureFlags });
  // The page is its own lit place only when the rail shows it; otherwise it is drilled in under what is lit, and the
  // way back goes there (a drilled-in page, or a gated page reached by its URL or a link).
  const current = lit?.key === entry.key;
  const back = !current && lit ? { href: placeHref(lit, urlKey), label: lit.label } : null;
  const wsName = workspaceName || findWorkspaceByUrlKey(workspaces, urlKey)?.name || 'Workspace';
  const feedbackMount = renderFeedbackMount(urlKey, featureFlags, dispatchDefaults);
  return renderPage({
    title: `${escapeHtml(pageName)} · ${escapeHtml(wsName)}`,
    stylesheets: frameSheets(stylesheets),
    bodyClass: ['frame-body', bodyClass].filter(Boolean).join(' '),
    bodyAttrs: [`data-place="${escapeHtml(entry.key)}"`, bodyAttrs].filter(Boolean).join(' '),
    headExtra,
    embeddedData,
    scripts: frameScripts(scripts),
    content: `${SKIP_LINK}
  <div class="frame" data-testid="frame">
    ${band({ urlKey, pageName, featureFlags })}
    ${renderRail({ urlKey, workspaces, featureFlags, openRouterSource, lit, current, q })}
    <div class="frame-scrim" data-testid="frame-scrim" hidden></div>
    <div class="frame-page">
    ${main({ pageName, subtitle, subtitleHtml, back, filters, content })}
    ${renderFrameFooter(deployInfo)}
    </div>
  </div>${feedbackMount}`,
  });
}

/**
 * Who is looking at a public page, from the session alone: signed in (with a Home to go back to) or not. The one
 * helper every public route passes through, so no page decides it for itself.
 * @param {Object|null|undefined} session - req.session
 * @returns {{signedIn: boolean, homeHref: string|null, workspaceName: string|null}}
 */
export function frameViewer(session) {
  const workspaces = Array.isArray(session?.workspaces) ? session.workspaces.filter(w => w?.urlKey) : [];
  if (workspaces.length === 0) return { signedIn: false, homeHref: null, workspaceName: null };
  const active = workspaces.find(w => w.id && w.id === session.activeWorkspaceId) || workspaces[0];
  return { signedIn: true, homeHref: `/workspace/${encodeURIComponent(active.urlKey)}/`, workspaceName: active.name || null };
}

/**
 * Render a public or signed-out page in the public frame: no rail, a band with the wordmark, a way back, and Sign in
 * (or, signed in, "Open your workspace"), then the same `<main>` and footer as every page.
 *
 * @param {Object} opts
 * @param {string} opts.title - the page's name: the h1 and the tab title (`<Page> · Harbour`)
 * @param {string} [opts.subtitle]
 * @param {string} [opts.subtitleHtml]
 * @param {{signedIn: boolean, homeHref: string|null}} [opts.viewer] - frameViewer(req.session)
 * @param {{href: string, label: string}} [opts.back] - the way back; defaults to Harbour's front page
 * @param {string} [opts.signIn] - the sign-in control(s), pre-built (a preview passes its own CTAs); defaults to one link
 * @param {Object} [opts.deployInfo]
 * @param {string} [opts.content]
 * @param {string[]} [opts.stylesheets]
 * @param {Array<string|{module: string}>} [opts.scripts]
 * @param {string} [opts.bodyClass]
 * @param {string} [opts.headExtra]
 * @returns {string} the complete document
 */
export function renderPublicFrame({
  title, subtitle, subtitleHtml, viewer = { signedIn: false, homeHref: null }, back, signIn, deployInfo = {},
  content = '', stylesheets = [], scripts = [], bodyClass, headExtra,
} = {}) {
  if (!title) throw new Error('renderPublicFrame: a page needs its name');
  const signedIn = viewer?.signedIn === true && !!viewer.homeHref;
  const home = signedIn ? viewer.homeHref : '/';
  const way = back || { href: '/', label: 'Harbour' };
  const action = signedIn
    ? `<a class="frame-public__action" href="${escapeHtml(viewer.homeHref)}" data-testid="frame-open-workspace">Open your workspace</a>`
    : (signIn || '<a class="frame-public__action" href="/" data-testid="frame-sign-in">Sign in</a>');
  return renderPage({
    title: `${escapeHtml(title)} · Harbour`,
    stylesheets: frameSheets(stylesheets),
    bodyClass: ['frame-body', 'frame-body--public', bodyClass].filter(Boolean).join(' '),
    headExtra,
    scripts: unique(scripts),
    content: `${SKIP_LINK}
  <div class="frame frame--public" data-testid="frame">
    <header class="frame-public" data-testid="frame-public-band">
      ${renderWordmark({ context: 'rail', href: home })}
      <a class="frame-back frame-public__back" href="${escapeHtml(way.href)}" data-testid="frame-back">← ${escapeHtml(way.label)}</a>
      <span class="frame-public__actions">${action}</span>
    </header>
    <div class="frame-page">
    ${main({ pageName: title, subtitle, subtitleHtml, back: null, filters: '', content })}
    ${renderFrameFooter(deployInfo)}
    </div>
  </div>`,
  });
}
