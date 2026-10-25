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
 * provider/auth import cycle (the registry, and the local-workspace form spec),
 * which is allowed: no cycle member imports this module (N6).
 *
 * LIN-3956: the first Plain page with both `rows` and a `form`. It renders through
 * `renderPlainDocument`, which links settings.css because it has rows; the sections are the
 * account's identity, the source rows, the local-workspace form, and the session row.
 */
import { escapeHtml } from './utils/html.js';
import { renderPlainDocument } from './components/plain-page.js';
import { actionRow } from './components/settings-row.js';
import { getAllProviders } from './providers/index.js';
import { LOCAL_WORKSPACE_FORM } from './render-pages.js';

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
    ? `Signed in as ${emails.map(escapeHtml).join(', ')}`
    : 'Signed in';
  const ctas = accountHomeSourceCtas()
    .map(cta => actionRow({ href: cta.href, label: `Connect ${cta.label}`, testid: `account-home-add-${cta.name}` }))
    .join('');

  return renderPlainDocument({
    title: 'Your account - Harbour',
    plain: {
      brand: true,
      title: 'Add a source',
      attrs: 'data-testid="account-home"',
      sections: [
        {
          kind: 'html',
          title: 'Your account',
          body: `<p data-testid="account-home-email">${who}</p>\n      <p data-testid="account-home-c6">${escapeHtml(ACCOUNT_HOME_C6_LINE)}</p>`,
        },
        ...(ctas ? [{ kind: 'rows', title: 'Add a source', rowsHtml: ctas, testid: 'account-home-sources' }] : []),
        { kind: 'form', title: 'Create a local workspace', ...LOCAL_WORKSPACE_FORM },
        { kind: 'rows', title: 'Session', rowsHtml: actionRow({ href: '/logout', label: 'Log out', testid: 'account-home-logout' }) },
      ],
    },
  });
}
