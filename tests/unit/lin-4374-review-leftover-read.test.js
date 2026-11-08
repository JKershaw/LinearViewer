/**
 * LIN-4374 (piece 3 of LIN-4347): review reads the leftovers, close-out writes the notes.
 *
 * - Review's "Isolated, or One of a Class?" section carries the one read of what the change
 *   left at its edges: the builder's `### Leftovers` comment against the diff, each untouched
 *   edge routed to a fix, a note entry or an outside follow-up, and never by itself Request
 *   Changes (the review loop bound is untouched).
 * - Close-out writes review's note entries into `docs/areas/<slug>.md` on the PR branch before
 *   the merge, stays the only filer, and states the one-home rule in Follow-up Triage.
 * - The heading has one spelling, shared by the leftover prompt and review's template.
 * - The two post-merge readers (`retrospective-audit`, `retro`) are left as they were.
 *
 * Run with: node --test tests/unit/lin-4374-review-leftover-read.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePrompt } from '../../lib/prompt-templates.js';
import { LEFTOVERS_HEADING } from '../../lib/dispatch-fields.js';
import { LEFTOVERS_HEADING as PROMPT_HEADING, leftoverPrompt } from '../../lib/dispatch-leftover.js';
import { SIZE_OF_MOVE_HEADING } from '../../lib/size-of-move.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const ISSUE = {
  id: 'issue-4374', identifier: 'LIN-9001', title: 'Leftover read fixture', description: 'Some work',
  url: 'https://linear.app/test/issue/LIN-9001', state: { name: 'In Progress', type: 'started' },
  labels: [], createdAt: '2026-11-01T00:00:00.000Z'
};
const CONTEXT = { parent: null, siblings: [], project: null, children: [], comments: [] };

const render = (kind) => {
  const out = generatePrompt(kind, ISSUE, CONTEXT, {});
  return typeof out === 'string' ? out : out.prompt;
};

/** The text from a `### ` heading to the next `### ` or `## ` heading. */
function section(prompt, heading) {
  const start = prompt.indexOf(`### ${heading}`);
  assert.ok(start >= 0, `the prompt has a "### ${heading}" section`);
  const rest = prompt.slice(start + 4 + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('review: the one read of what the change left at its edges (LIN-4374)', () => {
  const classCheck = section(render('review'), 'Isolated, or One of a Class?');

  test('the read sits in the class check and reads the builder\'s answer under the shared heading', () => {
    assert.ok(classCheck.includes('**What the change left at its edges.**'), classCheck);
    assert.ok(classCheck.includes('`' + LEFTOVERS_HEADING + '`'), 'names the heading the leftover step posts under');
    assert.match(classCheck, /Read the diff against the builder's/);
    assert.match(classCheck, /if there is one/, 'with no answer on the ticket, review still reads the diff');
    assert.match(classCheck, /neither tidied nor in its area's notes/);
  });

  test('each untouched edge has one of three routes', () => {
    assert.match(classCheck, /inside the change's area and the size of a fix, a fix for close-out/);
    assert.match(classCheck, /larger, a note entry for close-out to write in `docs\/areas\/<slug>\.md`/);
    assert.match(classCheck, /outside the area, an outside follow-up/);
  });

  test('a leftover alone never makes Request Changes, and defects keep their route', () => {
    assert.match(classCheck, /A leftover alone is never Request Changes; a defect keeps its route\./);
  });
});

describe('close-out: writes review\'s note entries and states the one-home rule (LIN-4374)', () => {
  const prompt = render('close-out');

  test('the note entries are written on the PR branch before the merge, alongside the fixes', () => {
    const fixes = section(prompt, 'Make the Fixes Review Asked For');
    assert.match(fixes, /Write each note entry review named into its area's `docs\/areas\/<slug>\.md` on the PR branch the same way, before the merge\./);
    assert.match(prompt, /Make the fixes and write the note entries review asked for/, 'Workflow step 2 names them');
  });

  test('Follow-up Triage states the one-home rule, and close-out stays the only filer', () => {
    const triage = section(prompt, 'Follow-up Triage');
    assert.match(triage, /One home for each leftover: a filed follow-up will be done, a note is known but not scheduled, and a leftover inside the change's area is never filed\./);
    assert.match(triage, /Only outside items are filed here/);
  });

  test('the prune still keeps the size record word for word (LIN-4368)', () => {
    assert.ok(prompt.includes('Keep the `' + SIZE_OF_MOVE_HEADING + '` section verbatim'), 'the prune line is unchanged');
  });
});

describe('the leftover heading has one spelling (LIN-4374)', () => {
  test('the leftover prompt and review read the same constant', () => {
    assert.equal(PROMPT_HEADING, LEFTOVERS_HEADING);
    assert.ok(leftoverPrompt({ issueIdentifier: 'LIN-9001', prUrl: 'https://github.com/o/r/pull/1' }).includes('`' + LEFTOVERS_HEADING + '`'));
  });

  test('no other file in lib/ or routes/ spells the heading', () => {
    const offenders = [];
    for (const dir of ['lib', 'routes']) {
      const walk = (rel) => {
        for (const ent of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
          const path = `${rel}/${ent.name}`;
          if (ent.isDirectory()) walk(path);
          else if (ent.name.endsWith('.js') && path !== 'lib/dispatch-fields.js'
            && readFileSync(join(ROOT, path), 'utf8').includes(LEFTOVERS_HEADING)) offenders.push(path);
        }
      };
      walk(dir);
    }
    assert.deepEqual(offenders, [], 'import LEFTOVERS_HEADING from lib/dispatch-fields.js instead of retyping it');
  });
});

describe('the post-merge readers are left as they were (LIN-4374)', () => {
  for (const kind of ['retrospective-audit', 'retro']) {
    test(`${kind} carries neither the leftover read nor the one-home sentence`, () => {
      const prompt = render(kind);
      assert.ok(!prompt.includes(LEFTOVERS_HEADING));
      assert.ok(!prompt.includes('One home for each leftover'));
    });
  }
});
