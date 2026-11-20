/**
 * LIN-4504 (slice 2, P4): the one recognition rule for OLD plan text in a ticket. Plans are records now (plan records
 * `in` a task, read by lib/records/plan-facts.js): no reader takes a plan, its session fit or whether a review is owed
 * from ticket text. Descriptions written before the cutover still carry a plan section under the heading below, and it
 * stays there as display. Three users need to recognise it, and only to leave it out or refuse it:
 *
 *   - lib/asked-of.js `askedOf`: a task's immutable `asked` is the person's words, so it stops before the plan;
 *   - the skip: the brief's kept ticket section (lib/openrouter.js formatIssueContext) and the selector's own view
 *     (formatSelectorView) leave the description's plan section out, so no stale copy reads as the plan. They reach it
 *     through lib/asked-of.js `descriptionWithoutPlan`, which applies it outside a legacy sealed block only;
 *   - the write refusal: a proxy description write that ADDS the heading is refused 422 with `POST /records` named
 *     (routes/proxy-writes.js).
 *
 * It recognises the heading only and returns TEXT, never a fact: nothing here says whether a ticket has a plan, what
 * session fit it states or whether a review is owed (the 'leaf allowed the heading exports no fact reader' test in tests/unit/lin-4504-plan-text-census.test.js pins its exports).
 * Imports nothing, so any leaf may import it.
 *
 * The heading's one spelling: `#`, `##` or `###`, anywhere in the text. The readers it replaces matched `##` only for a
 * section (the LIN-3200 pilot's plan read, the selector's condensing reader) and `#{1,3}` for a plan comment and
 * `asked` (lib/run-trail.js, lib/asked-of.js); the shared rule takes the wider spelling on purpose (plan-review note 6).
 */

/** The plan heading's words, for the refusal that names them. */
export const PLAN_HEADING_WORDS = 'Implementation Plan';

/** The 422 code for a proxy description write that adds a plan heading (a plan is records: POST /api/proxy/records). */
export const PLAN_IN_DESCRIPTION = 'PLAN_IN_DESCRIPTION';

/**
 * The plan heading line: `#`–`###`, the words, anywhere in a text (multiline). A hash may be backslash-escaped
 * (`\#\#`), as Linear stores some descriptions (the brief quote reads its own heading the same way).
 */
export const LEGACY_PLAN_HEADING = /^((?:\\?#){1,3})[ \t]+Implementation Plan\b[^\n]*$/im;

const levelOf = (hashes) => hashes.replace(/\\/g, '').length;
const unescaped = (line) => line.replace(/\\#/g, '#').trim();

/** Whether `text` contains a plan heading line. */
export function hasPlanHeading(text) {
  return typeof text === 'string' && LEGACY_PLAN_HEADING.test(text);
}

/**
 * The text before the first plan heading, trailing whitespace trimmed; the whole text when it has none.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function textBeforePlan(text) {
  const s = typeof text === 'string' ? text : '';
  const m = LEGACY_PLAN_HEADING.exec(s);
  return m ? s.slice(0, m.index).replace(/\s+$/, '') : s;
}

/**
 * The text with every plan section taken out. A section runs from its heading line to the next heading of the same or
 * a higher level (`##` ends at the next `#` or `##`; a `###` inside a `##` plan stays inside it), or to the end. Text
 * around it is kept byte for byte; the cut leaves one blank line where the section was, and trailing whitespace goes.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function textWithoutPlan(text) {
  const s = typeof text === 'string' ? text : '';
  if (!hasPlanHeading(s)) return s;
  const lines = s.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LEGACY_PLAN_HEADING.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    const level = levelOf(m[1]);
    let end = i + 1;
    while (end < lines.length) {
      const h = /^((?:\\?#){1,6})[ \t]/.exec(lines[end]);
      if (h && levelOf(h[1]) <= level) break;
      end++;
    }
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    if (out.length && end < lines.length) out.push('');
    i = end - 1;
  }
  return out.join('\n').replace(/\s+$/, '');
}

/**
 * The plan heading lines `after` holds that `before` did not (a line counted as often as it appears), in order. The
 * proxy's write refusal judges what a write ADDS, never the whole result: an edit elsewhere in an old description that
 * already holds a plan adds no heading and passes; a renamed heading line is an added one. Lines are compared with
 * their escapes taken out, so an escaped stored heading and the same heading sent plain are one line.
 * @param {string|null|undefined} before - the description as it stands
 * @param {string|null|undefined} after - the description the write would store
 * @returns {string[]} the added heading lines, trimmed
 */
export function addedPlanHeadings(before, after) {
  const lines = (text) => (typeof text === 'string' ? text : '').split('\n').filter((l) => LEGACY_PLAN_HEADING.test(l)).map(unescaped);
  const left = new Map();
  for (const l of lines(before)) left.set(l, (left.get(l) || 0) + 1);
  const added = [];
  for (const l of lines(after)) {
    if (left.get(l)) left.set(l, left.get(l) - 1);
    else added.push(l);
  }
  return added;
}

