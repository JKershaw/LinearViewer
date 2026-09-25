/**
 * scripts/lin3014/lib/guard.mjs (LIN-3014)
 *
 * The safety rail every LIN-3014 script (measure, equivalence, replay) runs
 * through before it touches a Mongo connection: never authenticate as root
 * against production, never log the password, and only ever read from a
 * loopback replay target or from the `read@linear-viewer` user ruling
 * `16c2be3e` authorized.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PASSWORD_FILE = join(homedir(), '.harbour', 'secrets', 'lin3014_read.pass');

/**
 * Load the read-only credential from an env var or a `chmod 600` file.
 * Never console.log's the value — callers must not either.
 *
 * @param {Object} [opts]
 * @param {string} [opts.valueEnv] - env var carrying the password directly
 * @param {string} [opts.pathEnv] - env var carrying a path to the password file
 * @param {string} [opts.defaultPath] - fallback path when neither env var is set
 * @param {Object} [opts.env] - injectable for tests (defaults to process.env)
 * @param {Function} [opts.readFile] - injectable for tests (defaults to fs.readFileSync)
 * @param {Function} [opts.exists] - injectable for tests
 * @param {Function} [opts.stat] - injectable for tests
 * @returns {string} the trimmed password — never logged by this function
 */
export function loadCredential({
  valueEnv = 'LIN3014_MONGO_PASSWORD',
  pathEnv = 'LIN3014_MONGO_PASSWORD_FILE',
  defaultPath = DEFAULT_PASSWORD_FILE,
  env = process.env,
  readFile = readFileSync,
  exists = existsSync,
  stat = statSync
} = {}) {
  if (env[valueEnv]) return env[valueEnv].trim();

  const filePath = env[pathEnv] || defaultPath;
  if (!exists(filePath)) {
    throw new Error(
      `no LIN-3014 Mongo credential found: set ${valueEnv} or put the password in a chmod-600 file at ${filePath} (see ${pathEnv})`
    );
  }
  const mode = stat(filePath).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `refusing to read ${filePath}: mode ${mode.toString(8)} is readable/writable beyond the owner — chmod 600 it first`
    );
  }
  return readFile(filePath, 'utf8').trim();
}

/**
 * True if `hostname` (no port) is a loopback address — the only host a
 * throwaway local replay `mongod` is allowed to run on.
 */
export function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * The single role check every production read runs through. Throws unless
 * either:
 *   - `isLocalReplayTarget` is true (a throwaway local `mongod`, not
 *     production — the runbook's role restriction doesn't apply there), or
 *   - the connection's roles are EXACTLY `read@linear-viewer` — no more, no
 *     fewer, and never `root` (ruling `16c2be3e`: "All measurement and
 *     equivalence reads run under that user, never root").
 *
 * @param {Object} connectionStatus - the result of `db.runCommand({connectionStatus:1})`
 * @param {Object} [opts]
 * @param {boolean} [opts.isLocalReplayTarget]
 */
export function assertSafeConnection(connectionStatus, { isLocalReplayTarget = false } = {}) {
  if (isLocalReplayTarget) return;

  const roles = connectionStatus?.authInfo?.authenticatedUserRoles || [];
  const isExactlyReadOnLinearViewer =
    roles.length === 1 && roles[0]?.role === 'read' && roles[0]?.db === 'linear-viewer';

  if (!isExactlyReadOnLinearViewer) {
    const roleDesc = roles.length ? roles.map((r) => `${r.role}@${r.db}`).join(',') : '(none)';
    throw new Error(
      `refusing to proceed: connection roles are [${roleDesc}], expected exactly read@linear-viewer — ` +
        'production reads must never run under root (ruling 16c2be3e)'
    );
  }
}
