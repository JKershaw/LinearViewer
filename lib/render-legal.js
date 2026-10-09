/**
 * Legal page renderers for Privacy Policy and Terms of Service.
 *
 * Renders full HTML documents with minimal legal text.
 * Public routes — no authentication required.
 */

import { renderPageFooter } from './components/footer.js';
import { renderPage } from './components/page.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { SESSION_TTL_SECONDS } from './session-options.js';
import { THEME_COOKIE_MAX_AGE_MS } from './user-preferences.js';

// Heading stays an unclassed <h3> (styled by `.legal-content h3`) so the legal
// pages keep their exact look; only the wrapper converges to the canonical
// `.section` (LIN-461). The old `.legal-section` (margin-bottom: 2.5rem, an
// off-token value) becomes --space-5 (2rem) — a small, deliberate convergence
// shift shared with the /styleguide lock.
const legalSection = (title, body) =>
  renderSection({ titleTag: 'h3', titleClass: '', title, body });

/**
 * Privacy page facts (LIN-3390). Every sentence on /privacy is traced to code or
 * infrastructure in the PR's sentence-to-source table. The processor and cookie
 * lists are exported so tests pin the data the page is built from.
 */

// Merge blocker (LIN-3390 K5): the private deletion contact. Empty until John
// supplies the address; the page shows a visible placeholder meanwhile and
// tests/unit/render-legal.test.js fails while it is unset.
export const PRIVACY_CONTACT_EMAIL = '';
const CONTACT_PLACEHOLDER = '[private contact address to be confirmed]';

const DAY_SECONDS = 24 * 60 * 60;

function formatDuration(seconds) {
  const days = Math.round(seconds / DAY_SECONDS);
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? '1 year' : `${years} years`;
  }
  return `${days} days`;
}

export const PRIVACY_COOKIES = [
  {
    name: 'connect.sid',
    purpose: 'keeps you signed in',
    lifetimeSeconds: SESSION_TTL_SECONDS
  },
  {
    name: 'theme',
    purpose: 'remembers light or dark mode',
    lifetimeSeconds: THEME_COOKIE_MAX_AGE_MS / 1000
  }
];

export const PRIVACY_PROCESSORS = [
  {
    name: 'Linear, GitHub and Jira (Atlassian)',
    role: 'your tracker, the source of your data. Harbour also writes comments, labels and status changes back when you ask it to.'
  },
  {
    name: 'Railway',
    role: 'hosts Harbour, its database and its server logs. Log retention is set by Railway, not by Harbour.'
  },
  {
    name: 'OpenRouter',
    role: 'receives task text and prompts for AI features, and routes each request to an AI model provider. Harbour does not restrict which provider OpenRouter uses.'
  },
  {
    name: 'Resend',
    role: 'sends email sign-in links, so it receives your email address.'
  },
  {
    name: 'Yap',
    role: 'carries Collective chat (yap.jkershaw.com). Collective is off by default, but any user can switch it on.'
  },
  {
    name: "The workspace owner's own machine and its AI coding tool",
    role: "runs happen there, through the tool the owner runs (for example Claude Code, which sends code and prompts to Anthropic). That machine, not Harbour, keeps the run's transcript and repository copy."
  }
];

const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

/**
 * Render the Privacy Policy page
 * @param {Object} [options] - Render options
 * @param {Object} [options.deployInfo] - Deploy information (see lib/deploy-info.js)
 * @returns {string} Full HTML document
 */
export function renderPrivacyPolicy({ deployInfo } = {}) {
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/privacy' });
  const contact = PRIVACY_CONTACT_EMAIL
    ? `<a href="mailto:${PRIVACY_CONTACT_EMAIL}">${PRIVACY_CONTACT_EMAIL}</a>`
    : CONTACT_PLACEHOLDER;

  const stores = list([
    'The text of the tasks you work on: titles, descriptions, comments and labels, as read from your tracker.',
    'The prompts Harbour writes for you and the AI&rsquo;s full reply, every time.',
    'The history of each run: the prompt, the agent&rsquo;s progress messages and excerpts of its output (up to 2,000 characters each), and the decisions you make. Agent messages and prompts can quote code from your repository. Harbour does not keep a copy of the repository itself.',
    'Summaries, briefs and chats you save.',
    'Your account: your email address if you sign in by email, and the ids of your Linear, GitHub or Jira accounts.',
    'Server logs that carry workspace names and task ids.'
  ]);

  const tokens = list([
    'Linear and Jira: the access and refresh tokens from signing in, so Harbour can work for you while you are away. <strong>Stored unencrypted</strong> in Harbour&rsquo;s database.',
    'Jira API token (if you link Jira with an email and API token instead of signing in): kept only in your session, <strong>unencrypted</strong>, and it never expires.',
    'OpenRouter API key, if you connect OpenRouter: <strong>stored unencrypted</strong> with your account.',
    'GitHub: Harbour keeps only the app&rsquo;s installation id. The GitHub tokens it uses expire within about an hour, and your personal GitHub sign-in token is used once to identify you and is not kept.',
    'Harbour&rsquo;s own tokens (API tokens, runner tokens, share links, email sign-in links) are stored only as a one-way hash.'
  ]);

  const cookies =
    `<p>Harbour sets exactly two cookies:</p>` +
    list(PRIVACY_COOKIES.map((c) => `<code>${c.name}</code>: ${c.purpose}. Lasts ${formatDuration(c.lifetimeSeconds)}.`)) +
    `<p>There are no tracking or analytics cookies. Some display settings are kept in your browser&rsquo;s local storage and are never sent to Harbour.</p>`;

  const processors = list(PRIVACY_PROCESSORS.map((p) => `<strong>${p.name}</strong>: ${p.role}`));

  const access = list([
    'Access comes from your tracker. People who connect Harbour to the same Linear organisation, GitHub App installation or Jira site share that workspace&rsquo;s tasks, runs and history. Harbour checks this when you connect, not on every visit. A GitHub installation can cover more than one repository, and access to a repository is not re-checked afterwards.',
    'Harbour restricts new runner starts to the workspace&rsquo;s owner, whose own machine is the runner. This is not yet airtight: older runner tokens, and some controls such as halt and resume, are not covered.',
    'A task link (<code>/t/&hellip;</code>) you share, and API or runner tokens you create, give access to whoever holds them until you revoke them. Task links do not expire on their own.',
    'Harbour&rsquo;s operator can see everything in the database.'
  ]);

  const retention = list([
    'Task text, prompts, AI replies and run history are kept for the life of the service. This is on purpose: it is the record of what Harbour did.',
    `Saved chats are kept until you delete them (up to 50 each). Summaries stop being served after ${formatDuration(7 * DAY_SECONDS)}, though the stored copy can remain until it is next read.`,
    `Sign-in tokens are kept until you remove the workspace or unlink the provider. A session stops working after ${formatDuration(SESSION_TTL_SECONDS)}, but the expired session record, with its tokens, can stay in the database until it is next read.`
  ]);

  const deletion = list([
    'There is no self-serve delete. Removing a workspace deletes its stored sign-in tokens, not its history, and it does not revoke API tokens, runner tokens or share links.',
    `To have your data deleted, ask the operator at ${contact}. You should also revoke Harbour&rsquo;s access in Linear, GitHub or Atlassian, because removing a workspace does not do that for you.`
  ]);

  return renderPage({
    title: 'Privacy Policy - Harbour',
    stylesheets: ['/style.css'],
    bodyClass: 'is-landing',
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="legal-content">
    <h2>Privacy Policy</h2>

    ${legalSection('What Harbour stores', stores)}

    ${legalSection('Sign-in tokens', tokens)}

    ${legalSection('Cookies', cookies)}

    ${legalSection('Who processes it', processors)}

    ${legalSection('Who can see it', access)}

    ${legalSection('How long it is kept', retention)}

    ${legalSection('Getting your data deleted', deletion)}
  </main>
  ${footerHtml}`
  });
}

/**
 * Render the Terms of Service page
 * @param {Object} [options] - Render options
 * @param {Object} [options.deployInfo] - Deploy information (see lib/deploy-info.js)
 * @returns {string} Full HTML document
 */
export function renderTermsOfService({ deployInfo } = {}) {
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/terms' });

  return renderPage({
    title: 'Terms of Service - Harbour',
    stylesheets: ['/style.css'],
    bodyClass: 'is-landing',
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="legal-content">
    <h2>Terms of Service</h2>

    ${legalSection('Service Description', `<p>Harbour is a web application for viewing and orchestrating work across your issue tracker (such as Linear). It requires a valid account on a supported backend to use.</p>`)}

    ${legalSection('No Warranty', `<p>This service is provided "as is" without warranty of any kind. We make no guarantees about availability, accuracy, or fitness for any particular purpose.</p>`)}

    ${legalSection('Your Responsibilities', `<p>You are responsible for maintaining the security of your Linear account and for any activity that occurs through your authenticated session.</p>`)}

    ${legalSection('Limitation of Liability', `<p>To the fullest extent permitted by law, we are not liable for any damages arising from your use of this service.</p>`)}

    ${legalSection('Changes to Terms', `<p>We may update these terms at any time. Continued use of the service constitutes acceptance of any changes.</p>`)}

    ${legalSection('Contact', `<p>For questions about these terms, open an issue at <a href="https://github.com/JKershaw/LinearViewer/issues">github.com/JKershaw/LinearViewer/issues</a>.</p>`)}
  </main>
  ${footerHtml}`
  });
}
