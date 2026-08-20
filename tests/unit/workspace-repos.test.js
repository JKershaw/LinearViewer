/**
 * LIN-1935 — workspace repo inventory seam.
 *
 * `knownWorkspaceRepos(projects, { defaultLabel })` derives the workspace's
 * known repos from the `repo=` lines on the projects the caller already
 * holds, via the existing `parseRepoFromDescription` seam. It is pure (no
 * I/O, no clock, no store) and always returns a non-empty list whose first
 * element is the default lane (`repo: null`).
 *
 * Two seam edges pinned here: a whitespace-only `repo=` value parses to `""`
 * (not `null`) and must be dropped rather than collapsing into the default
 * lane; a truthy non-string `content` makes the seam throw `TypeError`, so
 * the helper must guard the type before calling it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownWorkspaceRepos } from '../../lib/workspace-repos.js';

test('no projects: returns the default-only list', () => {
  assert.deepEqual(knownWorkspaceRepos([]), [
    { repo: null, label: 'none', isDefault: true },
  ]);
});

test('no project has a repo= line: returns the default-only list', () => {
  const projects = [
    { name: 'A', content: 'just some description text' },
    { name: 'B', content: 'no marker here either' },
  ];
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
  ]);
});

test('duplicate repo= values across projects are deduped, first-seen order preserved', () => {
  const projects = [
    { name: 'A', content: 'repo=alpha' },
    { name: 'B', content: 'repo=beta' },
    { name: 'C', content: 'repo=alpha' },
  ];
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'alpha', label: 'alpha', isDefault: false },
    { repo: 'beta', label: 'beta', isDefault: false },
  ]);
});

test('case-differing repo values are kept distinct (no case-folding)', () => {
  const projects = [
    { name: 'A', content: 'repo=Foo' },
    { name: 'B', content: 'repo=foo' },
  ];
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'Foo', label: 'Foo', isDefault: false },
    { repo: 'foo', label: 'foo', isDefault: false },
  ]);
});

test('a whitespace-only repo= value is dropped, not treated as the default lane', () => {
  const projects = [
    { name: 'A', content: 'repo=   ' },
    { name: 'B', content: 'repo=real' },
  ];
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'real', label: 'real', isDefault: false },
  ]);
});

test('content: null is tolerated and contributes no repo', () => {
  const projects = [
    { name: 'Synthetic', content: null },
    { name: 'B', content: 'repo=real' },
  ];
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'real', label: 'real', isDefault: false },
  ]);
});

test('content absent is tolerated and contributes no repo', () => {
  const projects = [{ name: 'No content field' }, { name: 'B', content: 'repo=real' }];
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'real', label: 'real', isDefault: false },
  ]);
});

test('a truthy non-string content is tolerated (guarded before the seam) and does not throw', () => {
  const projects = [
    { name: 'Weird', content: 42 },
    { name: 'Weirder', content: { not: 'a string' } },
    { name: 'B', content: 'repo=real' },
  ];
  assert.doesNotThrow(() => knownWorkspaceRepos(projects));
  assert.deepEqual(knownWorkspaceRepos(projects), [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'real', label: 'real', isDefault: false },
  ]);
});

test('a literal "repo=null" line parses to the string "null", distinct from the sentinel', () => {
  const projects = [{ name: 'A', content: 'repo=null' }];
  const result = knownWorkspaceRepos(projects);
  assert.deepEqual(result, [
    { repo: null, label: 'none', isDefault: true },
    { repo: 'null', label: 'null', isDefault: false },
  ]);
  assert.notEqual(result[1].repo, null);
});

test('a custom defaultLabel overrides the default row label only', () => {
  const projects = [{ name: 'A', content: 'repo=real' }];
  assert.deepEqual(knownWorkspaceRepos(projects, { defaultLabel: 'this workspace' }), [
    { repo: null, label: 'this workspace', isDefault: true },
    { repo: 'real', label: 'real', isDefault: false },
  ]);
});

test('the default row is always first and the list is never empty', () => {
  assert.equal(knownWorkspaceRepos([])[0].isDefault, true);
  assert.equal(knownWorkspaceRepos([{ name: 'A', content: 'repo=x' }])[0].isDefault, true);
  assert.ok(knownWorkspaceRepos([]).length > 0);
});

test('does not mutate the input projects array or its project objects', () => {
  const projects = [{ name: 'A', content: 'repo=alpha' }];
  const snapshot = JSON.parse(JSON.stringify(projects));
  knownWorkspaceRepos(projects);
  assert.deepEqual(projects, snapshot);
});
