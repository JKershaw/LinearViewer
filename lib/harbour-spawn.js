/**
 * Harbour OS Spawn Library
 *
 * Spawns Claude Code sessions in Harbour OS via OSC escape sequences:
 *   \x1b]harbour:spawn;{payload}\x07
 *
 * Harbour OS (see src/stores/process-store.js) does NOT invoke the
 * payload with execv semantics. It always spawns `jsh`, then types
 * `[command, ...args].join(' ') + '\n'` into jsh's stdin as a shell
 * line — no quoting is added. jsh re-tokenises the whole line.
 *
 * The practical consequence: every element we put into `args` must
 * arrive at jsh already quoted so it survives tokenisation. For the
 * clone flow we therefore wrap the whole `sh -c` script in outer
 * single quotes, handing jsh exactly three tokens: `sh`, `-c`, and
 * the full script body. Inside the script we use double quotes so
 * `$HOME` and `$(cat …)` are expanded by the `sh` shim rather than
 * by jsh itself.
 *
 * We also avoid builtins the Harbour OS `sh` shim (src/system-tools/
 * bin/bash.mjs) does not implement — `exec` and `export`. Dispatch
 * env vars are supplied via the OSC `env` field, which Harbour OS
 * merges into the spawned process's environment (boot-event-handlers
 * and ProcessManager.spawn plumb `env` end-to-end).
 *
 * Two modes:
 * - Plain prompt mode: launches `claude <prompt>` directly.
 * - Harbour OS clone mode: clones a repo, sets HARBOUR_DISPATCH_* env via
 *   the OSC env field, then launches Claude with a prompt staged in a
 *   file (avoids argv/escape limits; lets repo-level Claude hooks call
 *   back via the dispatch feedback endpoint).
 *
 * Fire-and-forget: writes the escape sequence and returns immediately.
 */

import fs from 'fs';

/**
 * Checks if /dev/tty is accessible (i.e. running in a terminal environment).
 * @returns {boolean} true if /dev/tty can be opened for writing
 */
export function isHarbourAvailable() {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'w');
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Rejects single quotes (would terminate the surrounding quoting) and
 * control characters. Used for values wrapped in single quotes.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isSafeSingleQuotedLiteral(value) {
  return typeof value === 'string'
    && value.length > 0
    && !/['\x00-\x1F\x7F]/.test(value);
}

/**
 * Rejects characters that retain special meaning inside double quotes
 * (`"`, `$`, backtick, backslash) plus control chars. Used for values
 * wrapped in double quotes.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isSafeDoubleQuotedLiteral(value) {
  return typeof value === 'string'
    && value.length > 0
    && !/["$`\\\x00-\x1F\x7F]/.test(value);
}

/**
 * Builds the `sh -c` script body. The caller wraps the return value in
 * outer single quotes before putting it into args[1], so *this* string
 * MUST NOT contain a single quote — values interpolated here are all
 * double-quoted, so we validate each against the double-quote threat set
 * at the callsite.
 *
 * With a repo:
 *   git clone "<repo>" "$HOME/harbour-workspaces/<id>"
 *     && cd "$HOME/harbour-workspaces/<id>"
 *     && claude "$(cat "<stagingFile>")"
 *
 * Without a repo (any target='local' dispatch that doesn't specify one):
 *   claude "$(cat "<stagingFile>")"
 *
 * Notes:
 *  - No `export` — the Harbour OS sh shim has no export builtin. We rely
 *    on the OSC `env` field, which is plumbed to the spawned process.
 *  - No `exec` — also not a builtin of the shim.
 *  - `$HOME` expansion works inside double quotes in the sh shim.
 *  - `$(cat "<path>")` inside outer double quotes preserves newlines as
 *    a single argv element, confirmed in bash.mjs:301–325.
 *
 * @param {Object} params
 * @param {string} params.stagingFilePath - Always required
 * @param {string} [params.repo] - Optional; when set, clone + cd before claude
 * @param {string} [params.dispatchId] - Required when repo is set (names the workspace dir)
 * @returns {string}
 */
function buildHarbourCommand({ repo, dispatchId, stagingFilePath }) {
  const parts = [];
  if (repo) {
    const workspacePath = `"$HOME/harbour-workspaces/${dispatchId}"`;
    parts.push(`git clone "${repo}" ${workspacePath}`);
    parts.push(`cd ${workspacePath}`);
  }
  parts.push(`claude "$(cat "${stagingFilePath}")"`);
  return parts.join(' && ');
}

/**
 * Spawns a new Claude Code session in Harbour OS.
 *
 * Staged mode (recommended; active whenever `stagingFilePath` is set):
 * wraps `sh -c '<script>'` so jsh hands sh exactly three tokens. The
 * script reads the prompt from `stagingFilePath` via `$(cat …)`, which
 * the Harbour OS sh shim preserves as a single argv element even for
 * multi-line content. If `repo` is also set, the script clones it into
 * `$HOME/harbour-workspaces/<dispatchId>` and `cd`s in before launching
 * claude. Optional HARBOUR_DISPATCH_* values travel via the OSC `env`
 * field (never inlined into the shell line — jsh would split on the
 * embedded newlines otherwise).
 *
 * Inline mode (fallback for callers that can't stage; unsafe for
 * multi-line prompts): puts the quoted prompt directly into the OSC
 * args. Kept only for tests/legacy callers — `routes/dispatch.js`
 * always passes `stagingFilePath` so it never hits this path.
 *
 * @param {string} prompt - The prompt. Used for the terminal tab name;
 *   in staged mode the prompt claude actually reads comes from the
 *   staging file.
 * @param {Object} [options]
 * @param {string} [options.stagingFilePath] - Absolute path to the
 *   staged prompt file. Presence switches on staged mode.
 * @param {string} [options.repo] - Optional repo to clone. Requires
 *   dispatchId when set.
 * @param {string} [options.dispatchId] - UUID used as workspace dir
 *   name and as HARBOUR_DISPATCH_ID env var.
 * @param {string} [options.feedbackUrl] - If set, exported as
 *   HARBOUR_DISPATCH_FEEDBACK_URL in the OSC env.
 * @param {string} [options.token] - If set, exported as
 *   HARBOUR_DISPATCH_TOKEN in the OSC env.
 * @returns {{ success: boolean, error?: string }}
 */
export function spawnClaudeSession(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return { success: false, error: 'prompt is required and must be a string' };
  }

  const { repo, dispatchId, feedbackUrl, token, stagingFilePath } = options;
  const staged = Boolean(stagingFilePath);

  let payload;
  if (staged) {
    // Every value we interpolate into the script body sits inside
    // double quotes, and the whole body is wrapped in outer single
    // quotes at the jsh level — so interpolated values must be safe
    // under BOTH quote regimes.
    const mustBeSafe = [['stagingFilePath', stagingFilePath]];
    if (repo) {
      mustBeSafe.push(['repo', repo]);
      if (!dispatchId) {
        return { success: false, error: 'dispatchId is required when repo is set' };
      }
      mustBeSafe.push(['dispatchId', dispatchId]);
    }
    for (const [name, value] of mustBeSafe) {
      if (!isSafeDoubleQuotedLiteral(value) || !isSafeSingleQuotedLiteral(value)) {
        return { success: false, error: `${name} contains characters unsafe for shell embedding` };
      }
    }

    const scriptBody = buildHarbourCommand({ repo, dispatchId, stagingFilePath });
    // Wrap the whole script in outer single quotes so jsh's line-level
    // tokenisation hands `sh` exactly two post-flag tokens: `-c` and
    // <script body>. Without these outer quotes, jsh re-parses the
    // whole payload (including `&&`) at the jsh level.
    const args1 = `'${scriptBody}'`;

    const env = {};
    if (dispatchId) env.HARBOUR_DISPATCH_ID = dispatchId;
    if (feedbackUrl) env.HARBOUR_DISPATCH_FEEDBACK_URL = feedbackUrl;
    if (token) env.HARBOUR_DISPATCH_TOKEN = token;

    payload = JSON.stringify({
      command: 'sh',
      args: ['-c', args1],
      ...(Object.keys(env).length ? { env } : {}),
      name: 'Harbour: ' + prompt.substring(0, 40)
    });
  } else {
    // Inline argv fallback (no staging file). Breaks on multi-line
    // prompts because jsh's line reader receives embedded newlines on
    // its stdin line before sh ever sees them. Kept for LIN-257
    // prototype callers / tests; the dispatch route always stages.
    const escaped = prompt.replace(/'/g, "'\\''");
    payload = JSON.stringify({
      command: 'claude',
      args: ["'" + escaped + "'"],
      name: 'Claude: ' + prompt.substring(0, 40)
    });
  }

  const escapeSequence = `\x1b]harbour:spawn;${payload}\x07`;

  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'w');
    fs.writeSync(fd, escapeSequence);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to write to /dev/tty: ${err.message}` };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore close errors */ }
    }
  }
}
