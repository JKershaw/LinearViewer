/**
 * Autopilot operating manual (the "handbook").
 *
 * A portable senior-lead *disposition* — the judgment layer that sits beside the
 * kickoff's mechanism (verbs, precedence policy, the four lines). It carries the
 * *why* behind the loop so Autopilot can interpolate well at the seams the
 * mechanism doesn't enumerate.
 *
 * Single source of truth: docs/autopilot-operating-manual.md. This module reads
 * and caches that file so the same prose serves three roles with no duplication:
 *   - inline in the dispatched kickoff (the guaranteed-in-context lens),
 *   - the GET /api/proxy/autopilot/manual endpoint (signpost + re-reference),
 *   - the committed human-readable doc.
 *
 * The manual is static prose (no templating, no baseUrl), which is exactly why it
 * can be a single file read rather than an inline JS string like the kickoff
 * (which templates baseUrl into its text).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MANUAL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'docs', 'autopilot-operating-manual.md'
);

/** Minimal disposition if the doc can't be read — keeps the kickoff coherent. */
const FALLBACK = `# The Autopilot Handbook

(The operating handbook could not be loaded. Drive from the kickoff mechanics
alone: stay high, dispatch the work and judge it, verify completion against
external evidence rather than self-report, halt on a broken instrument instead of
improvising around it, and hand anything about "worth it" or "done" back to the
human.)`;

let cached = null;

/**
 * Return the Autopilot operating manual (the handbook) as a Markdown string.
 * Read once from docs/autopilot-operating-manual.md and cached for the process;
 * a failed read returns the fallback without caching, so a later call can retry.
 * @returns {string} The handbook text.
 */
export function buildAutopilotManual() {
  if (cached !== null) return cached;
  try {
    cached = readFileSync(MANUAL_PATH, 'utf-8').trim();
    return cached;
  } catch (err) {
    console.error(`Failed to read Autopilot manual: ${MANUAL_PATH}`, err.message);
    return FALLBACK;
  }
}

/** The anchor heading for the Principle 0 gate — must stay byte-identical to the manual. */
const PRINCIPLE_ZERO_HEADING = "## The human's edge, and how to hand back";

/**
 * Extract just the Principle 0 / hand-back section from the manual, so a consumer
 * that needs the rubric (e.g. a triage prompt) can compose it without shipping the
 * whole ~36 KB manual and without restating the rubric as separate prose (LIN-1732
 * pinned the manual as the rubric's single source of truth).
 *
 * A pure anchor-based slice: from the heading to the next `## ` heading (exclusive).
 * Reuses buildAutopilotManual()'s own read-once-cache + fallback discipline rather
 * than adding a second one.
 * @returns {string|null} The section text, or null if the anchor heading isn't found
 *   (e.g. the manual failed to load and the fallback text has no such heading).
 */
export function extractPrincipleZeroSection() {
  const manual = buildAutopilotManual();
  const start = manual.indexOf(PRINCIPLE_ZERO_HEADING);
  if (start === -1) return null;

  const rest = manual.slice(start + PRINCIPLE_ZERO_HEADING.length);
  const nextHeading = rest.match(/\n## /);
  const end = nextHeading ? start + PRINCIPLE_ZERO_HEADING.length + nextHeading.index : manual.length;

  return manual.slice(start, end).trim();
}
