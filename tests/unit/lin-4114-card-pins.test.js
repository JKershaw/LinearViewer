/**
 * LIN-4114 — characterization pins for the pinned reply card (lib/question-card.js renderBareBlockedCard).
 *
 * The expected bytes live in tests/fixtures/lin-4114-card-pins.json. LIN-4541 (LIN-4529 P7b-2) regenerated them when the
 * ruling ids left the card: the new bytes are the old ones with the five ruling attributes (`data-stamp-loop-id`,
 * `data-decision-id`, `data-disposition`, `data-effect`, `data-record-on`) and the two empty lines the options and dismiss
 * slots left removed, nothing else (checked when regenerated). The decision card's pins went with renderDecisionCard: a
 * question is a question record's card (lib/question-record-card.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderBareBlockedCard, renderQuestionCards } from '../../lib/question-card.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PINS = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/lin-4114-card-pins.json'), 'utf8'));

describe('LIN-4114 witness 2: the reply card renders byte-for-byte as pinned', () => {
  test('renderBareBlockedCard (interactive) is unchanged', () => {
    const html = renderBareBlockedCard({
      waitingMessage: '[blocked] which API key?', decisionCase: ['Two keys exist.'],
      producer: { loopId: 'lp-9', target: 'cli', issueId: 'x', issueIdentifier: 'LIN-9' },
      urlKey: 'w', canReply: true, sessionTerminal: false
    });
    assert.equal(html, PINS['bare-blocked-interactive']);
  });

  test('renderBareBlockedCard (cannot reply, session ended) is unchanged and offers no control', () => {
    const html = renderBareBlockedCard({
      waitingMessage: '[blocked] which API key?', decisionCase: [], producer: { loopId: 'lp-9' },
      urlKey: 'w', canReply: false, sessionTerminal: true
    });
    assert.equal(html, PINS['bare-blocked-cannot-reply']);
    assert.ok(!/<button|<input|<textarea/.test(html), 'a canReply:false card offers no control');
  });

  test('LIN-4541: the card carries no ruling ids, options or dismiss', () => {
    const html = PINS['bare-blocked-interactive'];
    assert.doesNotMatch(html, /data-(?:stamp-loop-ids?|decision-id|task-decision-id|effect|record-on|disposition)=/);
    assert.doesNotMatch(html, /session-question-card-(?:option|dismiss)/);
  });

  test('the bare-blocked wrapper is drawn when no question record covers the wait, and not when one does (LIN-4538)', () => {
    const bare = renderQuestionCards({ waiting: true, waitingMessage: 'awaiting', urlKey: 'w', canReply: true, sessionTerminal: false });
    assert.match(bare, /sess-qcards/);
    const covered = renderQuestionCards({ covered: true, waiting: true, waitingMessage: 'awaiting', urlKey: 'w', canReply: true, sessionTerminal: false });
    assert.equal(covered, '');
  });
});
