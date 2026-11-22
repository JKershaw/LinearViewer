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

import { readPrStatusFailOpen, resolvePrReadToken, summarizeChecks } from './github-pr-status.js';
import { prOf, prUrlsIn } from './run-ledger.js';
import { deriveCloseOutState, headMovedFor, CLOSE_OUT_ACTOR } from './run-closeout-state.js';
import { findingsNotRead, readOpenFindings } from './close-out-findings.js';
import { trailForTicket } from './task-standing.js';
import { toEpochMs } from './utils/time.js';

function checksUrlFor(repo, number) {
  return `https://github.com/${repo}/pull/${number}/checks`;
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
    const [url] = prUrlsIn(raw);
    if (url) { const { repo, number } = prOf(url); corroborating.add(`${repo}#${number}`); }
  }

  const sorted = (Array.isArray(comments) ? [...comments] : [])
    .sort((a, b) => (toEpochMs(b && b.createdAt) ?? 0) - (toEpochMs(a && a.createdAt) ?? 0));
  const seen = new Map();
  for (const comment of sorted) {
    const body = comment && typeof comment.body === 'string' ? comment.body : '';
    // LIN-4438: the PR URLs are lib/run-ledger.js prUrlsIn's, the one reader of a body's PR URLs.
    for (const found of prUrlsIn(body)) {
      const { repo, number } = prOf(found);
      const key = `${repo}#${number}`;
      if (seen.has(key)) continue;
      seen.set(key, { url: `https://github.com/${repo}/pull/${number}`, repo, number, corroborated: corroborating.has(key) });
    }
  }
  return [...seen.values()];
}

/**
 * The landing's PRs (the records trail's `landing`, full URLs) in the `{url, repo, number,
 * corroborated}` shape the box and the close-out chain list (LIN-4458). `corroborated` is the cited
 * entry's (`extractPrUrls`), when the caller has the cited list.
 * @param {string[]} landing
 * @param {Array<{url: string, corroborated?: boolean}>} [cited]
 */
export function landingPrRefs(landing, cited = []) {
  return (Array.isArray(landing) ? landing : []).map((url) => {
    const { repo, number } = prOf(url);
    const seen = cited.find(p => p.url === url);
    return { url, repo, number, corroborated: !!(seen && seen.corroborated) };
  });
}

// LIN-4460: the page's PR picker. It names the one cited PR the page shows checks for (`state.pr`) and
// the cited URLs (`state.prUrls`, read by lib/pr-state-store.js). It decides no close-out: the box's
// status is `closeOutDecision`'s, over the landing. Its old status words had no reader outside the
// tests and the GET body, so they are retired: clients read the check route's box for the close-out status, not this body.
function deriveState(prUrls, prStatus) {
  if (prUrls.length !== 1) return { pr: null, prUrls };
  const candidate = prUrls[0];
  const prBase = { url: candidate.url, repo: candidate.repo, number: candidate.number, corroborated: !!candidate.corroborated };
  if (!prStatus || prStatus.readable === false) {
    return { pr: { ...prBase, state: null, merged: false, headSha: null, checksUrl: null, mergedAt: null }, prUrls };
  }
  const headSha = (prStatus.head && prStatus.head.sha) || prStatus.ref || null;
  const pr = {
    ...prBase,
    state: prStatus.state || null,
    merged: !!prStatus.merged,
    headSha,
    checksUrl: checksUrlFor(candidate.repo, candidate.number),
    // LIN-4405 (Departure 4 of LIN-4395): GitHub's own merge time, so the task page's session timeline can mark a merge
    // whose close-out event predates `prMergedAt` (LIN-3713). Additive; null when GitHub has not set it.
    mergedAt: prStatus.merged_at ?? null,
  };
  return { pr, prUrls };
}

function buildNow(state, prStatus, review) {
  const prUrl = state.pr ? state.pr.url : null;
  const checksUrl = state.pr ? state.pr.checksUrl : null;
  const readable = prStatus && prStatus.readable === true;
  if (!readable) {
    return { state: 'unknown', read: false, checks: [], headSha: null, prUrl, checksUrl, headMoved: false };
  }
  const headSha = (prStatus.head && prStatus.head.sha) || prStatus.ref || null;
  return {
    state: summarizeChecks(prStatus.checks),
    // LIN-3443: the PR was read. `state: 'unknown'` with `read: true` means "no
    // checks are set up"; with `read: false` it means the PR could not be read.
    read: true,
    checks: Array.isArray(prStatus.checks) ? prStatus.checks : [],
    headSha,
    prUrl,
    checksUrl,
    // LIN-4520 (finding-e79dcdd5): the same per-PR rule the close-out decision reads (headMovedFor), never a single sha.
    headMoved: !!(review && state.pr && headSha && headMovedFor(state.pr.url, headSha, review)),
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
 * @param {Object|null} [input.prStatus] - `readPrStatusFailOpen` result for the landing's sole PR
 *   (LIN-4458: `readRunEvidence` reads that PR and no other; a multi-PR landing reads none)
 * @param {string|null} [input.asked]
 * @param {string|null} [input.done]
 * @param {boolean} [input.owner]
 * @param {string|null} [input.urlKey]
 * @param {('pr'|null)} [input.stopAt] - the run's boundary (P1a); gates `ready`.
 * @param {('standard'|'stepper')} [input.variant] - N2 copy.
 * @param {boolean} [input.runnerReady] - the ladder's readiness predicate.
 * @param {Object} [input.openFindings] - the task's open findings to close-out (lib/close-out-findings.js). Omitted
 *   reads as not-read, which holds the close and shows "not measured": never zero (LIN-4495).
 * @param {Object|null} input.trail - the ticket's records trail (lib/task-standing.js trailForTicket; LIN-4518 step 3,
 *   LIN-4520): the review, its blind read and the landing. Null or absent (not read) throws: a box never reads an unread
 *   ticket as "no review".
 * @returns {Object}
 */
export function buildRunEvidence({
  issueIdentifier = null,
  issue = null,
  comments = [],
  prUrls = null,
  prStatus = null,
  asked = null,
  done = null,
  owner = false,
  urlKey = null,
  stopAt = null,
  variant = null,
  runnerReady = false,
  openFindings = null,
  trail = null,
} = {}) {
  if (!trail) throw new Error('buildRunEvidence: the ticket\'s records trail was not read');
  const urls = prUrls || extractPrUrls(comments);
  const findings = openFindings || findingsNotRead('not read by the caller');
  // LIN-3497 / LIN-4520: a review is on record only when the records hold one; the review, its blind read after it and the
  // landing come from the ticket's records trail (lib/task-standing.js trailForTicket), read once by the caller. The
  // comments are read here only for the PR links the page shows as cited (the picker's list), never for a verdict.
  const reviewModel = trail.review;
  const blindRead = reviewModel ? reviewModel.blindRead : null;
  // LIN-4458: the box counts the landing (lib/run-trail.js), never every cited PR. Its one PR read
  // is the landing's sole PR, matched to it by URL; a multi-PR landing reads none, so it reads as not
  // known merged. The page's own PR state (`state`, and the picker `resolveRunPrRef` reads from it)
  // still lists the cited URLs: it picks a PR to show checks for, not a landing to gate. It takes the
  // read only when its one cited PR is that same landing PR, as before.
  const landing = trail.landing;
  const landingRefs = landingPrRefs(landing, urls);
  const soleLandingUrl = landingRefs.length === 1 ? landingRefs[0].url : null;
  const statusForState = urls.length === 1 && urls[0].url === soleLandingUrl ? prStatus : null;
  const state = deriveState(urls, statusForState);

  const review = reviewModel
    ? { verdict: reviewModel.verdict, verdictText: null, ciLine: null, at: reviewModel.at, sha: reviewModel.sha }
    : null;
  const evidence = {
    asked: asked != null ? asked : (issue && issue.title) || issueIdentifier || null,
    done: done != null ? done : (state.pr ? `PR #${state.pr.number}` : null),
    checked: { review, blindRead: blindRead ? { verdict: blindRead.verdict, reason: blindRead.reason, at: blindRead.at } : null, now: buildNow(state, statusForState, reviewModel) },
  };

  // The close-out box is P3's (LIN-3248): a `deriveCloseOutState` model over `closeOutDecision`
  // (LIN-4460); `state` decides nothing. One PR status is read here (P2's cost bound), the landing's sole
  // PR's; a multi-PR landing is left unread, so it fails open to `unknown` until the page's
  // check route reads the landing.
  // LIN-4438: the box answers the blind-read gate the dispatch guard answers, from the same landing,
  // so it never shows a ready PR whose press would be refused.
  const closeOutState = deriveCloseOutState({
    prs: landingRefs,
    prStatuses: new Map(soleLandingUrl && prStatus ? [[soleLandingUrl, prStatus]] : []),
    landingPrs: landing,
    review: reviewModel,
    runnerReady,
    owner: !!owner,
    stopAt,
    variant,
    actor: CLOSE_OUT_ACTOR.HARBOUR,
    openFindings: findings,
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
 * @param {string|null} [args.workspaceId] - LIN-3285: the workspace id the owner is read from
 * @param {Function|null} [args.installationTokenFor] - LIN-3285: the owner-installation token seam
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
  workspaceId = null,
  installationTokenFor = null,
  recordsStore = null,
  openFindings = null,
} = {}) {
  const comments = Array.isArray(suppliedComments)
    ? suppliedComments
    : await provider.fetchIssueComments(callScope, issueIdentifier);
  // The PRs the page shows as cited (the picker's list) are the comments' links, for display; no verdict is read from them.
  const prUrls = extractPrUrls(comments, evidenceUrls);
  // LIN-4495: the open findings to close-out, read once here unless the caller already holds the reading.
  const findings = openFindings || await readOpenFindings({
    store: recordsStore, urlKey, ticket: issueIdentifier,
  });
  // LIN-4518 step 3: the review, its blind read and the landing come from the ticket's records (throws when unread).
  const trail = await trailForTicket({ recordsStore, urlKey, ticket: issueIdentifier });
  if (!trail) throw new Error(`the ticket's records could not be read (${urlKey} ${issueIdentifier})`);
  // LIN-4458: the one PR read is the landing's sole PR (a multi-PR landing reads none), the same PR
  // the box counts; a PR cited outside the landing is not read.
  const landing = trail.landing;
  let prStatus = null;
  if (landing.length === 1) {
    const { repo, number } = prOf(landing[0]);
    // LIN-3443: authenticate only with a workspace scope to cache under; no
    // `urlKey` → anonymous, so the token-needs-scopeKey guard cannot fire here.
    // LIN-3285: a Linear/Jira workspace resolves the owner's installation token
    // here, once per read; the token is passed on as `auth`, so a custom
    // `readPrStatus` (the task page's) does not resolve a second time.
    const token = urlKey
      ? await resolvePrReadToken({ callScope, repo, providerKind: provider?.name, workspaceId, installationTokenFor })
      : null;
    const auth = token ? { token, scopeKey: urlKey } : undefined;
    prStatus = await readPrStatus({
      repo, number, doFetch: githubFetch,
      ...(auth ? { ...auth, auth } : {}),
    });
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
    openFindings: findings,
    trail,
  });
}

const ANY_HEADING_RE = /^#{2,4}[ \t]/;
const OPENING_TITLE_RE = /^#{1,4}[ \t]/;

/**
 * The block a close-out's account opens with: from its first line to the next `##`–`####` heading, an opening title
 * line excluded. '' when there is nothing under it.
 * @param {string|null|undefined} account - the run's final text (lib/run-records.js)
 * @returns {string}
 */
function summaryBlockOf(account) {
  const lines = String(account || '').split('\n');
  const first = lines.findIndex(l => l.trim());
  if (first === -1) return '';
  const start = OPENING_TITLE_RE.test(lines[first].trim()) ? first + 1 : first;
  const rest = lines.slice(start);
  const end = rest.findIndex(l => ANY_HEADING_RE.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

/**
 * The close-out's own leading summary (LIN-3373), for the finished share page to quote verbatim: the account of the
 * latest close-out run that ended AFTER the chosen review (a close-out dated before it belongs to an earlier round).
 * LIN-4520 (finding-9d0c053a): read from the run record's `account`, not from a comment's title. `text` is quoted, never
 * parsed into items or counts. No such run, or an account with nothing under it, is `null`.
 *
 * @param {Array<{at?: string, fields?: {account?: string|null}}>} closeOutRuns - the task's close-out run records
 *   (lib/records-store.js closeOutRunsForTicket)
 * @param {{at?: string|null}|null} review - the review the ledger came from (the trail's review, with its records instant)
 * @returns {{at: string|null, text: string}|null}
 */
export function closeOutSummaryFor(closeOutRuns, review) {
  const reviewAt = (toEpochMs(review && review.at) ?? 0);
  let best = null;
  for (const run of Array.isArray(closeOutRuns) ? closeOutRuns : []) {
    const at = (toEpochMs(run && run.at) ?? 0);
    if (reviewAt && at <= reviewAt) continue;
    if (best && at < best.ms) continue;
    const text = summaryBlockOf(run && run.fields ? run.fields.account : null);
    if (!text) continue;
    best = { ms: at, at: run.at || null, text };
  }
  return best ? { at: best.at, text: best.text } : null;
}
