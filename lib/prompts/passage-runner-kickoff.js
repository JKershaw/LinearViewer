/**
 * Passage Runner kickoff prompt source (LIN-1812/LIN-2162, generator + route
 * lift of the design artifact `docs/passage-runner-prompt.md`).
 *
 * Serves `docs/passage-runner-prompt.md` **at HEAD** — never a pinned
 * snapshot, mirroring `passage-planner-kickoff.js` — cut at its single
 * design-artifact preamble boundary: the file's one `^---$` divider; only the
 * body after it is the pasteable live-session prompt.
 *
 * Doc-read pattern mirrors `lib/prompts/passage-planner-kickoff.js` (itself
 * mirroring `lib/prompts/autopilot-manual.js`): readFileSync + cache the
 * final string for the process; a failed read returns a minimal FALLBACK
 * WITHOUT caching it, so a later call can retry.
 *
 * No `baseUrl` templating — every endpoint reference in the doc is relative.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'docs', 'passage-runner-prompt.md'
);

/** Minimal fallback if the doc can't be read — keeps the page coherent. */
const FALLBACK = `# Passage Runner

(The passage runner prompt could not be loaded. Read \`docs/passage-runner-prompt.md\`
directly and paste everything after its first \`---\` divider into a fresh session.)`;

let cached = null;

/**
 * Return the Passage Runner kickoff prompt body (preamble stripped) as a
 * Markdown string. Read once from docs/passage-runner-prompt.md and cached
 * for the process.
 * @returns {string} The pasteable prompt body.
 */
export function buildPassageRunnerKickoff() {
  if (cached !== null) return cached;
  try {
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const lines = raw.split('\n');
    const dividerIndex = lines.findIndex((line) => line.trim() === '---');
    const body = dividerIndex === -1 ? raw : lines.slice(dividerIndex + 1).join('\n');
    cached = body.trim() + '\n';
    return cached;
  } catch (err) {
    console.error(`Failed to read Passage Runner prompt: ${PROMPT_PATH}`, err.message);
    return FALLBACK;
  }
}
