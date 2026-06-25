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

// Heading stays an unclassed <h3> (styled by `.legal-content h3`) so the legal
// pages keep their exact look; only the wrapper converges to the canonical
// `.section` (LIN-461). The old `.legal-section` (margin-bottom: 2.5rem, an
// off-token value) becomes --space-5 (2rem) — a small, deliberate convergence
// shift shared with the /styleguide lock.
const legalSection = (title, body) =>
  renderSection({ titleTag: 'h3', titleClass: '', title, body });

/**
 * Render the Privacy Policy page
 * @param {Object} [options] - Render options
 * @param {Object} [options.deployInfo] - Heroku deploy information
 * @returns {string} Full HTML document
 */
export function renderPrivacyPolicy({ deployInfo } = {}) {
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/privacy' });

  return renderPage({
    title: 'Privacy Policy - Harbour',
    stylesheets: ['/style.css'],
    bodyClass: 'is-landing',
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="legal-content">
    <h2>Privacy Policy</h2>

    ${legalSection('Data We Collect', `<p>When you sign in with Linear, we receive an OAuth access token that grants read access to your Linear workspace. We store this token in your session to make API requests on your behalf.</p>`)}

    ${legalSection('How We Store Data', `<p>Session data (including your OAuth token and workspace information) is stored server-side in a database. We do not store your Linear data beyond what is needed to render the current page.</p>`)}

    ${legalSection('Cookies', `<p>We use a single session cookie to identify your browser session. No tracking or analytics cookies are used.</p>`)}

    ${legalSection('Third-Party Services', `<p>This application connects to the <a href="https://linear.app" rel="noopener noreferrer">Linear API</a> to fetch your projects and issues. If you enable AI features, requests are sent to <a href="https://openrouter.ai" rel="noopener noreferrer">OpenRouter</a> using either your connected account or a server-side API key.</p>`)}

    ${legalSection('Data Sharing', `<p>We do not sell, share, or transfer your personal data to third parties beyond the services described above.</p>`)}

    ${legalSection('Contact', `<p>For questions about this policy, open an issue at <a href="https://github.com/JKershaw/LinearViewer/issues">github.com/JKershaw/LinearViewer/issues</a>.</p>`)}
  </main>
  ${footerHtml}`
  });
}

/**
 * Render the Terms of Service page
 * @param {Object} [options] - Render options
 * @param {Object} [options.deployInfo] - Heroku deploy information
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
