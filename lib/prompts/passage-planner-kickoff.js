/**
 * Passage Planner kickoff prompt source (LIN-1849, one-click copy parity with
 * Flight Companion / LIN-922).
 *
 * Serves `docs/passage-planner-prompt.md` **at HEAD** — never a pinned
 * snapshot, since the validated prompt content has already moved once
 * (LIN-1841 v0 → LIN-1850 v0.1) — cut at its single design-artifact preamble
 * boundary. Lines 1-37 are a design-artifact preamble (what this is / revision
 * history / vocabulary note); line 38 is the file's only `^---$`; only the
 * body after it is the pasteable live-session prompt.
 *
 * Doc-read pattern mirrors `lib/prompts/autopilot-manual.js`: readFileSync +
 * cache the final string for the process; a failed read returns a minimal
 * FALLBACK WITHOUT caching it, so a later call can retry.
 *
 * No `baseUrl` templating here (unlike `flight-companion-kickoff.js`): every
 * endpoint reference in the doc is relative — base + token come from the
 * proxy access block appended alongside this prompt, not from this builder.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'docs', 'passage-planner-prompt.md'
);

/** Minimal fallback if the doc can't be read — keeps the page coherent. */
const FALLBACK = `# Passage Planner

(The passage planner prompt could not be loaded. Read \`docs/passage-planner-prompt.md\`
directly and paste everything after its first \`---\` divider into a fresh session.)`;

let cached = null;

/**
 * Return the Passage Planner kickoff prompt body (preamble stripped) as a
 * Markdown string. Read once from docs/passage-planner-prompt.md and cached
 * for the process.
 * @returns {string} The pasteable prompt body.
 */
export function buildPassagePlannerKickoff() {
  if (cached !== null) return cached;
  try {
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const lines = raw.split('\n');
    const dividerIndex = lines.findIndex((line) => line.trim() === '---');
    const body = dividerIndex === -1 ? raw : lines.slice(dividerIndex + 1).join('\n');
    cached = body.trim() + '\n';
    return cached;
  } catch (err) {
    console.error(`Failed to read Passage Planner prompt: ${PROMPT_PATH}`, err.message);
    return FALLBACK;
  }
}
