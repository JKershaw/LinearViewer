/**
 * Harbour OS Spawn Library
 *
 * Spawns Claude Code sessions in Harbour OS via OSC escape sequences.
 * Harbour OS intercepts escape sequences written to /dev/tty:
 *   \x1b]harbour:spawn;{payload}\x07
 *
 * Two modes:
 * - Plain prompt mode: launches `claude "<prompt>"` directly
 * - Harbour clone mode: clones a repo, exports dispatch env vars, then
 *   launches Claude with a prompt staged in a file (avoids argv/escape
 *   limits and lets repo-level Claude hooks call back via the dispatch
 *   feedback endpoint).
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
 * Validates that a string is safe to embed inside a single-quoted shell word.
 * Single quotes inside the value would terminate the surrounding quoting and
 * allow command injection, so we reject anything that contains them. We also
 * reject control characters.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isSafeShellLiteral(value) {
  return typeof value === 'string'
    && value.length > 0
    && !/['\x00-\x1F\x7F]/.test(value);
}

/**
 * Builds the `sh -c` command string that runs in the Harbour terminal:
 *  1. Exports HARBOUR_DISPATCH_* env vars (redundant with OSC `env`,
 *     but tolerant of Harbour OS versions that don't yet plumb env).
 *  2. `git clone`s the repo into a per-dispatch workspace dir.
 *  3. `cd`s into the clone.
 *  4. `exec`s `claude` with the prompt read from the staging file.
 *
 * Each interpolated value is single-quote wrapped after being validated by
 * isSafeShellLiteral, eliminating shell-escaping pain.
 *
 * @param {Object} params
 * @param {string} params.repo - Repo URL or shorthand (e.g. github.com/user/repo)
 * @param {string} params.workspaceDir - Path the clone is created at
 * @param {string} params.stagingFilePath - Absolute path to the prompt staging file
 * @param {string} params.dispatchId
 * @param {string} params.feedbackUrl
 * @param {string} params.token
 * @returns {string}
 */
function buildHarbourCommand({ repo, workspaceDir, stagingFilePath, dispatchId, feedbackUrl, token }) {
  const q = (v) => `'${v}'`;
  return [
    `export HARBOUR_DISPATCH_ID=${q(dispatchId)} HARBOUR_DISPATCH_FEEDBACK_URL=${q(feedbackUrl)} HARBOUR_DISPATCH_TOKEN=${q(token)}`,
    `git clone ${q(repo)} ${q(workspaceDir)}`,
    `cd ${q(workspaceDir)}`,
    `exec claude "$(cat ${q(stagingFilePath)})"`
  ].join(' && ');
}

/**
 * Spawns a new Claude Code session in Harbour OS.
 *
 * Plain mode (no `options.repo`): launches `claude "<prompt>"` with the
 * prompt single-quote escaped, preserving the original LIN-257 prototype
 * behaviour for callers that haven't opted into the Harbour clone flow.
 *
 * Harbour clone mode (`options.repo` set): clones the repo into
 * `~/harbour-workspaces/<dispatchId>` and execs Claude with the prompt
 * read from `options.stagingFilePath`. Requires the caller (typically
 * routes/dispatch.js) to have:
 *   - written the prompt to `stagingFilePath` (mode 0600)
 *   - minted a short-lived feedback token tied to dispatchId
 *
 * @param {string} prompt - The prompt (used for the terminal tab name; the
 *   actual prompt seen by Claude in clone mode comes from the staging file)
 * @param {Object} [options]
 * @param {string} [options.repo] - Repo URL/shorthand to clone (enables clone mode)
 * @param {string} [options.dispatchId] - Dispatch item ID (also used as workspace dir name)
 * @param {string} [options.feedbackUrl] - Absolute URL to POST hook feedback to
 * @param {string} [options.token] - Short-lived feedback token
 * @param {string} [options.stagingFilePath] - Absolute path to the staged prompt file
 * @param {string} [options.workspaceDir] - Override workspace dir (default ~/harbour-workspaces/<dispatchId>)
 * @returns {{ success: boolean, error?: string }} Result of the spawn attempt
 */
export function spawnClaudeSession(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return { success: false, error: 'prompt is required and must be a string' };
  }

  const { repo, dispatchId, feedbackUrl, token, stagingFilePath } = options;
  const useHarbourClone = Boolean(repo);

  let payload;
  if (useHarbourClone) {
    // Validate every value that we'll interpolate into the sh -c string.
    // Anything failing this check would be a server-side bug (the values
    // come from trusted server code), so we surface a clear error rather
    // than silently fall back.
    if (!isSafeShellLiteral(repo)) {
      return { success: false, error: 'repo contains characters unsafe for shell embedding' };
    }
    if (!isSafeShellLiteral(dispatchId)) {
      return { success: false, error: 'dispatchId is required and must be safe for shell embedding' };
    }
    if (!isSafeShellLiteral(feedbackUrl)) {
      return { success: false, error: 'feedbackUrl is required and must be safe for shell embedding' };
    }
    if (!isSafeShellLiteral(token)) {
      return { success: false, error: 'token is required and must be safe for shell embedding' };
    }
    if (!isSafeShellLiteral(stagingFilePath)) {
      return { success: false, error: 'stagingFilePath is required and must be safe for shell embedding' };
    }

    const workspaceDir = options.workspaceDir || `~/harbour-workspaces/${dispatchId}`;
    if (!isSafeShellLiteral(workspaceDir)) {
      return { success: false, error: 'workspaceDir contains characters unsafe for shell embedding' };
    }

    const commandString = buildHarbourCommand({
      repo, workspaceDir, stagingFilePath, dispatchId, feedbackUrl, token
    });

    payload = JSON.stringify({
      command: 'sh',
      args: ['-c', commandString],
      env: {
        HARBOUR_DISPATCH_ID: dispatchId,
        HARBOUR_DISPATCH_FEEDBACK_URL: feedbackUrl,
        HARBOUR_DISPATCH_TOKEN: token
      },
      name: 'Harbour: ' + prompt.substring(0, 40)
    });
  } else {
    // Plain prompt mode (LIN-257 prototype path): single-quote escape then
    // wrap so jsh receives the prompt as one argv element.
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
