/**
 * LIN-3210 (sub-task (c)): the runner's failed-post summary aligns with the new
 * D5x semantics, per the LIN-3197 plan slice ("Files to modify, measurement").
 *
 * `survey-hides-runner.mjs` reads the simple-dispatcher oplog. Its `failByMonth`
 * now carries the D5x companions alongside the unchanged `terminal`/`terminalLost`:
 *   - `terminalLost` still excludes a healed retry (a post that later succeeded);
 *   - `doneLoggedAnyway` = a FALSE `done_posted` (no ok `[done]` feedback.post for
 *     the item) — the old unconditional marker's lie;
 *   - `donePostFailed` = retries exhausted (`hook.done_post_failed`);
 *   - `unresolved` = a `hook.done_post_started` with no posted/failed outcome.
 *
 * The script is run against a synthetic state dir (no production read): the
 * real wiring is exercised, not a re-implementation.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'survey-hides-runner.mjs');
const U = (p) => `${p}-0000-4000-8000-000000000000`;

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'lin3210-runner-')); });
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function writeOplog(events) {
  writeFileSync(join(dir, 'oplog.jsonl'), events.map((e) => JSON.stringify({ ts: e.ts, ...e })).join('\n') + '\n');
}

describe('survey-hides-runner failByMonth D5x companions (LIN-3210)', () => {
  test('counts doneLoggedAnyway / donePostFailed / unresolved and keeps terminalLost healed-excluded', () => {
    const t = (h) => `2026-09-10T${String(h).padStart(2, '0')}:00:00Z`;
    writeOplog([
      // X: a FALSE done_posted — the [done] post failed, the marker landed anyway, never healed.
      { event: 'feedback.post', item: U('a1a1a1a1'), ok: false, status: 503, msg: '[done] finished', ts: t(1) },
      { event: 'hook.done_posted', item: U('a1a1a1a1'), session: 'sess0001', ts: t(1) },
      // Y: a healed retry — failed then the same line succeeded, so not a false posted and not a loss.
      { event: 'feedback.post', item: U('b2b2b2b2'), ok: false, status: 502, msg: '[done] done', ts: t(2) },
      { event: 'hook.done_posted', item: U('b2b2b2b2'), session: 'sess0002', ts: t(2) },
      { event: 'feedback.post', item: U('b2b2b2b2'), ok: true, status: 200, msg: '[done] done', ts: t(3) },
      // Z: retries exhausted — an honest done_post_failed.
      { event: 'hook.done_post_started', item: U('c3c3c3c3'), session: 'sess0003', ts: t(4) },
      { event: 'hook.done_post_failed', item: U('c3c3c3c3'), session: 'sess0003', status: 503, attempts: 4, ts: t(4) },
      // W: a started post with no outcome — unresolved.
      { event: 'hook.done_post_started', item: U('d4d4d4d4'), session: 'sess0004', ts: t(5) },
    ]);
    execFileSync(process.execPath, [SCRIPT, '--state', dir, '--out', dir], { cwd: REPO });
    const r = JSON.parse(readFileSync(join(dir, 'runner.json'), 'utf8'));
    const m = r.feedback.failByMonth['2026-09'];
    assert.ok(m, 'a September bucket exists');
    assert.equal(m.doneLoggedAnyway, 1, 'X is the one false done_posted; Y healed');
    assert.equal(m.donePostFailed, 1, 'Z is the one honest failure');
    assert.equal(m.unresolved, 1, 'W is the one started-with-no-outcome');
    assert.equal(m.terminal, 2, 'X and Y are terminal failed rows');
    assert.equal(m.terminalLost, 1, 'only X is lost; Y healed');
    assert.equal(m.healed, 1, 'Y healed');
  });
});
