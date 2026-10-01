/**
 * lib/file-pointer.js — the LIN-3200 file-pointer pilot's pure core.
 *
 * A short pointer prepended to the IMPLEMENTATION prompt only, on every
 * second implementation dispatch (chosen deterministically from the live
 * ordinal). It carries two inputs, both already in the record:
 *
 *   1. the plan's named paths, parsed from the issue description's
 *      `## Implementation Plan` block; and
 *   2. the files edited in earlier PRs on the ticket, read from GitHub at
 *      dispatch time (lib/github-pr-files.js) because only the PR *URL* is
 *      recorded, never its file list.
 *
 * This module is PURE: no I/O, no clock, no env. Everything that reads
 * (the plan block, the PR files, the eligible-row count) happens in the
 * factory seam (lib/dispatch-factory.js step 7.6) and the store
 * (lib/dispatch-store.js `countPilotEligible`), both of which consume the
 * timing constants and the arm rule exported here so there is exactly ONE
 * copy of each.
 *
 * The arm rule is recomputable from existing row fields (kind, followUpTo,
 * abort, issueIdentifier, dispatchedAt, resolvedAt) — no row field is added
 * or stamped, and the `addItem` argument stays byte-identical across arms.
 *
 * Residuals R1-R4 (fail-open, a hop that outlasts HOP_ALLOWANCE_MS, a
 * swallowed archive failure, clock skew) are named in the plan's arm-rule
 * section and are deliberately NOT claimed away by this module; the
 * race-suspect flag here shrinks, but does not eliminate, their effect.
 * Plus the insert-lag residual folded in from plan-review verdict
 * `ee3c850d`: `addItem` stamps `dispatchedAt` and THEN awaits an uncapped
 * `insertOne`, so the stamp-to-visible gap `L_insert` is absorbed by
 * `RACE_SUSPECT_WINDOW_MS − COUNT_TIMEOUT_MS`; an insert stall above that is
 * the write-side twin of R2 and is named, not closed.
 */

// ─── Timing constants (single source for factory, store and read side) ───────

export const COUNT_TIMEOUT_MS = 2000;
export const PLAN_READ_TIMEOUT_MS = 3000;
export const POINTER_STEP_TIMEOUT_MS = 4000;
export const HOP_ALLOWANCE_MS = 1000;
export const SKEW_SLACK_MS = 2000;

/**
 * Race-suspect window. DERIVED, never hard-coded: `G` (the max gap from the
 * count that decided the arm to `addItem`'s `new Date()`) is bounded by
 * `COUNT_TIMEOUT_MS`; a hop miss needs `G + HOP_ALLOWANCE_MS`; the skew slack
 * covers clock differences and ms-level stamp inversion; and the same window
 * absorbs the insert-lag `L_insert` up to its remainder
 * (`W − COUNT_TIMEOUT_MS`). Raising a timeout without raising the window
 * therefore fails the constants test rather than silently shrinking coverage.
 */
export const RACE_SUSPECT_WINDOW_MS = COUNT_TIMEOUT_MS + HOP_ALLOWANCE_MS + SKEW_SLACK_MS;

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * Stable, human-readable start marker. It is the FIRST line of the rendered
 * pointer (three existing consumers show a prompt's first line — an accepted
 * cosmetic surface), and it is the idempotency key `prependFilePointer`
 * checks: a prompt that already carries it is left untouched.
 *
 * Deliberately carries no tracker name and no literal "Linear": the text can
 * reach any provider, and this module renders only repo-relative paths.
 */
export const FILE_POINTER_MARKER = '[file-pointer v1]';

const START_LINE = `${FILE_POINTER_MARKER} Starting points from this ticket's plan and earlier PRs — not the scope; re-read before trusting:`;
const END_LINE = '[end file-pointer]';

/**
 * Character budget for the rendered entry lines (`- <path>` each plus its
 * trailing newline), chosen to keep the WHOLE pointer near the plan's ~100-token
 * figure (the probe's 93). The old 40-entry cap rendered about 295 tokens and
 * 1,032 characters — roughly three times the evidence it cites — because path
 * length, not entry count, is what a worker's model actually spends context on.
 * The fixed header + footer add about 40 tokens, leaving ~60 for entries.
 */
export const DEFAULT_MAX_CHARS = 300;

const PATH_RE = /^[A-Za-z0-9._@+/-]+$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Extension allowlist for a plan/PR path. Requiring an extension is not enough:
 * dotted identifiers, semver fragments (`1.5`, `7.6`), method references
 * (`Promise.all`, `store.listItems`) and hosts (`api.github.com`,
 * `github.com.evil.com`) all end in a dot-plus-alphanumerics. Only code/text
 * extensions a real repo file would carry are admitted.
 */
const FILE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts',
  'json', 'jsonc', 'json5', 'md', 'markdown', 'mdx',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte', 'astro',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'scala',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'm', 'mm',
  'php', 'pl', 'lua', 'r', 'dart', 'ex', 'exs', 'erl', 'clj',
  'sql', 'graphql', 'gql', 'prisma', 'proto', 'tf', 'tfvars',
  'xml', 'txt', 'env', 'lock', 'gradle', 'dockerfile'
]);

/**
 * The render bound — the LAST gate before a worker sees text. Anything the
 * upstream (session-written plan text, third-party PR filenames) supplies is
 * dropped, never escaped, when it fails this.
 */
export function isRenderablePath(path) {
  if (typeof path !== 'string') return false;
  if (path.length < 1 || path.length > 200) return false;
  if (!PATH_RE.test(path)) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('://')) return false;
  // Reject `..` ANYWHERE in the token, not only as a whole segment: an ellipsis
  // or range like `2b454442..HEAD` must not read as a path (and a traversal
  // `lib/../etc` is caught here too).
  if (path.includes('..')) return false;
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return false;
  }
  const base = segments[segments.length - 1];
  // Extension must be a real code/text extension: this drops dotted
  // identifiers, semver fragments and hostnames the naked "has a dot" rule let
  // through.
  const extMatch = base.match(/\.([A-Za-z0-9]+)$/);
  if (!extMatch || !FILE_EXTENSIONS.has(extMatch[1].toLowerCase())) return false;
  return true;
}

export function isRenderableRepo(repo) {
  return typeof repo === 'string' && REPO_RE.test(repo);
}

// ─── Plan-block extraction ───────────────────────────────────────────────────

/**
 * Extract the `## Implementation Plan` section from a description. The heading
 * is matched by PREFIX, because real headings carry suffixes (this ticket's
 * `(LIN-3200 plan pass 4, Strategy C)`, LIN-3135's `(2026-09-29, revision 2)`,
 * LIN-3136's `(T3 build, …)`); when several match, the LAST one wins (the plan
 * revision replaces the prior block rather than appending beside it).
 *
 * @param {string|null} planBlock - the issue description (or any text)
 * @returns {string|null} the section body, or null when there is no heading
 */
export function extractPlanSection(planBlock) {
  if (typeof planBlock !== 'string' || planBlock.length === 0) return null;
  const headingRe = /^##[ \t]+Implementation Plan\b[^\n]*$/gm;
  let match;
  let headingStart = -1;
  while ((match = headingRe.exec(planBlock)) !== null) headingStart = match.index;
  if (headingStart === -1) return null;

  const lineEnd = planBlock.indexOf('\n', headingStart);
  const body = lineEnd === -1 ? '' : planBlock.slice(lineEnd + 1);
  const nextRe = /^##[ \t]/m;
  const nextMatch = nextRe.exec(body);
  return nextMatch ? body.slice(0, nextMatch.index) : body;
}

/**
 * Pull repo-relative path tokens out of a plan section. A token qualifies when
 * its trailing punctuation and any `:line`/`:line-range` reference are
 * stripped and the remainder passes the render bound (extension required; URLs
 * and absolute paths excluded). Order preserved; deduped by the builder.
 *
 * @param {string|null} planBlock
 * @returns {string[]}
 */
export function extractPlanPaths(planBlock) {
  const section = extractPlanSection(planBlock);
  if (!section) return [];
  const out = [];
  const seen = new Set();
  for (const raw of section.split(/\s+/)) {
    let token = raw
      .replace(/^[`*_([{'"<>]+/, '')
      .replace(/[`*_)\]}>'".,;:!?]+$/, '');
    token = token.replace(/:\d+(?:-\d+)?$/, '');
    if (!isRenderablePath(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

// ─── PR-file normalization ───────────────────────────────────────────────────

function normalizePrFiles(prFiles) {
  if (!Array.isArray(prFiles)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of prFiles) {
    const repo = entry?.repo;
    const path = entry?.path;
    if (!isRenderableRepo(repo) || !isRenderablePath(path)) continue;
    const key = `${repo}\u0000${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Newest PR first is the caller's order; preserve it.
    out.push({ repo, path });
  }
  return out;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build the pointer text. Returns null when both inputs are empty (nothing is
 * delivered). Plan paths lead, then earlier-PR files; both are deduped on the
 * rendered path so the two sources never waste a line. Entries are bounded by a
 * CHARACTER budget (`maxChars`, covering each `- <path>` line and its newline),
 * not a fixed entry count: the plan's ~100-token target tracks rendered size,
 * so a handful of long paths must not blow past it.
 *
 * @param {Object} params
 * @param {string|null} [params.planBlock] - issue description text
 * @param {Array<{repo: string, path: string}>} [params.prFiles]
 * @param {number} [params.maxChars] - character budget for the entry lines
 * @returns {{text: string, planPaths: string[], prFiles: Array}|null}
 */
export function buildFilePointer({ planBlock = null, prFiles = [], maxChars = DEFAULT_MAX_CHARS } = {}) {
  const charCap = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
  const planPaths = extractPlanPaths(planBlock).filter(isRenderablePath);
  const normalizedPr = normalizePrFiles(prFiles);

  const entries = [];
  const seen = new Set();
  let used = 0;
  const push = (path) => {
    if (seen.has(path)) return;
    // Each rendered entry is `- <path>` plus a separating newline; charge the
    // exact rendered cost so the budget matches what the worker sees.
    const cost = path.length + 3;
    if (used + cost > charCap) return;
    seen.add(path);
    entries.push(path);
    used += cost;
  };
  for (const path of planPaths) push(path);
  for (const file of normalizedPr) push(file.path);

  if (entries.length === 0) return null;
  const text = `${START_LINE}\n${entries.map(e => `- ${e}`).join('\n')}\n${END_LINE}`;
  return { text, planPaths, prFiles: normalizedPr };
}

/**
 * Prepend the pointer to a prompt. Idempotent on the start marker: a prompt
 * that already carries it is returned unchanged (never double-prepended).
 */
export function prependFilePointer(prompt, pointerText) {
  if (typeof prompt !== 'string') return prompt;
  if (typeof pointerText !== 'string' || pointerText.length === 0) return prompt;
  if (prompt.includes(FILE_POINTER_MARKER)) return prompt;
  return `${pointerText}\n${prompt}`;
}

// ─── Arm rule ────────────────────────────────────────────────────────────────

/**
 * Even ordinal ⇒ pointer arm; odd ⇒ control. A missing/non-integer ordinal
 * (the fail-open case) resolves to control, the untouched prompt.
 */
export function selectPilotArm({ ordinal } = {}) {
  if (!Number.isInteger(ordinal)) return 'control';
  return ordinal % 2 === 0 ? 'pointer' : 'control';
}

/**
 * The predicate shared by the store count (P4) and the recompute here. Every
 * field is on every row and never mutated after insert.
 */
export function isPilotEligible(row) {
  if (!row) return false;
  if (row.kind !== 'implementation') return false;
  if (row.followUpTo != null) return false;
  if (row.abort === true) return false;
  if (row.issueIdentifier == null || row.issueIdentifier === '') return false;
  return true;
}

function toMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Recompute the arm of every eligible row and flag race suspects — the ONE
 * function the read-side script and the tests both call, so the rule that is
 * tested is the rule that is used.
 *
 * Ordering: eligible rows by `dispatchedAt` ascending, ties by `_id`;
 * even position ⇒ pointer, odd ⇒ control. A row X is race-suspect iff another
 * eligible row Y is within `windowMs` of X's `dispatchedAt` (clause i) or
 * within `windowMs` of X's `dispatchedAt` on either side of Y's `resolvedAt`
 * (clause ii — history rows only, i.e. `resolvedAt` present).
 *
 * Suspects are EXCLUDED from the primary comparison in both arms, marker or
 * not; they are counted only in the per-arm `excluded` tally. The flag depends
 * only on timing, never on the arm, so the exclusion is symmetric by
 * construction.
 *
 * @param {Array<Object>} rows
 * @param {Object} [options]
 * @param {number} [options.windowMs=RACE_SUSPECT_WINDOW_MS]
 * @returns {Object}
 */
export function classifyPilotRows(rows, { windowMs = RACE_SUSPECT_WINDOW_MS } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter(isPilotEligible).map(row => ({
    row,
    id: String(row.id ?? row._id ?? ''),
    dispatchedMs: toMs(row.dispatchedAt),
    resolvedMs: toMs(row.resolvedAt)
  }));

  const undated = eligible.filter(r => r.dispatchedMs == null);
  const positioned = eligible
    .filter(r => r.dispatchedMs != null)
    .sort((a, b) => (a.dispatchedMs - b.dispatchedMs) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const outRows = positioned.map((entry, index) => {
    let raceSuspect = false;
    for (const other of positioned) {
      if (other === entry) continue;
      if (Math.abs(entry.dispatchedMs - other.dispatchedMs) <= windowMs) { raceSuspect = true; break; }
      if (other.resolvedMs != null && Math.abs(entry.dispatchedMs - other.resolvedMs) <= windowMs) { raceSuspect = true; break; }
    }
    return {
      id: entry.id,
      position: index,
      arm: selectPilotArm({ ordinal: index }),
      raceSuspect,
      delivered: entry.row.delivered === true,
      dispatchedAt: entry.row.dispatchedAt ?? null,
      resolvedAt: entry.row.resolvedAt ?? null
    };
  });

  const primary = outRows.filter(r => !r.raceSuspect);
  const armStats = (arm) => {
    const assigned = primary.filter(r => r.arm === arm);
    const delivered = assigned.filter(r => r.delivered).length;
    return {
      assigned: assigned.length,
      delivered,
      assignedEmpty: assigned.length - delivered,
      excluded: outRows.filter(r => r.arm === arm && r.raceSuspect).length
    };
  };
  const pointer = armStats('pointer');
  const control = armStats('control');

  const raceSuspect = outRows.filter(r => r.raceSuspect).length;
  const eligibleCount = outRows.length + undated.length;
  const excludedTotal = raceSuspect + undated.length;
  const excludedPct = eligibleCount ? excludedTotal / eligibleCount : 0;

  const maxExcluded = Math.max(pointer.excluded, control.excluded);
  const minExcluded = Math.min(pointer.excluded, control.excluded);
  const lopsided = maxExcluded >= 2 && maxExcluded >= 2 * Math.max(1, minExcluded);

  const concerns = [];
  if (excludedPct > 0.1) {
    concerns.push(`over 10% of eligible rows excluded (${excludedTotal}/${eligibleCount})`);
  }
  if (lopsided) {
    concerns.push(`race-suspect exclusions lopsided between arms (pointer ${pointer.excluded}, control ${control.excluded})`);
  }

  return {
    windowMs,
    rows: outRows,
    totals: {
      eligible: eligibleCount,
      positioned: outRows.length,
      undated: undated.length,
      raceSuspect,
      excluded: excludedTotal,
      excludedPct,
      lopsided,
      pointer,
      control
    },
    concerns
  };
}
