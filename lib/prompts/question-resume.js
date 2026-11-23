/**
 * LIN-4531 (LIN-4529 plan D2): the words an asking run is resumed with when its question is answered or dismissed.
 *
 * One composer, server-side: the answer route reads the question and its decision from the records and calls these, so the
 * browser never composes a resume prompt. Every value goes in verbatim (never trimmed, never escaped, never truncated: the
 * limit on a decision's words is checked at write time, so this composer sees the whole text). The order is the plan's:
 * the question, the option, then the person's own words.
 *
 * The marker line (`Answer to question <id>.` or `Dismissal of question <id>.`) is the one line a retry reads to see that a
 * resume was already made for this question (`resumesQuestion`). It is a whole line on its own, so the text around it can
 * change without losing the marker.
 */

const ANSWER_MARKER = (questionId) => `Answer to question ${questionId}.`;
const DISMISSAL_MARKER = (questionId) => `Dismissal of question ${questionId}.`;

/**
 * The prompt a run is resumed with after its question is answered.
 * @param {{questionId: string, asks: string, option?: string|null, words?: string|null}} input
 * @returns {string}
 */
export function questionAnsweredPrompt({ questionId, asks, option = null, words = null }) {
  const parts = [
    ANSWER_MARKER(questionId),
    '',
    'Your question was answered. Continue the work it was asked for, with the answer below.',
    '',
    'Question:',
    String(asks),
  ];
  if (typeof option === 'string' && option.trim()) parts.push('', 'Option chosen:', option);
  if (typeof words === 'string' && words.trim()) parts.push('', "The person's own words:", words);
  return parts.join('\n');
}

/**
 * The prompt a run is resumed with after its question is dismissed: the person has said to go ahead without an answer, so the
 * run takes the fallback its question named (`if-unanswered`).
 * @param {{questionId: string, asks: string, ifUnanswered?: string|null}} input
 * @returns {string}
 */
export function questionDismissedPrompt({ questionId, asks, ifUnanswered = null }) {
  const fallback = typeof ifUnanswered === 'string' && ifUnanswered.trim()
    ? ifUnanswered
    : 'Use your own judgement, and record the reasoning in your records.';
  return [
    DISMISSAL_MARKER(questionId),
    '',
    'Your question was dismissed, so no answer is coming. Go ahead with the fallback you named for it:',
    '',
    'Question:',
    String(asks),
    '',
    'If unanswered:',
    fallback,
  ].join('\n');
}

/** The two ways a question's run is resumed. A marker belongs to one of them, and a retry checks only the one it would make. */
export const RESUME_ACTION = Object.freeze({ ANSWER: 'answer', DISMISSAL: 'dismissal' });

/**
 * Does this prompt already resume the run for this question with this action? A whole-line match of that action's marker, so a
 * retry never makes a second resume. The other action's marker does not count (review finding af9e77b1): a dismissal's resume
 * is not the answer's resume, and an answer's is not the dismissal's. An unknown action throws, never matches by default.
 * @param {string} prompt
 * @param {string} questionId
 * @param {'answer'|'dismissal'} action - RESUME_ACTION
 * @returns {boolean}
 */
export function resumesQuestion(prompt, questionId, action) {
  let marker;
  if (action === RESUME_ACTION.ANSWER) marker = ANSWER_MARKER(questionId);
  else if (action === RESUME_ACTION.DISMISSAL) marker = DISMISSAL_MARKER(questionId);
  else throw new Error(`resumesQuestion: unknown action "${action}"`);
  if (typeof prompt !== 'string' || !questionId) return false;
  return prompt.split('\n').some((line) => line === marker);
}
