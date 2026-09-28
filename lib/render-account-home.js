/**
 * The account home (LIN-1892 S2 item 6): the page a signed-in account with
 * ZERO workspaces lands on — today, an email-only sign-in.
 *
 * It shows the account's email identity, the providers' "add a source" CTAs
 * (from the registry's `entryCta`, gated on each `isConfigured()`), the local
 * workspace form, logout, and one plain line saying what this ticket does NOT
 * ship (C6): workspaces don't follow a person to a new device yet, so each
 * source is reconnected here. Cross-device restore is follow-up work behind
 * LIN-2149; this page must not claim it.
 *
 * Imported only by routes/email-auth.js. It imports downward into the
 * provider/auth import cycle (the registry, and `renderLocalWorkspaceCta`),
 * which is allowed: no cycle member imports this module (N6).
 */
import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageHeader } from './components/page-header.js';
import { getAllProviders } from './providers/index.js';
import { renderLocalWorkspaceCta } from './render-pages.js';

export const ACCOUNT_HOME_C6_LINE = "Workspaces don't follow you to a new device yet: reconnect a source here.";

/**
 * The "add a source" CTAs, in registry order: every provider with an
 * `entryCta` whose `isConfigured()` is true (Linear always; GitHub and Jira
 * when their apps are configured; GitHub Projects and Local have none).
 * @returns {Array<{name: string, label: string, href: string}>}
 */
export function accountHomeSourceCtas() {
  return getAllProviders()
    .filter(provider => provider.entryCta && provider.entryCta.isConfigured())
    .map(provider => ({
      name: provider.name,
      label: provider.ui?.displayName || provider.name,
      href: provider.entryCta.href,
    }));
}

/**
 * @param {Object} options
 * @param {string[]} [options.emails] - the account's email identities (normalised)
 * @returns {string} Full HTML document
 */
export function renderAccountHomePage({ emails = [] } = {}) {
  const who = emails.length
    ? `<p class="error-message" data-testid="account-home-email">Signed in as ${emails.map(escapeHtml).join(', ')}</p>`
    : `<p class="error-message" data-testid="account-home-email">Signed in</p>`;
  const ctas = accountHomeSourceCtas()
    .map(cta => `<a href="${escapeHtml(cta.href)}" class="login-button" data-testid="account-home-add-${escapeHtml(cta.name)}">Connect ${escapeHtml(cta.label)}</a>`)
    .join('\n      ');

  return renderPage({
    title: 'Your account - Harbour',
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Harbour' })}
  <div class="login-container" data-testid="account-home">
    <h2 class="error-title">Add a source</h2>
    ${who}
    <p data-testid="account-home-c6">${escapeHtml(ACCOUNT_HOME_C6_LINE)}</p>
    <div class="account-home-sources" data-testid="account-home-sources">
      ${ctas}
    </div>
    ${renderLocalWorkspaceCta()}
    <a href="/logout" class="error-home-link" data-testid="account-home-logout">Log out</a>
  </div>`,
  });
}
