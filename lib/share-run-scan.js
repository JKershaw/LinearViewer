/**
 * Guest-page secret scan (LIN-3312, LIN-2950 S7a).
 *
 * The rendered guest run page is the last thing that leaves the server for a
 * signed-out reader, and its free text (ledger prose, the run paragraph, issue
 * and PR titles) cannot be bounded by grep. `scanGuestHtml` runs the repo's own
 * `scanText` rules (lib/secret-scan.js — the rules behind `npm run
 * secret-scan` and `scan:public-pages`) over the FINAL HTML and FAILS CLOSED:
 * anything other than a clean scan of a non-empty page — a finding, a
 * non-string or empty page, or a scanner error — is `ok: false`, and the
 * caller must not serve the page (LIN-2950 PROVISIONAL #2: a token-shaped
 * string in ledger prose suppresses the page rather than serving it).
 *
 * Pure. Findings carry only the rule and the redacted form, never the match,
 * so a caller can log them without re-leaking the secret.
 *
 * Wired at refresh and on every serve in LIN-2950 Phase 3 (S7b).
 */

import { scanText } from './secret-scan.js';

// A fixed, non-fixture path: `scanText` suppresses findings for allowlisted
// fixture paths, so the path must never be one of them.
const SCAN_PATH = 'guest-run-page.html';

/**
 * @param {string} html - the complete guest page
 * @param {{ scan?: Function }} [deps] - the scanner (tests only; defaults to `scanText`)
 * @returns {{ ok: boolean, reason: (null|'not-html'|'secret'|'scan-error'), findings: Array<{ruleId: string, ruleName: string, line: number, column: number, redacted: string}> }}
 */
export function scanGuestHtml(html, { scan = scanText } = {}) {
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, reason: 'not-html', findings: [] };
  }
  let found;
  try {
    found = scan(html, { filePath: SCAN_PATH, isAllowlisted: false });
  } catch {
    return { ok: false, reason: 'scan-error', findings: [] };
  }
  if (!Array.isArray(found)) return { ok: false, reason: 'scan-error', findings: [] };
  if (found.length === 0) return { ok: true, reason: null, findings: [] };
  return {
    ok: false,
    reason: 'secret',
    findings: found.map(f => ({ ruleId: f.ruleId, ruleName: f.ruleName, line: f.line, column: f.column, redacted: f.redacted }))
  };
}
