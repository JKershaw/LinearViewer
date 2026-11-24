/**
 * The hand-off protocol (LIN-4495, decision 7a of LIN-4491): the one home for how a stage passes a thing on.
 *
 * A hand-off is a records finding, written by the writer and addressed to its reader. Two spellings, each written
 * once: `HANDOFF_BLOCK` is the short block every run-bearing stage's preamble renders (lib/proxy-preamble.js), and
 * `HANDOFF_CALLS` is the call shapes the proxy instructions carry (lib/proxy-instructions.js). `CLOSE_OUT_LINE` is the
 * close-out gate's one line, which both name. The preamble and the instructions import these; no prompt retypes them.
 *
 * A LEAF: it imports nothing, so the preamble, the instructions and the stage templates can all import it.
 */

/** The records route a hand-off is written to (routes/proxy-records.js). */
export const HANDOFF_WRITE_PATH = '/api/proxy/records';

/** The close-out gate's one line: the state a task is ready to close in, and what the reading of it says (never "discharged"). */
export const CLOSE_OUT_LINE = 'no open findings to close-out';

/**
 * The ask route (decision 7a): the line implementation, plan and breakdown name where they would once have told a
 * parent or a sibling in a comment. An ask or a change of course is a finding to that task.
 */
export const ASK_ROUTE = 'To ask the parent or a sibling task something, or to change course with it, write a finding to that task: `to` its ticket id, `in` this ticket.';

/**
 * The question protocol (LIN-4533, LIN-4529 P3): how a run asks a person, or a deciding stage, for a choice only they can
 * make, and what the run does while it waits. An answer is a decision record that resumes the run that asked. LIN-4550:
 * `short` leads every card (its 200 is KINDS.limits.question.short, held equal by tests/unit/lin-4550-question-prompts.test.js;
 * this leaf imports nothing), and the card marks the recommended option itself.
 */
export const QUESTION_ROUTE = 'To ask a person, or a stage that decides, for a choice only they can make, write a `question` record: `in` this task, `to` the person (the name the workspace shows them) or the stage, with `short` (the question in one sentence, read first; at most 200 characters, longer is refused, not cut), `asks` (the question, with the result that would mean yes and the one that would mean no), `options` (the answers they pick from, each a line of text, no option marked "(Recommended)"), `recommended` (one of the options, with your reason in `asks`; the card marks it) and `if-unanswered` (what this run does if no answer comes). One record per question, as many as the run needs. A run that cannot go on until an answer comes ends `BLOCKED:`, as its last line; an answer resumes that run with the question, the option chosen and the person\'s own words.';

/** The question's check before asking: the task's open questions, so none is raised twice. */
export const QUESTION_CHECK = 'Before you ask, check the task\'s open questions and the answers already given: `GET /api/proxy/records?kind=question&in=<this ticket>&state=open`, and `GET /api/proxy/records?kind=decision&in=<this ticket>` for the answers. Ask a question only the record does not already cover.';

/**
 * The block every run-bearing stage's preamble renders (lib/proxy-preamble.js). Short on purpose: the call shapes are
 * in the instructions. `run` is the run id the preamble names; a write without it is refused.
 */
export const HANDOFF_BLOCK = [
  'Hand-offs are records, not comments. Write each one with `POST /api/proxy/records` as a flat JSON body, with `"run"` set to your run id above:',
  '- a check you could not run, or could not verify: a finding with `how` (the exact check to run), `to` the person (the name the workspace shows them);',
  '- a review or blind-read find, a leftover, or a find about the codebase: a finding `to` `close-out` with `in` this task\'s ticket, or `to` `project` when no task owns it;',
  '- an ask to the parent or a sibling task: a finding `to` that task\'s ticket id, with `in` this task\'s ticket;',
  '- a choice only a person or a deciding stage can make: a `question` record (the question route below);',
  '- what you act on yourself, you end: `POST /api/proxy/records/<id>/end` with `{"state": ...}`.',
  `A refused write names what would work. Close-out ends when there are ${CLOSE_OUT_LINE}.`,
  '',
  QUESTION_ROUTE,
  QUESTION_CHECK
].join('\n');

/**
 * The call shapes the proxy instructions carry (lib/proxy-instructions.js). A flat body; the records route fills `by`
 * from the credential and the run, so an agent never sends it.
 */
export const HANDOFF_CALLS = [
  `POST https://harbour.cat${HANDOFF_WRITE_PATH}`,
  '  Body: {"kind":"finding","in":"<this ticket>","to":"close-out","says":"...","how":"...","run":"<your run id>"}',
  '  → 201 { "id", "v", "kind", "state", "in", "to", ... }. `to` names what Harbour can brief: `close-out`, `project`, a stage kind (`review`, `implementation`, ...), a task (its ticket id or task id), or a person as the workspace shows them.',
  '  → 422 { "problems": [ { "field", "message", "works" } ] }: every problem named in one refusal, with the names that would work.',
  '  → 403 names why a dispatch credential cannot write: no run, the run ended, or the run is in another lineage.',
  'POST https://harbour.cat/api/proxy/records',
  '  Body: {"kind":"question","in":"<this ticket>","to":"<the person, as the workspace shows them>","short":"...","asks":"...","options":["...","..."],"recommended":"...","if-unanswered":"...","run":"<your run id>"}',
  '  → 201 { "id", "v", "kind": "question", "state": "open", ... }. An answer arrives as a decision record that resumes this run; a person\'s dismissal ends it `dismissed` and resumes the run with its if-unanswered. To take your own question back, end it `withdrawn`; `dismissed` from an agent is refused.',
  '  → 422 names the field a question is missing, or the limit a text field passes.',
  'GET https://harbour.cat/api/proxy/records?kind=question&in=<ticket>&state=open',
  '  → { "records": [ ... ] }: the task\'s open questions, to check before asking one. `count=1` returns { "count" } only.',
  'POST https://harbour.cat/api/proxy/records/{id}/end',
  '  Body: {"state":"done","reason":"...","run":"<your run id>"}',
  '  → 200. Ending a record that has ended returns it unchanged. A `state` is one the kind lists (a finding: done, declined, handed-on).'
].join('\n');
