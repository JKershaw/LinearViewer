/**
 * LIN-4450 (piece 1 of LIN-4445): a Jira description holds the person's words
 * byte-exact. The exact words live in the issue property `harbour.asAsked`; the
 * description shows the block formatted. These tests drive the provider against the
 * Jira fake, so the property semantics (written in the same PUT, requested by the
 * read, absent unless asked for) are the fake's, and the reader is the real one.
 *
 * Witnesses (each observed failing against the pre-change code, or pinned as a
 * behaviour that code did not have):
 *   - the reader: kept, edited in Jira, edited below the line, the end line deleted,
 *     re-marked as plain text, a localId added, a stale property with no block;
 *   - byte equality of the words after filing, after a later write of what was read,
 *     after a description/below-style write, and after a human edit below the line;
 *   - the codec's fixed point, and the empty fence that used to break later writes;
 *   - the size guard: a property over Atlassian's limit is refused before any write;
 *   - the grep witness: no description read in index.js bypasses the reader.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { adfHasUnrenderableContent, adfToMarkdown, markdownToAdf } from '../../lib/providers/jira/adf.js';
import {
  AS_ASKED_PROPERTY,
  AS_ASKED_PROPERTY_LIMIT_BYTES,
  AS_ASKED_READ,
  AsAskedHoldError,
  holdAsAsked,
  readDescription,
} from '../../lib/providers/jira/as-asked-region.js';
import { AS_ASKED_END, AS_ASKED_HEADING, sealAsAsked, splitAsAsked } from '../../lib/as-asked.js';
import { providerHoldsAsAsked, sealForFiling } from '../../lib/as-asked-seal.js';

const SITE = 'https://acme.atlassian.net';
const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };
const BELOW = '## Implementation Plan\n\n1. step one';
// The end sentence without its markdown emphasis, as a person would type it in plain text.
const END_TEXT = AS_ASKED_END.slice(1, -1);

const WITNESSES = {
  'plain prose': 'Please make the button blue.',
  'star bullets': '* a\n* b',
  'star and underscore emphasis': '*em* and **strong**',
  'triple emphasis': '***x***',
  'fence with a blank line': '```\ncode\n\nmore\n```',
  'empty fence': '```\n```',
  'trailing spaces before a line break': 'line one  \nline two',
  'numbered list starting at 3': '3. x\n4. y',
  'end sentence as plain text': `before\n\n${END_TEXT}\n\nafter`,
  'end sentence as underscore text': `before\n\n_${END_TEXT}_\n\nafter`,
};

const issue = (id, key, description) => ({
  id, key,
  fields: {
    summary: key, description: markdownToAdf(description),
    status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
    project: { id: '10001', key: 'ENG', name: 'Engineering' },
    created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
    labels: [], assignee: null, parent: null, _transitions: [],
  },
});

describe('the Jira as-asked region (LIN-4450)', () => {
  let fake;
  const saved = { client: jiraProvider.client, clientFactory: jiraProvider.clientFactory, site: jiraProvider.site };

  beforeEach(() => {
    fake = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [issue('30001', 'ENG-1', `${sealAsAsked('seed words')}\n\n${BELOW}`)],
    });
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });
  afterEach(() => Object.assign(jiraProvider, saved));

  // The stored ADF of ENG-1 and its property, as the read path sees them.
  async function stored(key = 'ENG-1') {
    const raw = await fake.getIssue(key, AS_ASKED_READ);
    return { adf: structuredClone(raw.fields.description), property: raw.properties?.[AS_ASKED_PROPERTY] };
  }
  // Put an ADF description back on the fake, as an ordinary Jira save would.
  async function saveAdf(adf, key = 'ENG-1') {
    await fake.updateIssue(key, { fields: { description: adf } });
  }

  describe('the reader', () => {
    test('a block written through the provider is served as its exact words, from the property', async () => {
      const words = 'Ship it *today*.\n\n* one\n* two';
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: `${sealAsAsked(words)}\n\n${BELOW}` });
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      const parts = splitAsAsked(description);
      assert.equal(parts.words, words, 'byte for byte');
      assert.equal(parts.below, `\n\n${BELOW}`, 'the text below the block is kept too');
    });

    test('an edit made in Jira to the block serves the edited rendering, behind the canonical markers', async () => {
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked('Please make the button blue.') });
      const { adf } = await stored();
      const wordsNode = adf.content[1];
      wordsNode.content[0].text = 'Please make the button GREEN.';
      await saveAdf(adf);
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(description).words, 'Please make the button GREEN.', 'the person\'s edit becomes the words');
    });

    test('an edit below the line leaves the words exact', async () => {
      const words = '* a\n*em*  \n***x***';
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(words) });
      const { adf } = await stored();
      adf.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'typed below the line' }] });
      await saveAdf(adf);
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(description).words, words);
      assert.ok(description.includes('typed below the line'));
    });

    test('the end line deleted in Jira leaves no block (as on Linear)', async () => {
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked('words') });
      const { adf } = await stored();
      adf.content.splice(adf.content.length - 1, 1);
      await saveAdf(adf);
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(description), null);
    });

    test('the end line re-marked as plain text still closes the block; the words are then the rendering', async () => {
      const words = '* a\n*em*';
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(words) });
      const { adf } = await stored();
      const end = adf.content.find(n => n.type === 'paragraph' && n.content?.[0]?.text?.startsWith('End of what'));
      delete end.content[0].marks;
      await saveAdf(adf);
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(description).words, adfToMarkdown(markdownToAdf(words)));
    });

    test('a localId added by Jira\'s own save keeps the block exact', async () => {
      const words = 'Keep *this*.';
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(words) });
      const { adf } = await stored();
      const stamp = node => {
        if (node && typeof node === 'object') {
          node.attrs = { ...(node.attrs || {}), localId: 'abc-123' };
          for (const child of node.content || []) stamp(child);
        }
      };
      stamp(adf);
      await saveAdf(adf);
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(description).words, words);
    });

    test('a stale property with no block is ignored', async () => {
      await fake.updateIssue('ENG-1', { fields: { description: markdownToAdf(BELOW) } });
      await fake.updateIssue('ENG-1', { properties: [{ key: AS_ASKED_PROPERTY, value: { v: 1, words: 'old', rendered: 'x' } }] });
      const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(description), null, 'no block in the description, so the property says nothing');
      assert.equal(description, BELOW);
    });

    test('a read that did not ask for the property gets the rendering, not the exact words', async () => {
      const words = '* a';
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(words) });
      const bare = await fake.getIssue('ENG-1');
      assert.equal(bare.properties, undefined, 'the property is only returned when asked for');
      assert.equal(readDescription(bare.fields.description, undefined).includes('- a'), true, 'the rendering, not "* a"');
    });

    test('every provider-side issue read asks for the property', async () => {
      const calls = [];
      const spy = { ...fake, getIssue: async (id, opts) => { calls.push(opts); return fake.getIssue(id, opts); } };
      jiraProvider.configure({ client: spy, clientFactory: () => spy, site: SITE });
      await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      await jiraProvider.issueWriteGuard(SCOPE, 'ENG-1');
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { title: 'renamed' });
      assert.ok(calls.length >= 3);
      for (const opts of calls) assert.deepEqual(opts, AS_ASKED_READ);
    });
  });

  describe('byte equality of the words', () => {
    for (const [name, words] of Object.entries(WITNESSES)) {
      test(`${name}: after filing, a later write of what was read, a description/below-style write, and a human edit below the line`, async () => {
        const sealed = `${sealAsAsked(words)}\n\n${BELOW}`;
        await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealed });
        let read = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
        assert.equal(splitAsAsked(read.description).words, words, 'after filing');

        await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: read.description });
        read = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
        assert.equal(splitAsAsked(read.description).words, words, 'after a later write of what was read');

        await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: `${read.description}\n\nappended below` });
        read = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
        assert.equal(splitAsAsked(read.description).words, words, 'after a description/below-style write');

        const { adf } = await stored();
        adf.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'a human edit below' }] });
        await saveAdf(adf);
        read = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
        assert.equal(splitAsAsked(read.description).words, words, 'after a human edit below the line');
      });
    }
  });

  describe('the seal and the round trip', () => {
    for (const [name, words] of Object.entries(WITNESSES)) {
      test(`${name}: the Jira provider holds the block, and the words read back through the same reader`, () => {
        const sealed = sealAsAsked(words);
        assert.equal(providerHoldsAsAsked(jiraProvider, sealed), true);
        const { doc, property } = holdAsAsked(sealed);
        assert.equal(splitAsAsked(readDescription(doc, property)).words, words);
      });
    }

    test('the codec reaches a fixed point after one pass, for every witness', () => {
      for (const [name, words] of Object.entries(WITNESSES)) {
        const once = adfToMarkdown(markdownToAdf(words));
        assert.equal(adfToMarkdown(markdownToAdf(once)), once, name);
      }
    });

    test('an empty fence is rebuildable, and the description written with it takes later writes (the regression: a 422 on every later write)', async () => {
      const sealed = sealAsAsked('```\n```');
      assert.equal(adfHasUnrenderableContent(markdownToAdf(sealed)), false, 'the gate accepts the block');
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealed });
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: `${sealed}\n\nbelow` });
      const read = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(read.description).words, '```\n```');
    });

    test('a block with an end-sentence paragraph inside its words is held: the region closes on the real end, below stays intact', async () => {
      const words = `before\n\n${END_TEXT}\n\nafter`;
      await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: `${sealAsAsked(words)}\n\n${BELOW}` });
      const read = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
      assert.equal(splitAsAsked(read.description).words, words);
      assert.equal(splitAsAsked(read.description).below, `\n\n${BELOW}`, 'no words-tail leaks below the block');
    });
  });

  describe('the size guard', () => {
    // A property of exactly the limit: the words fill what the envelope leaves.
    const envelope = Buffer.byteLength(JSON.stringify({ v: 1, words: '', rendered: '0'.repeat(64) }), 'utf8');
    const FITS = 'a'.repeat(AS_ASKED_PROPERTY_LIMIT_BYTES - envelope);

    test('a property at exactly the limit is held; one byte over is refused', () => {
      assert.doesNotThrow(() => holdAsAsked(sealAsAsked(FITS)));
      assert.throws(() => holdAsAsked(sealAsAsked(`${FITS}a`)), AsAskedHoldError);
    });

    test('JSON escaping counts: quotes that fit raw do not fit serialized', () => {
      const quotes = '"'.repeat(20000);
      assert.ok(quotes.length < AS_ASKED_PROPERTY_LIMIT_BYTES);
      assert.throws(() => holdAsAsked(sealAsAsked(quotes)), err => err.reason === 'too-large');
    });

    test('an oversized body is not sealed: the seal is skipped, the text filed as written', () => {
      const big = '"'.repeat(20000);
      assert.equal(providerHoldsAsAsked(jiraProvider, sealAsAsked(big)), false);
      const log = mock.method(console, 'log', () => {});
      let filed;
      try {
        filed = sealForFiling({ provider: jiraProvider, words: big, lane: 'test' });
      } finally {
        log.mock.restore();
      }
      assert.deepEqual(
        log.mock.calls.map(call => call.arguments.join(' ')),
        ['[as-asked] seal skipped: provider jira cannot hold the block (test)'],
        'exactly one skip line, naming the provider and the lane',
      );
      assert.equal(filed.sealed, false);
      assert.equal(filed.reason, 'provider');
      assert.equal(filed.description, big, 'never reformatted');
    });

    test('an oversized sealed updateIssue returns 422 naming the size, and writes nothing', async () => {
      const before = structuredClone((await fake.getIssue('ENG-1')).fields.description);
      await assert.rejects(
        () => jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked('"'.repeat(20000)) }),
        err => err.status === 422 && /too large/.test(err.message) && /bytes/.test(err.message),
      );
      assert.deepEqual((await fake.getIssue('ENG-1')).fields.description, before, 'nothing written');
    });
  });

  describe('the seal headers and the one reader', () => {
    test('index.js reads no description through adfToMarkdown: only comment bodies remain', () => {
      const path = fileURLToPath(new URL('../../lib/providers/jira/index.js', import.meta.url));
      const offenders = readFileSync(path, 'utf8').split('\n')
        .map((text, i) => ({ text, line: i + 1 }))
        .filter(({ text }) => /adfToMarkdown\(/.test(text) && !/^\s*(\/\/|\*)/.test(text))
        .filter(({ text }) => !/body: adfToMarkdown\(/.test(text));
      assert.deepEqual(offenders, [], 'a description read must go through readDescription');
    });

    test('the block\'s heading and end spellings are the only ones the region module uses', () => {
      const path = fileURLToPath(new URL('../../lib/providers/jira/as-asked-region.js', import.meta.url));
      const source = readFileSync(path, 'utf8');
      assert.equal(source.includes(AS_ASKED_HEADING), false, 'the heading is imported, not retyped');
      assert.equal(source.includes(AS_ASKED_END), false, 'the end sentence is imported, not retyped');
    });
  });
});
