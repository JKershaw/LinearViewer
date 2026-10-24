/**
 * Settings › "You" areas (LIN-3846): Account and Features.
 *
 * Both are per-user, so nothing here is a change for everyone and nothing
 * needs the change log: switches apply at once (with inline Undo in
 * public/app.js), the theme and "use my key when I'm away" apply at once.
 * Split from render-settings.js so neither file passes ~1000 lines; it
 * imports nothing from there (the consent copy lives here and is re-exported).
 */

import { escapeHtml } from './utils/html.js';
import { FEATURE_DEFAULTS, FEATURE_LABELS, EXPERIMENTAL_VIEWS } from './feature-defaults.js';
import { isEmailSignInAvailable } from './email-availability.js';
import { switchRow, drillRow, actionRow, group } from './render-settings-shell.js';

/**
 * Blast-radius copy for OpenRouter unattended-use consent (LIN-2412, C4).
 * Consent gates the connecting account's key funding unattended,
 * workspace-scoped work whose triggering activity can come from ANY member
 * of a shared workspace, not just the consenting account's own — the
 * deliberate inverse of the interactive proxy path's posture. Shown wherever
 * a user is offered the chance to grant it. Exported (re-exported by
 * render-settings.js) so the GET /auth/openrouter consent interstitial shares
 * this exact copy rather than a forked restatement.
 */
export const OPENROUTER_CONSENT_BLAST_RADIUS_COPY = 'Connecting here lets Harbour use your OpenRouter key for unattended work in every workspace you’re a member of — even work triggered by another member.';

/** What reads the consent today (LIN-3846: say what it does, no more). */
export const CONSENT_READER_COPY = 'Today only the 15-minute observer pass reads this. It is report-only.';

/** Free-tier limit, as `FREE_TIER_RUN_LIMIT` (lib/plan-allowance.js) enforces it. */
export const FREE_TIER_COPY = 'The free tier limits new runs per account per UTC day and resets at midnight UTC. Follow-ups and wakes do not count, and prompts are not limited.';

/** Settings-side link labels for each experimental feature (the nav needs short ones, LIN-1247). */
const EXPERIMENTAL_LINK_LABELS = {
  collective: 'Open the discussion page',
  taskChat: 'Open the task chat page',
  ship: 'Open the radial view',
  nextRun: 'Open the next-run suggester',
  flightCompanion: 'Open the flight companion',
  passagePlanner: 'Open the passage planner',
  shipBiscuit: "Open The Ship's Biscuit",
  liveConsole: 'Open the live console',
  shipJourney: 'Open the ship journey'
};

const workspaceUrl = (urlKey, suffix) => `/workspace/${encodeURIComponent(urlKey)}${suffix}`;

const consentNotice = () => `<p class="settings-note consent-notice" data-testid="settings-openrouter-consent-notice">${escapeHtml(OPENROUTER_CONSENT_BLAST_RADIUS_COPY)}</p>`;

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/** The OpenRouter connection, its unattended-use consent, as rows. */
function openRouterRows(source, consentedAt) {
  const connectLink = (text) => `<a href="/auth/openrouter" class="action-btn connect" data-testid="settings-openrouter-connect">${text}</a>`;
  const statusValue = (cls, text, attrs = '') => `<span class="settings-value ${cls}"${attrs}>${text}</span>`;
  const line = (label, valueHtml, extraHtml = '') => `
      <div class="settings-row settings-row-static line">
        <span class="settings-row-label">${label}</span>
        <span class="settings-row-value">${valueHtml}</span>${extraHtml}
      </div>`;

  if (source === 'oauth') {
    const consentRow = consentedAt
      ? line('Use my key when I’m away', statusValue('consent-granted', '✓ enabled', ' data-testid="settings-openrouter-consent-status"'),
        `<form action="/auth/openrouter/consent/clear" method="POST" class="settings-form"><button type="submit" class="action-btn consent-clear" data-testid="settings-openrouter-consent-clear">turn off</button></form>`)
      : line('Use my key when I’m away', statusValue('consent-pending', '○ not enabled', ' data-testid="settings-openrouter-consent-status"'),
        `<form action="/auth/openrouter/consent" method="POST" class="settings-form"><button type="submit" class="action-btn consent-grant" data-testid="settings-openrouter-consent-grant">enable</button></form>`);
    return `${line('OpenRouter', statusValue('connected', '● connected', ' data-testid="settings-openrouter-status"'),
      `<form action="/auth/openrouter/disconnect" method="POST" class="settings-form"><button type="submit" class="action-btn disconnect settings-action-red" data-testid="settings-openrouter-disconnect">disconnect</button></form>`)}${consentRow}${consentedAt ? '' : consentNotice()}
      <p class="settings-note">${escapeHtml(CONSENT_READER_COPY)}</p>`;
  }
  if (source === 'env') {
    return line('OpenRouter', statusValue('env', '● env key', ' data-testid="settings-openrouter-status"'));
  }
  if (source === 'free') {
    return `${line('OpenRouter', statusValue('free-tier', '● free tier', ' data-free-tier-status data-testid="settings-openrouter-status"'), connectLink('connect for unlimited runs'))}
      <div class="settings-row settings-row-static line"><span class="settings-row-label">Runs</span><span class="settings-row-value" data-free-tier-usage>Loading…</span></div>
      <p class="settings-note">${escapeHtml(FREE_TIER_COPY)}</p>${consentNotice()}`;
  }
  return `${line('OpenRouter', statusValue('disconnected', '○ not connected', ' data-testid="settings-openrouter-status"'), connectLink('connect'))}${consentNotice()}`;
}

/** The theme as two visible choices, posting the existing route (works with no script). */
function themeRow(urlKey, theme) {
  const action = workspaceUrl(urlKey, '/settings/theme');
  const choice = (value, label) => `
        <form action="${escapeHtml(action)}" method="POST" class="settings-form settings-theme-form">
          <input type="hidden" name="theme" value="${value}">
          <button type="submit" class="settings-theme-choice${theme === value ? ' is-selected' : ''}" data-theme-choice="${value}" data-url-key="${escapeHtml(urlKey)}" aria-pressed="${theme === value ? 'true' : 'false'}" data-testid="settings-theme-${value}">${label}</button>
        </form>`;
  return `
      <div class="settings-row settings-row-static line" data-testid="settings-theme">
        <span class="settings-row-label">Theme</span>
        <span class="settings-segmented" role="group" aria-label="Theme">${choice('light', 'Light')}${choice('dark', 'Dark')}
        </span>
      </div>`;
}

export function accountBody({ accountEmails = [], urlKey, workspaces = [], openRouterSource = null, openRouterConsentedAt = null, theme = 'light' }) {
  const settingsPath = workspaceUrl(urlKey, '/settings/account');
  let emailRow = '';
  if (accountEmails.length) {
    emailRow = `
      <div class="settings-row settings-row-static line"><span class="settings-row-label">Email</span><span class="settings-row-value settings-value" data-testid="settings-account-emails">${accountEmails.map(escapeHtml).join(', ')}</span></div>`;
  } else if (isEmailSignInAvailable()) {
    emailRow = `
      <a class="settings-row settings-row-action settings-action-teal" href="/auth/email/register?next=${encodeURIComponent(settingsPath)}" data-testid="settings-account-add-email">Add email →</a>`;
  }
  const names = (workspaces || []).map(w => w.name || w.urlKey).filter(Boolean);
  const workspacesRow = names.length
    ? `
      <div class="settings-row settings-row-static line"><span class="settings-row-label">Workspaces</span><span class="settings-row-value">${names.map(escapeHtml).join(', ')}</span></div>`
    : '';
  const signOut = workspaces?.some(w => w.isPAT)
    ? `
      <a href="/logout" class="action-btn logout settings-action-red" data-testid="settings-logout">refresh session</a> <span class="settings-note">PAT mode — session restores automatically</span>`
    : `
      <a href="/logout" class="action-btn logout settings-action-red" data-testid="settings-logout">logout</a>`;

  return group({
    title: 'For you',
    testid: 'settings-section-account',
    note: 'These apply to your account, in every workspace.',
    rowsHtml: `${emailRow}${workspacesRow}${themeRow(urlKey, theme)}${openRouterRows(openRouterSource, openRouterConsentedAt)}${signOut}`
  });
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export function featuresBody({ urlKey, featureFlags = FEATURE_DEFAULTS, proxyDefault = true }) {
  const action = workspaceUrl(urlKey, '/settings/features');
  const isOn = (key) => featureFlags[key] ?? FEATURE_DEFAULTS[key];
  const flag = (key) => switchRow({ key, label: FEATURE_LABELS[key] || key, on: !!isOn(key), action });

  // The +proxy default posts JSON (the route accepts only a boolean), so the
  // client (public/settings.js) intercepts `data-settings-json`; the
  // button is the same switch shape as every other row.
  const proxyRow = `
      <div class="settings-row settings-row-switch line feature-toggle" data-feature="proxyDefault" data-testid="settings-toggle-proxyDefault">
        <span class="settings-row-label">Add a task key to copied prompts<span class="settings-row-note">your default for the +proxy option</span></span>
        <form action="${escapeHtml(workspaceUrl(urlKey, '/settings/proxy-default'))}" method="POST" class="settings-form" data-settings-json="proxyDefault" data-value="${proxyDefault ? 'true' : 'false'}">
          <button type="submit" class="toggle-btn settings-json-toggle ${proxyDefault ? 'toggle-on' : 'toggle-off'}" role="switch" aria-checked="${proxyDefault ? 'true' : 'false'}" aria-label="Add a task key to copied prompts"><span class="toggle-state">${proxyDefault ? '● on' : '○ off'}</span></button>
        </form>
      </div>`;

  const experiments = EXPERIMENTAL_VIEWS.map(({ flag: key, path }) =>
    flag(key) + (isOn(key) ? actionRow({ label: EXPERIMENTAL_LINK_LABELS[key], href: workspaceUrl(urlKey, `/${path}`), testid: `settings-open-${key}` }) : '')
  ).join('');

  const prompts = group({
    title: 'Prompts · for you',
    testid: 'settings-section-prompts',
    rowsHtml: `${proxyRow}${drillRow({ label: 'Step catalogue', value: 'Prompts', href: workspaceUrl(urlKey, '/prompts'), testid: 'settings-link-prompts' })}${drillRow({ label: 'Custom prompts', value: 'Shared with the workspace', href: workspaceUrl(urlKey, '/prompts/custom'), testid: 'settings-link-custom-prompts' })}`,
    note: 'Custom prompts are shared with everyone in the workspace; the toggle above is only yours.'
  });
  const views = group({
    title: 'Views · for you',
    testid: 'settings-section-experimental',
    rowsHtml: `${flag('roadmap')}${experiments}`,
    note: 'The nine experiments are rough drafts: they may change or disappear.'
  });
  const feedback = group({
    title: 'Feedback · for you',
    testid: 'settings-section-workflow',
    rowsHtml: flag('feedbackWidget')
  });
  return `${prompts}${views}${feedback}`;
}
