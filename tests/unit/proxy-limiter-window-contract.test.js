/**
 * The proxy limiter's window against the runner broker's retry cap (agent-api Waiting entry,
 * Seams & Tangles, 8 Nov.; settled on LIN-4468's branch).
 *
 * The broker retries a rate-limited bootstrap exchange only when the 429's Retry-After is no longer
 * than the limiter's window (lib/runner-kit/broker.mjs `EXCHANGE_MAX_WAIT_SECONDS`). The contract's
 * `exchange` rows own that cap, and tests/unit/runner-kit-contract.test.js holds the kit to them
 * (simple-dispatcher pins the same rows). Nothing read the proxy's own window against them, so the
 * window could move and break the retry budget unseen. This reads it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROXY_LIMITER_WINDOW_MS } from '../../routes/proxy.js';

const CONTRACT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../lib/runner-kit/contract.json'), 'utf8'));

describe('the proxy limiter window matches the broker retry cap the contract records', () => {
  test('the contract has exactly one exchange row at the cap, and the kit waits it out', () => {
    const capRows = CONTRACT.rows.filter(r => r.area === 'exchange' && /\(the cap\)/.test(r.case));
    assert.equal(capRows.length, 1, 'one exchange row names the cap');
    const [row] = capRows;
    const capSeconds = Number(row.item.replies[0].retryAfter);
    assert.equal(row.item.replies[0].status, 429);
    assert.match(row.kit, new RegExp(`waits ${capSeconds}s`), 'the kit retries at the cap');
  });

  test('the window is the cap: a 429 the limiter answers is one the broker waits out', () => {
    const [row] = CONTRACT.rows.filter(r => r.area === 'exchange' && /\(the cap\)/.test(r.case));
    const capSeconds = Number(row.item.replies[0].retryAfter);
    assert.equal(PROXY_LIMITER_WINDOW_MS, capSeconds * 1000);
  });
});
