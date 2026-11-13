/**
 * LIN-4452 (piece 3 of LIN-4445): Jira create and edit fail loudly when the seal's
 * `harbour.asAsked` property is dropped or changed by the site.
 *
 * Jira can answer a create or edit 200 and still discard the entity property in the
 * body. The rejection path never sees that, so the write used to succeed and later
 * reads served converted words as kept. The confirmation re-read already asks for the
 * property (AS_ASKED_READ); these tests pin that a missing or different property on
 * that re-read is a PartialWriteError, and that a write with no block is not held to it.
 *
 * The fake's `dropProperties` seed simulates the silent drop. Each guard witness was
 * observed failing against the pre-guard code before the guard was written.
 *
 * The reader-branch witness is recorded here without instrumenting the reader: a
 * discriminating body whose codec round trip differs from its words, read back byte
 * for byte, with `matchesRendered` (the same digest check the reader uses) true for
 * the stored block.
 *
 * These run against the in-memory fake. They prove the provider's logic, not that
 * John's Jira drops or keeps the property: that is the live check (LIN-4452, handoff).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4452-jira-property-guard.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { adfToMarkdown, markdownToAdf } from '../../lib/providers/jira/adf.js';
import { AS_ASKED_PROPERTY, AS_ASKED_READ, matchesRendered } from '../../lib/providers/jira/as-asked-region.js';
import { PartialWriteError } from '../../lib/partial-write-error.js';
import { sealAsAsked, splitAsAsked } from '../../lib/as-asked.js';

const SITE = 'https://acme.atlassian.net';
const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };
const TASK = { id: '10100', name: 'Task', subtask: false, hierarchyLevel: 0 };
const SCREEN = [
  { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false },
  { fieldId: 'project', name: 'Project', required: true, hasDefaultValue: false },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false },
  { fieldId: 'description', name: 'Description', required: false, hasDefaultValue: false },
];
// Every lossy construct the codec changes: `* a` bullets, `*em*`, trailing spaces, a list at 3.
const DISCRIMINATING = '* a\n\n*em*  \nline\n\n3. three\n4. four';
const BELOW = '## Implementation Plan\n\n1. step one';

const plainIssue = {
  id: '30001', key: 'ENG-1',
  fields: {
    summary: 'Existing', description: markdownToAdf('Just prose.'),
    status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
    project: { id: '10001', key: 'ENG', name: 'Engineering' },
    issuetype: { id: TASK.id, name: 'Task', subtask: false },
    created: '2026-01-01T00:00:00.000Z', labels: [], parent: null, _transitions: [],
  },
};

function fakeWith({ dropProperties = false } = {}) {
  return createFakeJiraClient({
    projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
    projectStatuses: {},
    createMeta: { ENG: { issueTypes: [TASK], fields: { [TASK.id]: SCREEN } } },
    issues: [structuredClone(plainIssue)],
    dropProperties,
  });
}

describe('the dropped-property guard (LIN-4452)', () => {
  test('a create whose block the site drops is a PartialWriteError: the issue exists, so the caller must not retry', async () => {
    const fake = fakeWith({ dropProperties: true });
    const provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Sealed', description: sealAsAsked(DISCRIMINATING) }),
      err => err instanceof PartialWriteError
        && err.applied.includes('created')
        && err.failed === 'property'
        && /do not retry/.test(err.message),
    );
  });

  test('an edit whose block the site drops is a PartialWriteError: the description landed, the property did not', async () => {
    const fake = fakeWith({ dropProperties: true });
    const provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-1', { description: `${sealAsAsked(DISCRIMINATING)}\n\n${BELOW}` }),
      err => err instanceof PartialWriteError && err.applied.join() === 'description' && err.failed === 'property',
    );
    const stored = await fake.getIssue('ENG-1', AS_ASKED_READ);
    assert.ok(stored.fields.description.content.some(n => n.type === 'heading'), 'the block did land in the description');
    assert.equal(stored.properties?.[AS_ASKED_PROPERTY], undefined, 'and no property was held');
  });

  test('a property the site keeps but changes (not the words that were filed) is refused the same way', async () => {
    const fake = fakeWith();
    const changed = Object.create(fake);
    const realGetIssue = fake.getIssue.bind(fake);
    changed.getIssue = async (id, opts) => {
      const read = await realGetIssue(id, opts);
      if (read?.properties?.[AS_ASKED_PROPERTY]) {
        read.properties[AS_ASKED_PROPERTY] = { ...read.properties[AS_ASKED_PROPERTY], words: 'Something else.' };
      }
      return read;
    };
    const provider = new JiraProvider({ client: changed, clientFactory: () => changed, site: SITE });
    await assert.rejects(
      () => provider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(DISCRIMINATING) }),
      err => err instanceof PartialWriteError && err.failed === 'property',
    );
  });

  test('a create whose property the site keeps but changes is refused the same way (the create path, not only the edit)', async () => {
    const fake = fakeWith();
    const changed = Object.create(fake);
    const realGetIssue = fake.getIssue.bind(fake);
    changed.getIssue = async (id, opts) => {
      const read = await realGetIssue(id, opts);
      if (read?.properties?.[AS_ASKED_PROPERTY]) {
        read.properties[AS_ASKED_PROPERTY] = { ...read.properties[AS_ASKED_PROPERTY], words: 'Something else.' };
      }
      return read;
    };
    const provider = new JiraProvider({ client: changed, clientFactory: () => changed, site: SITE });
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Changed', description: sealAsAsked(DISCRIMINATING) }),
      err => err instanceof PartialWriteError && err.applied.includes('created') && err.failed === 'property' && /do not retry/.test(err.message),
    );
  });

  test('a description with no block writes no property, so a site that drops properties is not an error', async () => {
    const fake = fakeWith({ dropProperties: true });
    const provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const updated = await provider.updateIssue(SCOPE, 'ENG-1', { description: 'Plain words, no block.' });
    assert.equal(updated.identifier, 'ENG-1');
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Plain', description: 'Plain words.' });
    assert.equal(created.identifier.startsWith('ENG-'), true);
  });

  test('when the site keeps the property, the same writes succeed and read back byte-exact', async () => {
    const fake = fakeWith();
    const provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    await provider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(DISCRIMINATING) });
    const { description } = await provider.issueDescription(SCOPE, 'ENG-1');
    assert.equal(splitAsAsked(description).words, DISCRIMINATING);
  });
});

describe('the reader branch, witnessed without instrumenting the reader (LIN-4452)', () => {
  test('the discriminating body is one the codec changes, so a byte-equal read-back can only be the digest-match branch', async () => {
    assert.notEqual(adfToMarkdown(markdownToAdf(DISCRIMINATING)), DISCRIMINATING, 'the codec does not round-trip it');
    const fake = fakeWith();
    const provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    await provider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(DISCRIMINATING) });
    const raw = await fake.getIssue('ENG-1', AS_ASKED_READ);
    assert.equal(
      matchesRendered(raw.fields.description, raw.properties[AS_ASKED_PROPERTY]),
      true,
      'the stored block renders to the stored digest',
    );
    const { description } = await provider.issueDescription(SCOPE, 'ENG-1');
    assert.equal(splitAsAsked(description).words, DISCRIMINATING, 'byte for byte');
  });

  test('after an edit in Jira the digest no longer matches, and the reader serves the rendering instead', async () => {
    const fake = fakeWith();
    const provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    await provider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(DISCRIMINATING) });
    const raw = await fake.getIssue('ENG-1', AS_ASKED_READ);
    const adf = structuredClone(raw.fields.description);
    const heading = adf.content.findIndex(n => n.type === 'heading');
    const firstText = node => (node.text != null ? node : (node.content || []).map(firstText).find(Boolean));
    firstText(adf.content[heading + 1]).text += ' EDITED';
    await fake.updateIssue('ENG-1', { fields: { description: adf } });
    const edited = await fake.getIssue('ENG-1', AS_ASKED_READ);
    assert.equal(matchesRendered(edited.fields.description, edited.properties[AS_ASKED_PROPERTY]), false);
    const { description } = await provider.issueDescription(SCOPE, 'ENG-1');
    assert.notEqual(splitAsAsked(description).words, DISCRIMINATING);
  });
});
