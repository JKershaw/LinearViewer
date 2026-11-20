/**
 * LIN-4503 (P3): the child ticket Harbour makes for a child task, and the mark that finds it again. Pure.
 *
 * A stub identifies the task, its piece and its done-when. It copies no plan text: the plan is a record, and the
 * child reads its piece in its brief. The mark is a single HTML comment line in the description; `ensureTicket`
 * (lib/records/writes.js) finds a child ticket by it, so a retry after a failed write makes no second ticket.
 */

const MARK = /^<!-- harbour-task: (\S+) -->$/;

/** The mark line a stub carries for task `taskId`. */
export const taskMarkOf = (taskId) => `<!-- harbour-task: ${taskId} -->`;

/**
 * The task id a description's mark names, or null when it carries none. Only a whole line counts, so a task id that is a
 * prefix of another (`task-1` in `task-12`) never matches: the comparison is by the id the line names, exactly.
 */
export function markedTaskOf(description) {
  if (typeof description !== 'string') return null;
  for (const line of description.split('\n')) {
    const m = MARK.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

const firstLineOf = (text) => (typeof text === 'string' ? (text.split('\n').find((l) => l.trim() !== '') || '').trim() : '');

/** The title of a child ticket: its parent's ticket, then the done-when's first line (or the task id when it has none). */
export function childTicketTitleOf({ parentRef, taskId, doneWhen = '' }) {
  const words = firstLineOf(doneWhen) || taskId;
  return `${parentRef}: ${words}`.slice(0, 200);
}

/**
 * The description of a child ticket: the mark, the task, the piece (when it has one) and the done-when. Plan text is
 * never copied in: the piece is named by its id and read from records.
 */
export function childTicketDescriptionOf({ parentRef, taskId, piece = null, doneWhen = '' }) {
  const lines = [
    taskMarkOf(taskId),
    `Harbour task ${taskId}, a child of ${parentRef}.`,
    '',
    `**Done when:** ${doneWhen.trim() || '(not yet written)'}`,
  ];
  if (piece) lines.push(`**Piece:** ${piece}`);
  return lines.join('\n');
}
