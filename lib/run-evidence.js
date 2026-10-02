// Run-evidence builder (LIN-3247, P2 of LIN-2949).
//
// Turns a run's tracker comments plus a fail-open PR-state read into the
// evidence model the page seam renders. The PR-URL source here is deliberately
// narrow (S1): PR URLs found in the run's OWN tracker comments, newest first,
// restricted to the workspace repo allowlist. The run's `[evidence]` telemetry
// URLs are corroboration only — they may mark a comment URL as corroborated but
// can never be the sole source of a `ready` state.
//
// `buildRunEvidence` is pure. `readRunEvidence` is the I/O orchestrator both the
// route and the temporary session-page mount call, so the two read the same way.

import { resolveRepoAllowlist, readPrStatusFailOpen } from './github-pr-status.js';
import { latestReviewComment, parseRunLedger } from './run-ledger.js';

const PR_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

const FAILING_CONCLUSIONS = new Set(['failure', 'error', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);
const PENDING_CONCLUSIONS = new Set([null, '', 'queued', 'in_progress', 'pending', 'requested', 'waiting']);

function tsOf(value) {
  const t = Date.parse(value || '');
  return Number.isNaN(t) ? 0 : t;
}

function checksUrlFor(repo, number) {
  return `https://github.com/${repo}/pull/${number}/checks`;
}

/** Two shas are "the same head" if equal or one is an abbreviation of the other. */
export function sameHead(a, b) {
  if (!a || !b) return true;
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * Summarise a PR's check-runs + commit statuses as one of passing / failing /
 * pending. An empty rollup is `unknown` (no checks recorded), never a false pass.
 */
export function summarizeChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'unknown';
  let pending = false;
  for (const check of checks) {
    const conclusion = check && check.conclusion != null ? String(check.conclusion).toLowerCase() : null;
    if (FAILING_CONCLUSIONS.has(conclusion)) return 'failing';
    if (PENDING_CONCLUSIONS.has(conclusion)) pending = true;
  }
  return pending ? 'pending' : 'passing';
}

/**
 * Distinct PR URLs from a run's comments, newest comment first, restricted to
 * `allowlist`. `evidenceUrls` (worker `[evidence]` telemetry) only annotate a
 * comment URL as `corroborated`; a URL present ONLY in evidence is ignored.
 *
 * @param {Array<{body?: string, createdAt?: string}>} comments
 * @param {Set<string>|string[]} allowlist
 * @param {string[]} [evidenceUrls]
 * @returns {Array<{url: string, repo: string, number: number, corroborated: boolean}>}
 */
export function extractPrUrls(comments, allowlist, evidenceUrls = []) {
  const allowed = allowlist instanceof Set ? allowlist : new Set(allowlist || []);
  const corroborating = new Set();
  for (const raw of Array.isArray(evidenceUrls) ? evidenceUrls : []) {
    if (typeof raw !== 'string') continue;
    const m = PR_URL_RE.exec(raw);
    PR_URL_RE.lastIndex = 0;
    if (m) corroborating.add(`${m[1]}#${Number(m[2])}`);
  }

  const sorted = (Array.isArray(comments) ? [...comments] : [])
    .sort((a, b) => tsOf(b && b.createdAt) - tsOf(a && a.createdAt));
  const seen = new Map();
  for (const comment of sorted) {
    const body = comment && typeof comment.body === 'string' ? comment.body : '';
    PR_URL_RE.lastIndex = 0;
    let m;
    while ((m = PR_URL_RE.exec(body)) !== null) {
      const repo = m[1];
      const number = Number(m[2]);
      const key = `${repo}#${number}`;
      if (!allowed.has(repo)) continue;
      if (seen.has(key)) continue;
      seen.set(key, { url: `https://github.com/${repo}/pull/${number}`, repo, number, corroborated: corroborating.has(key) });
    }
  }
  return [...seen.values()];
}

function deriveState(prUrls, prStatus, review) {
  if (prUrls.length === 0) {
    return { status: 'no-pr', pr: null, prUrls, message: "no pull request found in this task's comments" };
  }
  if (prUrls.length > 1) {
    return { status: 'multiple-prs', pr: null, prUrls, message: 'more than one PR: close each out on GitHub or with run this step' };
  }
  const candidate = prUrls[0];
  const prBase = { url: candidate.url, repo: candidate.repo, number: candidate.number, corroborated: !!candidate.corroborated };
  if (!prStatus || prStatus.readable === false) {
    return { status: 'unknown', pr: { ...prBase, state: null, merged: false, headSha: null, checksUrl: null }, prUrls, message: 'the pull request could not be read — not checked' };
  }
  const headSha = (prStatus.head && prStatus.head.sha) || prStatus.ref || null;
  const pr = {
    ...prBase,
    state: prStatus.state || null,
    merged: !!prStatus.merged,
    headSha,
    checksUrl: checksUrlFor(candidate.repo, candidate.number),
  };
  if (pr.merged) return { status: 'merged', pr, prUrls, message: 'the pull request is already merged' };
  if (pr.state === 'open') return { status: 'ready', pr, prUrls, message: null };
  return { status: 'pr-not-open', pr, prUrls, message: `the pull request is ${pr.state || 'not open'}` };
}

function buildNow(state, prStatus, review) {
  const prUrl = state.pr ? state.pr.url : null;
  const checksUrl = state.pr ? state.pr.checksUrl : null;
  const readable = prStatus && prStatus.readable === true;
  if (!readable) {
    return { state: 'unknown', checks: [], headSha: null, prUrl, checksUrl, headMoved: false };
  }
  const headSha = (prStatus.head && prStatus.head.sha) || prStatus.ref || null;
  return {
    state: summarizeChecks(prStatus.checks),
    checks: Array.isArray(prStatus.checks) ? prStatus.checks : [],
    headSha,
    prUrl,
    checksUrl,
    headMoved: !!(review && review.sha && headSha && !sameHead(review.sha, headSha)),
  };
}

/**
 * Build the `{ state, evidence, ledger, closeOut }` model. Pure.
 *
 * @param {Object} input
 * @param {string|null} [input.issueIdentifier]
 * @param {Object|null} [input.issue]
 * @param {Array} [input.comments]
 * @param {Set<string>|string[]} [input.allowlist]
 * @param {Array} [input.prUrls] - precomputed `extractPrUrls` result (else recomputed)
 * @param {Object|null} [input.prStatus] - `readPrStatusFailOpen` result for the one PR
 * @param {Object|null} [input.ledger] - precomputed `parseRunLedger` model
 * @param {string|null} [input.asked]
 * @param {string|null} [input.done]
 * @param {boolean} [input.owner]
 * @returns {Object}
 */
export function buildRunEvidence({
  issueIdentifier = null,
  issue = null,
  comments = [],
  allowlist = new Set(),
  prUrls = null,
  prStatus = null,
  ledger = null,
  asked = null,
  done = null,
  owner = false,
} = {}) {
  const urls = prUrls || extractPrUrls(comments, allowlist);
  const reviewModel = ledger || parseRunLedger(latestReviewComment(comments));
  const state = deriveState(urls, prStatus, reviewModel);

  const review = reviewModel
    ? { verdict: reviewModel.verdict, verdictText: reviewModel.verdictText, ciLine: reviewModel.ciLine, at: reviewModel.at, sha: reviewModel.sha }
    : null;
  const evidence = {
    asked: asked != null ? asked : (issue && issue.title) || issueIdentifier || null,
    done: done != null ? done : (state.pr ? `PR #${state.pr.number}` : null),
    checked: { review, now: buildNow(state, prStatus, reviewModel) },
  };

  return {
    issueIdentifier,
    state,
    evidence,
    ledger: reviewModel,
    closeOut: { owner: !!owner, status: state.status, pr: state.pr, message: state.message },
  };
}

/**
 * The I/O orchestrator: read the issue's comments, resolve the allowlist, do
 * the fail-open PR-state read for the single candidate, and build the model.
 * Shared by the route and the temporary session-page mount.
 *
 * @param {Object} args
 * @param {string} args.issueIdentifier
 * @param {Object} args.provider
 * @param {string|Object} args.callScope
 * @param {boolean} [args.viewerIsOwner]
 * @param {Function} [args.readPrStatus]
 * @param {Function} [args.githubFetch]
 * @param {string[]} [args.evidenceUrls]
 * @param {string|null} [args.asked]
 * @param {string|null} [args.done]
 * @returns {Promise<Object>}
 */
export async function readRunEvidence({
  issueIdentifier,
  provider,
  callScope,
  viewerIsOwner = true,
  readPrStatus = readPrStatusFailOpen,
  githubFetch = null,
  evidenceUrls = [],
  asked = null,
  done = null,
} = {}) {
  const comments = await provider.fetchIssueComments(callScope, issueIdentifier);
  let allowlist = new Set();
  try {
    allowlist = await resolveRepoAllowlist(provider, callScope);
  } catch {
    allowlist = new Set();
  }
  const prUrls = extractPrUrls(comments, allowlist, evidenceUrls);
  let prStatus = null;
  if (prUrls.length === 1) {
    const { repo, number } = prUrls[0];
    prStatus = await readPrStatus({ provider, scope: callScope, repo, number, doFetch: githubFetch, allowlist });
  }
  return buildRunEvidence({
    issueIdentifier,
    comments,
    allowlist,
    prUrls,
    prStatus,
    asked,
    done,
    owner: !!viewerIsOwner,
  });
}
