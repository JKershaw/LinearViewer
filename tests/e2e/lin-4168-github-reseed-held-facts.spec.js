// LIN-4168: a GitHub reseed (/test/set-github-session) starts the workspace's held task facts over, as a local reseed does
// (LIN-4110). Before the one per-key reset, only /test/set-local-session cleared the held set; the GitHub seam left the set a
// previous spec held, so a task the second seed added answered `incomplete: 'task-missing'` inside the refresh floor.
//
// The condition that tells the fix from its absence is the same as LIN-4110's: a SECOND seed on the same key, inside 60 s of
// a read, adding a task the first seed did not have. The unit witness for the seam calls is tests/unit/key-state-seams.test.js;
// this is the observable outcome on the GitHub fixture.

import { test, expect } from '../fixtures/test-base.js';
import { seedGitHubWorkspace, defaultGitHubSeed } from '../fixtures/github-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

const issueOne = defaultGitHubSeed.issues[0];

function openIssue(number, title) {
  return {
    number, title, body: `Added by the second seed (#${number})`, state: 'open',
    html_url: `https://github.com/octocat/hello-world/issues/${number}`, created_at: '2026-01-01T00:00:00Z',
    labels: [], milestone: null,
  };
}

test.describe('A GitHub reseed starts the held task facts over (LIN-4168)', () => {
  test('a task the second GitHub seed adds is found by /state straight away, inside the refresh floor', async ({ page }) => {
    // Seed A has only #1. Reading its state fills the held set and uses the refresh's attempt floor.
    const { urlKey } = await seedGitHubWorkspace(page, { ...defaultGitHubSeed, issues: [issueOne] });
    await seedWorkspaceOwnership(page, urlKey, 'owner');
    const stateOf = async (identifier) => {
      const resp = await page.request.get(`/workspace/${urlKey}/api/task/${encodeURIComponent(identifier)}/state`);
      expect(resp.ok(), `state read for ${identifier}: ${resp.status()}`).toBeTruthy();
      return resp.json();
    };
    const a = await stateOf('#1');
    expect(a.incomplete, 'task #1 is in the first seed').not.toBe('task-missing');

    // Seed B (same key, a moment later) adds #4. Its state must not be answered from seed A's held set.
    await seedGitHubWorkspace(page, { ...defaultGitHubSeed, issues: [issueOne, openIssue(4, 'GitHub reseed task')] });
    await seedWorkspaceOwnership(page, urlKey, 'owner');
    const b = await stateOf('#4');
    expect(b.incomplete, 'task #4 is in the second seed; a held set from seed A would say task-missing').not.toBe('task-missing');
  });
});
