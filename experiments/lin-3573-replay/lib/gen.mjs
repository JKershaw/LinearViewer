// Seeded, stateful request generator for the 13 write URL forms and 3 rulings URL forms.
//
// Written fresh from the routers' contract (not from any prior replay's generator).
// Every request carries a `script` that drives the recording fakes (see world.mjs), and an
// `expect` ("<http status>/<logEvent status | n for none>") naming the exit it targets: the
// catalogue below is therefore also the table of reachable status/logEvent pairs that Gate 1
// checks at >= 5 hits each.
import { mulberry32 } from './util.mjs';
import { U, WS, WS2 } from './world.mjs';

export const FORMS = {
  W_ISSUE_CREATE: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues', write: true, endpoint: '/api/proxy/issues' },
  W_ISSUE_PATCH: { needsWrite: true, method: 'PATCH', tpl: '/api/proxy/issues/:issueId', write: true, endpoint: '/api/proxy/issues/:id' },
  W_DESC_APPEND: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues/:issueId/description/append', write: true, endpoint: '/api/proxy/issues/:id/description/append' },
  W_DESC_REPLACE: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues/:issueId/description/replace', write: true, endpoint: '/api/proxy/issues/:id/description/replace' },
  W_COMMENT_NESTED: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues/:issueId/comments', write: true, endpoint: '/api/proxy/issues/comments' },
  W_COMMENT_FLAT: { needsWrite: true, method: 'POST', tpl: '/api/proxy/comments/:issueId', write: true, endpoint: '/api/proxy/issues/comments' },
  W_COMMENT_DELETE: { needsWrite: true, method: 'DELETE', tpl: '/api/proxy/issues/:issueId/comments/:commentId', write: true, endpoint: '/api/proxy/issues/comments' },
  W_COMMENT_PATCH: { needsWrite: true, method: 'PATCH', tpl: '/api/proxy/issues/:issueId/comments/:commentId', write: true, endpoint: '/api/proxy/issues/comments' },
  W_ATTACH: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues/:issueId/attachments', write: true, endpoint: '/api/proxy/issues/:id/attachments' },
  W_REL_CREATE: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues/:issueId/relations', write: true, endpoint: '/api/proxy/issues/relations' },
  W_REL_DELETE: { needsWrite: true, method: 'DELETE', tpl: '/api/proxy/issues/:issueId/relations/:relationId', write: true, endpoint: '/api/proxy/issues/relations' },
  W_LABEL_ADD: { needsWrite: true, method: 'POST', tpl: '/api/proxy/issues/:issueId/labels', write: true, endpoint: '/api/proxy/issues/labels' },
  W_LABEL_REMOVE: { needsWrite: true, method: 'DELETE', tpl: '/api/proxy/issues/:issueId/labels/:labelId', write: true, endpoint: '/api/proxy/issues/labels' },
  R_GET: { method: 'GET', tpl: '/api/proxy/rulings', write: false, endpoint: '/api/proxy/rulings' },
  R_DISMISS: { needsWrite: true, method: 'POST', tpl: '/api/proxy/rulings/:decisionId/suggest-dismissal', write: false, endpoint: '/api/proxy/rulings/suggest-dismissal' },
  R_ANSWER: { needsWrite: true, method: 'POST', tpl: '/api/proxy/rulings/:decisionId/suggest-answer', write: false, endpoint: '/api/proxy/rulings/suggest-answer' },
};
export const WRITE_FORMS = Object.keys(FORMS).filter(k => FORMS[k].write);
export const FORM_KEYS = Object.keys(FORMS);

const SOURCES = ['jira', 'github', 'linear', 'bogus', ''];
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR-fake-bytes-for-the-sniffer')]);
const pngDataUrl = (extra = 0) => `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(extra, 7)]).toString('base64')}`;
let bigImageUrl = null;                                          // > 10 MB decoded: memoised, built once
const tooBigImage = () => (bigImageUrl ||= pngDataUrl(10 * 1024 * 1024 + 64));

const mk = (n, c = 'a') => c.repeat(n);
const DANGER = 'bad\u0001char';

export function createGenerator(seed, info = {}) {
  const rng = mulberry32(seed);
  const chance = (p) => rng() < p;
  const int = (n) => Math.floor(rng() * n);
  const pick = (a) => a[int(a.length)];
  const cursors = new Map();
  // round-robin (not random) choice: situations that exist to reach one block per element must reach each element evenly
  const cycKey = (k, a) => { const i = cursors.get(k) || 0; cursors.set(k, i + 1); return a[i % a.length]; };
  const cyc = (a) => cycKey(new Error().stack.split('\n')[2], a);       // keyed by call site, so each site cycles independently
  let idx = 0;
  const counters = {};

  const ISSUE_OK = () => pick([U.issue, U.issue2, 'LIN-123', '#45', 'abc-9']);
  const ISSUE_BAD = () => pick(['bad%20id', mk(101), 'a_b', 'x.y']);
  const TEXTS = ['Plain text', 'Unicode ✓ — naïve café 日本語 😀', 'multi\nline\ttabs', '`code` and **bold**', ' padded '];
  const text = () => pick(TEXTS);
  const UUIDISH = () => pick([U.comment, '00000000-0000-4000-8000-0000000000aa']);

  function skeleton(form) {
    const f = FORMS[form];
    return {
      form, method: f.method, tpl: f.tpl, params: { issueId: ISSUE_OK(), commentId: UUIDISH(), relationId: U.relation, labelId: U.label.feature, decisionId: 'd-1' },
      query: {}, headers: { authorization: 'Bearer tok-rw', 'content-type': 'application/json' },
      body: undefined, rawBody: undefined, mode: 'full', advance: 10,
      script: { access: 'ok', p: {}, world: {}, unsupported: [], missing: [] }, expect: null, tag: '', overlay: true,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Situation catalogue. Each entry mutates the skeleton and names the targeted exit.
  // ---------------------------------------------------------------------------------------
  const err = (code) => ({ throw: code });
  // Status a thrown provider error maps to (credential 'future' => transient 401/403 become 503).
  const ERRS = [['plain', 500], ['e404', 404], ['e429', 429], ['ext404', 404], ['e500', 500], ['user400', 400], ['e429', 429], ['timeout', 504], ['abort', 504], ['e401', 503], ['e429', 429], ['e403', 503]];
  const ERRS_HARD = [['e401', 401], ['e403', 401]]; // with an expired/unknown credential expiry
  function thrown(r, method, ctxLabel) {
    const [code, status] = pick(ERRS);
    r.script.p[method] = err(code);
    r.expect = `${status}/${status}`;
    if (code === 'e401' || code === 'e403') r.sensitiveAuthErr = true;   // 401 vs transient 503 depends on expiry / registry
    r.tag += `:${ctxLabel || method}-${code}`;
  }
  function thrownHard(r, method) {
    const [code, status] = pick(ERRS_HARD);
    r.script.p[method] = err(code);
    r.script.expires = pick(['past', 'none']);
    r.expect = `${status}/${status}`;
    r.tag += `:${method}-${code}-hard`;
  }

  const S = {};
  const sits = (form, list) => { S[form] = list; };
  const rep = (k, fn) => Array.from({ length: k }, () => fn);   // weight a situation k-fold in the round-robin

  // ---- POST /issues -----------------------------------------------------------------
  const createBody = (r, o = {}) => { r.body = { title: text(), ...o }; };
  sits('W_ISSUE_CREATE', [
    ...rep(3, (r) => { createBody(r, { teamId: cyc([U.team, 'LIN', 'linear team']), description: cyc([undefined, text()]), projectId: cyc([undefined, 'Alpha', U.project.alpha]), stateId: cyc([undefined, 'done', 'In Progress', U.state.prog]), assigneeId: cyc([undefined, U.user]), parentId: cyc([undefined, U.issue2]), cycleId: cyc([undefined, U.issue2]), priority: cyc([undefined, 0, 1, 4, 9, -1, 'high']) }); r.expect = '201/201'; r.tag = 'ok-linear'; }),
    (r) => { createBody(r, { teamId: U.team, priorityLevel: cyc([0, 2, 4, 7]) }); r.expect = '201/201'; r.tag = 'ok-priorityLevel'; },
    (r) => { r.script.createFields = []; createBody(r, { description: text() }); r.expect = '201/201'; r.tag = 'ok-teamless'; },
    (r) => { createBody(r, { teamId: U.team, priority: 1, priorityLevel: 2 }); r.expect = '400/400'; r.tag = 'both-priority'; },
    (r) => { createBody(r, {}); r.expect = '400/400'; r.tag = 'no-team'; },
    (r) => { createBody(r, { teamId: 12345 }); r.expect = '400/400'; r.tag = 'team-not-string'; },
    (r) => { r.body = { teamId: U.team, ...cyc([{}, { title: 12 }, { title: '' }, { title: null }]) }; r.expect = '400/400'; r.tag = 'no-title'; },
    (r) => { createBody(r, { teamId: U.team, ...cyc([{ title: mk(1001) }, { description: mk(100001) }, { title: DANGER }, { description: DANGER }]) }); r.expect = '400/n'; r.tag = 'field-validation'; },
    (r) => { r.script.createFields = []; createBody(r, { teamId: U.team }); r.expect = '400/400'; r.tag = 'team-on-teamless'; },
    ...rep(7, (r) => { r.script.writable = []; const k = cyc([['projectId', 'Alpha'], ['stateId', U.state.prog], ['assigneeId', U.user], ['parentId', U.issue2], ['cycleId', U.issue2], ['priority', 2], ['priorityLevel', 2]]); createBody(r, { teamId: U.team, [k[0]]: k[1] }); r.expect = '400/400'; r.tag = `unwritable-${k[0]}`; }),
    (r) => { createBody(r, { teamId: 'NOPE' }); r.expect = '422/422'; r.tag = 'ref-team-missing'; },
    (r) => { createBody(r, { teamId: 'dup' }); r.expect = '422/422'; r.tag = 'ref-team-ambiguous'; },
    (r) => { createBody(r, { teamId: U.team, ...cyc([{ stateId: 'nonesuch' }, { projectId: 'Gamma' }]) }); r.expect = '422/422'; r.tag = 'ref-state-project'; },
    (r) => { createBody(r, { teamId: 'LIN' }); r.script.p.fetchTeams = err('plain'); r.expect = '500/500'; r.tag = 'ref-lookup-throws'; },
    (r) => { createBody(r, { teamId: U.team }); r.script.p.createIssue = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'create-rejected'; },
    (r) => { createBody(r, { teamId: U.team }); r.script.p.createIssue = 'bare'; r.expect = '201/201'; r.tag = 'create-bare-object'; },
    ...rep(5, (r) => { createBody(r, { teamId: U.team }); thrown(r, 'createIssue'); }),
    ...rep(3, (r) => { createBody(r, { teamId: U.team }); thrownHard(r, 'createIssue'); }),
    (r) => { createBody(r, { teamId: U.team }); r.script.unsupported = ['createIssue']; r.expect = '422/422'; r.tag = 'unsupported'; },
  ]);

  // ---- PATCH /issues/:id ------------------------------------------------------------
  const MARK = '<!-- harbour-periodical-gate id="weekly-review" -->';
  const EVID = [{ body: 'Report: https://github.com/o/r/pull/12' }];
  const ADV = [{ body: 'Report: https://github.com/o/r/pull/12' }, { body: 'Adversarial second-read verdict: AGREE\nDiffered from top finding: NO\nDisposition: no change' }];
  sits('W_ISSUE_PATCH', [
    ...rep(14, (r) => { r.body = cyc([{ title: text() }, { description: cyc(['', text()]) }, { assigneeId: U.user }, { projectId: cyc(['Alpha', U.project.alpha]) }, { parentId: null }, { parentId: U.issue2 }, { cycleId: U.issue2 }, { priority: cyc([0, 3]) }, { priorityLevel: cyc([1, 4]) }, { title: 'T', stateId: cyc(['done', 'in progress', U.state.prog]) }]); r.expect = '200/200'; r.tag = 'ok-fields'; r.script.closer = cyc(['ok', 'throw']); }),
    ...rep(3, (r) => { r.body = { stateId: cyc(['done', U.state.done]) }; r.script.closer = cyc(['ok', 'throw', 'throw-bare']); r.expect = '200/200'; r.tag = 'ok-state'; }),
    (r) => { r.script.unsupported = ['updateIssue']; r.body = { title: 'x' }; r.expect = '422/422'; r.tag = 'unsupported'; },
    (r) => { r.params.issueId = ISSUE_BAD(); r.body = { title: 'x' }; r.expect = '400/400'; r.tag = 'bad-id'; },
    (r) => { r.body = { priority: 1, priorityLevel: 1 }; r.expect = '400/400'; r.tag = 'both-priority'; },
    (r) => { r.body = cyc([{ title: mk(1001) }, { description: mk(100001) }, { title: DANGER }, { description: DANGER }]); r.expect = '400/n'; r.tag = 'field-validation'; },
    (r) => { r.body = cyc([{}, { unknown: 1 }]); r.expect = '400/400'; r.tag = 'empty-body'; },
    (r) => { r.body = cyc([{ assigneeId: 'not-a-uuid' }, { priority: 9 }, { parentId: 'nope' }]); r.expect = '400/400'; r.tag = 'all-dropped'; },
    ...rep(3, (r) => { r.script.missing = ['issueWriteGuard']; r.body = { title: 'x' }; r.expect = '422/422'; r.tag = 'guard-read-missing'; }),
    (r) => { r.script.world.trashed = true; r.body = { title: 'x' }; r.expect = '409/409'; r.tag = 'trashed'; },
    (r) => { r.script.p.issueWriteGuard = 'null'; r.body = { title: 'x' }; r.expect = '200/200'; r.tag = 'guard-null-proceeds'; },
    ...rep(5, (r) => { r.body = { title: 'x' }; thrown(r, 'issueWriteGuard'); }),
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.done }; r.script.world.comments = []; r.expect = '409/409'; r.tag = 'gate-no-report'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.done }; r.script.world.comments = EVID; r.expect = '409/409'; r.tag = 'gate-no-adversarial'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.done }; r.script.world.comments = ADV; r.expect = '200/200'; r.tag = 'gate-complete'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.prog }; r.expect = '200/200'; r.tag = 'gate-nonterminal'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.done }; r.script.p.states = err('plain'); r.expect = '200/200'; r.tag = 'gate-states-throws'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.done }; r.script.missing = ['states']; r.expect = '200/200'; r.tag = 'gate-states-absent'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: U.state.done }; r.script.p.states = { val: null }; r.expect = '200/200'; r.tag = 'gate-states-null'; },
    (r) => { r.script.world.desc = `Review ${MARK}`; r.body = { stateId: '22222222-0000-4000-8000-0000000000ff' }; r.expect = '200/200'; r.tag = 'gate-state-id-unknown'; },
    (r) => { r.script.world.noTeam = true; r.body = { stateId: 'done' }; r.expect = '422/422'; r.tag = 'state-no-team'; },
    (r) => { r.body = cyc([{ stateId: 'nonesuch' }, { projectId: 'nonesuch' }]); r.expect = '422/422'; r.tag = 'ref-fail'; },
    (r) => { r.body = { title: 'x' }; r.script.p.updateIssue = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'write-rejected'; },
    (r) => { r.body = { title: 'x' }; r.script.p.updateIssue = err('refres'); r.expect = '422/422'; r.tag = 'write-refres'; },
    (r) => { r.body = { title: 'x' }; r.script.p.updateIssue = err('refres-nc'); r.expect = '409/409'; r.tag = 'write-refres-nocand'; },
    (r) => { r.body = { stateId: U.state.prog, title: 'x' }; r.script.p.updateIssue = err('partial'); r.expect = '502/502'; r.tag = 'write-partial'; },
    (r) => { r.body = { title: 'x' }; r.script.p.updateIssue = err('partial0'); r.expect = '500/500'; r.tag = 'write-partial0'; },
    ...rep(5, (r) => { r.body = { title: 'x' }; thrown(r, 'updateIssue'); }),
    ...rep(3, (r) => { r.body = { title: 'x' }; thrownHard(r, 'updateIssue'); }),
  ]);

  // ---- description append / replace -------------------------------------------------
  const editCommon = (kind) => {
    const okCurrent = () => (kind === 'append' ? cyc(['Existing description', '', 'Existing\\_escaped text']) : cyc(['Existing description', 'Existing\\_escaped text']));
    const body = (extra = {}) => (kind === 'append' ? { block: text(), ...extra } : { oldString: 'Existing', newString: text(), ...extra });
    return [
      (r) => { r.body = body(); r.script.world.current = okCurrent(); r.expect = '200/200'; r.tag = 'ok'; },
      (r) => { r.body = kind === 'append' ? { block: text() } : { oldString: 'a', newString: 'b' }; r.script.world.current = null; r.expect = kind === 'append' ? '200/200' : '422/422'; r.tag = 'current-null'; },
      (r) => { r.body = body(kind === 'append' ? { block: cyc([undefined, '', 7, null]) } : { oldString: cyc([undefined, '', 7]) }); r.expect = '400/400'; r.tag = 'input-missing'; },
      (r) => { r.body = kind === 'append' ? { block: mk(100001) } : { oldString: 'Existing', newString: mk(100001) }; r.expect = '400/400'; r.tag = 'input-too-long'; },
      (r) => { r.body = kind === 'append' ? { block: DANGER } : { oldString: 'Existing', newString: DANGER }; r.expect = '400/400'; r.tag = 'input-dangerous'; },
      (r) => { r.body = kind === 'append' ? { block: 'ok' } : { oldString: 'Existing' }; if (kind === 'replace') r.expect = '400/400'; else r.expect = '200/200'; r.tag = kind === 'replace' ? 'newString-missing' : 'ok-short'; },
      (r) => { r.body = body(); r.script.unsupported = ['updateIssue']; r.expect = '422/422'; r.tag = 'unsupported'; },
      (r) => { r.body = body(); r.params.issueId = ISSUE_BAD(); r.expect = '400/400'; r.tag = 'bad-id'; },
      (r) => { r.body = body(); r.script.missing = ['issueDescription']; r.expect = '422/422'; r.tag = 'read-missing'; },
      (r) => { r.body = body(); r.script.p.issueDescription = 'null'; r.expect = '404/404'; r.tag = 'issue-missing'; },
      (r) => { r.body = body(); r.script.world.trashed = true; r.expect = '409/409'; r.tag = 'trashed'; },
      ...rep(5, (r) => { r.body = body(); thrown(r, 'issueDescription', 'read'); }),
      (r) => { r.body = body(); r.script.world.current = mk(99990); if (kind === 'append') r.body.block = mk(500); else { r.body.oldString = 'xxxx'; r.body.newString = mk(5000); r.expect = '422/422'; } r.expect = kind === 'append' ? '400/400' : '422/422'; r.tag = kind === 'append' ? 'result-too-long' : 'not-unique'; },
      (r) => { r.body = body(); r.script.world.current = 'Existing\u0001 description'; r.expect = '400/400'; r.tag = 'result-dangerous'; },
      (r) => { r.body = body(); r.script.p.updateIssue = cyc(['null', 'false']); r.expect = '200/200'; r.tag = 'write-rejected-200'; },
      (r) => { r.body = body(); r.script.p.updateIssue = err('refres'); r.expect = '422/422'; r.tag = 'write-refres'; },
      (r) => { r.body = body(); r.script.p.updateIssue = err('partial'); r.expect = '502/502'; r.tag = 'write-partial'; },
      ...rep(5, (r) => { r.body = body(); thrown(r, 'updateIssue', 'write'); }),
      (r) => { r.body = body(); r.script.access = 'throw'; r.overlay = false; r.expect = '500/n'; r.tag = 'resolve-rejects'; },
      (r) => { r.body = kind === 'append' ? { block: '' } : { oldString: '' }; r.script.access = 'none'; r.overlay = false; r.expect = '400/400'; r.tag = 'validate-before-resolve'; },
    ];
  };
  sits('W_DESC_APPEND', editCommon('append'));
  sits('W_DESC_REPLACE', [
    ...editCommon('replace'),
    (r) => { r.body = { oldString: 'Nonexistent span', newString: 'x' }; r.expect = '422/422'; r.tag = 'not-found'; },
    (r) => { r.body = { oldString: 'a', newString: 'b' }; r.script.world.current = 'a and a again'; r.expect = '422/422'; r.tag = 'ambiguous'; },
  ]);

  // ---- comments create (nested + flat) ----------------------------------------------
  const commentBody = () => `${cyc([text(), 'unique comment', mk(200)])} #${idx}`;   // unique per request: accidental dedupe hits would hide the exit under test
  const commentSits = [
    (r) => { r.body = { body: commentBody() }; r.expect = '201/201'; r.tag = 'ok'; r.script.ledger = cyc(['ok', 'throw']); },
    (r) => { r.body = { body: commentBody() }; r.script.p.issueWriteGuard = 'null'; r.expect = '201/201'; r.tag = 'ok-guard-null'; },
    (r) => { r.params.issueId = ISSUE_BAD(); r.body = { body: 'x' }; r.expect = '400/n'; r.tag = 'bad-id'; },
    (r) => { r.body = cyc([{}, { body: '' }, { body: null }]); r.expect = '400/400'; r.tag = 'body-required'; },
    (r) => { r.body = cyc([{ body: 12 }, { body: ['x'] }, { body: { a: 1 } }]); r.expect = '400/400'; r.tag = 'body-not-string'; },
    (r) => { r.body = { body: DANGER }; r.expect = '400/n'; r.tag = 'body-invalid'; },
    (r) => { r.body = { body: mk(50001) }; r.expect = '400/n'; r.tag = 'body-too-long'; },
    (r) => { r.body = { body: 'x' }; r.script.unsupported = ['createComment']; r.expect = '422/422'; r.tag = 'unsupported'; },
    (r) => { r.body = { body: 'x' }; r.script.missing = ['issueWriteGuard']; r.expect = '422/422'; r.tag = 'guard-read-missing'; },
    (r) => { r.body = { body: 'x' }; r.script.world.trashed = true; r.expect = '409/409'; r.tag = 'trashed'; },
    ...rep(5, (r) => { r.body = { body: 'x' }; thrown(r, 'issueWriteGuard', 'guard'); }),
    (r) => { r.body = { body: commentBody() }; r.script.p.createComment = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'create-rejected'; },
    ...rep(5, (r) => { r.body = { body: commentBody() }; thrown(r, 'createComment'); }),
    ...rep(3, (r) => { r.body = { body: commentBody() }; thrownHard(r, 'createComment'); }),
  ];
  sits('W_COMMENT_NESTED', commentSits);
  sits('W_COMMENT_FLAT', commentSits);

  // ---- comment delete / patch --------------------------------------------------------
  const idSits = (extra) => [
    (r) => { r.params.issueId = ISSUE_BAD(); r.body = { body: 'x' }; r.expect = '400/n'; r.tag = 'bad-issue-id'; },
    (r) => { r.params.commentId = 'not-a-uuid'; r.body = { body: 'x' }; r.expect = '400/400'; r.tag = 'bad-comment-id'; },
    ...extra,
  ];
  sits('W_COMMENT_DELETE', idSits([
    (r) => { r.expect = '200/200'; r.tag = 'ok'; },
    (r) => { r.script.unsupported = ['deleteComment']; r.expect = '422/422'; r.tag = 'unsupported'; },
    (r) => { r.script.p.deleteComment = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'rejected'; },
    (r) => { r.script.p.deleteComment = 'bare'; r.expect = '502/502'; r.tag = 'rejected-bare'; },
    ...rep(5, (r) => { thrown(r, 'deleteComment'); }),
    ...rep(3, (r) => { thrownHard(r, 'deleteComment'); }),
  ]));
  sits('W_COMMENT_PATCH', idSits([
    (r) => { r.body = { body: commentBody() }; r.expect = '200/200'; r.tag = 'ok'; },
    (r) => { r.body = cyc([{}, { body: '' }]); r.expect = '400/400'; r.tag = 'body-required'; },
    (r) => { r.body = { body: 5 }; r.expect = '400/400'; r.tag = 'body-not-string'; },
    (r) => { r.body = { body: DANGER }; r.expect = '400/n'; r.tag = 'body-invalid'; },
    (r) => { r.body = { body: mk(50001) }; r.expect = '400/n'; r.tag = 'body-too-long'; },
    (r) => { r.body = { body: 'x' }; r.script.unsupported = ['updateComment']; r.expect = '422/422'; r.tag = 'unsupported'; },
    (r) => { r.body = { body: 'x' }; r.script.p.updateComment = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'rejected'; },
    ...rep(5, (r) => { r.body = { body: 'x' }; thrown(r, 'updateComment'); }),
  ]));

  // ---- attachments ------------------------------------------------------------------
  const att = (o = {}) => ({ image: pngDataUrl(), ...o });
  sits('W_ATTACH', [
    ...rep(2, (r) => { r.body = att({ body: cyc([undefined, 'caption ✓']) }); r.expect = '201/201'; r.tag = 'ok-comment'; r.script.ledger = cyc(['ok', 'throw']); }),
    (r) => { r.body = att({ target: 'comment', image: { data: pngDataUrl().split(',')[1], contentType: 'image/svg+xml', filename: 'x.png' } }); r.expect = '201/201'; r.tag = 'ok-object-image'; },
    (r) => { r.body = att({ target: 'description', body: cyc([undefined, 'caption']) }); r.expect = '200/200'; r.tag = 'ok-description'; },
    (r) => { r.body = att({ target: cyc(['bogus', 5, 'Comment']) }); r.expect = '400/400'; r.tag = 'bad-target'; },
    (r) => { r.body = att({ target: 'bogus' }); r.script.access = 'none'; r.overlay = false; r.expect = '503/503'; r.tag = 'bad-target-under-503'; },
    (r) => { r.body = att({ target: 'bogus' }); r.script.unsupported = ['uploadFile']; r.overlay = false; r.expect = '422/422'; r.tag = 'bad-target-under-no-uploadFile'; },
    (r) => { r.body = att(); r.script.unsupported = ['uploadFile']; r.expect = '422/422'; r.tag = 'no-uploadFile'; },
    (r) => { r.body = att({ target: 'description' }); r.script.unsupported = ['updateIssue']; r.expect = '422/422'; r.tag = 'no-updateIssue'; },
    (r) => { r.body = att(); r.script.unsupported = ['createComment']; r.expect = '422/422'; r.tag = 'no-createComment'; },
    (r) => { r.body = att(); r.params.issueId = ISSUE_BAD(); r.expect = '400/400'; r.tag = 'bad-id'; },
    (r) => { r.body = att({ body: cyc([5, DANGER]) }); r.expect = '400/400'; r.tag = 'bad-caption'; },
    (r) => { r.body = cyc([{}, { image: '' }, { image: null }]); r.expect = '400/400'; r.tag = 'image-missing'; },
    (r) => { r.body = { image: cyc(['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'not-an-image', 'data:image/png,rawnotbase64', { data: 7 }, { data: Buffer.from('plain text bytes here').toString('base64') }]) }; r.expect = '400/400'; r.tag = 'image-invalid'; },
    (r) => { r.body = att(); r.script.world.trashed = true; r.expect = '409/409'; r.tag = 'trashed'; },
    (r) => { r.body = att({ target: cyc(['comment', 'description']) }); r.script.missing = ['issueWriteGuard']; r.expect = '422/422'; r.tag = 'guard-read-missing'; },
    (r) => { r.body = att({ target: 'description' }); r.script.missing = ['issueDescription']; r.expect = '422/422'; r.tag = 'desc-read-missing'; },
    (r) => { r.body = att({ target: 'description', body: cyc([undefined, 'caption']) }); r.script.world.current = cyc([null, '']); r.expect = '200/200'; r.tag = 'ok-description-empty'; },
    (r) => { r.body = att({ target: 'description' }); r.script.p.issueDescription = 'null'; r.expect = '404/404'; r.tag = 'desc-issue-missing'; },
    (r) => { r.body = att({ target: 'description' }); r.script.world.current = mk(99900); r.expect = '400/400'; r.tag = 'desc-precheck-too-long'; },
    (r) => { r.body = att({ body: mk(49900) }); r.expect = '400/400'; r.tag = 'comment-precheck-too-long'; },
    (r) => { r.body = att({ body: mk(49790) }); r.script.p.uploadFile = { val: `https://assets.example/${mk(260)}.png` }; r.expect = '400/400'; r.tag = 'comment-embedded-too-long'; },
    (r) => { r.body = att(); r.script.p.createComment = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'comment-rejected'; },
    ...rep(5, (r) => { r.body = att(); thrown(r, cyc(['uploadFile', 'createComment'])); }),
    ...rep(3, (r) => { r.body = att(); thrownHard(r, 'uploadFile'); }),
    ...rep(5, (r) => { r.body = att({ target: 'description' }); thrown(r, cyc(['uploadFile', 'issueDescription']), 'pre'); }),
    (r) => { r.body = att({ target: 'description' }); r.script.accessSeq = ['ok', 'throw']; r.overlay = false; r.expect = '500/n'; r.tag = 'second-resolve-rejects'; },
    (r) => { r.body = att({ target: 'description' }); r.script.accessSeq = ['ok', 'none']; r.overlay = false; r.expect = '503/503'; r.tag = 'second-resolve-503'; },
    (r) => { r.body = att({ target: 'description' }); r.script.p.issueDescription = ['ok', 'null']; r.expect = '404/404'; r.tag = 'second-read-missing'; },
    (r) => { r.body = att({ target: 'description' }); r.script.p.issueDescription = ['ok', { throw: 'plain' }]; r.expect = '500/500'; r.tag = 'second-read-throws'; },
    (r) => { r.body = att({ target: 'description' }); r.script.p.updateIssue = cyc(['null', 'false']); r.expect = '200/200'; r.tag = 'desc-write-rejected-200'; },
    (r) => { r.body = att({ target: 'description' }); r.script.p.updateIssue = err('partial'); r.expect = '502/502'; r.tag = 'desc-write-partial'; },
    ...rep(5, (r) => { r.body = att({ target: 'description' }); thrown(r, 'updateIssue', 'desc-write'); }),
    (r) => { r.rawBody = JSON.stringify(att({ body: mk(300000, 'z').slice(0, 1) })); r.headers['content-type'] = 'text/plain'; r.pad = 300000; r.expect = '201/201'; r.tag = 'big-non-json-body'; },
  ]);

  // ---- relations ---------------------------------------------------------------------
  sits('W_REL_CREATE', [
    (r) => { r.body = { type: cyc(['blocks', 'blocked-by', 'related']), relatedIssueId: cyc([U.issue2, 'LIN-9']) }; r.expect = '201/201'; r.tag = 'ok'; },
    ...rep(3, (r) => { r.body = { type: 'duplicate', relatedIssueId: U.issue2 }; r.script.closer = cyc(['ok', 'ok', 'throw', 'throw-bare']); r.expect = '201/201'; r.tag = 'ok-duplicate'; }),
    (r) => { r.params.issueId = ISSUE_BAD(); r.body = { type: 'blocks', relatedIssueId: U.issue2 }; r.expect = '400/n'; r.tag = 'bad-id'; },
    (r) => { r.body = { type: cyc([undefined, 'nonsense', 5]), relatedIssueId: U.issue2 }; r.expect = '400/400'; r.tag = 'bad-type'; },
    (r) => { r.body = { type: 'blocks', relatedIssueId: cyc([undefined, 'bad id!', 9]) }; r.expect = '400/n'; r.tag = 'bad-related'; },
    (r) => { r.body = { type: 'blocks', relatedIssueId: U.issue2 }; r.script.unsupported = ['createRelation']; r.expect = '422/422'; r.tag = 'unsupported'; },
    (r) => { r.body = { type: 'blocks', relatedIssueId: U.issue2 }; r.script.world.trashed = true; r.expect = '409/409'; r.tag = 'trashed'; },
    (r) => { r.body = { type: 'blocks', relatedIssueId: U.issue2 }; r.script.missing = ['issueWriteGuard']; r.expect = '422/422'; r.tag = 'guard-read-missing'; },
    (r) => { r.body = { type: 'blocks', relatedIssueId: U.issue2 }; r.script.p.createRelation = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'rejected'; },
    ...rep(5, (r) => { r.body = { type: 'blocks', relatedIssueId: U.issue2 }; thrown(r, cyc(['createRelation', 'issueWriteGuard'])); }),
  ]);
  sits('W_REL_DELETE', idSits([
    (r) => { r.expect = '200/200'; r.tag = 'ok'; },
    (r) => { r.params.relationId = 'not-a-uuid'; r.expect = '400/400'; r.tag = 'bad-relation-id'; },
    (r) => { r.script.unsupported = ['deleteRelation']; r.expect = '422/422'; r.tag = 'unsupported'; },
    (r) => { r.script.p.deleteRelation = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'rejected'; },
    ...rep(5, (r) => { thrown(r, 'deleteRelation'); }),
  ]).filter((_, i) => i !== 1));

  // ---- labels ------------------------------------------------------------------------
  const labelCommon = (add) => {
    const cap = add ? 'addLabel' : 'removeLabel';
    const setLabel = (r, v) => { if (add) r.body = { labelId: v }; else r.params.labelId = v; };
    return [
      (r) => { setLabel(r, U.label.other); r.script.world.labels = null; r.expect = add ? '200/200' : '200/200'; r.tag = 'labels-field-missing'; },
      (r) => { setLabel(r, cyc(['Feature', 'feature', U.label.feature, U.label.other])); r.script.world.labels = add ? [{ id: U.label.bug, name: 'bug' }] : [{ id: U.label.bug, name: 'bug' }, { id: U.label.feature, name: 'Feature' }, { id: U.label.other, name: 'o' }]; r.expect = '200/200'; r.tag = add ? 'add-writes' : 'remove-writes'; },
      (r) => { setLabel(r, add ? 'bug' : 'Feature'); r.script.world.labels = add ? [{ id: U.label.bug, name: 'bug' }] : [{ id: U.label.bug, name: 'bug' }]; r.expect = '200/200'; r.tag = add ? 'already-present' : 'not-present'; },
      (r) => { if (add) { r.body = cyc([{}, { labelId: '' }, { labelId: 5 }]); r.expect = '400/400'; r.tag = 'labelId-required'; } else { r.params.issueId = ISSUE_BAD(); r.expect = '400/n'; r.tag = 'bad-id'; } },
      (r) => { r.params.issueId = ISSUE_BAD(); setLabel(r, 'Feature'); r.expect = '400/n'; r.tag = 'bad-id'; },
      (r) => { setLabel(r, 'x'); r.script.unsupported = [cap]; r.expect = '422/422'; r.tag = 'unsupported'; },
      (r) => { setLabel(r, cyc(['nonesuch', 'dupe'])); r.expect = '422/422'; r.tag = 'ref-fail'; },
      (r) => { setLabel(r, 'Feature'); r.script.p.labels = err('plain'); r.expect = '500/500'; r.tag = 'ref-lookup-throws'; },
      (r) => { setLabel(r, U.label.feature); r.script.missing = ['issueLabels']; r.expect = '422/422'; r.tag = 'read-missing'; },
      (r) => { setLabel(r, U.label.feature); r.script.p.issueLabels = 'null'; r.expect = '404/404'; r.tag = 'issue-missing'; },
      (r) => { setLabel(r, U.label.feature); r.script.world.trashed = true; r.expect = '409/409'; r.tag = 'trashed'; },
      ...rep(5, (r) => { setLabel(r, U.label.feature); thrown(r, 'issueLabels', 'read'); }),
      (r) => { setLabel(r, U.label.feature); r.script.world.labels = add ? [] : [{ id: U.label.feature, name: 'Feature' }]; r.script.missing = ['updateIssueLabels']; r.expect = '422/422'; r.tag = 'write-missing'; },
      (r) => { setLabel(r, U.label.feature); r.script.world.labels = add ? [] : [{ id: U.label.feature, name: 'Feature' }]; r.script.p.updateIssueLabels = cyc(['null', 'false']); r.expect = '502/502'; r.tag = 'rejected'; },
      (r) => { setLabel(r, U.label.feature); r.script.world.labels = add ? [] : [{ id: U.label.feature, name: 'Feature' }]; r.script.p.updateIssueLabels = err('refres'); r.expect = '422/422'; r.tag = 'write-refres'; },
      ...rep(5, (r) => { setLabel(r, U.label.feature); r.script.world.labels = add ? [] : [{ id: U.label.feature, name: 'Feature' }]; thrown(r, 'updateIssueLabels'); }),
      ...rep(3, (r) => { setLabel(r, U.label.feature); r.script.world.labels = add ? [] : [{ id: U.label.feature, name: 'Feature' }]; thrownHard(r, 'updateIssueLabels'); }),
    ];
  };
  sits('W_LABEL_ADD', labelCommon(true));
  sits('W_LABEL_REMOVE', labelCommon(false));

  // ---- rulings -----------------------------------------------------------------------
  const rw = (r, name) => { r.script.rworld = name; };
  sits('R_GET', [
    (r) => { rw(r, cyc(['basic', 'options', 'shared', 'many', 'empty', 'live', 'shelved'])); r.expect = '200/200'; r.tag = 'ok'; },
    (r) => { rw(r, cyc(['resolved', 'shelved', 'basic'])); r.query.includeResolved = cyc(['true', 'true', 'false', '1', 'TRUE', '']); r.expect = '200/200'; r.tag = 'includeResolved'; },
    (r) => { rw(r, cyc(['basic', 'resolved', 'many'])); r.query.issueIdentifier = cyc(['LIN-1', 'LIN-2', 'LIN-999', '']); if (chance(0.5)) r.query.includeResolved = 'true'; r.expect = '200/200'; r.tag = 'issueIdentifier'; },
    (r) => { rw(r, 'basic'); r.mode = 'bare'; r.expect = '200/200'; r.tag = 'bare-mode'; },
    (r) => { rw(r, 'basic'); r.script.rfail = cyc(['dispatch', 'tasks', 'suggestions']); r.expect = '500/500'; r.tag = 'store-fails'; },
    (r) => { rw(r, 'many'); r.headers.authorization = 'Bearer tok-read'; r.expect = '200/200'; r.tag = 'read-scope'; r.advance = cyc([10, 6000]); },
  ]);
  const suggestBase = (r, o) => { rw(r, 'options'); r.body = { reason: cyc(['because it shipped', '  padded reason  ', 'unicode ✓ reason']), ...o }; };
  const suggestSits = (answer) => [
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : cyc(['d-1', 'd-opt']); r.expect = '201/201'; r.tag = 'ok'; r.script.world.after = 'get'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.body.decisionLoopId = answer ? 'loop-2' : 'loop-1'; r.expect = '201/201'; r.tag = 'ok-loop-scoped'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = 'nonesuch'; r.expect = '404/404'; r.tag = 'unknown-decision'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.body.decisionLoopId = 'no-such-loop'; r.expect = '404/404'; r.tag = 'unknown-loop'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.body.decisionLoopId = cyc(['', 5, null]); r.expect = '400/400'; r.tag = 'bad-loop-id'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.body.reason = cyc([undefined, '', '   ', 7]); r.expect = '400/400'; r.tag = 'reason-missing'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.body.reason = mk(501); r.expect = '400/400'; r.tag = 'reason-too-long'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.mode = 'bare'; r.expect = '503/503'; r.tag = 'no-store-503'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.script.suggest = 'null'; r.expect = '500/500'; r.tag = 'store-returns-null'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.script.suggest = 'throw'; r.expect = '500/500'; r.tag = 'store-throws'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.script.rfail = 'dispatch'; r.expect = '500/500'; r.tag = 'read-fails'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.headers.authorization = 'Bearer tok-read'; r.overlay = false; r.expect = '403/n'; r.tag = 'read-scope-403'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.headers.authorization = 'Bearer tok-ws2'; r.overlay = false; r.expect = '404/404'; r.tag = 'cross-workspace-404'; },
    (r) => { suggestBase(r, answer ? { optionId: 'a' } : {}); r.params.decisionId = answer ? 'd-opt' : 'd-1'; r.headers.authorization = cyc(['Bearer tok-rw-orphan', 'Bearer tok-rw-bare', 'Bearer tok-rw2']); r.expect = '201/201'; r.tag = 'attribution-variants'; },
  ];
  sits('R_DISMISS', suggestSits(false));
  sits('R_ANSWER', [
    ...suggestSits(true),
    (r) => { suggestBase(r, {}); r.params.decisionId = 'd-opt'; r.body.optionId = cyc([undefined, '', '  ', 5]); r.expect = '400/400'; r.tag = 'optionId-required'; },
    (r) => { suggestBase(r, { optionId: 'a' }); r.params.decisionId = cyc(['d-1', 'd-noopt']); r.expect = '422/422'; r.tag = 'no-options'; },
    (r) => { suggestBase(r, { optionId: 'zzz' }); r.params.decisionId = 'd-opt'; r.expect = '422/422'; r.tag = 'option-not-found'; },
  ]);

  // Generic exits every write route has: an unresolvable credential (503) and a resolve that rejects.
  for (const form of WRITE_FORMS) {
    const descEdit = form === 'W_DESC_APPEND' || form === 'W_DESC_REPLACE';
    const needsValid = (r) => {
      // a valid body so the exit under test is reached
      if (form === 'W_DESC_APPEND') r.body = { block: 'ok' };
      else if (form === 'W_DESC_REPLACE') r.body = { oldString: 'Existing', newString: 'ok' };
      else if (form === 'W_ISSUE_CREATE') r.body = { title: 'T', teamId: U.team };
      else if (form === 'W_ISSUE_PATCH') r.body = { title: 'T' };
      else if (form === 'W_COMMENT_NESTED' || form === 'W_COMMENT_FLAT' || form === 'W_COMMENT_PATCH') r.body = { body: 'ok' };
      else if (form === 'W_ATTACH') r.body = att();
      else if (form === 'W_REL_CREATE') r.body = { type: 'blocks', relatedIssueId: U.issue2 };
      else if (form === 'W_LABEL_ADD') r.body = { labelId: U.label.feature };
    };
    S[form].push((r) => { needsValid(r); r.script.access = cyc(['none', 'none:owner_mismatch', 'none:no_credential']); r.overlay = false; r.expect = '503/503'; r.tag = 'no-credential'; });
    S[form].push((r) => { needsValid(r); r.script.access = 'throw'; r.overlay = false; r.expect = descEdit ? '500/n' : '500/500'; r.tag = 'resolve-rejects'; });
  }

  // Auth layer and transport (before any handler): systematic, so each pair is reached on every form.
  for (const form of FORM_KEYS) {
    const f = FORMS[form];
    S[form].push((r) => { r.overlay = false; const v = cyc(['no-header', 'bad-header', 'unknown-token']); if (v === 'no-header') delete r.headers.authorization; else if (v === 'bad-header') r.headers.authorization = cyc(['Basic abc', 'Bearer ', 'bearer tok-rw']); else r.headers.authorization = 'Bearer tok-unknown'; r.expect = '401/n'; r.tag = `auth-${v}`; });
    S[form].push((r) => { r.overlay = false; r.headers.authorization = cyc(['Bearer tok-consumed', 'Bearer tok-expired']); r.expect = '401/401'; r.tag = 'auth-401-logged'; });
    S[form].push((r) => { r.overlay = false; r.headers.authorization = 'Bearer tok-throws'; r.expect = '500/n'; r.tag = 'auth-store-throws'; });
    if (f.needsWrite) S[form].push((r) => { r.overlay = false; r.headers.authorization = 'Bearer tok-read'; r.expect = '403/n'; r.tag = 'auth-read-scope'; });
    if (f.write && form !== 'W_COMMENT_DELETE' && form !== 'W_REL_DELETE' && form !== 'W_LABEL_REMOVE') {
      S[form].push((r) => { r.overlay = false; r.rawBody = cyc(['{"a":', '{bad json}', '[1,', '{"title": "x",}']); r.expect = '400/n'; r.tag = 'transport-malformed-json'; });
      if (form !== 'W_ATTACH') S[form].push((r) => { r.overlay = false; r.body = { title: 'T' }; r.pad = 260 * 1024; r.expect = '413/n'; r.tag = 'transport-over-250kb'; });
    }
  }

  // task-bound rulings (real TaskDecisionsStore rows seeded into both variants)
  const TASK = 'scan_99999999_open0000001';
  S.R_DISMISS.push((r) => { suggestBase(r, {}); r.params.decisionId = TASK; r.body.decisionLoopId = cyc([undefined, info.openTaskRowId]); r.expect = '201/201'; r.tag = 'task-bound'; });
  S.R_ANSWER.push((r) => { suggestBase(r, { optionId: 'a' }); r.params.decisionId = TASK; r.body.decisionLoopId = cyc([undefined, info.openTaskRowId]); r.expect = '201/201'; r.tag = 'task-bound'; });

  // ---------------------------------------------------------------------------------------
  // Overlays: cross-cutting dimensions applied to a share of every form.
  // ---------------------------------------------------------------------------------------
  const authOverlays = [
    (r) => { delete r.headers.authorization; r.expect = '401/n'; r.tag += '+no-auth'; },
    (r) => { r.headers.authorization = pick(['Basic abc', 'Bearer ', 'bearer tok-rw']); r.expect = '401/n'; r.tag += '+bad-auth-header'; },
    (r) => { r.headers.authorization = 'Bearer tok-unknown'; r.expect = '401/n'; r.tag += '+unknown-token'; },
    (r) => { r.headers.authorization = 'Bearer tok-consumed'; r.expect = '401/401'; r.tag += '+consumed-token'; },
    (r) => { r.headers.authorization = 'Bearer tok-expired'; r.expect = '401/401'; r.tag += '+expired-token'; },
    (r) => { r.headers.authorization = 'Bearer tok-throws'; r.expect = '500/n'; r.tag += '+token-store-throws'; },
  ];
  const accessOverlays = [
    (r) => { r.script.access = pick(['none', 'none:owner_mismatch', 'none:no_credential']); r.expect = '503/503'; r.tag += '+no-credential'; },
  ];
  function applyOverlays(r) {
    const f = FORMS[r.form];
    if (!r.overlay) return;
    if (chance(0.04)) { pick(authOverlays)(r); return; }
    if (f.needsWrite && chance(0.04)) { r.headers.authorization = 'Bearer tok-read'; r.expect = '403/n'; r.tag += '+read-scope'; return; }
    // 503 from an unresolvable credential. Description edits validate before they resolve, so
    // their input-validation 400s keep their status; every other exit before the first
    // resolve is the 503.
    if (f.write && chance(0.04)) {
      const preResolve = (r.form === 'W_DESC_APPEND' || r.form === 'W_DESC_REPLACE') && /^400\//.test(r.expect || '');
      if (!preResolve && !r.script.accessSeq && r.script.access === 'ok') { pick(accessOverlays)(r); return; }
    }
    if (f.write && r.script.access === 'ok' && !r.script.accessSeq && chance(0.03) && !r.noAccessThrow) {
      // resolveWorkspaceAccess rejects. Everywhere but the description edits this is caught
      // and mapped; the description edits resolve outside any try (candidate fix a1).
      const unlogged = r.form === 'W_DESC_APPEND' || r.form === 'W_DESC_REPLACE';
      if (!(unlogged && /^400\//.test(r.expect || ''))) { r.script.access = 'throw'; r.expect = unlogged ? '500/n' : '500/500'; r.tag += '+resolve-rejects'; return; }
    }
    if (chance(0.03)) r.script.scope = 'obj';
    if (!r.sensitiveAuthErr && chance(0.05)) r.script.expires = pick(['past', 'none']);
    if (!r.sensitiveAuthErr && chance(0.04)) r.script.registry = pick([{ suspect: true }, { past: true }, { superseded: true }]);
    if (chance(0.03)) r.script.fp = false;
    if (chance(0.03)) { r.headers.authorization = 'Bearer tok-ws2'; if (r.form === 'R_DISMISS' || r.form === 'R_ANSWER') r.expect = /^400\//.test(r.expect || '') ? r.expect : null; }
  }
  function applyTransport(r) {
    if (!FORMS[r.form].write || r.body === undefined || !r.overlay || r.method === 'DELETE') return;
    const pCont = r.form === 'W_ATTACH' ? 0.02 : 0.03;
    if (chance(pCont)) { r.rawBody = pick(['{"a":', '{bad json}', '[1,', '', '{"title": "x",}']); r.expect = r.rawBody === '' ? null : '400/n'; r.tag += '+malformed-json'; if (r.rawBody === '') { r.rawBody = undefined; r.body = undefined; } return; }
    if (chance(0.015) && r.form !== 'W_ATTACH') { r.pad = 260 * 1024; r.expect = '413/n'; r.tag += '+over-250kb'; return; }
    if (chance(0.02)) { r.body = pick([[], [1, 2], 'str-not-allowed']); if (typeof r.body === 'string') { r.rawBody = '"just a string"'; r.body = undefined; r.expect = '400/n'; } else r.expect = null; r.tag += '+non-object-body'; return; }
    if (chance(0.03)) { r.headers['content-type'] = 'text/plain'; r.expect = null; r.tag += '+text-plain'; }
  }

  // ---------------------------------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------------------------------
  function finish(r) {
    const f = FORMS[r.form];
    if (f.write && r.form !== 'W_ISSUE_CREATE' || r.form === 'W_ISSUE_CREATE') {
      if (chance(0.34) && f.write) r.query.source = pick(SOURCES);
    }
    let p = f.tpl;
    for (const [k, val] of Object.entries(r.params)) p = p.replace(`:${k}`, /%[0-9a-f]{2}/i.test(String(val)) ? String(val) : encodeURIComponent(String(val)));
    let body = r.rawBody;
    if (body === undefined && r.body !== undefined) body = JSON.stringify(r.body);
    if (r.pad && body !== undefined) {
      if (r.headers['content-type'] === 'text/plain') {
        // large non-JSON attachment body: a valid JSON document padded after the payload, sent as text/plain
        const o = JSON.parse(body); o.body = 'pad'; o.image = pngDataUrl(r.pad); body = JSON.stringify(o);
      } else body = JSON.stringify({ ...(r.body || {}), __pad: mk(r.pad) });
    } else if (r.pad) body = JSON.stringify({ __pad: mk(r.pad) });
    const q = Object.entries(r.query).map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
    const sc = { resetCache: FORMS[r.form].write === false && !r.keepCache, idx: idx++, form: r.form, method: r.method, path: p, query: q, headers: r.headers, body, mode: r.mode, advance: r.advance, script: r.script, expect: r.expect, tag: r.tag, source: r.query.source };
    return sc;
  }

  function build(form, k) {
    const r = skeleton(form);
    const list = S[form];
    const sit = list[k % list.length];
    sit(r);
    r.tag = `${form}:${r.tag}`;
    applyOverlays(r);
    applyTransport(r);
    return r;
  }

  // ---- macros: stateful sequences ----------------------------------------------------
  function* dedupeMacro() {
    const flat = chance(0.5);
    const form = flat ? 'W_COMMENT_FLAT' : 'W_COMMENT_NESTED';
    const other = flat ? 'W_COMMENT_NESTED' : 'W_COMMENT_FLAT';
    const issue = ISSUE_OK();
    const bodyText = `dedupe ${idx} ${text()}`;
    const mkc = (f, extra = {}) => { const r = skeleton(f); r.params.issueId = issue; r.body = { body: bodyText }; r.overlay = false; Object.assign(r, extra); return r; };
    const first = mkc(form); first.expect = '201/201'; first.tag = 'dedupe:create'; first.script.ledger = pick(['ok', 'throw']);
    yield finish(first);
    const hit = mkc(chance(0.4) ? other : form); hit.expect = '200/200'; hit.tag = 'dedupe:hit'; hit.script.ledger = pick(['ok', 'throw']);
    if (chance(0.3)) hit.headers.authorization = pick(['Bearer tok-rw2', 'Bearer tok-rw-orphan']);
    if (chance(0.15)) hit.params.issueId = issue.toUpperCase() === issue ? issue.toLowerCase() : issue.toUpperCase();
    if (hit.params.issueId !== issue) { hit.expect = null; }
    yield finish(hit);
    const mode = int(5);
    if (mode === 0) {
      const d = skeleton('W_COMMENT_DELETE'); d.overlay = false; d.expect = '200/200'; d.tag = 'dedupe:delete-bumps'; yield finish(d);
    } else if (mode === 1) {
      const e = skeleton('W_COMMENT_PATCH'); e.overlay = false; e.body = { body: 'edited' }; e.expect = '200/200'; e.tag = 'dedupe:edit-bumps'; yield finish(e);
    } else if (mode === 2) {
      const t = mkc(form); t.advance = 5 * 60 * 1000 + 1500; t.expect = '201/201'; t.tag = 'dedupe:expired'; yield finish(t); return;
    } else if (mode === 3) {
      const t = mkc(form); t.script.world.trashed = true; t.expect = '409/409'; t.tag = 'dedupe:trashed-before-hit'; yield finish(t); return;
    } else {
      const t = mkc(form); t.body = { body: bodyText + ' (different)' }; t.expect = '201/201'; t.tag = 'dedupe:other-body'; yield finish(t);
      const t2 = mkc(form); t2.params.issueId = issue === U.issue ? U.issue2 : U.issue; t2.expect = '201/201'; t2.tag = 'dedupe:other-issue'; yield finish(t2); return;
    }
    const again = mkc(form); again.expect = '201/201'; again.tag = 'dedupe:fresh-after-bump'; yield finish(again);
    const again2 = mkc(form); again2.expect = '200/200'; again2.tag = 'dedupe:hit-after-bump'; yield finish(again2);
  }
  function* rulingsMacro() {
    // world -> a decision that exists in it, and what suggest-answer does with it
    const table = [
      { w: 'options', d: 'd-opt', a: '201/201' }, { w: 'options', d: 'd-1', a: '422/422' }, { w: 'basic', d: 'd-1', a: '422/422' },
      { w: 'shared', d: 'd-shared', a: '201/201' }, { w: 'many', d: 'd-1', a: '201/201' }, { w: 'many', d: 'd-0', a: '422/422' },
    ];
    const t = pick(table);
    const get = (tag, extra = {}) => { const r = skeleton('R_GET'); r.overlay = false; r.script.rworld = t.w; r.expect = '200/200'; r.keepCache = tag !== 'rulings:get-cold'; r.tag = tag; Object.assign(r, extra); return r; };
    yield finish(get('rulings:get-cold', { advance: 6000 }));
    yield finish(get('rulings:get-warm'));
    const answer = chance(0.5);
    const s = skeleton(answer ? 'R_ANSWER' : 'R_DISMISS'); s.overlay = false; s.script.rworld = t.w; s.keepCache = true;
    s.params.decisionId = t.d;
    s.body = answer ? { optionId: 'a', reason: 'macro' } : { reason: 'macro' };
    s.expect = answer ? t.a : '201/201';
    s.tag = 'rulings:suggest'; yield finish(s);
    yield finish(get('rulings:get-after-suggest'));
    yield finish(get('rulings:get-swr', { advance: 6000 }));
    yield finish(get('rulings:get-after-swr'));
  }
  function* bigMacro(kind) {
    const r = skeleton('W_ATTACH'); r.overlay = false;
    if (kind === 'too-large-image') { r.rawBody = JSON.stringify({ image: tooBigImage() }); r.headers['content-type'] = 'text/plain'; r.expect = '413/413'; r.tag = 'W_ATTACH:image-too-large'; }
    else { r.rawBody = ''.padEnd(15 * 1024 * 1024, 'x'); r.headers['content-type'] = 'text/plain'; r.expect = '413/n'; r.tag = 'W_ATTACH:body-over-14mb'; }
    yield finish(r);
  }

  function* all(total) {
    let produced = 0;
    let bigCount = 0;
    while (produced < total) {
      const form = FORM_KEYS[produced % FORM_KEYS.length];
      counters[form] = (counters[form] || 0) + 1;
      // stateful macros: roughly 1 in 12 slots
      if (chance(0.085)) {
        const m = chance(0.6) ? dedupeMacro() : rulingsMacro();
        for (const sc of m) { yield sc; produced++; }
        continue;
      }
      if (produced % 500 === 250 && bigCount < 12) {
        const kind = bigCount % 2 === 0 ? 'too-large-image' : 'body-over-14mb';
        bigCount++;
        for (const sc of bigMacro(kind)) { yield sc; produced++; }
        continue;
      }
      const r = build(form, counters[form] - 1 + int(1));
      yield finish(r);
      produced++;
    }
  }
  return { all, rng };
}
