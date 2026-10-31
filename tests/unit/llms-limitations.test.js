/**
 * LIN-2255 guard: every line under `## Limitations` in public/llms.txt must
 * describe what the code does today.
 *
 * Two halves:
 *   1. The stale wording the issue was filed against must not come back.
 *   2. The facts the corrected lines rely on must still hold in source, so a
 *      future change to the gate, the logout handler or the storage keys
 *      fails here instead of silently making the doc wrong again.
 *
 * Run with: node --test tests/unit/llms-limitations.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(join(ROOT, rel), 'utf8');

function limitationsSection() {
  const lines = read('public/llms.txt').split('\n');
  const start = lines.findIndex((l) => l === '## Limitations');
  assert.notEqual(start, -1, 'llms.txt must keep a "## Limitations" section');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

test('Limitations no longer carries the stale read-only or Linear-only-logout claims', () => {
  const section = limitationsSection();
  assert.doesNotMatch(section, /Read-only view \(no editing tasks\)/);
  assert.doesNotMatch(section, /Logout requires re-authentication via Linear OAuth/);
});

test('task editing is gated on ui.inlineEdit and redirects to the dashboard when off', () => {
  const src = read('routes/task-edit.js');
  assert.match(src, /provider\?\.ui\?\.inlineEdit/, 'task-edit route must read the ui.inlineEdit gate');
  assert.match(src, /res\.redirect\(dashboardHref\)/, 'a closed gate must redirect to the dashboard');
});

test('logout destroys the session and returns to the landing page, with no OAuth step', () => {
  const src = read('routes/auth.js');
  const m = src.match(/router\.get\('\/logout'[\s\S]*?\n {2}\}\)/);
  assert.ok(m, 'GET /logout handler must exist in routes/auth.js');
  assert.match(m[0], /req\.session\.destroy\(/);
  assert.match(m[0], /res\.redirect\('\/'\)/);
  assert.doesNotMatch(m[0], /oauth/i, '/logout must not involve an OAuth flow');
});

test('PAT mode re-signs in after logout, so the logout line must say it does not stay signed out', () => {
  const src = read('lib/pat-session.js');
  assert.match(src, /req\.path === '\/logout'/, 'ensurePATSession must only skip /logout itself');
  assert.match(src, /LINEAR_ACCESS_TOKEN/);
  assert.match(limitationsSection(), /PAT mode[^\n]*LINEAR_ACCESS_TOKEN[^\n]*does not stay signed out/);
});

test('sign-in routes exist for the methods the Limitations line names', () => {
  // GitHub's routes come from a shared factory mounted at its basePath.
  assert.ok(read('routes/auth.js').includes("router.get('/auth/linear'"), 'Linear sign-in route');
  assert.ok(read('routes/github-auth.js').includes("basePath: '/auth/github'"), 'GitHub sign-in basePath');
  assert.ok(read('routes/jira-auth.js').includes("router.get('/auth/jira'"), 'Jira sign-in route');
  assert.ok(read('routes/email-auth.js').includes("router.get('/auth/email'"), 'email sign-in route');
  assert.ok(read('lib/pat-session.js').includes('LINEAR_ACCESS_TOKEN'), 'PAT sign-in wired from LINEAR_ACCESS_TOKEN');
});

test('expand/collapse state is persisted in localStorage and reset restores defaults', () => {
  assert.match(read('public/app.js'), /const STORAGE_KEY = 'linear-projects-state'/);
  assert.match(read('public/app.js'), /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(read('lib/components/footer.js'), /class="footer-action reset-view"/);
});

test('team filter is remembered per workspace in localStorage and in server-side account preferences', () => {
  assert.match(read('public/common.js'), /const TEAM_STORAGE_KEY = 'linear-projects-selected-team'/);
  assert.match(read('public/common.js'), /localStorage\.setItem\(teamStorageKey\(urlKey\)/);
  // Witnesses are the real per-account store and its server.js caller, not a header comment.
  assert.match(read('lib/user-preferences.js'), /selectedTeamByWorkspace: map/);
  assert.match(read('server.js'), /userPreferencesStore\.getSelectedTeam\(/);
});
