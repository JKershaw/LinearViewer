/**
 * Common Utilities
 *
 * Shared JavaScript utilities used across multiple pages.
 * Loaded before page-specific scripts (app.js, audit.js).
 */

// =============================================================================
// HTML Escaping
// =============================================================================

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML insertion
 */
window.escapeHtml = function(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// =============================================================================
// Deploy Time Formatting
// =============================================================================

/**
 * Format deploy timestamp in viewer's local timezone.
 * Updates .deploy-time elements that have a data-timestamp attribute.
 * Changes "deployed Jan 15" to "deployed Jan 15, 2:30 PM".
 */
function initDeployTime() {
  const deployTimeEl = document.querySelector('.deploy-time[data-timestamp]');
  if (!deployTimeEl) return;

  const timestamp = deployTimeEl.dataset.timestamp;
  if (!timestamp) return;

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return;

    // Format: "deployed Jan 15, 2:30 PM"
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();

    // Format time in 12-hour format with AM/PM
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours || 12; // 0 should be 12
    const minuteStr = String(minutes).padStart(2, '0');

    deployTimeEl.textContent = `deployed ${month} ${day}, ${hours}:${minuteStr} ${ampm}`;
  } catch (e) {
    // Keep server-rendered fallback on error
    console.warn('Failed to format deploy time:', e);
  }
}

// =============================================================================
// Auto-initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initDeployTime();
});
