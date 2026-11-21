#!/usr/bin/env node
/**
 * LIN-4517 (slice 3, P4): the one-off import of verdicts that are still only comments on open tasks, for ruling 2's
 * "import" branch (decision lin4513-p4-verdict-import on LIN-4513, John's). Built and tested in P4; it runs only if John
 * rules "import", and nothing runs it by itself.
 *
 * THROWAWAY: delete after its single production run, or in P7 (LIN-4520) at the latest.
 *
 * ORDERING RULE. It must run before P7 retires the verdict parse: it pins each imported verdict to the head its judge's
 * comment states, read by `findSha` through `parseRunLedger(comment).sha` (lib/run-ledger.js), and it is the last user of
 * that read. It must also run before P5 (LIN-4518) flips the stages to records, inside P5's fleet pause, so that no
 * open comment-reviewed task is stranded with no verdict record. P7 deletes this script with findSha.
 *
 * What it imports, per open task the cutover query (docs/reviews/slice-3-readings/cutover-query.mjs) lists as needing an
 * import or a re-review. The selection is that query's own `needsImportOrReReview` (and its per-stage `commentOnly`
 * stages, `legacyLedger` and `ledgerReadEmptyWithItems` lists), so the two cannot disagree:
 *   1. CHANGES FIRST: one change record per PR a verdict rests on, under `fixedIdOf('change', task, PR key)` (the
 *      backstop's own id rule, lib/change-records.js), or the task's existing change for that PR. A change is added with
 *      no head: its head is set only by P3's pin (the head the judge read) and P2's one refresh (the PR's live head).
 *      This script reads no PR head itself.
 *   2. FINDINGS: an approval's conditions (one finding to close-out per condition, about the change, written before the
 *      approval, as routes/proxy-records.js says), then the review ledger's items, one finding to close-out each, for a
 *      task whose ledger is legacy or read as empty although it lists items (finding-76683071; LIN-2634).
 *   3. VERDICTS, `via: import` (no summary and no ticket: lib/records/writes.js), `on` the change version holding the head
 *      the comment states (pinVerdictToHeads, the route's own pin) or the plan version the plan review read.
 *   4. THE REFRESH: refreshTaskChanges, as the verdict route runs it after a pin. A change whose PR merged ends `merged` at
 *      its head at merge, one that closed ends `abandoned`, and one whose PR moved on gets a newer head, which shows the
 *      imported verdict stale.
 * Every id is `fixedIdOf`, so a second run finds what the first made and writes nothing.
 *
 * Never guessed, each skipped and listed instead: a comment whose verdict does not parse; a review or blind read with no
 * PR, with more PRs than the one head its comment states, with no head stated, or whose stated head is not a commit of
 * its PR; a plan review with no plan record to rest on. An "Approve — conditional" with no conditions itemised in its
 * verdict section rests on the task's open findings to close-out when it has any (the reviews of 19 to 20 Nov say
 * "conditional on close-out settling the findings"); with none, its verdict line becomes one finding, so the condition is
 * not lost.
 *
 * How to run (the slice-2 importer's steps, scripts/records/slice-2-import.mjs at 2a2fbb3a2):
 *   0. The dump, read-only, inside harbour-cat: `node cutover-query.mjs dump` (see docs/reviews/slice-3-readings/README.md).
 *   1. capture (read-only, local, through the workspace proxy; `gh` reads each stated head's PR commits):
 *        node scripts/records/slice-3-verdict-import.mjs capture --dump dump.json [--reading reading.json] --out capture.json
 *      With --reading (the cutover query's output), its selection is used and only those tickets are read; without it the
 *      selection is computed here, by the same function, over every open ticket.
 *   2. plan (pure): node scripts/records/slice-3-verdict-import.mjs plan --capture capture.json --out plan.json
 *   3. apply, inside harbour-cat (`railway ssh`, the script in /dev/shm with /app/node_modules linked beside it, the
 *      deployed lib through --root /app), or against an explicit store path. A dry run is the default and prints the
 *      planned writes as counts and ids; --apply writes.
 *        node slice-3-verdict-import.mjs apply --root /app < plan.json
 *        node slice-3-verdict-import.mjs apply --root /app --apply < plan.json
 *        node scripts/records/slice-3-verdict-import.mjs apply --store <dir> --url-key <key> [--offline] [--apply] < plan.json
 *      Apply refuses to run anywhere but harbour-cat in production or an explicit --store. It prints counts and ids only,
 *      never the environment. After an apply, rerun the cutover query: it must read zero needing an import.
 *
 * For P6 (LIN-4519): after an apply the imported verdicts are records written at the apply instant (their comment times are
 * in `reasoning`), so the measures read verdict records from the apply instant, not from the comments' times.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WRITER = 'import';
const ID_SCOPE = 'slice-3-import';
const CLOSE_OUT = 'close-out';
const DB_NAME = 'linear-viewer';
const DEFAULT_ANCHOR = 'plan-fbd0aca5';

const argOf = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const byTime = (a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '');

/** The records functions the import writes through, from `root` (the repo locally, /app inside harbour-cat). */
export async function loadLib(root = REPO_ROOT) {
  const at = (p) => import(pathToFileURL(resolve(root, p)).href);
  const [refs, changeRef, changeRecords, writes, stateMap, stageKinds] = await Promise.all([
    at('lib/records/refs.js'), at('lib/records/change-ref.js'), at('lib/change-records.js'), at('lib/records/writes.js'),
    at('lib/providers/state-map.js'), at('lib/prompts/stage-kinds.js'),
  ]);
  return {
    fixedIdOf: refs.fixedIdOf,
    changeKeyOf: changeRef.changeKeyOf,
    canonicalChangeRef: changeRef.canonicalChangeRef,
    prRefOf: changeRef.prRefOf,
    pinVerdictToHeads: changeRecords.pinVerdictToHeads,
    refreshTaskChanges: changeRecords.refreshTaskChanges,
    createChangePrReaders: changeRecords.createChangePrReaders,
    createRecordWrites: writes.createRecordWrites,
    isTerminalState: stateMap.isTerminalState,
    stageKinds: Object.keys(stageKinds.STAGE_KINDS),
  };
}

/**
 * The checked writer as the records route builds it, less the tracker (an import makes no summary and no ticket): the
 * stage kinds make `close-out` a reader a finding can be addressed to.
 */
export function writesFor(lib, recordsStore) {
  return lib.createRecordWrites({ recordsStore, isTerminalState: lib.isTerminalState, stageKinds: lib.stageKinds });
}

/** The comment readers today's gate uses (the capture is local: never loaded inside the container). */
export async function loadReaders(root = REPO_ROOT) {
  const at = (p) => import(pathToFileURL(resolve(root, p)).href);
  const [trail, ledger, query] = await Promise.all([
    at('lib/run-trail.js'), at('lib/run-ledger.js'), at('docs/reviews/slice-3-readings/cutover-query.mjs'),
  ]);
  return {
    ...(await query.loadReaders()),
    parseRunLedger: ledger.parseRunLedger,
    ledgerItemLines: query.ledgerItemLines,
    cutoverReading: query.cutoverReading,
    readTickets: query.readTickets,
    _trail: trail,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. capture
// ---------------------------------------------------------------------------------------------------------------

/** The bullet or numbered items in an approval's verdict section: its conditions, when it itemises them. */
export function conditionItemsOf(body) {
  const text = String(body || '');
  const start = text.search(/^#{1,4}\s*Verdict\b|^\s*\*\*Verdict|^\s*Verdict:/im);
  if (start === -1) return [];
  const rest = text.slice(start).split('\n').slice(1).join('\n');
  const stop = rest.search(/\n#{1,4}\s/);
  const section = stop === -1 ? rest : rest.slice(0, stop);
  return section.split('\n')
    .map((line) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(\S.*)$/))
    .filter(Boolean)
    .map((m) => m[1].trim());
}

const latestOf = (comments, pred) => comments.filter(pred).sort(byTime).at(-1) ?? null;

/**
 * One task's facts, from its ticket's comments, for the stages the cutover reading lists for it. Pure.
 * @param {Object} args
 * @param {{task: string, ticket: string, stages: string[], ledger: boolean}} args.selected - from the cutover reading
 * @param {object[]} args.comments - the ticket's comments
 * @param {object[]} args.plans - the task's plan records, as the dump holds them
 * @param {Object} args.readers - loadReaders()'s answer
 */
export function factsOf({ selected, comments, plans, readers }) {
  const sorted = [...comments].sort(byTime);
  const stages = [];
  const review = readers.latestReviewComment(sorted);
  const reviewModel = review ? readers.parseRunLedger(review) : null;
  for (const stage of selected.stages) {
    if (stage === 'review' && review) {
      const upTo = sorted.filter((c) => byTime(c, review) <= 0);
      stages.push({
        stage, commentId: review.id, at: review.createdAt, verdict: reviewModel.verdict, verdictText: reviewModel.verdictText,
        sha: reviewModel.sha, prs: readers.readTrail(upTo).landing,
        conditionItems: reviewModel.verdict === 'approve-conditional' ? conditionItemsOf(review.body) : [],
      });
    } else if (stage === 'plan-review') {
      const c = latestOf(sorted, (x) => readers.commentKindOf(x) === 'plan-review');
      if (c) stages.push({ stage, commentId: c.id, at: c.createdAt, verdict: readers.extractVerdict(c.body) ?? 'unknown', verdictText: readers.parseRunLedger(c).verdictText });
    } else if (stage === 'blind-read') {
      const c = latestOf(sorted, (x) => readers.parseBlindRead(x) !== null);
      if (c) {
        const b = readers.parseBlindRead(c);
        stages.push({ stage, commentId: c.id, at: c.createdAt, verdict: b.verdict, verdictText: b.reason, sha: readers.parseRunLedger(c).sha, prs: b.prs });
      }
    }
  }
  let ledger = null;
  if (selected.ledger && review) {
    const items = readers.ledgerItemLines(reviewModel.ledger.raw);
    const legacy = readers.legacyLedgerOf(readers.readTrail(sorted).review);
    ledger = { commentId: review.id, at: review.createdAt, lines: items.length ? items : (legacy && reviewModel.ledger.raw ? [reviewModel.ledger.raw] : []) };
  }
  return { task: selected.task, ticket: selected.ticket, stages, ledger, plans };
}

/**
 * The selection from a cutover reading: each task needing an import or a re-review, with its comment-only stages and
 * whether its ledger is to be imported. Pure.
 */
export function selectionOf(reading) {
  const stagesOf = new Map(reading.commentOnly.tasks.map((r) => [r.task, r.stages.map((s) => s.stage)]));
  const ledgerTasks = new Set([...reading.legacyLedger.tasks, ...reading.ledgerReadEmptyWithItems.tasks].map((r) => r.task));
  return reading.needsImportOrReReview.tasks.map((r) => ({ task: r.task, ticket: r.ticket, stages: stagesOf.get(r.task) ?? [], ledger: ledgerTasks.has(r.task) }));
}

/**
 * The full sha of the head a comment states, when it is a commit of the PR: `{repo, number, sha}` → sha or null. The
 * default reads the PR's commit list through `gh` (a commit list, not the PR's head: the head is the refresh's).
 */
export function ghHeadResolver({ run = (args) => execFileSync('gh', args, { encoding: 'utf8' }) } = {}) {
  return async ({ repo, number, sha }) => {
    let out;
    try { out = run(['api', `repos/${repo}/pulls/${number}/commits`, '--paginate', '--jq', '.[].sha']); } catch { return null; }
    const hits = out.split('\n').map((s) => s.trim()).filter((s) => s && s.startsWith(sha.toLowerCase()));
    return hits.length === 1 ? hits[0] : null;
  };
}

/** Each change-bearing stage's stated head resolved to a full sha of its one PR (or null). */
export async function resolveHeads(facts, { resolveHead, prRefOf }) {
  for (const s of facts.stages) {
    if (s.stage === 'plan-review' || !s.sha || !Array.isArray(s.prs) || s.prs.length !== 1) continue;
    const pr = prRefOf(s.prs[0]);
    s.head = pr ? await resolveHead({ repo: pr.repo, number: pr.number, sha: s.sha }) : null;
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. plan (pure)
// ---------------------------------------------------------------------------------------------------------------

const OUTCOMES = {
  review: { approve: 'approve', 'approve-conditional': 'approve', 'request-changes': 'request-changes', 'needs-discussion': 'needs-discussion' },
  'plan-review': { approve: 'approve', 'request changes': 'request-changes', 'needs discussion': 'needs-discussion' },
  'blind-read': { better: 'better', same: 'same', worse: 'worse' },
};

/** The outcome a stage's comment verdict imports as, or null when it does not parse. */
export const outcomeOf = (stage, verdict) => OUTCOMES[stage]?.[verdict] ?? null;

/**
 * The plan versions a plan review read: each of the task's plans at the version current at the comment's time; a plan
 * made after it counts only when its first version is slice 2's import of the very text the reviewer read (`via: import`).
 */
export function planPinsOf(plans, at) {
  const when = Date.parse(at || '');
  const pins = [];
  for (const p of plans || []) {
    const before = p.versions.filter((v) => Date.parse(v.at) <= when).at(-1);
    if (before) pins.push(`${p.id}@${before.v}`);
    else if (p.versions[0]?.via === 'import') pins.push(`${p.id}@${p.versions[0].v}`);
  }
  return pins;
}

/**
 * The writes the import would make, per task, from the capture. Pure over the id rules.
 * @param {{tasks: object[]}} capture
 * @param {{fixedIdOf: Function, changeKeyOf: Function, canonicalChangeRef: Function}} ids
 */
export function writesPlanOf(capture, { fixedIdOf, changeKeyOf, canonicalChangeRef }) {
  const tasks = [];
  for (const t of capture.tasks) {
    const row = { task: t.task, ticket: t.ticket, changes: [], findings: [], verdicts: [], skipped: [] };
    const changeOf = (url) => {
      const ref = canonicalChangeRef(url);
      if (!row.changes.some((c) => c.ref === ref)) row.changes.push({ ref, id: fixedIdOf('change', t.task, changeKeyOf(ref)) });
      return ref;
    };
    const skip = (s, why) => row.skipped.push({ stage: s.stage, comment: s.commentId, why });
    let reviewChange = null;
    for (const s of t.stages) {
      const outcome = outcomeOf(s.stage, s.verdict);
      if (!outcome) { skip(s, `its verdict does not parse ('${s.verdict}')`); continue; }
      const id = fixedIdOf('verdict', ID_SCOPE, t.task, s.stage, s.commentId);
      const reasoning = `Imported from ${t.ticket}'s ${s.stage} comment of ${s.at} (comment ${s.commentId}). Its verdict: ${s.verdictText ?? s.verdict}`;
      const verdict = { id, stage: s.stage, judgement: s.stage, outcome, reasoning, on: [], heads: {} };
      if (s.stage === 'plan-review') {
        const pins = planPinsOf(t.plans, s.at);
        if (!pins.length) { skip(s, 'no plan record to rest on'); continue; }
        verdict.on = pins.map((plan) => ({ plan }));
      } else {
        const prs = s.prs || [];
        if (!prs.length) { skip(s, 'no PR to rest on'); continue; }
        if (prs.length > 1) { skip(s, `its landing holds ${prs.length} PRs and the comment states one head`); continue; }
        if (!s.sha) { skip(s, 'the comment states no head'); continue; }
        if (!s.head) { skip(s, 'the head it states is not a commit of its PR'); continue; }
        const ref = changeOf(prs[0]);
        verdict.on = [{ change: ref }];
        verdict.heads = { [ref]: s.head };
        if (s.stage === 'review') reviewChange = ref;
      }
      if (s.verdict === 'approve-conditional') {
        const about = verdict.on.filter((o) => o.change).map((o) => o.change);
        if (s.conditionItems?.length) {
          for (const item of s.conditionItems) {
            row.findings.push({ id: fixedIdOf('finding', ID_SCOPE, t.task, 'condition', s.commentId, item), kind: 'condition', says: `A condition of ${t.ticket}'s approval (imported from its review of ${s.at}): ${item}`, about });
          }
        } else {
          verdict.conditionFallback = { id: fixedIdOf('finding', ID_SCOPE, t.task, 'condition', s.commentId, 'verdict'), kind: 'condition', says: `The condition of ${t.ticket}'s approval (imported from its review of ${s.at}), as its verdict states it: ${s.verdictText}`, about };
        }
      }
      row.verdicts.push(verdict);
    }
    if (t.ledger) {
      for (const item of t.ledger.lines) {
        row.findings.push({ id: fixedIdOf('finding', ID_SCOPE, t.task, 'ledger', t.ledger.commentId, item), kind: 'ledger', says: `CI did not prove (imported from ${t.ticket}'s review of ${t.ledger.at}): ${item}`, about: reviewChange ? [reviewChange] : [] });
      }
    }
    tasks.push(row);
  }
  return { tasks };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. apply
// ---------------------------------------------------------------------------------------------------------------

/**
 * Where apply may run (step 3's guard): harbour-cat in production, or an explicit --store. A dry run needs a store too,
 * so the guard is checked for both; --apply is what makes it write.
 * @returns {{write: boolean, store?: string, production?: true}|{refused: string}}
 */
export function applyGuard({ argv, env, exists = existsSync }) {
  const write = argv.includes('--apply');
  const store = argOf(argv, '--store');
  if (store) {
    if (!argOf(argv, '--url-key')) return { refused: '--store needs --url-key, the workspace to import into' };
    return { write, store };
  }
  const production = env.RAILWAY_SERVICE_NAME === 'harbour-cat' && env.RAILWAY_ENVIRONMENT_NAME === 'production'
    && Boolean(env.MONGODB_URI) && exists('/app/lib/records-store.js');
  if (production) return { write, production: true };
  return { refused: `apply runs only inside harbour-cat in production, or against an explicit --store <dir> --url-key <key>${write ? '; --apply refused' : ''}` };
}

/**
 * Apply (or, with write false, plan against the store) the import. Prints nothing; returns counts and ids only.
 * @param {Object} deps
 * @param {{tasks: object[]}} deps.plan - writesPlanOf's answer
 * @param {Object} deps.lib - loadLib()'s answer
 * @param {(args: {repo: string, number: number}) => Promise<object>} deps.readPrStatus - the refresh's PR reader
 */
export async function applyImport({ plan, lib, writes, recordsStore, urlKey, readPrStatus, write = false }) {
  const counts = { tasks: plan.tasks.length, changes: {}, findings: {}, verdicts: {}, skipped: 0, refreshed: {} };
  const bump = (group, action) => { counts[group][action] = (counts[group][action] ?? 0) + 1; };
  const exists = async (id) => Boolean(await recordsStore.current(urlKey, id));
  const tasks = [];

  for (const row of plan.tasks) {
    const out = { ticket: row.ticket, task: row.task, changes: [], findings: [], verdicts: [], skipped: row.skipped, notes: [] };
    counts.skipped += row.skipped.length;
    const idOfRef = new Map();

    // 1. changes first
    const held = await recordsStore.find(urlKey, { kind: 'change', inRef: row.task });
    for (const c of row.changes) {
      const found = held.find((x) => lib.changeKeyOf(x.fields?.ref) === lib.changeKeyOf(c.ref));
      if (found) { idOfRef.set(c.ref, found.id); out.changes.push({ id: found.id, action: 'exists', state: found.state }); bump('changes', 'exists'); continue; }
      if (!write) { idOfRef.set(c.ref, c.id); out.changes.push({ id: c.id, action: 'would-add' }); bump('changes', 'would-add'); continue; }
      const made = await writes.add({ urlKey, kind: 'change', input: { in: row.task, ref: c.ref }, by: WRITER, via: 'import', fixedId: c.id });
      if (made.problems) { out.changes.push({ id: c.id, action: 'refused', problems: made.problems }); bump('changes', 'refused'); continue; }
      idOfRef.set(c.ref, made.record.id);
      out.changes.push({ id: made.record.id, action: 'added' });
      bump('changes', 'added');
    }

    // 2. findings: conditions, then the ledger's items; then a conditional approval's fallback condition
    const addFinding = async (f) => {
      if (await exists(f.id)) { out.findings.push({ id: f.id, kind: f.kind, action: 'exists' }); bump('findings', 'exists'); return; }
      if (!write) { out.findings.push({ id: f.id, kind: f.kind, action: 'would-add' }); bump('findings', 'would-add'); return; }
      const about = (f.about || []).map((ref) => idOfRef.get(ref)).filter(Boolean);
      const made = await writes.add({ urlKey, kind: 'finding', input: { in: row.task, to: CLOSE_OUT, says: f.says, ...(about.length ? { about } : {}) }, by: WRITER, via: 'import', fixedId: f.id });
      if (made.problems) { out.findings.push({ id: f.id, kind: f.kind, action: 'refused', problems: made.problems }); bump('findings', 'refused'); return; }
      out.findings.push({ id: f.id, kind: f.kind, action: 'added' });
      bump('findings', 'added');
    };
    for (const f of row.findings) await addFinding(f);
    for (const v of row.verdicts) {
      if (!v.conditionFallback) continue;
      if (await exists(v.conditionFallback.id)) { await addFinding(v.conditionFallback); continue; }
      const open = await recordsStore.find(urlKey, { kind: 'finding', state: 'open', to: CLOSE_OUT, inRef: row.task });
      if (open.length) out.notes.push(`${v.id}: its conditions are the task's ${open.length} open finding(s) to close-out`);
      else await addFinding(v.conditionFallback);
    }

    // 3. verdicts, on the version each judge read
    for (const v of row.verdicts) {
      if (await exists(v.id)) { out.verdicts.push({ id: v.id, stage: v.stage, outcome: v.outcome, action: 'exists' }); bump('verdicts', 'exists'); continue; }
      const missing = v.on.filter((o) => o.change && !idOfRef.has(o.change));
      if (missing.length) { out.verdicts.push({ id: v.id, stage: v.stage, action: 'refused', why: 'its change was not written' }); bump('verdicts', 'refused'); continue; }
      const on = v.on.map((o) => o.plan ?? idOfRef.get(o.change));
      const heads = Object.fromEntries(Object.entries(v.heads).map(([ref, sha]) => [idOfRef.get(ref), sha]));
      if (!write) { out.verdicts.push({ id: v.id, stage: v.stage, outcome: v.outcome, on, action: 'would-add' }); bump('verdicts', 'would-add'); continue; }
      const pin = await lib.pinVerdictToHeads({ urlKey, on, heads: Object.keys(heads).length ? heads : undefined, writes, recordsStore });
      if (pin.problems) { out.verdicts.push({ id: v.id, stage: v.stage, action: 'refused', problems: pin.problems }); bump('verdicts', 'refused'); continue; }
      const made = await writes.add({ urlKey, kind: 'verdict', input: { judgement: v.judgement, outcome: v.outcome, reasoning: v.reasoning, on: pin.on, in: row.task }, by: WRITER, via: 'import', fixedId: v.id });
      if (made.problems) { out.verdicts.push({ id: v.id, stage: v.stage, action: 'refused', problems: made.problems }); bump('verdicts', 'refused'); continue; }
      out.verdicts.push({ id: v.id, stage: v.stage, outcome: v.outcome, on: pin.on, action: 'added' });
      bump('verdicts', 'added');
    }

    // 4. the one refresh, as the verdict route runs it after a pin
    if (write && row.changes.length) {
      out.refreshed = (await lib.refreshTaskChanges({ urlKey, taskId: row.task, writes, recordsStore, readPrStatus }))
        .map((a) => ({ id: a.id, ...(a.merged ? { ended: 'merged' } : a.abandoned ? { ended: 'abandoned' } : a.unreadable ? { unreadable: true } : {}) }));
      for (const a of out.refreshed) bump('refreshed', a.ended ?? (a.unreadable ? 'unreadable' : 'open'));
    }
    tasks.push(out);
  }
  return { mode: write ? 'apply' : 'dry-run', counts, tasks };
}

// ---------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------

async function storeFor(guard, argv, recordsCollection) {
  if (guard.store) {
    const { MangoClient } = await import('@jkershaw/mangodb');
    const client = new MangoClient(guard.store);
    await client.connect();
    return { client, db: client.db(argOf(argv, '--db') || DB_NAME), urlKey: argOf(argv, '--url-key') };
  }
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const anchorId = argOf(argv, '--anchor') || DEFAULT_ANCHOR;
  const anchor = await db.collection(recordsCollection).findOne({ id: anchorId }, { projection: { urlKey: 1 } });
  if (!anchor) throw new Error('anchor record not found');
  return { client, db, urlKey: anchor.urlKey };
}

async function main(argv) {
  const [step] = argv;
  if (step === 'capture') {
    const dump = JSON.parse(readFileSync(argOf(argv, '--dump'), 'utf8'));
    const readers = await loadReaders();
    const lib = await loadLib();
    const base = process.env.HARBOUR_LOCAL_BASE ? `${process.env.HARBOUR_LOCAL_BASE}/api/proxy` : null;
    if (!base) throw new Error('HARBOUR_LOCAL_BASE is not set');
    const readingFile = argOf(argv, '--reading');
    let selection;
    let tickets;
    if (readingFile) {
      selection = selectionOf(JSON.parse(readFileSync(readingFile, 'utf8')));
      const wanted = new Set(selection.map((s) => s.ticket));
      tickets = await readers.readTickets({ base, dump: { ...dump, tasks: dump.tasks.filter((t) => wanted.has(t.ref)) } });
    } else {
      tickets = await readers.readTickets({ base, dump });
      selection = selectionOf(readers.cutoverReading({ dump, tickets, readers }));
    }
    const resolveHead = ghHeadResolver();
    const tasks = [];
    for (const selected of selection) {
      const facts = factsOf({ selected, comments: tickets.get(selected.ticket)?.comments ?? [], plans: (dump.plans || []).filter((p) => p.in === selected.task), readers });
      tasks.push(await resolveHeads(facts, { resolveHead, prRefOf: lib.prRefOf }));
    }
    writeFileSync(argOf(argv, '--out'), JSON.stringify({ asOf: dump.asOf, tasks }, null, 2));
    console.log(JSON.stringify({ captured: tasks.length, stages: tasks.reduce((n, t) => n + t.stages.length, 0), ledgers: tasks.filter((t) => t.ledger).length }));
    return;
  }
  if (step === 'plan') {
    const capture = JSON.parse(readFileSync(argOf(argv, '--capture'), 'utf8'));
    const planned = writesPlanOf(capture, await loadLib());
    writeFileSync(argOf(argv, '--out'), JSON.stringify(planned, null, 2));
    console.log(JSON.stringify({ tasks: planned.tasks.length, verdicts: planned.tasks.reduce((n, t) => n + t.verdicts.length, 0), skipped: planned.tasks.reduce((n, t) => n + t.skipped.length, 0) }));
    return;
  }
  if (step === 'apply') {
    const guard = applyGuard({ argv, env: process.env });
    if (guard.refused) { console.error(`refused: ${guard.refused}`); process.exitCode = 2; return; }
    const planned = JSON.parse(readFileSync(0, 'utf8'));
    const root = argOf(argv, '--root') || REPO_ROOT;
    const lib = await loadLib(root);
    const { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } = await import(pathToFileURL(resolve(root, 'lib/records-store.js')).href);
    const { client, db, urlKey } = await storeFor(guard, argv, RECORDS_COLLECTION);
    try {
      const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
      const writes = writesFor(lib, recordsStore);
      const readPrStatus = argv.includes('--offline') ? async () => ({ readable: false }) : lib.createChangePrReaders({ resolveAccess: null })(urlKey);
      console.log(JSON.stringify(await applyImport({ plan: planned, lib, writes, recordsStore, urlKey, readPrStatus, write: guard.write }), null, 2));
    } finally {
      await client.close();
    }
    return;
  }
  console.error('usage: slice-3-verdict-import.mjs capture|plan|apply (see the header)');
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
