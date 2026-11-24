/**
 * LIN-4559 (LIN-4508 piece D), beat 3: on the run page, each child agent's words are their own collapsible thread under
 * the parent run, one click from it.
 *
 * The run page's transcript is drawn client-side (public/session.js `renderRunTranscripts`) from the `data-feedback`
 * JSON the server embeds (lib/render-session.js `renderTranscript`). This file holds the server half and the
 * stylesheet; the drawn half (the real common.js and chat.js with session.js's toggle-and-transcript slice over the
 * server's page) lives in tests/unit/session-run-transcript-entries.test.js, the suite that already runs session.js
 * as a classic script (the classic-loader census keeps their number from rising). Shared fixtures:
 * tests/fixtures/lin-4559-run-page.js.
 *
 * Witnessed:
 *   - the server carries each child entry's `agent` and never flags a child's `[blocked]` as the run's;
 *   - a parent with no child entries renders byte for byte as before (the embed and the drawn bubbles);
 *   - each child is one `<details>` thread, placed where its first entry falls in time, its entries in order, the
 *     summary naming the agent and counting its messages; two interleaved children make two threads;
 *   - collapsed by default (the choice: the run's own conversation stays the line a reader follows, and a child can
 *     talk at length; the summary says who and how much, one click opens it);
 *   - a child's text takes the same escaping path as the run's words, and masked text shows as stored;
 *   - a child bubble carries no in-progress pill (it never needs to settle), and a child's `[done]` is neither the
 *     run's status on the page nor a bubble in the run's own thread;
 *   - a click inside a child thread (its summary) does not collapse the run card.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { own, child, loopWith, pageHtml, embedded } from '../fixtures/lin-4559-run-page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── The server's embed ─────────────────────────────────────────────────────

describe('LIN-4559 run page: the server embed', () => {
  test('a child entry carries its agent; the run\'s own entries carry none', () => {
    const entries = embedded(pageHtml(loopWith([own('Handed the search to an agent.', 1), child('a1b2c3', 'Searching lib/.', 2)])));
    assert.equal(entries[0].agent, undefined);
    assert.equal(entries[1].agent, 'a1b2c3');
    assert.equal(entries[1].kind, 'agent-text');
  });

  test('a child\'s [blocked] is not flagged as the run\'s block; the run\'s own still is', () => {
    const entries = embedded(pageHtml(loopWith([own('[blocked] which branch?', 1, 'status'), child('a1b2c3', '[blocked] which file?', 2)])));
    assert.equal(entries[0].blocked, true);
    assert.equal(entries[1].blocked, false);
  });

  test('characterization: a parent with no child entries embeds exactly what it did (key set and values)', () => {
    const feedback = [own('Looked at it.', 1), own('[blocked] which branch?', 2, 'status'), own('[done] Task completed', 3, null)];
    const entries = embedded(pageHtml(loopWith(feedback)));
    assert.deepEqual(entries, feedback.map((e) => ({
      message: e.message, url: null, urlLabel: null, timestamp: e.timestamp, blocked: /^\s*\[(blocked|pending)\]/i.test(e.message), kind: e.kind || null
    })));
    for (const e of entries) assert.deepEqual(Object.keys(e), ['message', 'url', 'urlLabel', 'timestamp', 'blocked', 'kind']);
  });
});

// ── Phone width and the theme ──────────────────────────────────────────────

describe('LIN-4559 run page: the thread at 390px and in dark mode (stylesheet)', () => {
  const css = readFileSync(join(__dirname, '../../public/session.css'), 'utf8');
  const rule = (selector) => {
    const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m ? m[2] : null;
  };

  test('the inner thread does not scroll on its own: it outranks the shared .chat-thread (chat.css loads after this sheet)', () => {
    const body = rule('.sess-agent-thread__tx.chat-thread');
    assert.ok(body, 'the inner thread\'s rule carries both classes, so it beats `.chat-thread` whatever the load order');
    assert.match(body, /--chat-thread-max-height:\s*none/);
    assert.match(body, /overflow-y:\s*visible/);
  });

  test('the thread and its summary wrap long unbroken text and never widen the page', () => {
    for (const sel of ['.sess-agent-thread', '.sess-agent-thread__summary']) {
      const body = rule(sel);
      assert.ok(body, `${sel} has a rule in public/session.css`);
      assert.match(body, /overflow-wrap:\s*anywhere/, `${sel} wraps long unbroken text`);
      assert.match(body, /min-width:\s*0/, `${sel} may shrink below its content`);
    }
  });

  test('colours come from the theme tokens, never a literal colour (dark mode is a token override)', () => {
    const bodies = ['.sess-agent-thread', '.sess-agent-thread__summary', '.sess-agent-thread__tx.chat-thread'].map(rule).join('\n');
    assert.match(bodies, /var\(--/);
    assert.doesNotMatch(bodies, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
