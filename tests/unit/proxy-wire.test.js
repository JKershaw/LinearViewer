/**
 * Unit tests for the proxy wire-contract neutralization (LIN-310).
 *
 * These pin the source-neutral wire shape: nested collections flatten to plain
 * arrays, labels become plain name strings, and backend deep-link URLs are
 * dropped — while opaque ids/identifiers are preserved untouched.
 *
 * Run with: node --test tests/unit/proxy-wire.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  flattenIssue,
  neutralizeProject,
  flattenCycle,
  flattenRelations,
  collectIssueAttachments,
  encodeAttachmentHandle,
  decodeAttachmentHandle,
  relayContentTypeFromName,
  GITHUB_UPLOAD_HOSTS,
} from '../../lib/proxy-wire.js';

// Helper: pull the `#name=` filename hint a non-image file handle carries.
function nameHintOf(handle) {
  const { value } = decodeAttachmentHandle(handle);
  const hash = value.includes('#') ? value.slice(value.indexOf('#') + 1) : '';
  return new URLSearchParams(hash).get('name');
}

describe('flattenIssue', () => {
  test('flattens labels {nodes} to a plain array of names', () => {
    const issue = { id: 'i1', labels: { nodes: [{ id: 'l1', name: 'bug', color: '#f00' }, { id: 'l2', name: 'urgent' }] } };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.labels, ['bug', 'urgent']);
  });

  test('flattens children {nodes} to a plain array and neutralizes each child', () => {
    const issue = {
      id: 'i1',
      children: { nodes: [{ id: 'c1', identifier: 'LIN-2', title: 'sub', url: 'https://linear.app/x', labels: { nodes: [{ name: 'bug' }] } }] }
    };
    flattenIssue(issue);
    assert.ok(Array.isArray(issue.children));
    assert.strictEqual(issue.children[0].identifier, 'LIN-2');
    assert.strictEqual('url' in issue.children[0], false, 'child url dropped');
    assert.deepStrictEqual(issue.children[0].labels, ['bug'], 'child labels flattened');
  });

  test('flattens comments / relations / inverseRelations {nodes} to plain arrays', () => {
    const issue = {
      id: 'i1',
      comments: { nodes: [{ id: 'm1', body: 'hi' }] },
      relations: { nodes: [{ id: 'r1', type: 'blocks', relatedIssue: { identifier: 'LIN-9' } }] },
      inverseRelations: { nodes: [{ id: 'r2', type: 'blocks', issue: { identifier: 'LIN-7' } }] }
    };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.comments, [{ id: 'm1', body: 'hi' }]);
    assert.strictEqual(issue.relations[0].relatedIssue.identifier, 'LIN-9');
    assert.strictEqual(issue.inverseRelations[0].issue.identifier, 'LIN-7');
  });

  test('derives a flat teamId from the nested team object, keeping team (LIN-589)', () => {
    const issue = { id: 'i1', team: { id: 'team-uuid', name: 'Engineering' } };
    flattenIssue(issue);
    assert.strictEqual(issue.teamId, 'team-uuid');
    assert.deepStrictEqual(issue.team, { id: 'team-uuid', name: 'Engineering' });
  });

  test('teamId is null when team came back null, and absent when team unselected (LIN-589)', () => {
    const withNull = { id: 'i1', team: null };
    flattenIssue(withNull);
    assert.strictEqual(withNull.teamId, null);

    const withoutTeam = { id: 'i2' };
    flattenIssue(withoutTeam);
    assert.strictEqual('teamId' in withoutTeam, false);
  });

  test('derives teamId on nested children too (one shared pass) (LIN-589)', () => {
    const issue = { id: 'i1', children: { nodes: [{ id: 'c1', team: { id: 't9', name: 'Ops' } }] } };
    flattenIssue(issue);
    assert.strictEqual(issue.children[0].teamId, 't9');
  });

  test('drops the backend url but preserves opaque id and identifier', () => {
    const issue = { id: 'uuid-1', identifier: 'LIN-123', url: 'https://linear.app/org/issue/LIN-123' };
    flattenIssue(issue);
    assert.strictEqual('url' in issue, false);
    assert.strictEqual(issue.id, 'uuid-1');
    assert.strictEqual(issue.identifier, 'LIN-123');
  });

  test('is defensive: leaves absent collections absent, tolerates already-flat input', () => {
    const issue = { id: 'i1', labels: ['bug'], state: { name: 'Todo', type: 'unstarted' } };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.labels, ['bug']);
    assert.strictEqual('children' in issue, false);
    assert.deepStrictEqual(issue.state, { name: 'Todo', type: 'unstarted' });
  });

  test('is idempotent', () => {
    const issue = { id: 'i1', labels: { nodes: [{ name: 'bug' }] }, comments: { nodes: [{ id: 'm1' }] } };
    flattenIssue(issue);
    const once = JSON.parse(JSON.stringify(issue));
    flattenIssue(issue);
    assert.deepStrictEqual(issue, once);
  });

  test('returns non-objects unchanged', () => {
    assert.strictEqual(flattenIssue(null), null);
    assert.strictEqual(flattenIssue(undefined), undefined);
  });
});

describe('flattenIssue attachments (LIN-649)', () => {
  test('maps formal Linear attachment nodes to the canonical shape, dropping url', () => {
    const issue = {
      id: 'i1',
      description: '',
      attachments: { nodes: [
        { id: 'att-1', title: 'screenshot', url: 'https://uploads.linear.app/a/b.png' },
        { id: 'att-2', title: 'spec', url: 'https://example.com/spec.pdf' },
      ] },
    };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.attachments, [
      { id: 'att:att-1', title: 'screenshot', contentType: 'image/png', kind: 'image' },
      { id: 'att:att-2', title: 'spec', contentType: null, kind: 'file' },
    ]);
    // No backend url leaks onto any attachment.
    assert.ok(issue.attachments.every(a => !('url' in a)), 'no url on attachments');
  });

  test('extracts a markdown-embedded image from the description (host-anchored, LIN-770)', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      description: 'before ![pasted](https://uploads.linear.app/x/shot.jpg) and a [link](https://example.com/page) after',
    };
    flattenIssue(issue);
    assert.strictEqual(issue.attachments.length, 1, 'only the upload-host image, not the off-host link');
    const [att] = issue.attachments;
    assert.strictEqual(att.kind, 'image');
    assert.strictEqual(att.contentType, null, 'discovery never types; the relay is the type-gate');
    assert.strictEqual(att.title, 'pasted');
    // The id is an opaque handle whose url round-trips, now carrying the #name hint.
    const decoded = decodeAttachmentHandle(att.id);
    assert.strictEqual(decoded.type, 'md');
    assert.ok(decoded.value.startsWith('https://uploads.linear.app/x/shot.jpg'));
    assert.strictEqual(nameHintOf(att.id), 'pasted', 'images carry the #name= hint too');
  });

  test('attaches per-comment markdown images under each comment', () => {
    const issue = {
      id: 'i1',
      comments: { nodes: [
        { id: 'm1', body: 'see ![](https://uploads.linear.app/c/one.png)' },
        { id: 'm2', body: 'no images here' },
      ] },
    };
    flattenIssue(issue);
    assert.strictEqual(issue.comments[0].attachments.length, 1);
    assert.strictEqual(issue.comments[0].attachments[0].kind, 'image');
    assert.strictEqual('attachments' in issue.comments[1], false, 'no attachments key when comment has no images');
  });

  test('omits the attachments field entirely when nothing is attached (parity)', () => {
    const issue = { id: 'i1', description: 'plain text, no images', attachments: { nodes: [] } };
    flattenIssue(issue);
    assert.strictEqual('attachments' in issue, false, 'empty ⇒ field absent, not []');
  });

  test('issue-list parity: an issue with no attachments connection is untouched', () => {
    // The list read does not select `attachments`; flattenIssue must not invent it
    // even if the description contains a markdown image.
    const issue = { id: 'i1', description: '![x](https://uploads.linear.app/x.png)' };
    flattenIssue(issue);
    assert.strictEqual('attachments' in issue, false);
  });

  test('attachment normalization is idempotent', () => {
    const issue = {
      id: 'i1',
      description: '![a](https://uploads.linear.app/a.png)',
      attachments: { nodes: [{ id: 'att-1', title: 't', url: 'https://uploads.linear.app/b.gif' }] },
    };
    flattenIssue(issue);
    const once = JSON.parse(JSON.stringify(issue));
    flattenIssue(issue);
    assert.deepStrictEqual(issue, once);
  });
});

describe('flattenIssue non-image file attachments (LIN-750)', () => {
  test('captures a non-image upload link in the description as kind:file', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      description: 'spec: [theme-design.md](https://uploads.linear.app/a/b/c) here',
    };
    flattenIssue(issue);
    assert.strictEqual(issue.attachments.length, 1);
    const [att] = issue.attachments;
    assert.strictEqual(att.kind, 'file');
    assert.strictEqual(att.contentType, null, 'extension-less upload → type unknown at discovery');
    assert.strictEqual(att.title, 'theme-design.md');
    // md: handle round-trips to the url and carries the filename hint.
    const decoded = decodeAttachmentHandle(att.id);
    assert.strictEqual(decoded.type, 'md');
    assert.ok(decoded.value.startsWith('https://uploads.linear.app/a/b/c'));
    assert.strictEqual(nameHintOf(att.id), 'theme-design.md');
  });

  test('captures non-image file links in comment bodies too', () => {
    const issue = {
      id: 'i1',
      comments: { nodes: [
        { id: 'm1', body: 'code: [AgentRuns.jsx](https://uploads.linear.app/x/y/z)' },
        { id: 'm2', body: 'nothing attached' },
      ] },
    };
    flattenIssue(issue);
    assert.strictEqual(issue.comments[0].attachments.length, 1);
    assert.strictEqual(issue.comments[0].attachments[0].kind, 'file');
    assert.strictEqual(issue.comments[0].attachments[0].title, 'AgentRuns.jsx');
    assert.strictEqual('attachments' in issue.comments[1], false);
  });

  test('does NOT double-capture image embeds or off-host links', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      description: [
        '![shot](https://uploads.linear.app/x/shot.jpg)',     // image embed → image path only
        '[external](https://example.com/page)',               // not an upload host → skipped
        '[doc](https://uploads.linear.app/u/spec.md)',        // upload file link → captured
      ].join('\n'),
    };
    flattenIssue(issue);
    const kinds = issue.attachments.map(a => `${a.kind}:${a.title}`).sort();
    assert.deepStrictEqual(kinds, ['file:doc', 'image:shot'], 'image once, file once, external never');
  });

  test('omits the attachments field when only off-host links are present (parity)', () => {
    const issue = { id: 'i1', attachments: { nodes: [] }, description: '[x](https://example.com/a)' };
    flattenIssue(issue);
    assert.strictEqual('attachments' in issue, false, 'empty ⇒ field absent, not []');
  });

  test('non-image file discovery is idempotent', () => {
    const issue = {
      id: 'i1',
      description: '[spec.md](https://uploads.linear.app/u/spec)',
      attachments: { nodes: [] },
    };
    flattenIssue(issue);
    const once = JSON.parse(JSON.stringify(issue));
    flattenIssue(issue);
    assert.deepStrictEqual(issue, once);
  });
});

describe('host-anchored inline-upload discovery (LIN-770)', () => {
  // Discovery is keyed on the URL HOST, not the file extension or markdown form.
  test('surfaces an extension-less image embed (no .jpg in the URL)', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      // The image upload URL is extension-less — the old image-ext filter dropped it.
      description: '![Screenshot 2026.jpg](https://uploads.linear.app/a/b/4f3c-uuid)',
    };
    flattenIssue(issue);
    assert.strictEqual(issue.attachments.length, 1, 'extension-less image embed is surfaced');
    const [att] = issue.attachments;
    assert.strictEqual(att.kind, 'image', 'kind comes from the leading `!`, not the URL');
    assert.strictEqual(att.contentType, null);
    assert.strictEqual(att.title, 'Screenshot 2026.jpg');
    assert.strictEqual(nameHintOf(att.id), 'Screenshot 2026.jpg', 'filename hint carried for typing');
    assert.strictEqual(decodeAttachmentHandle(att.id).value.split('#')[0], 'https://uploads.linear.app/a/b/4f3c-uuid');
  });

  test('surfaces an angle-bracket-wrapped URL `[label](<url>)` (the .jsx case)', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      // `(<url>)` made the old `new URL()` throw and the link was dropped.
      description: '[AgentRuns.jsx](<https://uploads.linear.app/x/y/9a2b-uuid>)',
    };
    flattenIssue(issue);
    assert.strictEqual(issue.attachments.length, 1, 'angle-bracket-wrapped URL is surfaced');
    const [att] = issue.attachments;
    assert.strictEqual(att.kind, 'file');
    assert.strictEqual(att.contentType, null);
    assert.strictEqual(att.title, 'AgentRuns.jsx');
    // The `<>` are stripped before encoding, so the handle round-trips to a clean URL.
    assert.strictEqual(
      decodeAttachmentHandle(att.id).value.split('#')[0],
      'https://uploads.linear.app/x/y/9a2b-uuid',
      'surrounding angle brackets stripped from the captured URL',
    );
    assert.strictEqual(nameHintOf(att.id), 'AgentRuns.jsx');
  });

  test('image syntax on a non-image upload keeps kind:image (form, not extension)', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      // `![]()` used on a PDF: discovery preserves the leading-mark kind and never
      // rejects on extension — the relay is the sole type-gate downstream.
      description: '![report.pdf](https://uploads.linear.app/p/d/c1d2-uuid)',
    };
    flattenIssue(issue);
    assert.strictEqual(issue.attachments.length, 1);
    const [att] = issue.attachments;
    assert.strictEqual(att.kind, 'image', 'kind follows the `!` mark, not the .pdf');
    assert.strictEqual(att.contentType, null);
    assert.strictEqual(att.title, 'report.pdf');
  });

  test('LIN-748 regression: all 4 inline uploads are surfaced (was 2)', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      description: [
        '[theme-design.md](https://uploads.linear.app/a/1)',            // clean .md link
        '[notes.md](https://uploads.linear.app/a/2)',                   // clean .md link
        '![Screenshot 2026.jpg](https://uploads.linear.app/a/3-uuid)',  // extension-less image embed (was MISSED)
        '[AgentRuns.jsx](<https://uploads.linear.app/a/4-uuid>)',       // angle-bracket-wrapped URL (was MISSED)
        '[external](https://example.com/page)',                         // off-host → never an attachment
      ].join('\n'),
    };
    flattenIssue(issue);
    assert.strictEqual(issue.attachments.length, 4, 'all 4 uploads surfaced, off-host link excluded');
    const summary = issue.attachments.map(a => `${a.kind}:${a.title}`);
    assert.deepStrictEqual(summary, [
      'file:theme-design.md',
      'file:notes.md',
      'image:Screenshot 2026.jpg',
      'file:AgentRuns.jsx',
    ], 'document order preserved; image embed not double-captured as a file');
    assert.ok(issue.attachments.every(a => a.contentType === null), 'discovery never types');
  });
});

describe('collectIssueAttachments — pure provider-agnostic collector (LIN-771)', () => {
  test('combines formal nodes + description uploads into the canonical array', () => {
    const atts = collectIssueAttachments({
      description: 'see ![pasted](https://uploads.linear.app/x/shot.jpg)',
      formalAttachmentNodes: { nodes: [
        { id: 'att-1', title: 'spec', url: 'https://uploads.linear.app/a/b.png' },
      ] },
    });
    assert.strictEqual(atts.length, 2);
    assert.strictEqual(atts[0].id, 'att:att-1', 'formal node first, in document order');
    assert.strictEqual(atts[1].kind, 'image');
    assert.strictEqual(atts[1].title, 'pasted');
  });

  test('accepts a flat array of formal nodes as well as a {nodes} connection', () => {
    const flat = collectIssueAttachments({ formalAttachmentNodes: [
      { id: 'att-9', title: 't', url: 'https://uploads.linear.app/b.gif' },
    ] });
    assert.deepStrictEqual(flat, [
      { id: 'att:att-9', title: 't', contentType: 'image/gif', kind: 'image' },
    ]);
  });

  test('folds comment-body uploads in when comments are passed (the S3 aggregate path)', () => {
    const atts = collectIssueAttachments({
      description: '![d](https://uploads.linear.app/d.png)',
      comments: [
        { id: 'm1', body: 'in a comment: [doc](https://uploads.linear.app/u/spec.md)' },
        { id: 'm2', body: 'no uploads here' },
        null, // tolerated
      ],
    });
    const summary = atts.map(a => `${a.kind}:${a.title}`);
    assert.deepStrictEqual(summary, ['image:d', 'file:doc']);
  });

  test('is pure: no inputs ⇒ empty array, and it never throws on partial input', () => {
    assert.deepStrictEqual(collectIssueAttachments(), []);
    assert.deepStrictEqual(collectIssueAttachments({}), []);
    assert.deepStrictEqual(collectIssueAttachments({ description: 'plain' }), []);
  });

  test('is provider-agnostic: discovers GitHub user-content uploads through the same path', () => {
    const atts = collectIssueAttachments({
      description: 'pasted ![grab](https://user-images.githubusercontent.com/1/abc.png) here',
    });
    assert.strictEqual(atts.length, 1, 'GitHub asset host is discovered like a Linear one');
    assert.strictEqual(atts[0].kind, 'image');
    const decoded = decodeAttachmentHandle(atts[0].id);
    assert.ok(decoded.value.startsWith('https://user-images.githubusercontent.com/1/abc.png'));
  });
});

describe('host-anchored discovery is provider-aware via the host union (LIN-771)', () => {
  test('surfaces uploads on every GitHub asset host in UPLOAD_HOSTS', () => {
    for (const host of GITHUB_UPLOAD_HOSTS) {
      const issue = {
        id: 'i1',
        attachments: { nodes: [] },
        description: `![g](https://${host}/owner/repo/file.png)`,
      };
      flattenIssue(issue);
      assert.strictEqual(issue.attachments?.length, 1, `discovered on ${host}`);
      assert.strictEqual(issue.attachments[0].kind, 'image');
    }
  });

  test('does NOT treat bare github.com links as uploads (cross-ref, not attachment)', () => {
    const issue = {
      id: 'i1',
      attachments: { nodes: [] },
      description: 'fixes [#5](https://github.com/owner/repo/issues/5)',
    };
    flattenIssue(issue);
    assert.strictEqual('attachments' in issue, false, 'github.com cross-ref is never an upload');
  });

  test('GITHUB_UPLOAD_HOSTS holds only dedicated *.githubusercontent.com asset hosts', () => {
    assert.ok(GITHUB_UPLOAD_HOSTS.length >= 1);
    assert.ok(
      GITHUB_UPLOAD_HOSTS.every(h => h.endsWith('.githubusercontent.com')),
      'only dedicated asset hosts — never bare github.com',
    );
  });
});

describe('relayContentTypeFromName (LIN-750)', () => {
  test('types images and the text/source allowlist; rejects the rest', () => {
    assert.strictEqual(relayContentTypeFromName('theme-design.md'), 'text/markdown');
    assert.strictEqual(relayContentTypeFromName('AgentRuns.jsx'), 'text/plain');
    assert.strictEqual(relayContentTypeFromName('data.json'), 'application/json');
    assert.strictEqual(relayContentTypeFromName('shot.png'), 'image/png');
    assert.strictEqual(relayContentTypeFromName('archive.zip'), null, 'not on the allowlist');
    assert.strictEqual(relayContentTypeFromName('noextension'), null);
    assert.strictEqual(relayContentTypeFromName(null), null);
  });
});

describe('attachment handle encode/decode (LIN-649)', () => {
  test('att handles carry the raw opaque id', () => {
    assert.strictEqual(encodeAttachmentHandle('att', 'abc-123'), 'att:abc-123');
    assert.deepStrictEqual(decodeAttachmentHandle('att:abc-123'), { type: 'att', value: 'abc-123' });
  });

  test('md handles base64url-encode the url so no deep link is exposed', () => {
    const url = 'https://uploads.linear.app/x/y.png?sig=abc';
    const handle = encodeAttachmentHandle('md', url);
    assert.ok(!handle.includes('https://'), 'no readable url in the handle');
    assert.deepStrictEqual(decodeAttachmentHandle(handle), { type: 'md', value: url });
  });

  test('decode returns null for non-handles', () => {
    assert.strictEqual(decodeAttachmentHandle('not-a-handle'), null);
    assert.strictEqual(decodeAttachmentHandle(null), null);
  });
});

describe('neutralizeProject', () => {
  test('strips url, keeps the rest', () => {
    const p = { id: 'p1', name: 'Alpha', content: 'desc', url: 'https://linear.app/x' };
    neutralizeProject(p);
    assert.deepStrictEqual(p, { id: 'p1', name: 'Alpha', content: 'desc' });
  });
});

describe('flattenCycle', () => {
  test('flattens nested issues {nodes} and neutralizes each', () => {
    const cycle = {
      id: 'cy1', name: 'Cycle 12', number: 12,
      issues: { nodes: [{ id: 'i1', identifier: 'LIN-1', url: 'https://linear.app/x', labels: { nodes: [{ name: 'bug' }] } }] }
    };
    flattenCycle(cycle);
    assert.ok(Array.isArray(cycle.issues));
    assert.strictEqual(cycle.issues[0].identifier, 'LIN-1');
    assert.strictEqual('url' in cycle.issues[0], false);
    assert.deepStrictEqual(cycle.issues[0].labels, ['bug']);
  });
});

describe('flattenRelations', () => {
  test('returns both directions as plain arrays', () => {
    const issue = {
      relations: { nodes: [{ id: 'r1', type: 'blocks' }] },
      inverseRelations: { nodes: [{ id: 'r2', type: 'blocks' }] }
    };
    const out = flattenRelations(issue);
    assert.deepStrictEqual(out, {
      relations: [{ id: 'r1', type: 'blocks' }],
      inverseRelations: [{ id: 'r2', type: 'blocks' }]
    });
  });

  test('tolerates a missing issue / missing connections', () => {
    assert.deepStrictEqual(flattenRelations(null), { relations: [], inverseRelations: [] });
    assert.deepStrictEqual(flattenRelations({}), { relations: [], inverseRelations: [] });
  });
});
