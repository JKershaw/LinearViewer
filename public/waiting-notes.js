/**
 * LIN-4552 (LIN-4546 piece 4): Home's "Notes for you", the browser half (lib/waiting-section.js renderNotesGroup is the markup).
 *
 * Three things, each bound by public/app.js to the section Harbour drew, never to the document:
 *  - the live merge (finding-d4767b81): each rulings tick's fragment carries the notes, merged by their keys (`record:<id>`) through
 *    the same keyed merge and keep-a-card rule as the question cards (public/waiting-merge.js mergeKeyed, public/question-records.js
 *    holdsCard), so a note that arrives after load appears once, and a line being cleared or read stays;
 *  - clear: ends the finding `done` through the workspace's records end route, answered in JSON (routes/task-records.js), then takes
 *    the line out; a note cleared here is never re-added by a response requested before it;
 *  - the fold: every note is in one list. The server says how many show (`data-shown` on the list, lib/waiting-section.js
 *    NOTES_SHOWN) and marks the lines past it `data-folded`; after every change this re-marks them, and the list's `data-expanded`
 *    shows them (style.css), so a merge never moves a line between two lists.
 */
import { mergeKeyed } from './waiting-merge.js';
import { holdsCard } from './question-records.js';

const GROUP = 'waiting-notes';
const NOTE = '[data-testid="waiting-note"]';
const LIST = '[data-testid="waiting-notes-list"]';
const MORE = '[data-testid="waiting-notes-more"]';
const CLEAR = '[data-testid="waiting-note-clear"]';
const FEEDBACK = '[data-testid="waiting-note-feedback"]';

// The notes cleared on this page, by key. Module state: one page, one set.
const clearedKeys = new Set();

/** A note line's key: its `data-key` (`record:<id>`, written by lib/waiting-section.js noteKeyFor). */
export const noteKeyOf = (el) => (el && el.dataset && el.dataset.key) || '';

/** The notes group directly in `body` (the section's `.waiting-body`), or null. */
function groupIn(body) {
  return [...(body?.children || [])].find((el) => el.classList.contains(GROUP)) || null;
}

/** The note lines in a group's list, in page order. */
function notesIn(group) {
  const list = group?.querySelector(LIST);
  return list ? [...list.children].filter((el) => el.matches(NOTE)) : [];
}

/**
 * The group's own state after a change: hidden with no notes, and the fold's control showing how many are behind it (hidden when
 * none are). An expanded list stays expanded; its control then offers to show fewer.
 * @param {Element|null} group
 * @returns {number} the notes in the group
 */
export function syncNotesGroup(group) {
  if (!group) return 0;
  const notes = notesIn(group);
  const count = notes.length;
  group.classList.toggle('hidden', count === 0);
  const more = group.querySelector(MORE);
  const list = group.querySelector(LIST);
  const shown = Number.parseInt(list?.dataset.shown ?? '', 10);
  const limit = Number.isFinite(shown) && shown >= 0 ? shown : count;
  notes.forEach((note, i) => {
    if (i >= limit) note.dataset.folded = 'true';
    else delete note.dataset.folded;
  });
  if (more) {
    const hidden = Math.max(0, count - limit);
    const expanded = list?.dataset.expanded === 'true';
    more.classList.toggle('hidden', hidden === 0);
    // The words are the server's (lib/waiting-section.js renderNotesMore): only the number and which label shows change here.
    const number = more.querySelector('[data-testid="waiting-notes-hidden-count"]');
    if (number) number.textContent = String(hidden);
    more.querySelector('[data-testid="waiting-notes-more-closed"]')?.classList.toggle('hidden', expanded);
    more.querySelector('[data-testid="waiting-notes-more-open"]')?.classList.toggle('hidden', !expanded);
    more.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
  return count;
}

/**
 * Merge the fresh section's notes into the live body's group. A page drawn before the group existed takes the fresh group whole.
 * @param {Element|null} body - the live `.waiting-body`
 * @param {string} freshHtml - the server's section markup (`{ html }` from /api/home-waiting)
 * @returns {{count: number, removed: string[]}}
 */
export function mergeNotes(body, freshHtml) {
  if (!body) return { count: 0, removed: [] };
  const template = body.ownerDocument.createElement('template');
  template.innerHTML = freshHtml || '';
  const freshGroup = template.content ? template.content.querySelector(`.${GROUP}`) : null;
  let group = groupIn(body);
  if (!group) {
    if (!freshGroup) return { count: 0, removed: [] };
    body.appendChild(freshGroup);
    return { count: syncNotesGroup(freshGroup), removed: [] };
  }
  const list = group.querySelector(LIST);
  const removed = mergeKeyed({
    container: list,
    onPage: notesIn(group),
    fresh: notesIn(freshGroup).map((el) => ({ key: noteKeyOf(el), el })),
    keyOf: noteKeyOf,
    holds: (el) => holdsCard(el),
    settled: clearedKeys,
  });
  return { count: syncNotesGroup(group), removed };
}

/**
 * Clear one note: end its finding `done` (JSON), then take the line out and hand focus to the next line's clear (else the group's
 * title). A refusal keeps the line, says why on it and gives the control back.
 * @param {Element} note - the `.waiting-note` line
 * @param {{urlKey: string, onCleared?: (key: string) => void}} ctx
 * @returns {Promise<boolean>} whether the note was cleared
 */
export async function clearNote(note, { urlKey, onCleared = () => {} }) {
  const button = note.querySelector(CLEAR);
  const feedback = note.querySelector(FEEDBACK);
  const id = note.dataset.recordId || '';
  if (!id || (button && button.disabled)) return false;
  if (button) button.disabled = true;
  if (feedback) feedback.textContent = '';
  let error = 'Could not clear it; try again';
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/records/${encodeURIComponent(id)}/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ state: 'done', reason: 'cleared from Home' }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const key = noteKeyOf(note);
      clearedKeys.add(key);
      const group = note.closest(`.${GROUP}`);
      const lines = notesIn(group);
      const next = lines[lines.indexOf(note) + 1] || lines[lines.indexOf(note) - 1] || null;
      note.remove();
      syncNotesGroup(group);
      const focusTo = next?.querySelector(CLEAR) || group?.querySelector('.waiting-notes-title');
      if (focusTo) {
        if (!focusTo.matches('button')) focusTo.setAttribute('tabindex', '-1');
        focusTo.focus();
      }
      onCleared(key);
      return true;
    }
    if (body && typeof body.error === 'string' && body.error) error = body.error;
  } catch {
    error = 'Could not reach Harbour; try again';
  }
  if (button) button.disabled = false;
  if (feedback) feedback.textContent = error;
  return false;
}

/** Open or close the fold: the list's `data-expanded`, and the control's words and state. */
export function toggleNotesFold(group) {
  const list = group?.querySelector(LIST);
  if (!list) return;
  list.dataset.expanded = list.dataset.expanded === 'true' ? 'false' : 'true';
  syncNotesGroup(group);
}

/**
 * Bind clear and the fold on the section Harbour drew (one listener, delegated, so a note merged in later works without a second
 * binding).
 * @param {Element} section - the `[data-testid="waiting-on-you"]` section
 * @param {{urlKey: string, onCleared?: (key: string) => void}} ctx
 */
export function bindNotes(section, ctx) {
  section.addEventListener('click', (ev) => {
    const target = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target : null;
    if (!target) return null;
    const clear = target.closest(CLEAR);
    if (clear) return clearNote(clear.closest(NOTE), ctx);
    const more = target.closest(MORE);
    if (more) toggleNotesFold(more.closest(`.${GROUP}`));
    return null;
  });
}
