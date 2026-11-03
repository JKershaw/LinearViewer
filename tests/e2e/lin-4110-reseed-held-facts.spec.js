// LIN-4110: a reseed (/test/set-local-session) starts the worker key's held task facts over.
//
// The server holds each workspace's issue set (lib/task-facts-holder.js), one entry per urlKey, and refreshes it at most once
// a minute (the 60 s attempt floor). Every spec on a Playwright worker uses the same per-worker key, so a set a previous spec
// left, with the floor already used, answered `incomplete: 'task-missing'` for every task the next spec's seed added. The
// page then re-read /state every second and fired a preview GET inside look-alike-controls' click window.
//
// This pins the seam directly, in one file, so it does not depend on which specs a shard runs before which. The condition that
// tells the fix from its absence: a SECOND reseed inside 60 s of a read on the same key, adding a task the first seed did not
// have. Red without the `resetTaskFacts` call in routes/test.js (the held set is the old seed's, the floor blocks a refresh).

import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

const OLD = '2020-01-01T00:00:00Z';

function task(urlKey, raw, identifier) {
  return {
    id: localSeedId(urlKey, raw), identifier, title: `Task ${identifier}`, projectId: localSeedId(urlKey, 'proj'),
    sortOrder: 1, createdAt: OLD, state: { name: 'In Progress', type: 'started' },
  };
}

function seedOf(urlKey, issues) {
  return {
    projects: [{ id: localSeedId(urlKey, 'proj'), name: 'Reseed project', content: 'p', sortOrder: 1 }],
    issues,
  };
}

test.describe('A reseed starts the held task facts over (LIN-4110)', () => {
  test('a task the second seed adds is found by /state straight away, inside the refresh floor', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const urlKey = localWorkerUrlKey;
    const stateOf = async (identifier) => {
      const resp = await page.request.get(`/workspace/${urlKey}/api/task/${identifier}/state`);
      expect(resp.ok(), `state read for ${identifier}: ${resp.status()}`).toBeTruthy();
      return resp.json();
    };

    // Seed A has only task A. Reading its state fills the held set and uses the refresh's attempt floor.
    await seedLocal(seedOf(urlKey, [task(urlKey, 'a', 'LOCAL-RS-A')]));
    await seedWorkspaceOwnership(page, urlKey, 'owner');
    const a = await stateOf('LOCAL-RS-A');
    expect(a.incomplete, 'task A is in the first seed').not.toBe('task-missing');

    // Seed B (same key, a moment later) adds task B. Its state must not be answered from seed A's set.
    await seedLocal(seedOf(urlKey, [task(urlKey, 'a', 'LOCAL-RS-A'), task(urlKey, 'b', 'LOCAL-RS-B')]));
    await seedWorkspaceOwnership(page, urlKey, 'owner');
    const b = await stateOf('LOCAL-RS-B');
    expect(b.incomplete, 'task B is in the second seed; a held set from seed A would say task-missing').not.toBe('task-missing');
  });
});
