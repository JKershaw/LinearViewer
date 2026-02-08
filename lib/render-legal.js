/**
 * Legal page renderers for Privacy Policy and Terms of Service.
 *
 * Renders full HTML documents with minimal legal text.
 * Public routes — no authentication required.
 */

import { FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';

/**
 * Render the Privacy Policy page
 * @param {Object} [options] - Render options
 * @param {Object} [options.deployInfo] - Heroku deploy information
 * @returns {string} Full HTML document
 */
export function renderPrivacyPolicy({ deployInfo } = {}) {
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/privacy' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Linear Projects Viewer</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1><a href="/" class="header-link">Linear Projects Viewer</a></h1>
  </header>
  <main class="legal-content">
    <h2>Privacy Policy</h2>

    <h3>Data We Collect</h3>
    <p>When you sign in with Linear, we receive an OAuth access token that grants read access to your Linear workspace. We store this token in your session to make API requests on your behalf.</p>

    <h3>How We Store Data</h3>
    <p>Session data (including your OAuth token and workspace information) is stored server-side in a database. We do not store your Linear data beyond what is needed to render the current page.</p>

    <h3>Cookies</h3>
    <p>We use a single session cookie to identify your browser session. No tracking or analytics cookies are used.</p>

    <h3>Third-Party Services</h3>
    <p>This application connects to the <a href="https://linear.app" rel="noopener noreferrer">Linear API</a> to fetch your projects and issues. If you enable AI features, requests are sent to <a href="https://openrouter.ai" rel="noopener noreferrer">OpenRouter</a> using either your connected account or a server-side API key.</p>

    <h3>Data Sharing</h3>
    <p>We do not sell, share, or transfer your personal data to third parties beyond the services described above.</p>

    <h3>Contact</h3>
    <p>For questions about this policy, open an issue at <a href="https://github.com/JKershaw/LinearViewer/issues">github.com/JKershaw/LinearViewer/issues</a>.</p>
  </main>
  ${footerHtml}
</body>
</html>`;
}

/**
 * Render the Terms of Service page
 * @param {Object} [options] - Render options
 * @param {Object} [options.deployInfo] - Heroku deploy information
 * @returns {string} Full HTML document
 */
export function renderTermsOfService({ deployInfo } = {}) {
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/terms' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - Linear Projects Viewer</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1><a href="/" class="header-link">Linear Projects Viewer</a></h1>
  </header>
  <main class="legal-content">
    <h2>Terms of Service</h2>

    <h3>Service Description</h3>
    <p>Linear Projects Viewer is a web application that provides a read-only view of your Linear projects and issues. It requires a valid Linear account to use.</p>

    <h3>No Warranty</h3>
    <p>This service is provided "as is" without warranty of any kind. We make no guarantees about availability, accuracy, or fitness for any particular purpose.</p>

    <h3>Your Responsibilities</h3>
    <p>You are responsible for maintaining the security of your Linear account and for any activity that occurs through your authenticated session.</p>

    <h3>Limitation of Liability</h3>
    <p>To the fullest extent permitted by law, we are not liable for any damages arising from your use of this service.</p>

    <h3>Changes to Terms</h3>
    <p>We may update these terms at any time. Continued use of the service constitutes acceptance of any changes.</p>

    <h3>Contact</h3>
    <p>For questions about these terms, open an issue at <a href="https://github.com/JKershaw/LinearViewer/issues">github.com/JKershaw/LinearViewer/issues</a>.</p>
  </main>
  ${footerHtml}
</body>
</html>`;
}
