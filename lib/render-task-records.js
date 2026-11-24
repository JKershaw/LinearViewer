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
import { stageLabel } from './run-view.js';
import { timeHtml } from './components/time.js';

/** The kinds the task page lists, in the order a reader meets them. Runs are the stage track's, not a record list. */
export const LISTED_KINDS = ['finding', 'question', 'decision', 'verdict', 'plan', 'change', 'lesson', 'task'];

/** The kinds a person may add from the task page, and the field their words go in. */
export const ADDABLE = { finding: 'says', question: 'asks' };

/**
 * The kinds a person may supersede from the task page: the ones whose ends include `superseded` (lib/records/kinds.json),
 * and the field the new words go in. A finding or a question ends as done, declined, answered or handed on, never superseded.
 */
export const SUPERSEDABLE = { lesson: 'says', decision: 'answer' };

const PREVIEW_FIELDS = ['says', 'asks', 'done-when', 'asked', 'answer', 'reasoning', 'how', 'judgement', 'ref'];

/** The first line of a record's words, capped: the brief preview. */
export function previewOf(view) {
  const field = PREVIEW_FIELDS.map((f) => view.fields?.[f]).find((x) => typeof x === 'string' && x.length);
  const first = String(field ?? '').split('\n')[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

const kindLabel = (kind) => kind.replace(/-/g, ' ');

/** A stored word (a state, an end, a kind) in plain words: `handed-on` reads "handed on". */
const plainWord = (word) => String(word || '').replace(/-/g, ' ');

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

const RECORD_ID = /^([a-z][a-z-]*)-[0-9a-f]{6,}$/;
const RECORD_REF = /\b([a-z][a-z-]*)-[0-9a-f]{6,}(?:@\d+)?\b/;

/**
 * Who an actor is, in words (a record's `by` or `to`). `people` is the workspace's (lib/workspace-people.js, injected by the route);
 * `tickets` maps the task records the page knows to their tickets. Never a raw id: what cannot be named is "someone" (a person)
 * or "another task" / "another record".
 * @param {string|null|undefined} actor
 * @param {{people?: Map<string, string>, tickets?: Map<string, string|null>}} ctx
 */
export function whoWordOf(actor, { people = new Map(), tickets = new Map() } = {}) {
  if (typeof actor !== 'string' || !actor) return 'someone';
  if (actor.startsWith('person:')) return people.get(actor.slice('person:'.length)) || 'someone';
  if (actor === 'project') return 'the project';
  const id = actor.match(RECORD_ID);
  if (id) {
    if (id[1] !== 'task') return `another ${plainWord(id[1])}`;
    if (!tickets.has(actor)) return 'another task';
    return tickets.get(actor) || 'a child task';
  }
  // A stage, Harbour or any other writer word: the product's stage word (`stageLabel`: "Build", "Plan review", "Harbour").
  if (/^[a-z][a-z-]*$/.test(actor)) return stageLabel(actor);
  return 'someone';
}

/** A view's flags, as plain lines: what it answers with, what it rests on, whether its task has ended. No record id. */
function flagWordsOf(flags) {
  const out = [];
  for (const reason of flags.stale || []) {
    const ref = String(reason).match(RECORD_REF);
    const ended = String(reason).match(/target ([a-z-]+)/);
    const what = ref ? `the ${plainWord(ref[1])} it rests on` : 'what it rests on';
    out.push(ended ? `stale: ${what} was ${plainWord(ended[1])}` : `stale: ${what} has changed`);
  }
  if (flags.answered) {
    const said = [flags.answered.answer, flags.answered.words].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    out.push(said.length ? `answered: ${said.join(' — ')}` : 'answered');
  }
  if (flags['under-ended-task']) out.push('its task has ended');
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
function renderRecordLine(view, { urlKey, identifier, canAct, who, now }) {
  const flagWords = flagWordsOf(view.flags || {});
  const ticketWords = ticketWordsOf(view, { urlKey, testid: 'task-record-no-ticket' });
  const to = view.to ? `to <span data-testid="task-record-to">${escapeHtml(who(view.to))}</span> · ` : '';
  const when = timeHtml(view.at, { now, testid: 'task-record-time' });
  // A record that has not ended is still in its kind's start state (open, stands, holds, kept: lib/records/kinds.json).
  const actions = canAct && !view.ended ? renderEndForms(view, { urlKey, identifier }) : '';
  return `<li class="task-record" data-testid="task-record" data-record-id="${escapeHtml(view.id)}" data-kind="${escapeHtml(view.kind)}" data-state="${escapeHtml(view.state)}">
      <div class="task-record-head"><span class="task-record-state" data-testid="task-record-state">${escapeHtml(stateWords(view))}</span>${ticketWords ? ` ${ticketWords}` : ''}</div>
      ${previewOf(view) ? `<div class="task-record-preview">${escapeHtml(previewOf(view))}</div>` : ''}
      <div class="task-record-meta">${to}by <span data-testid="task-record-by">${escapeHtml(who(view.by))}</span>${when ? ` · ${when}` : ''}</div>
      ${flagWords.map((w) => `<div class="task-record-flag">${escapeHtml(w)}</div>`).join('')}
      ${actions}
    </li>`;
}

/** The end and supersede forms for one open record: a person ends it, or supersedes it with new words. */
function renderEndForms(view, { urlKey, identifier }) {
  const base = `/workspace/${encodeURIComponent(urlKey)}`;
  const ends = KINDS.kinds[view.kind]?.ends || [];
  // LIN-4550: a question is dismissed through its card's Dismiss (it tells the run that asked), never through this generic form.
  const endOptions = ends.filter((e) => !(view.kind === 'question' && e === DISMISSED_END)).map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
  const back = `<input type="hidden" name="identifier" value="${escapeHtml(identifier)}">`;
  const endForm = `<form class="task-record-form" method="post" action="${base}/records/${encodeURIComponent(view.id)}/end" data-testid="task-record-end-form">
        ${back}
        <label>end as <select name="state">${endOptions}</select></label>
        <label>reason <input name="reason" required maxlength="500"></label>
        <label>taken over by <input name="into" maxlength="80" placeholder="a record id, when handed on or superseded"></label>
        <button type="submit">End</button>
      </form>`;
  const addable = SUPERSEDABLE[view.kind];
  const supersede = addable
    ? `<form class="task-record-form" method="post" action="${base}/records/${encodeURIComponent(view.id)}/supersede" data-testid="task-record-supersede-form">
        ${back}
        <label>supersede with <input name="${addable}" required maxlength="2000"></label>
        <label>to <input name="to" maxlength="200" value="${escapeHtml(view.to || '')}"></label>
        <button type="submit">Supersede</button>
      </form>`
    : '';
  return `<div class="task-record-actions">${endForm}${supersede}</div>`;
}

/** The new-record forms for a task: a finding or a question, and a child task. */
function renderAddForms({ urlKey, identifier }) {
  const base = `${taskPageHref({ urlKey, identifier })}/records`;
  return `<div class="task-records-add">
      <form class="task-record-form" method="post" action="${base}" data-testid="task-record-add-form">
        <label>kind <select name="kind"><option value="finding">finding</option><option value="question">question</option></select></label>
        <label>words <input name="text" required maxlength="2000"></label>
        <label>to <input name="to" required maxlength="200" placeholder="project, a stage, or a person"></label>
        <button type="submit">Add record</button>
      </form>
      <form class="task-record-form" method="post" action="${base}/child" data-testid="task-record-child-form">
        <label>child task, done when <input name="done-when" required maxlength="2000"></label>
        <button type="submit">Add child task</button>
      </form>
    </div>`;
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
  const names = new Map((people || []).filter((p) => p && p.accountId && p.name).map((p) => [p.accountId, p.name]));
  // The task records this page holds (its children), by id, to their ticket: a record addressed to one names it by its ticket.
  const tickets = new Map(views.filter((v) => v.kind === 'task').map((v) => [v.id, typeof v.fields?.ref === 'string' && v.fields.ref ? v.fields.ref : null]));
  const who = (actor) => whoWordOf(actor, { people: names, tickets });
  const listed = views.filter((v) => LISTED_KINDS.includes(v.kind) && !(v.kind === 'question' && !v.ended && cards.has(v.id)));
  const groups = LISTED_KINDS.map((kind) => {
    const items = listed.filter((v) => v.kind === kind);
    if (!items.length) return '';
    const open = items.filter((v) => !v.ended).length;
    return `<div class="task-records-kind" data-kind="${escapeHtml(kind)}">
      <h3 class="task-records-kind-title">${escapeHtml(kindLabel(kind))}s · ${open} open</h3>
      <ul class="task-records-list">${items.map((v) => renderRecordLine(v, { urlKey, identifier, canAct, who, now })).join('')}</ul>
    </div>`;
  }).filter(Boolean).join('');
  const refusedHtml = refused ? `<p class="task-records-refused" role="alert" data-testid="task-records-refused">${escapeHtml(refused)}</p>` : '';
  const empty = `<p class="task-records-none" data-testid="task-records-none">○ no records on this task yet</p>`;
  const body = `${refusedHtml}${groups || empty}${canAct ? renderAddForms({ urlKey, identifier }) : ''}`;
  return renderSection({ className: 'sess-section task-records', title: 'Records', body: `<div class="task-records-mount" data-testid="task-records">${body}</div>` });
}

/** A record line for Home's "Waiting on you" and the project page: the kind, the words, and where it sits. */
export function renderWaitingRecordLine(view, { urlKey }) {
  const where = view.in ? `in ${escapeHtml(view.in)}` : 'project';
  const to = view.to ? ` · to ${escapeHtml(view.to)}` : '';
  return `<div class="waiting-record" data-testid="waiting-record" data-record-id="${escapeHtml(view.id)}" data-kind="${escapeHtml(view.kind)}">
      <div class="waiting-record-head"><span class="waiting-record-kind">${escapeHtml(kindLabel(view.kind))}</span> <span class="waiting-record-where">${where}${to}</span></div>
      <div class="waiting-record-preview">${escapeHtml(previewOf(view) || view.id)}</div>
    </div>`;
}
