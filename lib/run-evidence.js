// Run-evidence builder (LIN-3247, P2 of LIN-2949).
//
// Turns a run's tracker comments plus a fail-open PR-state read into the
// evidence model the page seam renders. The PR-URL source here is deliberately
// narrow (S1): PR URLs found in the run's OWN tracker comments, newest first.
// The run's `[evidence]` telemetry URLs are corroboration only — they may mark
// a comment URL as corroborated but can never be the sole source of a `ready`
// state.
//
// LIN-3333: the workspace repo allowlist filter is gone (retired with the
// project `repo=` lines). Any GitHub `owner/name` slug in a comment counts; the
// slug safety moved into `fetchPrStatus` (`isGitHubRepoSlug`).
//
// `buildRunEvidence` is pure. `readRunEvidence` is the I/O orchestrator both the
// route and the temporary session-page mount call, so the two read the same way.

import { readPrStatusFailOpen } from './github-pr-status.js';
import { latestReviewComment, parseRunLedger } from './run-ledger.js';
import { deriveCloseOutState } from './run-closeout-state.js';

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
 * Distinct PR URLs from a run's comments, newest comment first. `evidenceUrls`
 * (worker `[evidence]` telemetry) only annotate a comment URL as
 * `corroborated`; a URL present ONLY in evidence is ignored.
 *
 * @param {Array<{body?: string, createdAt?: string}>} comments
 * @param {string[]} [evidenceUrls]
 * @returns {Array<{url: string, repo: string, number: number, corroborated: boolean}>}
 */
export function extractPrUrls(comments, evidenceUrls = []) {
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
 * @param {Array} [input.prUrls] - precomputed `extractPrUrls` result (else recomputed)
 * @param {Object|null} [input.prStatus] - `readPrStatusFailOpen` result for the one PR
 * @param {Object|null} [input.ledger] - precomputed `parseRunLedger` model
 * @param {string|null} [input.asked]
 * @param {string|null} [input.done]
 * @param {boolean} [input.owner]
 * @param {string|null} [input.urlKey]
 * @param {('pr'|null)} [input.stopAt] - the run's boundary (P1a); gates `ready`.
 * @param {('standard'|'stepper')} [input.variant] - N2 copy.
 * @param {boolean} [input.runnerReady] - the ladder's readiness predicate.
 * @returns {Object}
 */
export function buildRunEvidence({
  issueIdentifier = null,
  issue = null,
  comments = [],
  prUrls = null,
  prStatus = null,
  ledger = null,
  asked = null,
  done = null,
  owner = false,
  urlKey = null,
  stopAt = null,
  variant = null,
  runnerReady = false,
} = {}) {
  const urls = prUrls || extractPrUrls(comments);
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

  // The close-out box is P3's (LIN-3248): a `deriveCloseOutState` model, not
  // P2's looser `state.status`. One PR status is read here (P2's cost bound);
  // multi-PR is left unread, so it fails open to `unknown` until the page's
  // check route reads every PR.
  const closeOutState = deriveCloseOutState({
    prs: urls,
    prStatuses: prStatus ? [prStatus] : urls.map(() => null),
    review: reviewModel,
    runnerReady,
    owner: !!owner,
    stopAt,
    variant,
    byPersonCheck: false,
  });

  return {
    issueIdentifier,
    state,
    evidence,
    ledger: reviewModel,
    closeOut: { ...closeOutState, urlKey, issueIdentifier },
  };
}

/**
 * The I/O orchestrator: read the issue's comments, do the fail-open PR-state
 * read for the single candidate, and build the model.
 * Shared by the route and the temporary session-page mount.
 *
 * @param {Object} args
 * @param {string} args.issueIdentifier
 * @param {Object} args.provider
 * @param {string|Object} args.callScope
 * @param {boolean} [args.viewerIsOwner] - the viewer may act on the close-out
 *   box. Defaults to `false` (LIN-3311): only a caller that has established
 *   ownership passes `true`, so a forgotten flag can never mount the box.
 * @param {Function} [args.readPrStatus]
 * @param {Function} [args.githubFetch]
 * @param {string[]} [args.evidenceUrls]
 * @param {string|null} [args.asked]
 * @param {string|null} [args.done]
 * @param {string|null} [args.urlKey]
 * @param {('pr'|null)} [args.stopAt]
 * @param {('standard'|'stepper')} [args.variant]
 * @param {boolean} [args.runnerReady]
 * @param {Array|null} [args.comments] - the issue's comments when the caller
 *   already read them (LIN-3329: the task page's one tracker read carries them).
 *   Supplied, the comment fetch is skipped; omitted (the run page), it runs as
 *   before.
 * @returns {Promise<Object>}
 */
export async function readRunEvidence({
  issueIdentifier,
  provider,
  callScope,
  viewerIsOwner = false,
  readPrStatus = readPrStatusFailOpen,
  githubFetch = null,
  evidenceUrls = [],
  asked = null,
  done = null,
  urlKey = null,
  stopAt = null,
  variant = null,
  runnerReady = false,
  comments: suppliedComments = null,
} = {}) {
  const comments = Array.isArray(suppliedComments)
    ? suppliedComments
    : await provider.fetchIssueComments(callScope, issueIdentifier);
  const prUrls = extractPrUrls(comments, evidenceUrls);
  let prStatus = null;
  if (prUrls.length === 1) {
    const { repo, number } = prUrls[0];
    prStatus = await readPrStatus({ repo, number, doFetch: githubFetch });
  }
  return buildRunEvidence({
    issueIdentifier,
    comments,
    prUrls,
    prStatus,
    asked,
    done,
    owner: !!viewerIsOwner,
    urlKey,
    stopAt,
    variant,
    runnerReady,
  });
}
