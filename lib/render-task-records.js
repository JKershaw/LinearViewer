/**
 * LIN-4494 (piece 3): the Records section of a task page, and the records a Home row and the project page draw.
 * Pure: it takes record views (lib/records/views.js, as the store returns them) and returns markup. The route decides
 * who may see records (never a guest: lib/render-task-page.js refuses them for `viewer: 'guest'`) and whether the
 * viewer may act (`canAct`: a signed-in owner or member).
 *
 * A record's line says what it is: its kind, its state (open, or the end it took), a brief preview (its first line of
 * the words it carries), who it is addressed to and who wrote it. A task with no ticket reads "no ticket yet", so
 * nobody mistakes it for queued work (LIN-4494 acceptance).
 *
 * LIN-4554: the line reads as a person would. A writer or addressee is a name (the workspace's people, injected by the route),
 * a stage by its stage word (`stageLabel`), Harbour as "Harbour", the project as "the project", a task by its ticket, and
 * anything else as "someone": never a raw id. Its time is words in a <time datetime> (lib/components/time.js), the exact time
 * kept in the attribute. States are plain words; a question's end is read through questionOutcomeOf, so a person's dismissal
 * reads "dismissed" whether it was stored `dismissed` (LIN-4550) or, before that, `withdrawn` with reason "dismissed", and an
 * agent's own withdrawal keeps "withdrawn". A reason that only repeats the state is not said again. Record ids stay in attributes
 * and form values, never in the text.
 */
import { escapeHtml } from './utils/html.js';
import { renderSection } from './components/section.js';
import { KINDS, DISMISSED_END } from './records/check.js';
import { questionOutcomeOf } from './records/question-facts.js';
import { taskPageHref } from './task-page-href.js';
import { timeHtml } from './components/time.js';
import { ID_SHAPE, plainWord, whoWordOf, readableWords, peopleNames } from './readable-words.js';

export { whoWordOf, readableWords, peopleNames };

/** The kinds the task page lists, in the order a reader meets them. Runs are the stage track's, not a record list. */
export const LISTED_KINDS = ['finding', 'question', 'decision', 'verdict', 'plan', 'change', 'lesson', 'task'];

/** The kinds a person may add from the task page, and the field their words go in. */
export const ADDABLE = { finding: 'says', question: 'asks' };

/**
 * The kinds a person may supersede from the task page: the ones whose ends include `superseded` (lib/records/kinds.json),
 * and the field the new words go in. A finding or a question ends as done, declined, answered or handed on, never superseded.
 */
export const SUPERSEDABLE = { lesson: 'says', decision: 'answer' };

/**
 * LIN-4554: the ends a person may write from the task page's end form, for one record: its kind's ends (lib/records/kinds.json),
 * less those another surface owns. The form offers exactly these and the end route (routes/task-records.js) refuses any other
 * end of the kind, so the two cannot drift.
 *   - `dismissed` never: a person dismisses a question with its card's Dismiss, which tells the run that asked (LIN-4550).
 *   - `withdrawn` never on a question: it is the word for the asking agent taking its own question back, so a person's end
 *     stored that way would read as the agent's (the dismissed-vs-withdrawn ask of LIN-4546).
 *   - `answered` not on a question asked of a person: their card answers it, writing the decision and resuming the run
 *     (lib/question-answers.js); this form would skip both. A question to the project or a stage has no card, so it keeps it.
 * @param {{kind: string, to?: string|null}} record
 * @returns {string[]}
 */
export function pageEndsOf(record) {
  const ends = KINDS.kinds[record?.kind]?.ends || [];
  return ends.filter((end) => {
    if (end === DISMISSED_END) return false;
    if (record.kind !== 'question') return true;
    if (end === 'withdrawn') return false;
    if (end === 'answered' && typeof record.to === 'string' && record.to.startsWith('person:')) return false;
    return true;
  });
}

/** Why the end route refuses an end of the kind that the page does not offer (pageEndsOf): where that end is written instead. */
export function pageEndRefusal(state) {
  // Exactly the ends pageEndsOf filters out: dismissed, a question's withdrawn, and a question asked of a person answered.
  if (state === DISMISSED_END) return "Dismiss a question with its card's Dismiss, which tells the run that asked";
  if (state === 'withdrawn') return 'Only the run that asked takes its question back; hand it on, or dismiss it with its card';
  return 'Answer a question asked of a person with their card, which records the answer and resumes the run that asked';
}

const PREVIEW_FIELDS = ['says', 'asks', 'done-when', 'asked', 'answer', 'reasoning', 'how', 'judgement', 'ref'];

/** The first line of a record's words, capped: the brief preview. */
export function previewOf(view) {
  const field = PREVIEW_FIELDS.map((f) => view.fields?.[f]).find((x) => typeof x === 'string' && x.length);
  const first = String(field ?? '').split('\n')[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

const kindLabel = (kind) => kind.replace(/-/g, ' ');

/** A stored word (a state, an end, a kind) in plain words: `handed-on` reads "handed on". */

/**
 * The end a record took, as the word a person reads. A question's end is read through questionOutcomeOf (as lib/question-answers.js
 * endedOf does for the card): a person's dismissal is "dismissed" however it was stored; any other end is its own word.
 */
export function stateWordOf(view) {
  if (view.kind === 'question' && view.ended) {
    const outcome = questionOutcomeOf({ state: view.state, reason: view.ended.reason ?? null, by: view.by ?? null });
    if (outcome === 'dismissed') return plainWord(DISMISSED_END);
  }
  return plainWord(view.state);
}

/** The state, then the end's reason unless it only repeats the state (a dismissal's reason is "dismissed", finding-515bc015). */
function stateWords(view) {
  const word = stateWordOf(view);
  const reason = typeof view.ended?.reason === 'string' ? view.ended.reason.trim() : '';
  const repeats = !reason || [word, view.state, plainWord(view.state)].some((w) => w.toLowerCase() === reason.toLowerCase());
  return repeats ? word : `${word} — ${reason}`;
}

// LIN-4555: a record id's shape and the words a person reads in place of an id (whoWordOf, readableWords, peopleNames) live in
// lib/readable-words.js, the one reader of them for this page and for lib/open-questions.js (every surface's question and note
// rows). RECORD_REF is this page's own: a stale flag's reason names the record it rests on, with its version.
const RECORD_REF = new RegExp(`\\b${ID_SHAPE}(?:@\\d+)?\\b`);

/** A view's flags, as plain lines ({text, warn}): what it answers with, what it rests on, whether its task has ended. No record id. */
function flagWordsOf(flags) {
  const out = [];
  for (const reason of flags.stale || []) {
    const ref = String(reason).match(RECORD_REF);
    const ended = String(reason).match(/target ([a-z-]+)/);
    const what = ref ? `the ${plainWord(ref[1])} it rests on` : 'what it rests on';
    out.push({ text: ended ? `stale: ${what} was ${plainWord(ended[1])}` : `stale: ${what} has changed`, warn: true });
  }
  if (flags.answered) {
    const said = [flags.answered.answer, flags.answered.words].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    // An answer is news, not a warning: it reads quiet (task-page.css), where stale and an ended task read amber.
    out.push({ text: said.length ? `answered: ${said.join(' — ')}` : 'answered', warn: false });
  }
  if (flags['under-ended-task']) out.push({ text: 'its task has ended', warn: true });
  return out;
}

/**
 * A task record's ticket, as words: a link to the ticket's task page, or "no ticket yet" when the record has none, so
 * nobody mistakes it for queued work. Empty for any other kind. One place for the task page and the project backlog.
 * @param {object} view
 * @param {{urlKey: string, testid: string}} where - `testid` marks the "no ticket yet" span
 */
export function ticketWordsOf(view, { urlKey, testid }) {
  if (view.kind !== 'task') return '';
  const ticket = view.fields?.ref;
  return ticket
    ? `<a class="task-record-ticket" href="${escapeHtml(taskPageHref({ urlKey, identifier: ticket }))}">${escapeHtml(ticket)}</a>`
    : `<span class="task-record-noticket" data-testid="${escapeHtml(testid)}">no ticket yet</span>`;
}

/** One record line. `actions` is the forms a person may use on an open record (empty for a guest or an ended one). */
function renderRecordLine(view, { urlKey, identifier, canAct, who, now, others, words }) {
  const flagWords = flagWordsOf(view.flags || {});
  const preview = words(previewOf(view));
  const ticketWords = ticketWordsOf(view, { urlKey, testid: 'task-record-no-ticket' });
  const to = view.to ? `to <span data-testid="task-record-to">${escapeHtml(who(view.to))}</span> · ` : '';
  const when = timeHtml(view.at, { now, testid: 'task-record-time' });
  // A record that has not ended is still in its kind's start state (open, stands, holds, kept: lib/records/kinds.json).
  const actions = canAct && !view.ended ? renderEndForms(view, { urlKey, identifier, who, others }) : '';
  return `<li class="task-record" data-testid="task-record" data-record-id="${escapeHtml(view.id)}" data-kind="${escapeHtml(view.kind)}" data-state="${escapeHtml(view.state)}">
      <div class="task-record-head"><span class="task-record-state" data-testid="task-record-state">${escapeHtml(stateWords(view))}</span>${ticketWords ? ` ${ticketWords}` : ''}</div>
      ${preview ? `<div class="task-record-preview">${escapeHtml(preview)}</div>` : ''}
      <div class="task-record-meta">${to}by <span data-testid="task-record-by">${escapeHtml(who(view.by))}</span>${when ? ` · ${when}` : ''}</div>
      ${flagWords.map((f) => `<div class="task-record-flag${f.warn ? '' : ' task-record-flag--note'}">${escapeHtml(f.text)}</div>`).join('')}
      ${actions}
    </li>`;
}

/** A select's options, `[value, label]` pairs, the first selected unless `selected` names another value. */
const optionsHtml = (pairs, selected = null) => pairs
  .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`)
  .join('');

/** A record as a person picks it from a list: its kind and the first words it carries, never its id. */
function recordChoiceLabel(view, readable = (x) => x) {
  const words = readable(previewOf(view));
  const short = words.length > 70 ? `${words.slice(0, 69)}…` : words;
  return `${kindLabel(view.kind)}: ${short || 'no words'}`;
}

/**
 * The end and supersede forms for one open record, in its own closed fold: a person ends it with one of the ends the page offers
 * (pageEndsOf), or supersedes it with new words. A person picks what takes over and who it is addressed to by name; the ids the
 * pipeline needs ride only in option values (LIN-4554).
 * @param {object} view
 * @param {{urlKey: string, identifier: string, who: (actor: string) => string, others: {records: object[], addressees: string[]}}} ctx
 */
function renderEndForms(view, { urlKey, identifier, who, others }) {
  const base = `/workspace/${encodeURIComponent(urlKey)}`;
  const ends = pageEndsOf(view);
  const back = `<input type="hidden" name="identifier" value="${escapeHtml(identifier)}">`;
  const takeovers = [['', 'nothing'], ...others.records.filter((v) => v.id !== view.id).map((v) => [v.id, recordChoiceLabel(v, others.words)])];
  const endForm = ends.length
    ? `<form class="task-record-form" method="post" action="${base}/records/${encodeURIComponent(view.id)}/end" data-testid="task-record-end-form">
        ${back}
        <label>end as <select name="state" data-testid="task-record-end-state">${optionsHtml(ends.map((e) => [e, plainWord(e)]))}</select></label>
        <label>why <input name="reason" required maxlength="500" data-testid="task-record-end-reason"></label>
        <label>taken over by <select name="into" data-testid="task-record-end-into">${optionsHtml(takeovers)}</select></label>
        <button type="submit" class="btn" data-testid="task-record-end-submit">End</button>
      </form>`
    : '';
  const field = SUPERSEDABLE[view.kind];
  const addressees = [...new Set([...(view.to ? [view.to] : []), ...others.addressees])];
  const supersede = field
    ? `<form class="task-record-form" method="post" action="${base}/records/${encodeURIComponent(view.id)}/supersede" data-testid="task-record-supersede-form">
        ${back}
        <label>replace with <input name="${field}" required maxlength="2000"></label>
        <label>to <select name="to">${optionsHtml(addressees.map((a) => [a, who(a)]), view.to || null)}</select></label>
        <button type="submit" class="btn">Replace</button>
      </form>`
    : '';
  if (!endForm && !supersede) return '';
  const summary = supersede ? 'End or replace' : 'End';
  return `<details class="task-record-tools" data-testid="task-record-tools"><summary>${summary}</summary><div class="task-record-actions">${endForm}${supersede}</div></details>`;
}

/** The new-record forms for a task, in one closed fold after the list: a finding or a question, and a child task. */
function renderAddForms({ urlKey, identifier }) {
  const base = `${taskPageHref({ urlKey, identifier })}/records`;
  return `<details class="task-records-tools" data-testid="task-records-tools"><summary>Add a record</summary>
      <form class="task-record-form" method="post" action="${base}" data-testid="task-record-add-form">
        <label>kind <select name="kind"><option value="finding">finding</option><option value="question">question</option></select></label>
        <label>words <input name="text" required maxlength="2000"></label>
        <label>to <input name="to" required maxlength="200" placeholder="the project, a stage, or a person's name"></label>
        <button type="submit" class="btn">Add record</button>
      </form>
      <form class="task-record-form" method="post" action="${base}/child" data-testid="task-record-child-form">
        <label>child task, done when <input name="done-when" required maxlength="2000"></label>
        <button type="submit" class="btn">Add child task</button>
      </form>
    </details>`;
}

/**
 * The task page's Records section. Empty when the task has no record yet (the page never makes one: a task record is
 * made by the ticket's first write, not by a page read).
 * @param {object} opts
 * @param {Array<object>} opts.views - record views in this task (`in` = the task), any kind
 * @param {string} opts.identifier - the ticket the page is for (the page's URL)
 * @param {string} opts.urlKey
 * @param {boolean} opts.canAct - a signed-in owner or member
 * @param {string|null} [opts.refused] - a refusal from the last write, shown above the list
 * @param {Iterable<string>} [opts.shownAsCards] - LIN-4554: the ids of the open questions the page draws as cards above
 *   (lib/render-task-page.js passes the rows its question section draws), left out here so a question shows once. A viewer who
 *   gets no card (a member) passes none, so the question is listed here, the one place it shows.
 * @param {Array<{accountId: string, name: string}>} [opts.people] - LIN-4554: the workspace's people (lib/workspace-people.js), read
 *   by the route and injected, so a person reads as their name; none given, a person reads "someone"
 * @param {Date} [opts.now] - the moment the time words are measured from
 */
export function renderTaskRecordsSection({ views = [], identifier, urlKey, canAct, refused = null, shownAsCards = [], people = [], now = new Date() }) {
  const cards = new Set(shownAsCards);
  const names = peopleNames(people);
  // The task records this page holds (its children), by id, to their ticket: a record addressed to one names it by its ticket.
  const tickets = new Map(views.filter((v) => v.kind === 'task').map((v) => [v.id, typeof v.fields?.ref === 'string' && v.fields.ref ? v.fields.ref : null]));
  const who = (actor) => whoWordOf(actor, { people: names, tickets });
  const words = (text) => readableWords(text, { people: names, tickets, now });
  // What an end or supersede form offers to pick by name: the task's records (what takes over) and who a record may be addressed to.
  const others = { records: views.filter((v) => LISTED_KINDS.includes(v.kind)), addressees: ['project', ...[...names.keys()].map((id) => `person:${id}`)], words };
  const listed = views.filter((v) => LISTED_KINDS.includes(v.kind) && !(v.kind === 'question' && !v.ended && cards.has(v.id)));
  const groups = LISTED_KINDS.map((kind) => {
    const items = listed.filter((v) => v.kind === kind);
    if (!items.length) return '';
    const open = items.filter((v) => !v.ended).length;
    return `<div class="task-records-kind" data-kind="${escapeHtml(kind)}">
      <h3 class="task-records-kind-title">${escapeHtml(kindLabel(kind))}s · ${open} open</h3>
      <ul class="task-records-list">${items.map((v) => renderRecordLine(v, { urlKey, identifier, canAct, who, now, others, words })).join('')}</ul>
    </div>`;
  }).filter(Boolean).join('');
  const refusedHtml = refused ? `<p class="task-records-refused" role="alert" data-testid="task-records-refused">${escapeHtml(refused)}</p>` : '';
  const empty = `<p class="task-records-none" data-testid="task-records-none">○ no records on this task yet</p>`;
  const body = `${refusedHtml}${groups || empty}${canAct ? renderAddForms({ urlKey, identifier }) : ''}`;
  return renderSection({ className: 'sess-section task-records', title: 'Records', body: `<div class="task-records-mount" data-testid="task-records">${body}</div>` });
}
