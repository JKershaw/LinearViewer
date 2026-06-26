import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLandingPage } from '../../lib/parse-landing.js';

// Guards the LIN-726 landing rebuild contract: the sign-in CTAs moved out of the
// content tree into the brand hero, and a small Harbour OS section anchors the
// bottom of the page linking os.harbour.cat.
test('landing.md no longer carries the in-tree Login/sign-in section', () => {
  const { projects, issues } = parseLandingPage('./content/landing.md');
  assert.ok(!projects.some(p => p.name === 'Login'), 'Login section removed');
  // The old "Connect with Linear" CTA row is gone (the hero owns sign-in now).
  assert.ok(!issues.some(i => i.title === 'Connect with Linear'));
  assert.ok(!issues.some(i => i.url === '/auth/linear'));
});

test('landing.md ends with a small Harbour OS section linking os.harbour.cat', () => {
  const { projects, issues } = parseLandingPage('./content/landing.md');
  const harbourOs = projects.find(p => p.name === 'Harbour OS');
  assert.ok(harbourOs, 'Harbour OS project present');
  // It is the last section on the page.
  assert.equal(projects[projects.length - 1].name, 'Harbour OS');

  const osIssue = issues.find(i => i.url === 'https://os.harbour.cat');
  assert.ok(osIssue, 'os.harbour.cat link present');
  assert.equal(osIssue.project.id, harbourOs.id);
});
