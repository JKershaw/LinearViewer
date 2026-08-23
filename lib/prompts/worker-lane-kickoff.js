/**
 * Worker Lane kickoff prompt source (LIN-2242, generator lift of the design
 * artifact `docs/worker-lane-prompt.md`).
 *
 * Serves `docs/worker-lane-prompt.md` **at HEAD** — never a pinned snapshot,
 * mirroring `passage-runner-kickoff.js`/`passage-planner-kickoff.js` — cut at
 * its single design-artifact preamble boundary: the file's one `^---$`
 * divider; only the body after it is the pasteable live-session prompt.
 *
 * Doc-read pattern mirrors those two generators (themselves mirroring
 * `lib/prompts/autopilot-manual.js`): readFileSync + cache the final string
 * for the process; a failed read returns a minimal FALLBACK WITHOUT caching
 * it, so a later call can retry.
 *
 * This is a doc-only graduation, like passage-planner/runner: there is no new
 * dispatch kind, so nothing here touches `lib/prompt-template-defs.js`,
 * `lib/completion-signals.js`, or the meta-prompt action vocabulary — that
 * two-path rule (CLAUDE.md, "Prompt System (two independent paths)") governs
 * the registered template system, which a lane dispatch never joins.
 *
 * No `baseUrl` templating — every endpoint reference in the doc is relative.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'docs', 'worker-lane-prompt.md'
);

/** Minimal fallback if the doc can't be read — keeps the caller coherent. */
const FALLBACK = `# Worker Lane

(The worker lane prompt could not be loaded. Read \`docs/worker-lane-prompt.md\`
directly and paste everything after its first \`---\` divider into a fresh session.)`;

let cached = null;

/**
 * Return the Worker Lane kickoff prompt body (preamble stripped) as a
 * Markdown string. Read once from docs/worker-lane-prompt.md and cached for
 * the process.
 * @returns {string} The pasteable prompt body.
 */
export function buildWorkerLaneKickoff() {
  if (cached !== null) return cached;
  try {
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const lines = raw.split('\n');
    const dividerIndex = lines.findIndex((line) => line.trim() === '---');
    const body = dividerIndex === -1 ? raw : lines.slice(dividerIndex + 1).join('\n');
    cached = body.trim() + '\n';
    return cached;
  } catch (err) {
    console.error(`Failed to read Worker Lane prompt: ${PROMPT_PATH}`, err.message);
    return FALLBACK;
  }
}
