/**
 * Harbour OS Spawn Library
 *
 * Spawns Claude Code sessions in Harbour OS via OSC escape sequences.
 * Harbour OS intercepts escape sequences written to /dev/tty:
 *   \x1b]harbour:spawn;{payload}\x07
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
 * Spawns a new Claude Code session in Harbour OS with the given prompt.
 *
 * Shell-escapes the prompt (single-quote wrapping) so jsh treats it as
 * a single argument. Writes the OSC escape sequence to /dev/tty to reach
 * the Harbour terminal emulator directly (bypasses stdout capture).
 *
 * @param {string} prompt - The prompt to start the Claude session with
 * @returns {{ success: boolean, error?: string }} Result of the spawn attempt
 */
export function spawnClaudeSession(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { success: false, error: 'prompt is required and must be a string' };
  }

  // Shell-escape single quotes: replace ' with '\'' then wrap in single quotes
  const escaped = prompt.replace(/'/g, "'\\''");

  const payload = JSON.stringify({
    command: 'claude',
    args: ["'" + escaped + "'"],
    name: 'Claude: ' + prompt.substring(0, 40)
  });

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
