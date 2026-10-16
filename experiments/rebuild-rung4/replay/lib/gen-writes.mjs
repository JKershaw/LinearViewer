// Scenario generator for routes/proxy-writes.js (createProxyWriteRoutes).
import { G } from './common.mjs';
import {
  ok, fail, sync, TEXTS, CONTROL, genProviderError, writeErrorExtras, genAuth, genAccess, genProviderBase,
  genRegistry, encodeBody, qs, unknownPairs, pathVariant, enc,
} from './gen-common.mjs';
import { WRITES_VARIANTS } from './fakes.mjs';

const U = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`; // stable uuids
const TEAM_ENG = U(101), TEAM_OPS = U(102), TEAM_DUP1 = U(103), TEAM_DUP2 = U(104);
const ST_DONE = U(201), ST_TODO = U(202), ST_PROG = U(203), ST_DUP1 = U(204), ST_DUP2 = U(205);
const PRJ_A = U(301), PRJ_B = U(302);
const LBL_BUG = U(401), LBL_FEAT = U(402), LBL_D1 = U(403), LBL_D2 = U(404), LBL_NEW = U(405);
const ISSUE_UUID = U(501);
const PERIODICAL_MARKER = '<!-- harbour-periodical-gate id="weekly-review" -->';
const EVIDENCE = 'Report: https://github.com/acme/repo/pull/12';
const ADVERSARIAL = 'Adversarial second-read verdict: AGREE\nDiffered from top finding: NO\nDisposition: no change';

export const ROUTE_KEYS = {
  create: 'POST /api/proxy/issues',
  update: 'PATCH /api/proxy/issues/:issueId',
  append: 'POST /api/proxy/issues/:issueId/description/append',
  replace: 'POST /api/proxy/issues/:issueId/description/replace',
  comment: 'POST /api/proxy/issues/:issueId/comments',
  commentAlias: 'POST /api/proxy/comments/:issueId',
  commentDelete: 'DELETE /api/proxy/issues/:issueId/comments/:commentId',
  commentUpdate: 'PATCH /api/proxy/issues/:issueId/comments/:commentId',
  attach: 'POST /api/proxy/issues/:issueId/attachments',
  relation: 'POST /api/proxy/issues/:issueId/relations',
  relationDelete: 'DELETE /api/proxy/issues/:issueId/relations/:relationId',
  labelAdd: 'POST /api/proxy/issues/:issueId/labels',
  labelRemove: 'DELETE /api/proxy/issues/:issueId/labels/:labelId',
  unmatched: '(unmatched)',
};

function issueId(g) {
  return g.weighted([
    ['LIN-12', 5], ['LIN-7', 3], [ISSUE_UUID, 3], ['%2355', 1], ['M5-100', 0.5],
    ['LIN_12', 0.5], ['bad%20id', 0.5], ['%E2%9C%93', 0.4], ['A'.repeat(101), 0.3], ['..', 0.2], ['-', 0.3], ['%00', 0.2], ['%E0%A4%A', 0.1],
  ]);
}

function teams() {
  return [
    { id: TEAM_ENG, key: 'ENG', name: 'Engineering' }, { id: TEAM_OPS, key: 'OPS', name: 'Ops' },
    { id: TEAM_DUP1, key: 'DUP', name: 'Dup A' }, { id: TEAM_DUP2, key: 'DUP2', name: 'dup' },
  ];
}
function states(extraId, extraType) {
  const s = [
    { id: ST_DONE, name: 'Done', type: 'completed' }, { id: ST_TODO, name: 'Todo', type: 'unstarted' },
    { id: ST_PROG, name: 'In Progress', type: 'started' }, { id: ST_DUP1, name: 'Review', type: 'started' },
    { id: ST_DUP2, name: 'Canceled', type: 'canceled' },
  ];
  if (extraId) s.push({ id: extraId, name: 'X', type: extraType });
  return s;
}
const PROJECTS = [{ id: PRJ_A, name: 'Roadmap' }, { id: PRJ_B, name: 'roadmap' }, { id: U(303), name: 'Ünï ✓' }];
const LABELS = [{ id: LBL_BUG, name: 'bug' }, { id: LBL_FEAT, name: 'Feature' }, { id: LBL_D1, name: 'dup' }, { id: LBL_D2, name: 'DUP' }, { id: LBL_NEW, name: 'new' }];

function issueObj(g, extra = {}) {
  return {
    id: ISSUE_UUID, identifier: 'LIN-12', title: g.pick(TEXTS),
    priority: g.pick([0, 2, 4, undefined]),
    labels: g.weighted([[{ nodes: [{ id: LBL_BUG, name: 'bug' }] }, 3], [undefined, 1], [null, 0.3]]),
    team: g.weighted([[{ id: TEAM_ENG, name: 'Eng' }, 3], [null, 1], [undefined, 1]]),
    ...extra,
  };
}

// A provider write result: {success, entity} envelope, a raw entity
// (normalizeWritePayload wraps it), a rejected write, null, or a throw.
function writeResult(g, entityKey, entity) {
  return g.weighted([
    [ok({ success: true, [entityKey]: entity }), 5],
    [ok(entity), 1.5],
    [ok({ success: false, [entityKey]: null }), 1],
    [ok(null), 0.6],
    [fail(genProviderError(g, writeErrorExtras(g))), 6],
  ]);
}

function guardResult(g, opts = {}) {
  return g.weighted([
    [ok({ id: ISSUE_UUID, team: { id: TEAM_ENG }, description: opts.description ?? 'Desc', comments: opts.comments ?? { nodes: [] } }), 8],
    [ok({ id: ISSUE_UUID, team: { id: TEAM_ENG }, trashed: true }), 1],
    [ok({ id: ISSUE_UUID, team: null, description: opts.description ?? '' }), 0.8],
    [ok(null), 0.6],
    [fail(genProviderError(g)), 0.5],
  ]);
}

function priorityVal(g) { return g.pick([0, 1, 2, 3, 4, 7, -1, 1.5, '2', null]); }

function optionalRefs(g, f, { create }) {
  if (g.chance(0.35)) f.projectId = g.weighted([[PRJ_A, 3], ['Ünï ✓', 1], ['roadmap', 1], ['nomatch', 1], ['linear:Ünï ✓', 0.5], ['github:x', 0.4], [PRJ_A.toUpperCase(), 0.3]]);
  if (g.chance(0.4)) f.stateId = g.weighted([[ST_PROG, 3], ['done', 2], ['todo', 1], ['In Progress', 1], ['started', 0.6], ['nomatch', 0.8], ['linear:done', 0.4], ['jira:done', 0.3]]);
  if (g.chance(0.3)) f.assigneeId = g.weighted([[U(601), 3], ['not-a-uuid', 1], [7, 0.3]]);
  if (g.chance(0.25)) f.parentId = g.pick(create ? [U(602), 'LIN-1'] : [U(602), 'LIN-1', null]);
  if (g.chance(0.2)) f.cycleId = g.pick([U(603), 'cycle-1']);
  const p = g.weighted([['none', 6], ['priority', 3], ['level', 2], ['both', 0.6]]);
  if (p === 'priority' || p === 'both') f.priority = priorityVal(g);
  if (p === 'level' || p === 'both') f.priorityLevel = priorityVal(g);
}

function title(g) {
  return g.weighted([[g.pick(TEXTS), 10], ['', 0.5], [undefined, 0.6], [123, 0.4], ['t'.repeat(1001), 0.4], [CONTROL, 0.4]]);
}
function description(g) {
  return g.weighted([[undefined, 4], ['Some *markdown*', 4], ['', 0.8], ['d'.repeat(100001), 0.3], [CONTROL, 0.4]]);
}

function refMethods(g, s, teamIdForStates) {
  s.provider.methods.fetchTeams = g.chance(0.08) ? fail(genProviderError(g)) : ok(teams());
  s.provider.methods.states = g.chance(0.08) ? fail(genProviderError(g)) : ok(states());
  s.provider.methods.fetchProjectsList = g.chance(0.06) ? fail(genProviderError(g)) : ok(PROJECTS);
  void teamIdForStates;
}

const ROUTES = {
  create(g, s) {
    s.method = 'POST';
    s.path = '/api/proxy/issues' + qs(unknownPairs(g));
    const f = {};
    const teamful = g.chance(0.8);
    const tm = g.weighted([['uuid', 4], ['key', 2], ['name', 1], ['ns', 0.6], ['badNs', 0.4], ['nomatch', 0.6], ['dup', 0.4], ['absent', 1], ['empty', 0.3], ['num', 0.3]]);
    if (tm === 'uuid') f.teamId = TEAM_ENG;
    if (tm === 'key') f.teamId = g.pick(['ENG', 'ops']);
    if (tm === 'name') f.teamId = 'Engineering';
    if (tm === 'ns') f.teamId = 'linear:ENG';
    if (tm === 'badNs') f.teamId = 'jira:ENG';
    if (tm === 'nomatch') f.teamId = 'NOPE';
    if (tm === 'dup') f.teamId = 'dup';
    if (tm === 'empty') f.teamId = '';
    if (tm === 'num') f.teamId = 42;
    f.title = title(g);
    f.description = description(g);
    optionalRefs(g, f, { create: true });
    s.body = encodeBody(g, f);
    s.provider.methods.createFields = g.chance(0.03) ? sync(fail({ kind: 'plain', message: 'createFields broke' })) : sync(ok(teamful ? ['teamId', 'title', 'description'] : ['title', 'description']));
    const writable = ['projectId', 'stateId', 'assigneeId', 'parentId', 'cycleId', 'priority'].filter(() => g.chance(0.65));
    s.provider.methods.apiWriteFields = sync(ok(writable));
    refMethods(g, s);
    s.provider.methods.createIssue = writeResult(g, 'issue', issueObj(g));
    return 'createIssue';
  },
  update(g, s) {
    s.method = 'PATCH';
    const id = issueId(g);
    s.path = `/api/proxy/issues/${id}` + qs([...(g.chance(0.2) ? [['source', g.pick(['linear', 'jira'])]] : []), ...unknownPairs(g)]);
    const f = {};
    if (g.chance(0.6)) f.title = title(g);
    if (g.chance(0.4)) f.description = g.weighted([['New body', 4], ['', 1], [CONTROL, 0.4], ['d'.repeat(100001), 0.3]]);
    optionalRefs(g, f, { create: false });
    if (g.chance(0.07)) { for (const k of Object.keys(f)) delete f[k]; } // wholly empty body
    if (g.chance(0.05)) { for (const k of Object.keys(f)) delete f[k]; f.assigneeId = 'not-a-uuid'; } // only dropped fields
    s.body = encodeBody(g, f);
    // Periodical review gate (LIN-694): marked description, evidence comments,
    // and a states() lookup that names the target state's type.
    const periodical = g.chance(0.45);
    const comments = g.weighted([[{ nodes: [] }, 2], [{ nodes: [{ body: EVIDENCE }] }, 2], [{ nodes: [{ body: EVIDENCE }, { body: ADVERSARIAL }] }, 2], [null, 0.5]]);
    s.provider.methods.issueWriteGuard = guardResult(g, { description: periodical ? `Weekly ${PERIODICAL_MARKER}` : 'Desc', comments });
    refMethods(g, s);
    if (periodical && g.chance(0.85)) {
      const stateRef = typeof f.stateId === 'string' && /^[0-9a-f-]{36}$/i.test(f.stateId) ? f.stateId : ST_DONE;
      const list = states(stateRef, g.pick(['completed', 'completed', 'started']));
      // seq: the first states() call may be resolveStateInput's (symbolic stateId)
      s.provider.methods.states = g.weighted([[ok(list), 5], [ok(null), 1], [fail(genProviderError(g)), 1.2], [{ seq: [ok(list), fail(genProviderError(g))] }, 1.5]]);
    }
    s.provider.methods.updateIssue = writeResult(g, 'issue', issueObj(g));
    s.provider.methods.fetchIssueContext = g.chance(0.85) ? ok({ id: ISSUE_UUID, state: { type: 'completed' } }) : fail({ kind: 'plain', message: 'readback failed' });
    return 'updateIssue';
  },
  append(g, s) { return descEdit(g, s, 'append'); },
  replace(g, s) { return descEdit(g, s, 'replace'); },
  comment(g, s) { return commentCreate(g, s, false); },
  commentAlias(g, s) { return commentCreate(g, s, true); },
  commentDelete(g, s) {
    s.method = 'DELETE';
    const cid = g.weighted([[U(701), 6], ['not-a-uuid', 1], ['%E2%9C%93', 0.3]]);
    s.path = `/api/proxy/issues/${issueId(g)}/comments/${cid}` + qs(unknownPairs(g));
    s.body = g.chance(0.9) ? { kind: 'none' } : encodeBody(g, { body: 'ignored' });
    s.provider.methods.deleteComment = g.weighted([[ok({ success: true }), 6], [ok({ success: false }), 1], [ok(null), 0.4], [ok(true), 0.3], [fail(genProviderError(g)), 1.2]]);
    return 'deleteComment';
  },
  commentUpdate(g, s) {
    s.method = 'PATCH';
    const cid = g.weighted([[U(702), 6], ['not-a-uuid', 1]]);
    s.path = `/api/proxy/issues/${issueId(g)}/comments/${cid}` + qs(unknownPairs(g));
    s.body = encodeBody(g, { body: commentBody(g) });
    s.provider.methods.updateComment = writeResult(g, 'comment', { id: U(702), body: 'edited' });
    return 'updateComment';
  },
  attach(g, s) {
    s.method = 'POST';
    s.path = `/api/proxy/issues/${issueId(g)}/attachments` + qs(unknownPairs(g));
    const target = g.weighted([[undefined, 4], ['comment', 2], ['description', 4], ['inline', 0.5], [7, 0.2]]);
    const longUrl = g.chance(0.4);
    const assetUrl = longUrl ? 'https://uploads.linear.app/' + 'a'.repeat(300) : 'https://uploads.linear.app/x/y.png';
    const cap = g.weighted([
      [undefined, 5], ['A caption ✓', 3], [123, 0.4], [CONTROL, 0.4],
      ['c'.repeat(49798), 1.6], // fits the 200-char reserve; overflows once a long assetUrl is embedded
      ['c'.repeat(49900), 0.5], // over the pre-upload budget
    ]);
    const img = g.weighted([
      ['png', 5], ['jpeg', 1], ['gif', 1], ['webp', 1], ['obj', 2], ['objNoName', 0.6], ['svg', 0.6], ['short', 0.4], ['nobase64', 0.4],
      ['garbage', 0.4], ['missing', 0.8], ['num', 0.2], ['objNoData', 0.3], ['huge', 0.2], ['over14mb', 0.3],
    ]);
    const f = { target, body: cap };
    let bodyKind = 'json';
    if (img === 'huge' || img === 'over14mb') {
      // 10MB+1 decoded bytes (route 413) or a body past the route's 14mb parser.
      s.body = { kind: 'bigImage', bytes: img === 'huge' ? 10 * 1024 * 1024 + 1 : 11 * 1024 * 1024, fields: { target, body: typeof cap === 'string' ? cap.slice(0, 20) : cap }, contentType: 'text/plain' };
      bodyKind = 'big';
    } else {
      f.image = imageValue(g, img);
    }
    if (bodyKind === 'json') {
      const e = g.weighted([['json', 8], ['text', 2], ['other', 0.6]]);
      if (e === 'json') s.body = encodeBody(g, f, { allowForm: false, rates: { oversized: 1.2 } });
      else if (e === 'text') s.body = { kind: 'text', text: JSON.stringify(f), contentType: 'text/plain' }; // the route's own parser takes it
      else s.body = { kind: 'text', text: JSON.stringify(f), contentType: 'application/octet-stream' };
    }
    s.provider.methods.issueWriteGuard = guardResult(g);
    const curLen = g.weighted([[0, 2], [40, 4], [99700, 1.2], [99990, 1]]);
    const desc = { id: ISSUE_UUID, description: curLen ? 'x'.repeat(curLen) : g.pick(['', null]), trashed: g.chance(0.05) ? true : undefined };
    s.provider.methods.issueDescription = g.weighted([[{ seq: [ok(desc), ok(desc)] }, 7], [ok(null), 1.2], [{ seq: [ok(desc), ok(null)] }, 0.4], [fail(genProviderError(g)), 0.5]]);
    s.provider.methods.uploadFile = g.chance(0.9) ? ok(assetUrl) : fail(genProviderError(g));
    s.provider.methods.createComment = writeResult(g, 'comment', { id: U(703), body: 'img' });
    s.provider.methods.updateIssue = writeResult(g, 'issue', issueObj(g));
    if (g.chance(0.04)) s.unsupportedExtra = target === 'description' ? 'updateIssue' : 'createComment';
    return 'uploadFile';
  },
  relation(g, s) {
    s.method = 'POST';
    s.path = `/api/proxy/issues/${issueId(g)}/relations` + qs(unknownPairs(g));
    const f = {
      type: g.weighted([['blocks', 3], ['blocked-by', 2], ['duplicate', 2], ['related', 2], ['parent', 0.5], [undefined, 0.5], ['', 0.3], [1, 0.2]]),
      relatedIssueId: g.weighted([['LIN-99', 6], [U(801), 2], [undefined, 0.6], ['bad id', 0.5], [12, 0.2]]),
    };
    s.body = encodeBody(g, f);
    s.provider.methods.issueWriteGuard = guardResult(g);
    s.provider.methods.createRelation = writeResult(g, 'issueRelation', { id: U(802), type: f.type });
    s.provider.methods.fetchIssueContext = g.chance(0.85) ? ok({ id: ISSUE_UUID, state: { type: 'canceled' } }) : fail({ kind: 'plain', message: 'readback failed' });
    return 'createRelation';
  },
  relationDelete(g, s) {
    s.method = 'DELETE';
    const rid = g.weighted([[U(803), 6], ['nope', 1]]);
    s.path = `/api/proxy/issues/${issueId(g)}/relations/${rid}` + qs(unknownPairs(g));
    s.body = { kind: 'none' };
    s.provider.methods.deleteRelation = g.weighted([[ok({ success: true }), 6], [ok({ success: false }), 1], [ok(null), 0.4], [fail(genProviderError(g)), 1.2]]);
    return 'deleteRelation';
  },
  labelAdd(g, s) {
    s.method = 'POST';
    s.path = `/api/proxy/issues/${issueId(g)}/labels` + qs(unknownPairs(g));
    const labelId = g.weighted([[LBL_NEW, 3], [LBL_BUG, 2], ['bug', 2], ['feature', 1], ['dup', 0.6], ['nomatch', 0.6], ['linear:bug', 0.4], ['github:bug', 0.3], [undefined, 0.5], ['', 0.3], [5, 0.3]]);
    s.body = encodeBody(g, { labelId });
    labelWorld(g, s);
    return 'addLabel';
  },
  labelRemove(g, s) {
    s.method = 'DELETE';
    const labelId = g.weighted([[LBL_BUG, 4], [LBL_NEW, 2], ['bug', 2], ['dup', 0.5], ['nomatch', 0.5], ['linear:bug', 0.3], ['%C3%BCn%C3%AF', 0.3]]);
    s.path = `/api/proxy/issues/${issueId(g)}/labels/${labelId}` + qs(unknownPairs(g));
    s.body = { kind: 'none' };
    labelWorld(g, s);
    return 'removeLabel';
  },
  unmatched(g, s) {
    const [m, p] = g.pick([
      ['GET', '/api/proxy/issues/LIN-1/comments'], ['PUT', '/api/proxy/issues/LIN-1'], ['POST', '/api/proxy/issues/LIN-1/labels/x'],
      ['DELETE', '/api/proxy/issues/LIN-1/comments'], ['POST', '/api/proxy/issues/LIN-1/description'], ['PATCH', '/api/proxy/comments/LIN-1'],
      ['DELETE', '/api/proxy/issues/LIN-1'], ['POST', '/api/proxy/comments/'],
    ]);
    s.method = m;
    s.path = p;
    s.body = g.chance(0.5) ? { kind: 'none' } : encodeBody(g, { body: 'x' });
    return null;
  },
};

function commentBody(g) {
  return g.weighted([
    ['lgtm', 4], ['Ünï ✓ comment', 2], ['see attached', 2], ['', 0.4], [undefined, 0.5], [42, 0.3], [CONTROL, 0.4],
    ['b'.repeat(50001), 0.3], [CONTROL + 'b'.repeat(50001), 0.15],
  ]);
}

function commentCreate(g, s, alias) {
  s.method = 'POST';
  // small pools of (urlKey, issueId, body) so the real dedupe cache sees repeats
  const id = g.chance(0.85) ? g.pick(['LIN-12', 'LIN-7', ISSUE_UUID]) : issueId(g);
  s.path = (alias ? `/api/proxy/comments/${id}` : `/api/proxy/issues/${id}/comments`) + qs(unknownPairs(g));
  s.body = encodeBody(g, { body: commentBody(g) });
  s.provider.methods.issueWriteGuard = guardResult(g);
  s.provider.methods.createComment = writeResult(g, 'comment', { id: g.pick([U(704), U(705)]), body: 'c' });
  if (g.chance(0.15)) s.provider.methods.createComment = ok({ success: true, comment: { body: 'no id' } });
  return 'createComment';
}

function descEdit(g, s, kind) {
  s.method = 'POST';
  s.path = `/api/proxy/issues/${issueId(g)}/description/${kind}` + qs([...(g.chance(0.15) ? [['source', 'linear']] : []), ...unknownPairs(g)]);
  const current = g.weighted([['Intro\nfoo bar\nend', 5], ['dup dup', 1.2], ['', 1], [null, 0.5], ['x'.repeat(99995), 0.8], [`ok ${CONTROL}`, 1], ['with \\_escaped\\_ text', 0.5]]);
  if (kind === 'append') {
    s.body = encodeBody(g, { block: g.weighted([['## Added ✓', 6], ['', 0.4], [undefined, 0.5], [9, 0.3], ['b'.repeat(100001), 0.3], [CONTROL, 0.4], ['b'.repeat(20), 0.3]]) });
  } else {
    s.body = encodeBody(g, {
      oldString: g.weighted([['foo bar', 4], ['dup', 1.2], ['missing span', 1], ['_escaped_', 0.5], ['', 0.4], [undefined, 0.4], [3, 0.2]]),
      newString: g.weighted([['baz ✓', 5], ['', 1], [undefined, 0.4], [4, 0.2], ['n'.repeat(100001), 0.3], [CONTROL, 0.4], ['n'.repeat(120), 0.4]]),
    });
  }
  s.provider.methods.issueDescription = g.weighted([
    [ok({ id: ISSUE_UUID, description: current }), 8], [ok({ id: ISSUE_UUID, description: 'gone', trashed: true }), 0.8], [ok(null), 0.6],
    [fail(genProviderError(g)), 1],
  ]);
  s.provider.methods.updateIssue = writeResult(g, 'issue', issueObj(g));
  return 'updateIssue';
}

function labelWorld(g, s) {
  s.provider.methods.labels = g.chance(0.07) ? fail(genProviderError(g)) : ok(LABELS);
  const current = g.weighted([[[{ id: LBL_BUG, name: 'bug' }], 4], [[], 2], [[{ id: LBL_BUG }, { id: LBL_NEW }], 2]]);
  s.provider.methods.issueLabels = g.weighted([
    [ok({ id: ISSUE_UUID, labels: { nodes: current } }), 8], [ok({ id: ISSUE_UUID, labels: null }), 0.5], [ok({ id: ISSUE_UUID, trashed: true, labels: { nodes: [] } }), 0.8],
    [ok(null), 0.6], [fail(genProviderError(g)), 0.8],
  ]);
  s.provider.methods.updateIssueLabels = g.weighted([[ok({ success: true, issue: issueObj(g) }), 6], [ok({ success: false }), 0.8], [ok(null), 0.4], [fail(genProviderError(g, writeErrorExtras(g))), 1]]);
}

function imageValue(g, kind) {
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, g.int(0, 255)];
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1];
  const gif = [...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0];
  const webp = [...Buffer.from('RIFF'), 9, 0, 0, 0, ...Buffer.from('WEBPVP8 ')];
  switch (kind) {
    case 'png': return `data:image/png;base64,${b64(png)}`;
    case 'jpeg': return `data:image/jpeg;base64,${b64(jpeg)}`;
    case 'gif': return `data:image/gif;base64,${b64(gif)}`;
    case 'webp': return `data:;base64,${b64(webp)}`;
    case 'obj': return { data: b64(png), contentType: 'image/svg+xml', filename: g.pick(['shot.png', 'ünï ✓.png', '../x.png']) };
    case 'objNoName': return { data: b64(jpeg) };
    case 'svg': return `data:image/svg+xml;base64,${b64(Buffer.from('<svg onload=alert(1)></svg>'))}`;
    case 'short': return `data:image/png;base64,${b64(png.slice(0, 8))}`;
    case 'nobase64': return 'data:image/png,%89PNG';
    case 'garbage': return 'not a data url';
    case 'num': return 12345;
    case 'objNoData': return { contentType: 'image/png' };
    case 'missing': default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Stratified outcome intents. Requests rotate through the 13 URL forms; within
// a form they rotate through INTENTS. A non-'free' intent first canonicalizes
// the request (valid path/body, healthy auth/access/pre-reads) so it reaches
// the form's primary provider call, then forces one outcome — so every
// reachable (status, logEvent status) pair is hit several times per run.
// ---------------------------------------------------------------------------
const ROUTE_ORDER = ['create', 'update', 'append', 'replace', 'comment', 'commentAlias', 'commentDelete', 'commentUpdate', 'attach', 'relation', 'relationDelete', 'labelAdd', 'labelRemove'];
// 40 slots: 225 requests per form at n=3000 hit every intent >= 5 times.
const INTENTS = [
  'free', 'err401', 'attachLong', 'err404', 'attachEmbed', 'err429', 'free', 'err500', 'free', 'err504', 'free', 'err400', 'free', 'errNull',
  'free', 'err503', 'free', 'errRef', 'free', 'errPartial', 'free', 'rejected', 'free', 'limiter', 'free', 'malformed', 'free',
  'oversized', 'free', 'authFail', 'free', 'readScope', 'free', 'noToken', 'free', 'unsupported', 'attachDesc', 'trashed', 'dedupeHit', 'hugeImage',
];
const TRASHED_READ = { update: 'issueWriteGuard', append: 'issueDescription', replace: 'issueDescription', comment: 'issueWriteGuard', commentAlias: 'issueWriteGuard', attach: 'issueWriteGuard', relation: 'issueWriteGuard', labelAdd: 'issueLabels', labelRemove: 'issueLabels' };
const PNG_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]).toString('base64')}`;

const CANON = {
  create(g, s) {
    s.path = '/api/proxy/issues';
    s.body = { kind: 'json', value: { teamId: TEAM_ENG, title: 'Fix login bug', description: 'd' } };
    s.provider.methods.createFields = sync(ok(['teamId', 'title', 'description']));
    s.provider.methods.apiWriteFields = sync(ok(['projectId', 'stateId', 'assigneeId', 'parentId', 'cycleId', 'priority']));
    return 'createIssue';
  },
  update(g, s) {
    s.path = '/api/proxy/issues/LIN-12';
    s.body = { kind: 'json', value: { title: 'New title', stateId: ST_PROG } };
    s.provider.methods.issueWriteGuard = ok({ id: ISSUE_UUID, team: { id: TEAM_ENG }, description: 'Desc', comments: { nodes: [] } });
    return 'updateIssue';
  },
  append(g, s) {
    s.path = '/api/proxy/issues/LIN-12/description/append';
    s.body = { kind: 'json', value: { block: '## Added' } };
    s.provider.methods.issueDescription = ok({ id: ISSUE_UUID, description: 'Intro' });
    return 'updateIssue';
  },
  replace(g, s) {
    s.path = '/api/proxy/issues/LIN-12/description/replace';
    s.body = { kind: 'json', value: { oldString: 'foo bar', newString: 'baz' } };
    s.provider.methods.issueDescription = ok({ id: ISSUE_UUID, description: 'Intro\nfoo bar\nend' });
    return 'updateIssue';
  },
  comment(g, s) { return canonComment(g, s, '/api/proxy/issues/LIN-12/comments'); },
  commentAlias(g, s) { return canonComment(g, s, '/api/proxy/comments/LIN-12'); },
  commentDelete(g, s) { s.path = `/api/proxy/issues/LIN-12/comments/${U(701)}`; s.body = { kind: 'none' }; return 'deleteComment'; },
  commentUpdate(g, s) { s.path = `/api/proxy/issues/LIN-12/comments/${U(702)}`; s.body = { kind: 'json', value: { body: 'edited' } }; return 'updateComment'; },
  attach(g, s) {
    s.path = '/api/proxy/issues/LIN-12/attachments';
    s.body = { kind: 'json', value: { image: PNG_URL } };
    s.provider.methods.issueWriteGuard = ok({ id: ISSUE_UUID, team: { id: TEAM_ENG } });
    s.provider.methods.uploadFile = ok('https://uploads.linear.app/x/y.png');
    return 'createComment';
  },
  relation(g, s) {
    s.path = '/api/proxy/issues/LIN-12/relations';
    s.body = { kind: 'json', value: { type: 'blocks', relatedIssueId: 'LIN-99' } };
    s.provider.methods.issueWriteGuard = ok({ id: ISSUE_UUID, team: { id: TEAM_ENG } });
    return 'createRelation';
  },
  relationDelete(g, s) { s.path = `/api/proxy/issues/LIN-12/relations/${U(803)}`; s.body = { kind: 'none' }; return 'deleteRelation'; },
  labelAdd(g, s) {
    s.path = '/api/proxy/issues/LIN-12/labels';
    s.body = { kind: 'json', value: { labelId: LBL_NEW } };
    s.provider.methods.issueLabels = ok({ id: ISSUE_UUID, labels: { nodes: [{ id: LBL_BUG }] } });
    return 'updateIssueLabels';
  },
  labelRemove(g, s) {
    s.path = `/api/proxy/issues/LIN-12/labels/${LBL_BUG}`;
    s.body = { kind: 'none' };
    s.provider.methods.issueLabels = ok({ id: ISSUE_UUID, labels: { nodes: [{ id: LBL_BUG }, { id: LBL_NEW }] } });
    return 'updateIssueLabels';
  },
};

function canonComment(g, s, p) {
  s.path = p;
  s.body = { kind: 'json', value: { body: `lgtm #${g.int(0, 1e9)}` } }; // unique: no dedupe hit
  s.provider.methods.issueWriteGuard = ok({ id: ISSUE_UUID, team: { id: TEAM_ENG } });
  return 'createComment';
}

const GQL = (status, ext = {}) => ({ kind: 'gql', status, errors: [{ message: `upstream ${status}`, extensions: { statusCode: status, ...ext } }] });

function applyIntent(g, s, intent, gated) {
  // route-specific intents fall back to a free request where they do not apply
  if ((intent === 'trashed' && !TRASHED_READ[s.route]) || (intent === 'dedupeHit' && !s.route.startsWith('comment')) || (intent === 'dedupeHit' && (s.route === 'commentDelete' || s.route === 'commentUpdate')) || (['hugeImage', 'attachDesc', 'attachLong', 'attachEmbed'].includes(intent) && s.route !== 'attach')) return false;
  // healthy prerequisites
  s.auth = { ...s.auth, mode: 'ok', headerMode: 'ok', authorization: 'Bearer tok-abc', descriptor: null, result: { ...s.auth.result, scope: 'readWrite' } };
  s.access = { ...s.access, token: s.access.token || 'ws-token-canon', reason: 'ok', scope: undefined };
  delete s.access.throw;
  s.limiter = {};
  s.provider.unsupported = [];
  const primary = CANON[s.route](g, s);
  const set = (b) => { s.provider.methods[primary] = b; };
  switch (intent) {
    case 'err401': set(fail(GQL(401))); s.access.expiresAt = null; break;
    case 'err503': set(fail(GQL(401))); s.access.expiresAt = Date.UTC(2026, 9, 1, 13); s.access.credentialFingerprint = 'fp-live'; s.registry = { suspect: false, pastThreshold: false, superseded: false }; break;
    case 'err404': set(fail(GQL(404))); break;
    case 'err429': set(fail(GQL(429))); break;
    case 'err500': set(fail(g.pick([GQL(500), { kind: 'plain', message: 'boom' }, { kind: 'network', code: 'ECONNRESET' }]))); break;
    case 'err504': set(fail(g.pick([{ kind: 'timeout' }, { kind: 'abort' }]))); break;
    case 'err400': set(fail({ kind: 'gql', status: 200, errors: [{ message: 'Argument Validation Error', extensions: { userError: true } }] })); break;
    case 'errNull': set(fail({ kind: 'null' })); break;
    case 'errRef': set(fail({ kind: 'refResolution', message: 'Provider refused the write', status: 422 })); break;
    case 'errPartial': set(fail({ kind: 'partialWrite', message: 'Fields saved but transition failed', applied: ['title'], failed: 'transition', status: 502 })); break;
    case 'rejected': set(ok({ success: false })); break;
    case 'limiter': s.limiter = { proxyLimiter: 'block' }; break;
    case 'malformed': s.body = { kind: 'raw', text: '{"title": ', contentType: 'application/json' }; break;
    case 'oversized': s.body = { kind: 'pad', value: s.body.value || {}, padBytes: 260 * 1024, contentType: 'application/json' }; break;
    case 'authFail': if (g.chance(0.5)) s.auth.authorization = undefined; else s.auth.mode = 'rejected'; break;
    case 'readScope': s.auth.result.scope = 'read'; break;
    case 'noToken': s.access.token = null; s.access.reason = g.pick(['not_connected', 'session_expired', 'owner_mismatch']); break;
    case 'unsupported': s.provider.unsupported.push(gated); break;
    case 'trashed': s.provider.methods[TRASHED_READ[s.route]] = ok({ id: ISSUE_UUID, team: { id: TEAM_ENG }, description: 'gone', trashed: true, labels: { nodes: [] } }); break;
    case 'dedupeHit':
      // a workspace no delete/edit ever bumps: the first create mints, later ones hit
      s.auth.result.urlKey = 'dedupe-ws';
      s.body = { kind: 'json', value: { body: 'same comment ✓' } };
      set(ok({ success: true, comment: { id: U(706), body: 'same comment ✓' } }));
      s.variant = 'full';
      if (g.chance(0.5)) s.stores.harbourCommentsStore = { record: { throw: { kind: 'plain', message: 'ledger down' } } };
      break;
    case 'attachDesc':
      s.body = { kind: 'json', value: { image: PNG_URL, target: 'description', body: 'caption' } };
      s.provider.methods.issueDescription = { seq: [ok({ id: ISSUE_UUID, description: 'Intro' }), ok({ id: ISSUE_UUID, description: 'Intro' })] };
      s.provider.methods.updateIssue = ok({ success: true, issue: { id: ISSUE_UUID, description: 'Intro' } });
      break;
    case 'attachLong': // pre-upload budget: current description + caption + reserve > MAX_DESCRIPTION_LENGTH
      s.body = { kind: 'json', value: { image: PNG_URL, target: 'description', body: 'caption' } };
      s.provider.methods.issueDescription = ok({ id: ISSUE_UUID, description: 'x'.repeat(99900) });
      break;
    case 'attachEmbed': // caption fits the 200-char reserve; a 300-char assetUrl overflows the comment
      s.body = { kind: 'json', value: { image: PNG_URL, body: 'c'.repeat(49798) } };
      s.provider.methods.uploadFile = ok('https://uploads.linear.app/' + 'a'.repeat(300));
      break;
    case 'hugeImage': s.body = { kind: 'bigImage', bytes: 10 * 1024 * 1024 + 1, fields: {}, contentType: 'text/plain' }; break;
    default: break;
  }
  return true;
}

// (kept for reference: the free-sampling weights before stratification)
const WEIGHTS = [
  ['create', 1.3], ['update', 1.4], ['append', 1], ['replace', 1], ['comment', 1.1], ['commentAlias', 1], ['commentDelete', 0.9], ['commentUpdate', 0.9],
  ['attach', 1.5], ['relation', 1], ['relationDelete', 0.8], ['labelAdd', 1], ['labelRemove', 1], ['unmatched', 0.25],
];

const GATED_EXTRA = ['issueWriteGuard', 'issueDescription', 'issueLabels', 'updateIssueLabels'];

export function generateScenario(seed, i) {
  const g = new G((seed * 1000003 + i * 7919 + 101) >>> 0);
  // every 40th request is an unmatched method/path; the rest rotate forms x intents
  let route = 'unmatched';
  let intent = 'free';
  if (i % 40 !== 39) {
    const k = i - Math.floor(i / 40);
    route = ROUTE_ORDER[k % ROUTE_ORDER.length];
    intent = INTENTS[Math.floor(k / ROUTE_ORDER.length) % INTENTS.length];
  }
  const provider = genProviderBase(g);
  const s = {
    index: i, slot: 'writes', route, routeKey: ROUTE_KEYS[route], intent,
    variant: g.weighted(WRITES_VARIANTS.map((v, k) => [v, k === 0 ? 5 : 1])),
    method: 'POST', path: '', body: { kind: 'none' },
    auth: genAuth(g),
    access: genAccess(g, provider.name),
    provider,
    registry: genRegistry(g),
    stores: {},
    limiter: g.chance(0.025) ? { proxyLimiter: 'block' } : {},
    ticketWrite: { readBack: g.chance(0.7), throw: g.chance(0.15) ? { kind: 'plain', message: 'closer failed' } : null },
    randomSeed: g.int(1, 2 ** 31 - 1),
  };
  const gated = ROUTES[route](g, s);
  s.stores.harbourCommentsStore = { record: g.chance(0.25) ? { throw: { kind: 'plain', message: 'ledger down' } } : { ret: undefined } };
  if (intent !== 'free' && applyIntent(g, s, intent, gated)) return s;
  s.intent = 'free';
  if (g.chance(0.01)) s.stores.proxyEventStore = { recordEvent: { throw: { kind: 'plain', message: 'recordEvent rejected' } } };
  if (gated && g.chance(0.05)) s.provider.unsupported.push(gated);
  if (s.unsupportedExtra) { s.provider.unsupported.push(s.unsupportedExtra); delete s.unsupportedExtra; }
  // a provider missing one of the route-internal reads (denyIfMissingRead)
  const present = GATED_EXTRA.filter(m => s.provider.methods[m]);
  if (present.length && g.chance(0.04)) delete s.provider.methods[g.pick(present)];
  if (g.chance(0.004)) s.provider = null;
  if (route !== 'unmatched') s.path = pathVariant(g, s.path);
  return s;
}

void enc;
void WEIGHTS;
