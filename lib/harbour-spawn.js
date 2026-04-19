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
 * We also avoid builtins the Harbour `sh` shim (src/system-tools/
 * bin/bash.mjs) does not implement — `exec` and `export`. Dispatch
 * env vars are supplied via the OSC `env` field, which Harbour OS
 * merges into the spawned process's environment (boot-event-handlers
 * and ProcessManager.spawn plumb `env` end-to-end).
 *
 * Two modes:
 * - Plain prompt mode: launches `claude <prompt>` directly.
 * - Harbour clone mode: clones a repo, sets HARBOUR_DISPATCH_* env via
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
 *   git clone "<repo>" "$HOME/harbour-workspaces/<id>"
 *     && cd "$HOME/harbour-workspaces/<id>"
 *     && claude "$(cat "<stagingFile>")"
 *
 * Notes:
 *  - No `export` — the Harbour sh shim has no export builtin. We rely
 *    on the OSC `env` field, which is plumbed to the spawned process.
 *  - No `exec` — also not a builtin of the shim.
 *  - `$HOME` expansion works inside double quotes in the sh shim.
 *  - `$(cat "<path>")` inside outer double quotes preserves newlines as
 *    a single argv element, confirmed in bash.mjs:301–325.
 *
 * @param {Object} params
 * @param {string} params.repo
 * @param {string} params.dispatchId
 * @param {string} params.stagingFilePath
 * @returns {string}
 */
function buildHarbourCommand({ repo, dispatchId, stagingFilePath }) {
  const workspacePath = `"$HOME/harbour-workspaces/${dispatchId}"`;
  return [
    `git clone "${repo}" ${workspacePath}`,
    `cd ${workspacePath}`,
    `claude "$(cat "${stagingFilePath}")"`
  ].join(' && ');
}

/**
 * Spawns a new Claude Code session in Harbour OS.
 *
 * Plain mode (no `options.repo`): launches `claude <prompt>` with the
 * prompt wrapped in outer single quotes so jsh preserves it as one
 * argv element (LIN-257 prototype path).
 *
 * Harbour clone mode (`options.repo` set): clones the repo into
 * `$HOME/harbour-workspaces/<dispatchId>` and launches Claude with the
 * prompt read from `options.stagingFilePath`. Requires the caller
 * (typically routes/dispatch.js) to have:
 *   - written the prompt to `stagingFilePath`
 *   - minted a short-lived feedback token tied to dispatchId
 *
 * @param {string} prompt - The prompt (used for the terminal tab name;
 *   the actual prompt seen by Claude in clone mode comes from the
 *   staging file)
 * @param {Object} [options]
 * @param {string} [options.repo]
 * @param {string} [options.dispatchId]
 * @param {string} [options.feedbackUrl]
 * @param {string} [options.token]
 * @param {string} [options.stagingFilePath]
 * @returns {{ success: boolean, error?: string }}
 */
export function spawnClaudeSession(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return { success: false, error: 'prompt is required and must be a string' };
  }

  const { repo, dispatchId, feedbackUrl, token, stagingFilePath } = options;
  const useHarbourClone = Boolean(repo);

  let payload;
  if (useHarbourClone) {
    // Script body uses double quotes throughout, so every interpolated
    // value must be double-quote-safe. The outer wrapper around the
    // whole script body is a single quote, which is why we additionally
    // require that no value contain a single quote.
    for (const [name, value] of [
      ['repo', repo],
      ['dispatchId', dispatchId],
      ['stagingFilePath', stagingFilePath]
    ]) {
      if (!isSafeDoubleQuotedLiteral(value) || !isSafeSingleQuotedLiteral(value)) {
        return { success: false, error: `${name} contains characters unsafe for shell embedding` };
      }
    }
    // feedbackUrl and token travel via the OSC `env` field and don't go
    // into the shell script at all, but we still sanity-check them.
    if (typeof feedbackUrl !== 'string' || !feedbackUrl) {
      return { success: false, error: 'feedbackUrl is required' };
    }
    if (typeof token !== 'string' || !token) {
      return { success: false, error: 'token is required' };
    }

    const scriptBody = buildHarbourCommand({ repo, dispatchId, stagingFilePath });
    // Wrap the whole script in outer single quotes so jsh's line-level
    // tokenisation hands `sh` exactly two post-flag tokens: `-c` and
    // <script body>. Without these outer quotes, jsh re-parses the
    // whole payload (including the `&&`) at the jsh level.
    const args1 = `'${scriptBody}'`;

    payload = JSON.stringify({
      command: 'sh',
      args: ['-c', args1],
      env: {
        HARBOUR_DISPATCH_ID: dispatchId,
        HARBOUR_DISPATCH_FEEDBACK_URL: feedbackUrl,
        HARBOUR_DISPATCH_TOKEN: token
      },
      name: 'Harbour: ' + prompt.substring(0, 40)
    });
  } else {
    // Plain prompt mode (LIN-257 prototype path). Wrap the prompt in
    // outer single quotes so jsh's line-level tokenisation hands claude
    // one argv element. The escape-then-wrap dance converts embedded
    // single quotes into the POSIX `'\''` sequence.
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
