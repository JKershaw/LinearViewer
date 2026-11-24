/**
 * LIN-4532 (LIN-4529 plan D2, P2b): the open question records one person is asked, read as every surface shows them.
 *
 * One reader for every surface: the rulings feed (routes/dashboard-rulings.js), Home's Waiting on you and its count
 * (lib/home-row-states.js), the run page's pinned cards (openQuestionsForRun), the task page's cards (openQuestionsForTask) and
 * the chat tool `list_pending_decisions` (lib/chat-tools.js), so the pages, the count and the badge cannot disagree. A question is open for the person when it is current, its state is
 * `open`, and its `to` is `person:<accountId>` (the canonical account, the same id the answer route files its decision under).
 *
 * Each row's `interactive` is read the way the answer route reads the asking run (lib/question-answers.js runStateOf): a run still
 * working (`mid-turn`, `indeterminate`) is read-only; anything else can be answered or dismissed, and the answer says what happened
 * (resumed, not resumed because the run was stopped, or no session left).
 */
import { runStateOf, NOT_ANSWERABLE } from './question-answers.js';
import { questionShortOf, firstSentenceOf } from './records/question-short.js';

/**
 * @param {object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {object} deps.dispatchStore - needs isRunStopped, runTailOf (lib/question-answers.js runStateOf)
 * @param {string} deps.urlKey - the workspace the questions are in
 * @param {string|null} deps.accountId - the canonical account of the person; null reads nothing
 * @param {() => Date} [deps.now]
 * @param {(tickets: string[]) => (Object<string, string>|Promise<Object<string, string>>)} [deps.titlesOf] - LIN-4549: the task
 *   titles, by ticket, from the caller's own tracker read (this area takes outside reads injected, docs/areas/records.md). Absent,
 *   empty or failing, a row's `title` is null and the card shows the identifier alone.
 * @returns {Promise<Array<{questionId: string, short: string, asks: string, options: string[], recommended: string|null, ifUnanswered: string|null,
 *   taskId: string|null, ticket: string|null, title: string|null, runId: string|null, askedAt: string|null, state: string,
 *   reason: string|null, interactive: boolean}>>}
 */
export async function openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now = () => new Date(), titlesOf = null }) {
  if (!accountId) return [];
  const questions = await recordsStore.find(urlKey, { kind: 'question', state: 'open', to: `person:${accountId}` });
  const rows = [];
  for (const question of questions) {
    // One read of the versions: the asking run (what askingRunOf reads) and askedAt both come from the question's v1 snapshot.
    const first = (await recordsStore.versionsOf(urlKey, [question.id])).find((snap) => snap.id === question.id && snap.v === 1);
    const runId = first?.run || null;
    const state = await runStateOf({ dispatchStore, urlKey, runId, now });
    const fields = question.fields || {};
    rows.push({
      questionId: question.id,
      // LIN-4550: the one-line question, the written `short` or, for a question asked before it existed, the lead derived from
      // `asks` (lib/records/question-short.js), so every surface and feed reading these rows has it and no browser derives it.
      short: questionShortOf(fields),
      asks: typeof fields.asks === 'string' ? fields.asks : '',
      options: Array.isArray(fields.options) ? fields.options.filter((o) => typeof o === 'string') : [],
      recommended: typeof fields.recommended === 'string' && fields.recommended ? fields.recommended : null,
      ifUnanswered: typeof fields['if-unanswered'] === 'string' && fields['if-unanswered'].trim() ? fields['if-unanswered'].trim() : null,
      // `in` names the task RECORD (lib/records/check.js resolves a ticket to its task id); `ticket` is its identifier, what a page is keyed by.
      taskId: question.in ?? null,
      ticket: question.in ? await recordsStore.ticketOfTask(urlKey, question.in) : null,
      runId,
      askedAt: first?.at ?? null,
      state: state.kind,
      reason: state.reason ?? null,
      interactive: state.kind !== NOT_ANSWERABLE,
    });
  }
  const titles = await titlesFor(titlesOf, [...new Set(rows.map((r) => r.ticket).filter(Boolean))]);
  for (const r of rows) r.title = r.ticket && typeof titles[r.ticket] === 'string' && titles[r.ticket].trim() ? titles[r.ticket] : null;
  return rows.sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
}

/**
 * LIN-4552 (LIN-4546 piece 4): the open FINDINGS addressed to one person, read as Home's "Notes for you" shows them. Beside the
 * questions, never in their number: a note is not counted by the count line or the badge (finding-68be8578).
 *
 * Read in a fixed number of store reads whatever the count (Home's live fragment reads it every tick): `find` (the candidates and
 * their versions), then one claims read for every task's ticket (`ticketsOfTasks`), then the injected titles, which make no store
 * read. A finding's `in` is its task RECORD id; the row carries the ticket it claims, never the record id, so no surface prints a
 * raw `task-…` id. A task with no claimed ticket gives `ticket: null` and the line reads without a link.
 *
 * @param {object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {string} deps.urlKey
 * @param {string|null} deps.accountId - the canonical account of the person; null reads nothing
 * @param {Function} [deps.titlesOf] - as openQuestionsFor
 * @returns {Promise<Array<{recordId: string, says: string, lead: string, ticket: string|null, title: string|null, at: string|null}>>}
 *   newest first: the notes most likely to matter lead the fold
 */
export async function openFindingsFor({ recordsStore, urlKey, accountId, titlesOf = null }) {
  if (!accountId) return [];
  const findings = await recordsStore.find(urlKey, { kind: 'finding', state: 'open', to: `person:${accountId}` });
  if (!findings.length) return [];
  const tickets = await recordsStore.ticketsOfTasks(urlKey, findings.map((f) => f.in).filter(Boolean));
  const rows = findings.map((finding) => {
    const says = typeof finding.fields?.says === 'string' ? finding.fields.says.trim() : '';
    return {
      recordId: finding.id,
      says,
      lead: firstSentenceOf(says),
      ticket: (finding.in && tickets.get(finding.in)) || null,
      title: null,
      at: finding.at ?? null,
    };
  });
  const titles = await titlesFor(titlesOf, [...new Set(rows.map((r) => r.ticket).filter(Boolean))]);
  for (const r of rows) r.title = r.ticket && typeof titles[r.ticket] === 'string' && titles[r.ticket].trim() ? titles[r.ticket].trim() : null;
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** The titles the injected lookup gives for `tickets`; a missing or failing lookup gives none, so the questions still show. */
async function titlesFor(titlesOf, tickets) {
  if (typeof titlesOf !== 'function' || tickets.length === 0) return {};
  try {
    const got = await titlesOf(tickets);
    return got && typeof got === 'object' ? got : {};
  } catch {
    return {};
  }
}

/**
 * LIN-4549: a title lookup over issues the caller already holds ({identifier, title}), first match wins: the shape every caller
 * with an issue list passes as `titlesOf`.
 * @param {Array<{identifier?: string, title?: string}>|null|undefined} issues
 * @returns {(tickets: string[]) => Object<string, string>}
 */
export function titlesFromIssues(issues) {
  return (tickets) => {
    const wanted = new Set(tickets);
    const out = {};
    for (const issue of issues || []) {
      const id = issue?.identifier;
      if (id && wanted.has(id) && !(id in out) && typeof issue.title === 'string') out[id] = issue.title;
    }
    return out;
  };
}

/**
 * LIN-4532 (P2b): the open questions the person was asked by ONE run (its session id: the run id a question records as `run`),
 * for the run page's pinned cards. The same reader as the rulings feed, filtered to the run.
 * @returns {Promise<Array<Object>>} openQuestionsFor's rows whose asking run is `runId`
 */
export async function openQuestionsForRun({ recordsStore, dispatchStore, urlKey, accountId, runId, now = () => new Date(), titlesOf = null }) {
  if (!runId) return [];
  const rows = await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now, titlesOf });
  return rows.filter((row) => row.runId === runId);
}

/**
 * LIN-4532 (P2b): the open questions on one task, by its ticket identifier (`LIN-n`, what the task page is keyed by), for the task page.
 * @returns {Promise<Array<Object>>} openQuestionsFor's rows whose task's ticket is `ticket`
 */
export async function openQuestionsForTask({ recordsStore, dispatchStore, urlKey, accountId, ticket, now = () => new Date(), titlesOf = null }) {
  if (!ticket) return [];
  const rows = await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now, titlesOf });
  return rows.filter((row) => row.ticket === ticket);
}
