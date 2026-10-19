// LIN-3285 shared fakes: one fake GitHub (App endpoints + PR REST), connection rows
// and the owner-installation seam built over them. All in-memory; no socket.
import crypto from 'node:crypto';
import { createInstallationTokenResolver } from '../../lib/connection-credential.js';

export const REPO = 'acme/widget';
export const PR_URL = `https://github.com/${REPO}/pull/12`;
export const MINTED = 'ghs_minted_installation_token';
export const MINTED_AUTH = `Bearer ${MINTED}`;
export const OWNER = 'acct-owner';
export const OTHER = 'acct-other';
export const WS = 'ws-id-1';
export const NOW = Date.parse('2026-10-19T12:00:00.000Z');

export function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

/**
 * One fake GitHub: the App endpoints (JWT-authed) and the PR REST endpoints
 * (403 without a Bearer, answers a normal open PR with one). `coveredBy` is the
 * installation id that covers REPO (null → 404 "not installed").
 */
export function fakeGitHub({ coveredBy = 'inst-1', mintStatus = 201, repoLookupStatus = 200, throwOn = null, expiresInMs = 60 * 60 * 1000, clock = () => NOW } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const headers = opts.headers || {};
    calls.push({ url, method: opts.method || 'GET', auth: headers.Authorization || null });
    if (throwOn && throwOn.test(url)) throw new Error('socket hang up');
    if (/\/repos\/[^/]+\/[^/]+\/installation$/.test(url)) {
      if (repoLookupStatus !== 200) return res(repoLookupStatus, { message: 'boom' });
      if (coveredBy === null) return res(404, { message: 'Not Found' });
      return res(200, { id: Number.isNaN(Number(coveredBy)) ? coveredBy : coveredBy });
    }
    const mint = url.match(/\/app\/installations\/([^/]+)\/access_tokens$/);
    if (mint) {
      if (mintStatus !== 201) return res(mintStatus, { message: 'mint failed' });
      return res(201, { token: MINTED, expires_at: new Date(clock() + expiresInMs).toISOString() });
    }
    if (!headers.Authorization) return res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return res(200, { private: true });
    if (/\/pulls\/\d+$/.test(url)) return res(200, { state: 'open', merged: false, head: { ref: 'f', sha: 'abc1234' }, base: { ref: 'main' }, mergeable: true });
    if (/\/check-runs$/.test(url)) return res(200, { check_runs: [{ name: 'unit', conclusion: 'success' }] });
    if (/\/status$/.test(url)) return res(200, { state: 'success', statuses: [] });
    return res(404, {});
  };
  impl.calls = calls;
  impl.prCalls = () => calls.filter(c => /\/(pulls|check-runs|status)\b|\/repos\/[^/]+\/[^/]+$/.test(c.url) && !/installation/.test(c.url));
  impl.appCalls = () => calls.filter(c => /installation/.test(c.url));
  return impl;
}

export function connection(accountId, provider, installationId, extra = {}) {
  return { accountId, provider, unitId: String(installationId), credentials: { installationId: String(installationId) }, referents: [], ...extra };
}

/** Build the seam over fakes. `rows` are the connection rows; `owners` maps workspace id → owner account id. */
export function makeSeam({ rows = [], owners = { [WS]: OWNER }, ownerAnswer, github = fakeGitHub(), clock = () => NOW, fetchImpl: fetchImplOverride = undefined, noFetch = false } = {}) {
  const fetchImpl = noFetch ? undefined : (fetchImplOverride ?? github);
  const readLog = [];
  const connectionStore = {
    async readConnectionsByAccountPrefix(accountId) {
      readLog.push(accountId);
      return rows.filter(r => r.accountId === accountId);
    },
  };
  const ownerChecks = [];
  const workspaceOwnerCheck = async (args) => {
    ownerChecks.push(args);
    if (ownerAnswer) return ownerAnswer(args);
    return owners[args.workspaceId] === args.accountId ? { status: 'owner' } : { status: 'not-owner' };
  };
  const installationTokenFor = createInstallationTokenResolver({
    connectionStore,
    resolveCanonicalAccountId: id => id,
    getWorkspaceOwnerAccountId: async id => owners[id] ?? null,
    workspaceOwnerCheck,
    fetchImpl,
    now: clock,
  });
  return { installationTokenFor, github, readLog, ownerChecks };
}

/** Generate a throwaway App key into the env the resolver reads. Call from `before`. */
export function installAppKey() {
  process.env.NODE_ENV = 'test';
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
}

