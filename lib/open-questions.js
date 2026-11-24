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
import { readableWords, peopleNames, quotesPerson, quotedTaskIds } from './readable-words.js';

/**
 * @param {object} deps
 * @param {import('./records-store.js').RecordsStore} deps.recordsStore
 * @param {object} deps.dispatchStore - needs isRunStopped, runTailOf (lib/question-answers.js runStateOf)
 * @param {string} deps.urlKey - the workspace the questions are in
 * @param {string|null} deps.accountId - the canonical account of the person; null reads nothing
 * @param {() => Date} [deps.now]
 * @param {(tickets: string[]) => (Object<string, string>|Promise<Object<string, string>>)} [deps.titlesOf] - LIN-4549: the task
 *   titles, by ticket, from what the caller already holds (this area takes outside reads injected, docs/areas/records.md).
 * @param {(tickets: string[]) => Promise<Object<string, string>>} [deps.lookupTitles] - LIN-4553: the titles for the tickets still
 *   untitled after `titlesOf` and the asking runs' own rows, from a bounded tracker read the caller injects
 *   (lib/question-task-titles.js). Asked only for those tickets, and only when there are some. Absent, empty or failing, a row
 *   with no title from any source has `title` null and the card shows the identifier alone.
 * @param {(urlKey: string) => Promise<Array<{accountId: string, name: string}>>} [deps.listPeople] - LIN-4555: the workspace's people
 *   (lib/workspace-people.js), read only when the words quote a person id, so a quoted person reads by name. Absent or failing,
 *   the person reads "someone": never the raw id.
 * @returns {Promise<Array<{questionId: string, short: string, asks: string, options: string[], optionWords: string[], recommended: string|null, ifUnanswered: string|null,
 *   taskId: string|null, ticket: string|null, title: string|null, runId: string|null, askedAt: string|null, state: string,
 *   reason: string|null, interactive: boolean}>>}
 */
export async function openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now = () => new Date(), titlesOf = null, lookupTitles = null, listPeople = null }) {
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
  // LIN-4553: a title from each source in turn, the cheap ones first: what the caller holds, then the asking run's own row (a local
  // read by id, whose task title its dispatch stored), then the caller's bounded tracker lookup for whatever is still untitled.
  // A title that only repeats the identifier is none, as the card reads it (lib/question-record-card.js questionTaskLine), so the
  // next source is still asked (a run dispatched with its identifier as its title, LIN-4553).
  const held = await titlesFor(titlesOf, [...new Set(rows.map((r) => r.ticket).filter(Boolean))]);
  for (const r of rows) r.title = r.ticket ? titleOf(held, r.ticket) : null;
  for (const r of rows) if (r.ticket && !r.title) r.title = await runRowTitle(dispatchStore, urlKey, r);
  const untitled = [...new Set(rows.filter((r) => r.ticket && !r.title).map((r) => r.ticket))];
  if (untitled.length) {
    const looked = await titlesFor(lookupTitles, untitled);
    for (const r of rows) if (r.ticket && !r.title) r.title = titleOf(looked, r.ticket);
  }
  // LIN-4555 (finding-150d1329): the asker's words as a person reads them, here, so every surface agrees.
  const known = new Map(rows.filter((r) => r.taskId && r.ticket).map((r) => [r.taskId, r.ticket]));
  const read = await wordsReader({ recordsStore, urlKey, listPeople, now, known, texts: rows.flatMap((r) => [r.short, r.asks, r.ifUnanswered, ...r.options]) });
  for (const r of rows) {
    r.short = read(r.short);
    r.asks = read(r.asks);
    if (r.ifUnanswered) r.ifUnanswered = read(r.ifUnanswered);
    // An option is the answer value the card sends back, so `options` stays as written; `optionWords` (one per option, in order)
    // is what the card shows on each option (lib/question-record-card.js), so an id an option quotes is not shown raw either.
    r.optionWords = r.options.map(read);
  }
  return rows.sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
}

/**
 * LIN-4555 (LIN-4546 piece 7, finding-150d1329): the one reading of an agent's words for every surface that shows an open question
 * or a note (lib/readable-words.js readableWords): a quoted task id reads as its ticket ("a task" when no ticket claims it), a person
 * id as their name ("someone" when the workspace cannot name them), an ISO stamp as relative words. LIN-4554 read the words on the
 * task page alone (routes/task-page.js), so Home, the Questions tab, the run page and Flight Companion printed the ids raw; reading
 * them in the reader is what makes every surface agree. The record keeps its words as written.
 *
 * At most two reads, each only when the words need it: the tickets of the task ids the words quote and `known` lacks (one claims
 * read, `ticketsOfTasks`), and the workspace's people when the words quote a person. A failed read leaves the words reading
 * "a task" / "someone", never the raw id.
 * @returns {Promise<(text: string|null) => string|null>}
 */
async function wordsReader({ recordsStore, urlKey, listPeople, now, known = new Map(), texts }) {
  const said = texts.filter((t) => typeof t === 'string' && t);
  const quoted = [...new Set(said.flatMap(quotedTaskIds))].filter((id) => !known.has(id));
  const tickets = new Map(known);
  if (quoted.length && typeof recordsStore?.ticketsOfTasks === 'function') {
    const got = await recordsStore.ticketsOfTasks(urlKey, quoted).catch(() => new Map());
    for (const [taskId, ticket] of got) tickets.set(taskId, ticket);
  }
  let people = new Map();
  if (said.some(quotesPerson) && typeof listPeople === 'function') {
    people = peopleNames(await Promise.resolve().then(() => listPeople(urlKey)).catch(() => []));
  }
  const at = typeof now === 'function' ? now() : new Date();
  return (text) => (typeof text === 'string' ? readableWords(text, { people, tickets, now: at }) : text);
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
 * @param {Function} [deps.lookupTitles] - LIN-4555: as openQuestionsFor, for the notes' tickets still untitled after `titlesOf`
 *   (the bounded tracker lookup, lib/question-task-titles.js: capped per call and cached, so a 5 s tick repeats no tracker read)
 * @param {Function} [deps.listPeople] - LIN-4555: as openQuestionsFor
 * @param {() => Date} [deps.now]
 * @returns {Promise<Array<{recordId: string, says: string, lead: string, ticket: string|null, title: string|null, at: string|null}>>}
 *   newest first: the notes most likely to matter lead the fold
 */
export async function openFindingsFor({ recordsStore, urlKey, accountId, titlesOf = null, lookupTitles = null, listPeople = null, now = () => new Date() }) {
  if (!accountId) return [];
  const findings = await recordsStore.find(urlKey, { kind: 'finding', state: 'open', to: `person:${accountId}` });
  if (!findings.length) return [];
  const saysOf = (finding) => (typeof finding.fields?.says === 'string' ? finding.fields.says.trim() : '');
  // One claims read for every task's ticket: the notes' own tasks and (LIN-4555) the task ids their words quote, together.
  const tickets = await recordsStore.ticketsOfTasks(urlKey, [...findings.map((f) => f.in), ...findings.flatMap((f) => quotedTaskIds(saysOf(f)))].filter(Boolean));
  const read = await wordsReader({ recordsStore: null, urlKey, listPeople, now, known: tickets, texts: findings.map(saysOf) });
  const rows = findings.map((finding) => {
    const says = read(saysOf(finding));
    return {
      recordId: finding.id,
      says,
      lead: firstSentenceOf(says),
      ticket: (finding.in && tickets.get(finding.in)) || null,
      title: null,
      at: finding.at ?? null,
    };
  });
  // The same title chain as the questions' (titleOf: a title that only repeats the identifier is none), less the asking run.
  const held = await titlesFor(titlesOf, [...new Set(rows.map((r) => r.ticket).filter(Boolean))]);
  for (const r of rows) r.title = r.ticket ? titleOf(held, r.ticket) : null;
  const untitled = [...new Set(rows.filter((r) => r.ticket && !r.title).map((r) => r.ticket))];
  if (untitled.length) {
    const looked = await titlesFor(lookupTitles, untitled);
    for (const r of rows) if (r.ticket && !r.title) r.title = titleOf(looked, r.ticket);
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * LIN-4553: the title a source gives for a ticket, or null. A title that only repeats the identifier is none, as the card reads it
 * (lib/question-record-card.js questionTaskLine), so the next source is still asked. The one place this rule is held in this file.
 */
function titleOf(titles, ticket) {
  const t = typeof titles?.[ticket] === 'string' ? titles[ticket].trim() : '';
  return t && t !== ticket ? t : null;
}

/**
 * LIN-4553: the title the asking run's own dispatch row stored for this question's task, or null: no run, a store without the row
 * read, a row about another task, a row with no title, or a failed read (the reader's one dispatch-row read, rowForRunRecords).
 */
async function runRowTitle(dispatchStore, urlKey, row) {
  if (!row.runId || typeof dispatchStore?.rowForRunRecords !== 'function') return null;
  try {
    const doc = await dispatchStore.rowForRunRecords(urlKey, row.runId);
    if (!doc || doc.issueIdentifier !== row.ticket) return null;
    return titleOf({ [row.ticket]: doc.issueTitle }, row.ticket);
  } catch {
    return null;
  }
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
export async function openQuestionsForRun({ recordsStore, dispatchStore, urlKey, accountId, runId, now = () => new Date(), titlesOf = null, lookupTitles = null, listPeople = null }) {
  if (!runId) return [];
  const rows = await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now, titlesOf, lookupTitles, listPeople });
  return rows.filter((row) => row.runId === runId);
}

/**
 * LIN-4532 (P2b): the open questions on one task, by its ticket identifier (`LIN-n`, what the task page is keyed by), for the task page.
 * @returns {Promise<Array<Object>>} openQuestionsFor's rows whose task's ticket is `ticket`
 */
export async function openQuestionsForTask({ recordsStore, dispatchStore, urlKey, accountId, ticket, now = () => new Date(), titlesOf = null, lookupTitles = null, listPeople = null }) {
  if (!ticket) return [];
  const rows = await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId, now, titlesOf, lookupTitles, listPeople });
  return rows.filter((row) => row.ticket === ticket);
}
