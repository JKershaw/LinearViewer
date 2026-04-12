/**
 * Safe bash tool executor with data/code separation.
 *
 * The core problem: when an LLM sends a command like
 *   python3 -c "f.write('hello\nworld')"
 * through JSON → sh -c → python, the \n passes through three interpreters
 * and gets corrupted. Each layer consumes an escaping level.
 *
 * This module provides two execution modes that fix this:
 *
 * 1. Shell mode with stdin separation:
 *    execute({ command: 'cat > file.js', stdin: 'console.log("hello\\nworld")' })
 *    → data bypasses the shell entirely via process stdin
 *
 * 2. Direct mode with argv array:
 *    execArgs({ file: 'grep', args: ['-P', '\\d+\\.\\d+', 'data.txt'] })
 *    → arguments bypass the shell entirely via execvp
 */
import { spawn } from 'node:child_process';

/**
 * Kill a process and all its children by process group.
 * @param {import('child_process').ChildProcess} proc
 */
function killProcessGroup(proc) {
  try {
    // Kill the entire process group (negative pid)
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // Process may already be dead — ignore
    try { proc.kill('SIGKILL'); } catch { /* noop */ }
  }
}

/**
 * Execute a shell command with optional stdin data separation.
 *
 * The command string goes through sh -c (shell interprets it).
 * The stdin data is piped directly to the process, bypassing the shell.
 *
 * Data flow:
 *   command: LLM → JSON.parse → sh -c → executed (2 layers: JSON + shell)
 *   stdin:   LLM → JSON.parse → proc.stdin (1 layer: JSON only)
 *
 * @param {object} params
 * @param {string} params.command - Shell command to execute
 * @param {string} [params.stdin] - Data to pipe to stdin (bypasses shell)
 * @param {number} [params.timeout=120000] - Timeout in milliseconds
 * @param {string} [params.cwd] - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
export function execute({ command, stdin, timeout = 120000, cwd }) {
  return new Promise((resolve, reject) => {
    const hasStdin = stdin != null;
    const proc = spawn('sh', ['-c', command], {
      stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      cwd,
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer;

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(proc);
      }, timeout);
    }

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    if (hasStdin) {
      proc.stdin.on('error', () => {
        // Process may exit before stdin is fully written — ignore EPIPE
      });
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ stdout, stderr: stderr + '\n[timed out]', exitCode: exitCode ?? 137 });
      } else {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      }
    });
  });
}

/**
 * Execute a command with an explicit argv array — no shell involved.
 *
 * Uses execvp directly: the file and each argument are passed to the OS
 * without any shell interpretation. Special characters in arguments
 * (backslashes, quotes, spaces, glob patterns) are passed literally.
 *
 * Data flow:
 *   file+args: LLM → JSON.parse → execvp (1 layer: JSON only)
 *   stdin:     LLM → JSON.parse → proc.stdin (1 layer: JSON only)
 *
 * @param {object} params
 * @param {string} params.file - Executable path or name
 * @param {string[]} [params.args=[]] - Arguments array
 * @param {string} [params.stdin] - Data to pipe to stdin
 * @param {number} [params.timeout=120000] - Timeout in milliseconds
 * @param {string} [params.cwd] - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
export function execArgs({ file, args = [], stdin, timeout = 120000, cwd }) {
  return new Promise((resolve, reject) => {
    const hasStdin = stdin != null;
    const proc = spawn(file, args, {
      stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      cwd,
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer;

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(proc);
      }, timeout);
    }

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    if (hasStdin) {
      proc.stdin.on('error', () => {});
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ stdout, stderr: stderr + '\n[timed out]', exitCode: exitCode ?? 137 });
      } else {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      }
    });
  });
}
