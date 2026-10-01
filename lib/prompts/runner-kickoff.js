/**
 * Runner kickoff prompt source (LIN-3098 S3): the prompt that turns a
 * person's Claude Code session into their workspace's runner.
 *
 * Serves `docs/runner-prompt.md` **at HEAD**, cut at its single design-notes
 * boundary (the file's first `^---$` line), following
 * `passage-runner-kickoff.js`: read once and cache for the process; a failed
 * read returns a minimal FALLBACK WITHOUT caching it, so a later call retries.
 *
 * Unlike the passage runner, the body is templated. Every `{{NAME}}` is filled
 * from its source, never a hard-coded copy (E2):
 *   - the runner TTLs, from lib/proxy-scopes.js;
 *   - HALT_MODES (lib/workspace-halt.js) and FEEDBACK_ENTRY_KINDS
 *     (lib/dispatch-store.js);
 *   - the kit's own thresholds, from lib/runner-kit/*.mjs;
 *   - BASE_URL, from the request;
 *   - a sha256 per kit file (NB4), computed from the files the public
 *     `GET /runner-kit/:file` route serves (routes/runner-kit.js).
 * The template and the kit pins are cached together; BASE_URL is filled per
 * call. A placeholder the builder doesn't know serves the FALLBACK (uncached)
 * rather than shipping raw braces.
 */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RUNNER_BOOTSTRAP_TTL_SECONDS, RUNNER_WORKING_TTL_SECONDS } from '../proxy-scopes.js';
import { HALT_MODES } from '../workspace-halt.js';
import { FEEDBACK_ENTRY_KINDS } from '../dispatch-store.js';
import {
  OTHER_CONSUMER_RECENT_MS,
  FRESH_TAKE_MIN_TOKEN_LIFE_MS,
  WATCHDOG_STALL_MIN,
  WATCHDOG_FAIL_MIN,
  WAIT_CAP_MS,
  WAIT_HEARTBEAT_MS
} from '../runner-kit/runner.mjs';
import { BROKER_STALE_MS, BROKER_MAX_LIFETIME_MS } from '../runner-kit/broker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(HERE, '..', '..', 'docs', 'runner-prompt.md');

/** The kit the runner fetches from `GET /runner-kit/:file`, and its directory. */
export const RUNNER_KIT_DIR = join(HERE, '..', 'runner-kit');
export const RUNNER_KIT_FILES = Object.freeze(['broker.mjs', 'runner.mjs']);

/** Minimal fallback if the doc can't be read or filled. Never cached. */
const FALLBACK = `# Harbour runner

(The runner prompt could not be loaded. Read \`docs/runner-prompt.md\` in the Harbour
repository and use everything after its first \`---\` divider.)
`;

const backticked = (list) => list.map((v) => `\`${v}\``).join(', ');

// Values that don't depend on the request.
const STATIC_VALUES = {
  BOOTSTRAP_TTL_HOURS: String(RUNNER_BOOTSTRAP_TTL_SECONDS / 3600),
  WORKING_TTL_HOURS: String(RUNNER_WORKING_TTL_SECONDS / 3600),
  HALT_MODES: backticked(HALT_MODES),
  FEEDBACK_ENTRY_KINDS: backticked(FEEDBACK_ENTRY_KINDS),
  OTHER_CONSUMER_RECENT_MIN: String(OTHER_CONSUMER_RECENT_MS / 60_000),
  FRESH_TAKE_MIN_TOKEN_LIFE_HOURS: String(FRESH_TAKE_MIN_TOKEN_LIFE_MS / 3_600_000),
  WATCHDOG_STALL_MIN: String(WATCHDOG_STALL_MIN),
  WATCHDOG_FAIL_MIN: String(WATCHDOG_FAIL_MIN),
  WAIT_CAP_MIN: String(WAIT_CAP_MS / 60_000),
  WAIT_HEARTBEAT_SEC: String(WAIT_HEARTBEAT_MS / 1000),
  BROKER_STALE_MIN: String(BROKER_STALE_MS / 60_000),
  BROKER_MAX_LIFETIME_HOURS: String(BROKER_MAX_LIFETIME_MS / 3_600_000)
};

const kitKey = (file) => `KIT_SHA256_${file.replace(/\.mjs$/, '').toUpperCase()}`;
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * A builder over one doc and one kit directory, with its own cache. Exported
 * for tests; production uses `buildRunnerKickoff` below.
 */
export function createRunnerKickoffBuilder({ promptPath = PROMPT_PATH, kitDir = RUNNER_KIT_DIR } = {}) {
  let cached = null;

  function load() {
    const raw = readFileSync(promptPath, 'utf-8');
    const lines = raw.split('\n');
    const divider = lines.findIndex((line) => line.trim() === '---');
    const template = (divider === -1 ? raw : lines.slice(divider + 1).join('\n')).trim() + '\n';
    const values = { ...STATIC_VALUES };
    for (const file of RUNNER_KIT_FILES) {
      values[kitKey(file)] = createHash('sha256').update(readFileSync(join(kitDir, file))).digest('hex');
    }
    const unknown = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((name) => name !== 'BASE_URL' && !(name in values));
    if (unknown.length) throw new Error(`unknown placeholder(s) in ${promptPath}: ${[...new Set(unknown)].join(', ')}`);
    return { template, values };
  }

  /**
   * The pasteable runner prompt for this Harbour base URL.
   * @param {{baseUrl: string}} params
   * @returns {string}
   */
  return function build({ baseUrl } = {}) {
    if (!baseUrl) throw new Error('buildRunnerKickoff requires a baseUrl');
    if (cached === null) {
      try {
        cached = load();
      } catch (err) {
        console.error('Failed to build the runner prompt:', err.message);
        return FALLBACK;
      }
    }
    const values = { ...cached.values, BASE_URL: String(baseUrl).replace(/\/+$/, '') };
    return cached.template.replace(PLACEHOLDER, (_, name) => values[name]);
  };
}

/** The runner prompt, from docs/runner-prompt.md at HEAD. */
export const buildRunnerKickoff = createRunnerKickoffBuilder();
