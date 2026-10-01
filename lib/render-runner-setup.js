/**
 * Runner setup page renderer (LIN-3098 S4): `/workspace/:urlKey/runner`.
 *
 * Where a workspace owner turns their own Claude Code session into this
 * workspace's runner, from a phone if need be: tap 1 mints the runner
 * credential (LIN-3059's `getRunnerBootstrap`, public/common.js), tap 2 copies
 * the served runner prompt plus the credential block (public/runner-setup.js).
 *
 * Provider-free and logic-free: the route decides the state and builds the
 * prompt (lib/prompts/runner-kickoff.js); this only renders them. The state
 * decides what can be pressed:
 *
 *   owner               the mint and copy controls
 *   owner-dispatch-off  the same, plus a note that "run this step" needs the
 *                       Dispatch queue on
 *   proxy-off           a notice with a Settings link; no mint (it would 403)
 *   not-owner           a notice; the server mint stays authoritative anyway
 *   no-owner            a notice: the workspace has no recorded owner
 *   unavailable         a notice: the owner check failed; try again
 *
 * `data-account-id` is emitted in the owner states only: it becomes the
 * credential block's `ownerAccountId`. No token is ever rendered here; the
 * bootstrap exists only in the browser, after the mint.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { RUNNER_BOOTSTRAP_TTL_SECONDS, RUNNER_WORKING_TTL_SECONDS } from './proxy-scopes.js';

export const RUNNER_SETUP_STATES = Object.freeze(['owner', 'owner-dispatch-off', 'proxy-off', 'not-owner', 'no-owner', 'unavailable']);

const OWNER_STATES = new Set(['owner', 'owner-dispatch-off']);

function notice(state, key) {
  const settings = `<a href="/workspace/${key}/settings">Settings</a>`;
  switch (state) {
    case 'proxy-off':
      return `A runner reaches this workspace through workspace API access, which is off for you. Turn it on in ${settings}, then come back here.`;
    case 'not-owner':
      return 'Only this workspace\'s owner can set up a runner for it. Ask the owner, or sign in as the owner.';
    case 'no-owner':
      return 'This workspace has no recorded owner yet, so a runner can\'t be set up. Workspaces made before ownership tracking need an operator to assign an owner.';
    case 'unavailable':
      return 'Couldn\'t verify who owns this workspace right now. Try again in a minute.';
    default:
      return '';
  }
}

/**
 * @param {Object} data
 * @param {string} data.state      - one of RUNNER_SETUP_STATES
 * @param {string} data.urlKey
 * @param {string} [data.accountId] - the session account (owner states only)
 * @param {string} data.prompt     - the served runner prompt (buildRunnerKickoff)
 * @param {string} data.baseUrl    - this request's Harbour base URL
 * @param {Object} [options]       - page chrome: deployInfo, openRouterSource, workspaces, featureFlags
 * @returns {string} Complete HTML document.
 */
export function renderRunnerSetupPage(data = {}, options = {}) {
  const { state, urlKey = '', accountId = '', prompt = '', baseUrl = '' } = data;
  const { deployInfo = {}, openRouterSource = null, workspaces = [], featureFlags = {} } = options;
  const key = escapeHtml(urlKey);
  const isOwner = OWNER_STATES.has(state);
  const bootstrapHours = RUNNER_BOOTSTRAP_TTL_SECONDS / 3600;
  const workingHours = RUNNER_WORKING_TTL_SECONDS / 3600;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'runner', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/runner', urlKey, openRouterSource, featureFlags });

  const introBody = `<p class="runner-setup-lede">Turn your own Claude Code session into this workspace's runner. It takes the work you dispatch here and runs each item in its own subagent, on your machine, with no Simple Dispatcher.</p>
      <ol class="runner-setup-steps">
        <li>Tap <strong>create runner prompt</strong>.</li>
        <li>Tap <strong>copy</strong>.</li>
        <li>Within ${bootstrapHours}h, paste it into Claude Code on your laptop.</li>
      </ol>`;

  const controls = isOwner
    ? `<div class="runner-setup-controls">
        <button type="button" class="action-btn save runner-setup-btn" data-testid="runner-setup-mint">create runner prompt</button>
        <button type="button" class="action-btn runner-setup-btn" data-testid="runner-setup-copy" hidden>copy</button>
        <span class="runner-setup-feedback" data-testid="runner-setup-copy-feedback" aria-live="polite"></span>
      </div>
      <p class="runner-setup-error" data-testid="runner-setup-error" role="alert" hidden></p>
      <p class="runner-setup-fallback" data-testid="runner-setup-fallback" hidden>Copying didn't work here. The text below is selected: long-press it and choose <strong>Copy</strong>.</p>
      <textarea class="runner-setup-output" data-testid="runner-setup-output" readonly rows="8" spellcheck="false" autocomplete="off" aria-label="runner prompt and credential" placeholder="Your runner prompt and credential appear here."></textarea>`
    : `<p class="runner-setup-notice" data-testid="runner-setup-notice">${notice(state, key)}</p>`;

  const dispatchNote = state === 'owner-dispatch-off'
    ? `<p class="runner-setup-note" data-testid="runner-setup-dispatch-note">To use <strong>run this step</strong> on a task, also turn on the Dispatch queue in <a href="/workspace/${key}/settings">Settings</a>. With it off, Harbour's task pages can't send work to your runner: <strong>run this step</strong> and the dispatch buttons both need it.</p>`
    : '';

  const setupBody = `${controls}
      ${dispatchNote}
      <p class="runner-setup-links">Revoke it any time in <a href="/workspace/${key}/proxy#proxy-runner-credentials">Runner credentials</a>.</p>`;

  const honestyBody = `<ul class="runner-setup-facts">
        <li><strong>Claude Code only.</strong> opencode has no subagents, so it can't be this runner. You need Node 18+ and macOS or Linux (the kit uses Unix sockets); Windows isn't supported.</li>
        <li><strong>The credential.</strong> The copy carries a single-use bootstrap that expires ${bootstrapHours}h after you create it: if more than ${bootstrapHours}h passes before you paste, mint again. Pasted, it becomes a runner credential that lives ${workingHours}h.</li>
        <li><strong>Owner-only, always.</strong> The runner runs only items the workspace owner enqueued, and wakes of the owner's own dispatches; anything else stays queued. Until T3 (LIN-3136) enforces the dispatch grant, anyone with a read-write token here can enqueue work, and the runner executes it on your machine, so the rule holds after T3 as well.</li>
        <li><strong>If the laptop sleeps</strong>, everything pauses and the runner picks up again when it wakes. <strong>If the laptop closes</strong>, or the session ends, the runner is gone: rows it took stay <code>taken</code> until Harbour's history expires them (30 days), and a parent Autopilot waiting on one hangs. Re-dispatch the task. The next runner session closes out what it can.</li>
        <li><strong>The same-user boundary.</strong> Subagents never receive a token. But the runner credential rests in a credential file on your machine (mode 600), and each item's broker listens on a same-user socket: any process running as the same OS user, subagents included, could read that file or use a live broker. Run only work you'd run yourself.</li>
      </ul>`;

  const promptBody = `<details class="runner-setup-prompt-details">
        <summary>show the prompt</summary>
        <pre class="runner-setup-prompt" data-testid="runner-setup-prompt">${escapeHtml(prompt)}</pre>
      </details>`;

  const mainAttrs = [
    'class="runner-setup-page"',
    'data-testid="runner-setup-page"',
    `data-state="${escapeHtml(state)}"`,
    `data-url-key="${key}"`,
    ...(isOwner ? [`data-account-id="${escapeHtml(accountId)}"`, `data-base-url="${escapeHtml(baseUrl)}"`] : [])
  ].join(' ');

  return renderPage({
    title: 'Run on my machine',
    stylesheets: ['/style.css', '/common-actions.css', '/runner-setup.css'],
    nav: navBarHtml,
    scripts: ['/common.js', '/runner-setup.js'],
    content: `<main ${mainAttrs}>
    ${renderPageHeader({ title: 'Run on my machine', subtitle: 'Make your own Claude Code session this workspace\'s runner.' })}

    ${renderSection({ boxed: true, className: 'runner-setup-section', titleClass: 'section-header', title: 'How it works', body: introBody })}

    ${renderSection({ boxed: true, className: 'runner-setup-section', titleClass: 'section-header', title: 'Set up', body: setupBody })}

    ${renderSection({ boxed: true, className: 'runner-setup-section', titleClass: 'section-header', title: 'Before you start', body: honestyBody })}

    ${renderSection({ boxed: true, className: 'runner-setup-section', titleClass: 'section-header', title: 'The runner prompt', body: promptBody })}
  </main>
  ${footerHtml}`,
  });
}
