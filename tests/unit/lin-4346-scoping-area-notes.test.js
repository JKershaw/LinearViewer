/**
 * LIN-4346: scoping reads the area notes by pointer, in words fitted to its record-only output.
 *
 * As asked: "The area's notes and the latest Periodical readings should feed it too ... read them
 * where they exist". The notes live in docs/areas/ (LIN-4371) and corrective Periodicals feed them
 * (LIN-4379, LIN-4380), so Periodical readings reach scoping through the notes. The shared pointer
 * ends "name it ... where you record your decisions", but scoping's record takes no fifth line
 * (SIZE_RECORD_SHAPE) and it posts no comment (LIN-4369 arm 4): its pointer sends citations to its
 * final message. The Surveys get no pointer (survey-place reads no reports on the codebase's shape).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { formatAreaNotesPointer, formatScopingAreaNotesPointer } from '../../lib/prompt-formatters.js';
import { REGISTRY_PATH } from '../../lib/prompts/area-registry-path.js';
import { AS_ASKED_HEADING } from '../../lib/as-asked.js';
import {
  SIZE_OF_MOVE_HEADING, SIZES, SIZE_LABEL, WHY_LABEL, CUTS_LABEL, DECIDED_BY_LABEL, DECIDED_BY, NO_CUTS, checkSizeRecord
} from '../../lib/size-of-move.js';

const END = '*End of what was asked. Steps write below this line; nothing above it changes.*';
const ISSUE = {
  id: 'i-4346', identifier: 'LIN-4346', title: 'Area notes fixture',
  description: `${AS_ASKED_HEADING}\n\nMake Brief and Recap populate on open.\n\n${END}`,
  url: 'https://linear.app/test/issue/LIN-4346', createdAt: '2026-11-08T00:00:00.000Z',
  state: { name: 'Todo', type: 'unstarted' }, labels: []
};
const CONTEXT = { parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [] };
const render = (kind) => generatePrompt(kind, ISSUE, CONTEXT).prompt;
const count = (text, needle) => text.split(needle).length - 1;
const pointer = formatScopingAreaNotesPointer();

describe('scoping reads the area notes by pointer (LIN-4346)', () => {
  test('the scoping prompt carries its pointer once, naming where the notes and their registry are', () => {
    const prompt = render('scoping');
    assert.equal(count(prompt, pointer), 1);
    assert.equal(count(prompt, '## Area Notes'), 1);
    assert.match(pointer, /`docs\/areas\/README\.md`/);
    assert.ok(pointer.includes(`\`${REGISTRY_PATH}\``));
    assert.match(pointer, /Periodical readings reach you through these notes/);
  });

  test('the pointer never asks for a record line: citations go in the final message, never the size record', () => {
    const prompt = render('scoping');
    assert.match(pointer, /Name each entry you weighed \(its file and source\) in your final message, never in the size record\./);
    assert.ok(!prompt.includes('where you record your decisions'), 'not the shared pointer\'s "record your decisions"');
    assert.ok(!prompt.includes(formatAreaNotesPointer()), 'not the shared pointer');
    assert.ok(!/\*\*[^*]+:\*\*/.test(pointer), 'the pointer names no record label');
    // Why: a citation written as a fifth line is refused by the proxy guard.
    const four = [`**${SIZE_LABEL}:** ${SIZES[0]}`, `**${WHY_LABEL}:** Doing it as asked delivers what was asked.`, `**${CUTS_LABEL}:** ${NO_CUTS}`, `**${DECIDED_BY_LABEL}:** ${DECIDED_BY.policy}`];
    const record = `${ISSUE.description}\n\n${SIZE_OF_MOVE_HEADING}\n\n${four.join('\n')}`;
    assert.deepEqual(checkSizeRecord(ISSUE.description, record), { ok: true });
    assert.equal(checkSizeRecord(ISSUE.description, `${record}\nNotes weighed: the prompts area's lessons (LIN-4371)`).code, 'SIZE_RECORD_SHAPE');
    assert.notEqual(checkSizeRecord(ISSUE.description, `${record}\nNotes weighed: docs/areas/llm-and-prompts.md (LIN-4371)`).ok, true, 'a cited path is refused too');
  });

  test('a note entry is weighed by the bind rule scoping applies to a Survey finding', () => {
    assert.match(pointer, /Weigh a note entry as you weigh a Survey finding\./);
    assert.match(render('scoping'), /A finding binds on this task only when the asked change would not work/);
  });

  test('the read list points to the pointer, with no bare "area\'s notes" clause', () => {
    const prompt = render('scoping');
    assert.ok(!prompt.includes("the area's notes"), 'the bare clause is gone');
    assert.ok(!prompt.includes('latest Periodical readings'), 'readings come through the notes');
    assert.match(prompt, /the comments filed with the ticket, the area notes below, and for a subtask its parent's size record\./);
  });

  test('the pointers share their opening, so the seven stages\' pointer is unchanged', () => {
    const opening = '\n\n## Area Notes\n\nRead `docs/areas/README.md` and the notes for each area this work touches ' +
      '(`docs/areas/areas.json` maps a path to its area, first match wins; no notes file means nothing known yet).';
    assert.ok(pointer.startsWith(opening));
    assert.ok(formatAreaNotesPointer().startsWith(opening));
  });

  test('the Surveys carry no area notes pointer', () => {
    for (const kind of ['survey-task', 'survey-place']) {
      assert.ok(!render(kind).includes('## Area Notes'), kind);
      assert.ok(!render(kind).includes('docs/areas'), kind);
    }
  });
});
