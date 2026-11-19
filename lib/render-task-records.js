/**
 * LIN-4494 (piece 3): the Records section of a task page, and the records a Home row and the project page draw.
 * Pure: it takes record views (lib/records/views.js, as the store returns them) and returns markup. The route decides
 * who may see records (never a guest: lib/render-task-page.js refuses them for `viewer: 'guest'`) and whether the
 * viewer may act (`canAct`: a signed-in owner or member).
 *
 * A record's line says what it is: its kind, its state (open, or the end it took), a brief preview (its first line of
 * the words it carries), who it is addressed to and who wrote it. A task with no ticket reads "no ticket yet", so
 * nobody mistakes it for queued work (LIN-4494 acceptance).
 */
import { escapeHtml } from './utils/html.js';
import { renderSection } from './components/section.js';
import { KINDS } from './records/check.js';
import { taskPageHref } from './task-page-href.js';

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

function stateWords(view) {
  if (view.ended) return `${view.state} — ${view.ended.reason || ''}`.replace(/ — $/, '');
  return view.state;
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
function renderRecordLine(view, { urlKey, identifier, canAct }) {
  const flags = view.flags || {};
  const flagWords = [
    ...(flags.stale || []).map((s) => `STALE: ${s}`),
    ...(flags.answered ? [`answered by ${flags.answered.by}`] : []),
    ...(flags['under-ended-task'] ? [`under ended task ${flags['under-ended-task']}`] : []),
  ];
  const ticketWords = ticketWordsOf(view, { urlKey, testid: 'task-record-no-ticket' });
  const to = view.to ? `to ${escapeHtml(view.to)} · ` : '';
  // A record that has not ended is still in its kind's start state (open, stands, holds, kept: lib/records/kinds.json).
  const actions = canAct && !view.ended ? renderEndForms(view, { urlKey, identifier }) : '';
  return `<li class="task-record" data-testid="task-record" data-record-id="${escapeHtml(view.id)}" data-kind="${escapeHtml(view.kind)}" data-state="${escapeHtml(view.state)}">
      <div class="task-record-head"><span class="task-record-state">${escapeHtml(stateWords(view))}</span> <span class="task-record-id">${escapeHtml(view.id)}</span> ${ticketWords}</div>
      ${previewOf(view) ? `<div class="task-record-preview">${escapeHtml(previewOf(view))}</div>` : ''}
      <div class="task-record-meta">${to}by ${escapeHtml(view.by)} · ${escapeHtml(view.at || '')}</div>
      ${flagWords.map((w) => `<div class="task-record-flag">${escapeHtml(w)}</div>`).join('')}
      ${actions}
    </li>`;
}

/** The end and supersede forms for one open record: a person ends it, or supersedes it with new words. */
function renderEndForms(view, { urlKey, identifier }) {
  const base = `/workspace/${encodeURIComponent(urlKey)}`;
  const ends = KINDS.kinds[view.kind]?.ends || [];
  const endOptions = ends.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
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
 */
export function renderTaskRecordsSection({ views = [], identifier, urlKey, canAct, refused = null }) {
  const listed = views.filter((v) => LISTED_KINDS.includes(v.kind));
  const groups = LISTED_KINDS.map((kind) => {
    const items = listed.filter((v) => v.kind === kind);
    if (!items.length) return '';
    const open = items.filter((v) => !v.ended).length;
    return `<div class="task-records-kind" data-kind="${escapeHtml(kind)}">
      <h3 class="task-records-kind-title">${escapeHtml(kindLabel(kind))}s · ${open} open</h3>
      <ul class="task-records-list">${items.map((v) => renderRecordLine(v, { urlKey, identifier, canAct })).join('')}</ul>
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
