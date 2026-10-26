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
import { switchRow, drillRow, actionRow, staticRow } from './components/settings-row.js';
import { group, statusLine } from './components/settings-group.js';

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
export const FREE_TIER_COPY = 'Free tier: a daily limit on new runs, reset at midnight UTC. Prompts are not limited.';

const workspaceUrl = (urlKey, suffix) => `/workspace/${encodeURIComponent(urlKey)}${suffix}`;

const consentNotice = () => `<p class="settings-note consent-notice" data-testid="settings-openrouter-consent-notice">${escapeHtml(OPENROUTER_CONSENT_BLAST_RADIUS_COPY)}</p>`;

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/**
 * The AI key group (LIN-3890 outcome 1): the OpenRouter connection, its unattended-use consent and
 * the free-tier usage, one row each. The full consent copy stays where it was offered (shared with
 * GET /auth/openrouter, not reworded); the group's note is one line.
 */
function openRouterRows(source, consentedAt) {
  // The connect action is the shared quiet button, not the blue chip (LIN-3952 leftovers).
  const connectLink = (text) => `<a href="/auth/openrouter" class="btn--quiet" data-testid="settings-openrouter-connect">${text}</a>`;
  const statusValue = (cls, text, attrs = '') => `<span class="settings-value ${cls}"${attrs}>${text}</span>`;
  const line = (label, valueHtml, extraHtml = '') => staticRow({ label, valueHtml, extraHtml });

  if (source === 'oauth') {
    const consentRow = consentedAt
      ? line('Use my key when I’m away', statusValue('consent-granted', '✓ enabled', ' data-testid="settings-openrouter-consent-status"'),
        `<form action="/auth/openrouter/consent/clear" method="POST" class="settings-form"><button type="submit" class="btn--quiet consent-clear" data-testid="settings-openrouter-consent-clear">turn off</button></form>`)
      : line('Use my key when I’m away', statusValue('consent-pending', '○ not enabled', ' data-testid="settings-openrouter-consent-status"'),
        `<form action="/auth/openrouter/consent" method="POST" class="settings-form"><button type="submit" class="btn--quiet consent-grant" data-testid="settings-openrouter-consent-grant">turn on for unattended runs</button></form>`);
    return `${line('OpenRouter', statusValue('connected', '● connected', ' data-testid="settings-openrouter-status"'),
      `<form action="/auth/openrouter/disconnect" method="POST" class="settings-form"><button type="submit" class="btn--quiet settings-action-red" data-testid="settings-openrouter-disconnect">disconnect</button></form>`)}${consentRow}${consentedAt ? '' : consentNotice()}`;
  }
  if (source === 'env') {
    return line('OpenRouter', statusValue('env', '● env key', ' data-testid="settings-openrouter-status"'));
  }
  if (source === 'free') {
    return `${line('OpenRouter', statusValue('free-tier', '● free tier', ' data-free-tier-status data-testid="settings-openrouter-status"'), connectLink('connect for unlimited runs'))}
      ${staticRow({ label: 'Runs', valueHtml: '<span data-free-tier-usage>Loading…</span>' })}
      <p class="settings-note">${escapeHtml(FREE_TIER_COPY)}</p>${consentNotice()}`;
  }
  return `${line('OpenRouter', statusValue('disconnected', '○ not connected', ' data-testid="settings-openrouter-status"'), connectLink('connect'))}${consentNotice()}`;
}

/**
 * The theme as two visible choices, posting the existing route (works with no script). The row's
 * value is the current choice; the two buttons are the control.
 */
function themeRow(urlKey, theme) {
  const action = workspaceUrl(urlKey, '/settings/theme');
  const choice = (value, label) => `
        <form action="${escapeHtml(action)}" method="POST" class="settings-form settings-theme-form">
          <input type="hidden" name="theme" value="${value}">
          <button type="submit" class="settings-theme-choice${theme === value ? ' is-selected' : ''}" data-theme-choice="${value}" data-url-key="${escapeHtml(urlKey)}" aria-pressed="${theme === value ? 'true' : 'false'}" data-testid="settings-theme-${value}">${label}</button>
        </form>`;
  return staticRow({
    label: 'Theme',
    valueHtml: `<span class="settings-segmented" role="group" aria-label="Theme">${choice('light', 'Light')}${choice('dark', 'Dark')}
        </span>`,
    testid: 'settings-theme'
  });
}

/**
 * Account (LIN-3890 outcome 1): three groups, You, AI key and Theme, with Sign out as its own action.
 * `consentOff` is the one-shot "Turned off" just after the consent was cleared; its Undo sits on the
 * consent row, not in a flash (outcome 4).
 */
export function accountBody({ accountEmails = [], urlKey, workspaces = [], openRouterSource = null, openRouterConsentedAt = null, theme = 'light', consentOff = false }) {
  const settingsPath = workspaceUrl(urlKey, '/settings/account');
  let emailRow = '';
  if (accountEmails.length) {
    emailRow = staticRow({ label: 'Email', valueHtml: `<span class="settings-value" data-testid="settings-account-emails">${accountEmails.map(escapeHtml).join(', ')}</span>` });
  } else if (isEmailSignInAvailable()) {
    emailRow = actionRow({ label: 'Add email →', href: `/auth/email/register?next=${encodeURIComponent(settingsPath)}`, testid: 'settings-account-add-email' });
  }
  const names = (workspaces || []).map(w => w.name || w.urlKey).filter(Boolean);
  const workspacesRow = names.length
    ? staticRow({ label: 'Workspaces', valueHtml: names.map(escapeHtml).join(', ') })
    : '';
  const isPat = workspaces?.some(w => w.isPAT);
  const signOutRow = actionRow({
    label: isPat ? 'refresh session' : 'Sign out', href: '/logout', tone: 'red', testid: 'settings-logout',
    note: isPat ? 'PAT mode — session restores automatically' : ''
  });
  const undoneHtml = consentOff
    ? statusLine({
      text: 'Turned off.',
      actionHtml: `<form action="/auth/openrouter/consent" method="POST" class="settings-form settings-inline-form"><button type="submit" class="btn--quiet" data-testid="settings-consent-undo">Undo</button></form>`
    })
    : '';

  return `${group({
    title: 'You', testid: 'settings-section-account',
    note: 'These apply to your account, in every workspace.',
    rowsHtml: `${emailRow}${workspacesRow}`
  })}${group({
    title: 'AI key', testid: 'settings-section-ai-key',
    rowsHtml: `${undoneHtml}${openRouterRows(openRouterSource, openRouterConsentedAt)}`,
    note: CONSENT_READER_COPY
  })}${group({
    title: 'Theme', testid: 'settings-group-theme',
    rowsHtml: themeRow(urlKey, theme)
  })}${group({
    title: 'Session', testid: 'settings-section-session',
    rowsHtml: signOutRow
  })}`;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * One line under each view's switch (LIN-3890 outcome 6). A subtitle, not a paragraph: the long
 * FEATURE_DESCRIPTIONS stay with the views themselves. The "(experimental)" suffix is said once,
 * in the group's note, not on every row.
 */
const VIEW_SUBTITLES = {
  roadmap: 'Projected timeline and AI narrative from task data',
  collective: 'Dispatch agents from several workspaces into one discussion',
  taskChat: 'A grounded, multi-turn conversation about one task',
  ship: 'A radial view of in-progress work by priority',
  flightCompanion: 'A companion that watches work in flight and checks in',
  passagePlanner: 'A kickoff prompt for a live passage-planning session',
  shipBiscuit: 'An LLM-written newspaper of recent autopilot work',
  liveConsole: 'A real-time console of the swarm working',
  shipJourney: 'An animated map of roadmap progress over report history',
  feedbackWidget: 'A feedback control in the nav bar'
};

const withoutExperimental = (label) => (label || '').replace(/ \(experimental\)$/, '');

export function featuresBody({ urlKey, featureFlags = FEATURE_DEFAULTS, proxyDefault = true }) {
  const action = workspaceUrl(urlKey, '/settings/features');
  const isOn = (key) => featureFlags[key] ?? FEATURE_DEFAULTS[key];
  const flag = (key) => switchRow({
    key, label: withoutExperimental(FEATURE_LABELS[key] || key), note: VIEW_SUBTITLES[key] || '', on: !!isOn(key), action
  });

  // The +proxy default posts JSON (the route accepts only a boolean), so the
  // client (public/settings.js) intercepts `data-settings-json`; the
  // button is the same switch shape as every other row.
  const proxyRow = switchRow({
    key: 'proxyDefault', label: 'Add a task key to copied prompts', note: 'your default for the +proxy option',
    on: proxyDefault, action: workspaceUrl(urlKey, '/settings/proxy-default'), json: 'proxyDefault', testid: 'settings-toggle-proxyDefault'
  });

  // The experiment rows are the switches only: the view itself is in the view bar once it is on.
  const experiments = EXPERIMENTAL_VIEWS.map(({ flag: key }) => flag(key)).join('');

  const prompts = group({
    title: 'Prompts · for you',
    testid: 'settings-section-prompts',
    rowsHtml: `${proxyRow}${drillRow({ label: 'Step catalogue', value: 'Prompts', href: workspaceUrl(urlKey, '/prompts'), testid: 'settings-link-prompts' })}${drillRow({ label: 'Custom prompts', value: 'Shared with the workspace', href: workspaceUrl(urlKey, '/prompts/custom'), testid: 'settings-link-custom-prompts' })}`,
    note: 'Custom prompts are shared with everyone in the workspace; the toggle above is only yours.'
  });
  // The one view that is not an experiment sits in its own group, so the experiments group can say
  // what it is (LIN-3890 outcome 6): its rows are the experiments, and "(experimental)" is said once.
  const views = group({
    title: 'Views · for you',
    testid: 'settings-section-views',
    rowsHtml: flag('roadmap'),
    note: 'A view that is on appears in the view bar.'
  });
  const experimentsGroup = group({
    title: 'Experiments · for you',
    testid: 'settings-section-experimental',
    rowsHtml: experiments,
    note: 'Rough drafts, each a view of its own. A view that is on appears in the view bar.'
  });
  const feedback = group({
    title: 'Feedback · for you',
    testid: 'settings-section-workflow',
    rowsHtml: flag('feedbackWidget')
  });
  return `${prompts}${views}${experimentsGroup}${feedback}`;
}
