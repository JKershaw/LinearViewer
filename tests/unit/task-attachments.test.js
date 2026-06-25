import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { collectTaskImages } from '../../lib/task-attachments.js';

describe('collectTaskImages (LIN-652)', () => {
  test('returns [] for missing / non-object issue', () => {
    assert.deepEqual(collectTaskImages(null), []);
    assert.deepEqual(collectTaskImages(undefined), []);
    assert.deepEqual(collectTaskImages('nope'), []);
  });

  test('extracts image formal attachment nodes, dropping non-image files', () => {
    const issue = {
      attachments: {
        nodes: [
          { id: 'a1', title: 'Shot', url: 'https://uploads.linear.app/x/shot.png' },
          { id: 'a2', title: 'Spec', url: 'https://uploads.linear.app/x/spec.pdf' },
          { id: 'a3', title: 'GIF', url: 'https://uploads.linear.app/x/anim.gif?sig=abc' },
        ],
      },
    };
    const images = collectTaskImages(issue);
    assert.deepEqual(images, [
      { url: 'https://uploads.linear.app/x/shot.png', title: 'Shot', source: 'issue' },
      { url: 'https://uploads.linear.app/x/anim.gif?sig=abc', title: 'GIF', source: 'issue' },
    ]);
  });

  test('accepts a plain attachments array as well as { nodes }', () => {
    const issue = { attachments: [{ id: 'a1', title: null, url: 'https://cdn.linear.app/y/p.jpeg' }] };
    assert.deepEqual(collectTaskImages(issue), [
      { url: 'https://cdn.linear.app/y/p.jpeg', title: null, source: 'issue' },
    ]);
  });

  test('extracts markdown images from the description (image-ext only)', () => {
    const issue = {
      description: 'Before ![diagram](https://uploads.linear.app/d.png) and a [doc](https://x/doc.pdf) link',
    };
    assert.deepEqual(collectTaskImages(issue), [
      { url: 'https://uploads.linear.app/d.png', title: 'diagram', source: 'issue' },
    ]);
  });

  test('extracts per-comment markdown images tagged source: comment', () => {
    const issue = { description: '' };
    const comments = [
      { body: 'see ![one](https://uploads.linear.app/c1.png)' },
      { body: 'no images here' },
      { body: '![two](https://uploads.linear.app/c2.webp)' },
    ];
    assert.deepEqual(collectTaskImages(issue, comments), [
      { url: 'https://uploads.linear.app/c1.png', title: 'one', source: 'comment' },
      { url: 'https://uploads.linear.app/c2.webp', title: 'two', source: 'comment' },
    ]);
  });

  test('de-dupes by URL, keeping the first (issue-level) occurrence', () => {
    const issue = {
      attachments: { nodes: [{ id: 'a1', title: 'Formal', url: 'https://uploads.linear.app/dup.png' }] },
      description: '![desc dup](https://uploads.linear.app/dup.png)',
    };
    const comments = [{ body: '![comment dup](https://uploads.linear.app/dup.png)' }];
    const images = collectTaskImages(issue, comments);
    assert.equal(images.length, 1);
    assert.deepEqual(images[0], { url: 'https://uploads.linear.app/dup.png', title: 'Formal', source: 'issue' });
  });

  test('orders issue-level (formal then description) ahead of comment images', () => {
    const issue = {
      attachments: { nodes: [{ id: 'a1', title: 'F', url: 'https://uploads.linear.app/f.png' }] },
      description: '![D](https://uploads.linear.app/d.png)',
    };
    const comments = [{ body: '![C](https://uploads.linear.app/c.png)' }];
    assert.deepEqual(collectTaskImages(issue, comments).map(i => i.source), ['issue', 'issue', 'comment']);
  });

  test('tolerates absent fields and odd comment shapes', () => {
    assert.deepEqual(collectTaskImages({}), []);
    assert.deepEqual(collectTaskImages({ description: null }, [null, {}, { body: 42 }]), []);
  });
});
