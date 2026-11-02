/**
 * LIN-4140 — shared decision-row fixtures for the question-card tests.
 *
 * `LOOP_BACKED_ROWS` are the rows whose rendered card must stay BYTE-IDENTICAL
 * across the LIN-4140 change; their pinned output lives in
 * tests/fixtures/question-card-loop-golden.json (generated once, before the
 * change, from unmodified code). `TASK_BOUND_ROW` is the scan-raised row the
 * change makes answerable.
 */

export const RENDER_OPTS = { urlKey: 'w', canReply: true, sessionTerminal: false, sessionWaiting: false };

export const LOOP_ISSUE_UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const TASK_ISSUE_UUID = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';
export const TASK_DECISION_ID = 'td-1';

const OPTIONS = [
  { id: 'opt-a', label: 'Yes, ship it' },
  { id: 'opt-b', label: 'Not yet' }
];

const loopAnchor = (over = {}) => ({
  loopId: 'lp-1',
  issueId: LOOP_ISSUE_UUID,
  issueIdentifier: 'LIN-1',
  workspaceUrlKey: 'w',
  target: 'cli',
  followUpTo: 'lp-1',
  source: null,
  taskDecisionId: null,
  ...over
});

export const LOOP_BACKED_ROWS = {
  'loop-plain-no-options': {
    decision: { decision_id: 'd-plain', question: 'Ship the change?' },
    decisionCase: ['The diff is ready.'],
    anchor: loopAnchor(),
    stampLoopId: 'lp-1',
    disposition: 'resumable',
    effect: 'resume',
    canReply: true
  },
  'loop-with-options': {
    decision: { decision_id: 'd-opts', question: 'Which path?', options: OPTIONS },
    decisionCase: ['Two paths were considered.', 'Path A is smaller.'],
    anchor: loopAnchor({ source: 'github' }),
    stampLoopId: 'lp-1',
    disposition: 'resumable',
    effect: 'resume',
    canReply: true
  },
  'loop-joined-with-options': {
    decision: { decision_id: 'd-joined', question: 'Join the copies?', options: OPTIONS },
    decisionCase: [],
    anchor: loopAnchor(),
    stampLoopId: 'lp-1',
    stampLoopIds: ['lp-1', 'ap-2'],
    disposition: 'resumable',
    effect: 'resume',
    canReply: true
  },
  'loop-gone-dispatch-record-on': {
    decision: {
      decision_id: 'd-gone',
      question: 'Record where?',
      on_answer: { effect: 'record', record_on: 'LIN-9' }
    },
    decisionCase: ['A sibling owns this.'],
    anchor: loopAnchor({ loopId: 'lp-9', target: 'web', followUpTo: 'lp-9' }),
    stampLoopId: 'lp-9',
    disposition: 'gone',
    effect: 'record',
    canReply: true
  },
  'loop-readonly-mid-turn': {
    decision: { decision_id: 'd-mid', question: 'Still thinking?', options: OPTIONS },
    decisionCase: ['<b>not escaped away</b>'],
    anchor: loopAnchor(),
    stampLoopId: 'lp-1',
    disposition: 'mid-turn',
    effect: 'resume',
    canReply: true
  },
  'loop-cannot-reply': {
    decision: { decision_id: 'd-noreply', question: 'Can you answer?' },
    decisionCase: [],
    anchor: loopAnchor(),
    stampLoopId: 'lp-1',
    disposition: 'resumable',
    effect: 'resume',
    canReply: false
  }
};

/** The scan-raised row: `loopId` null, a scan decision id, and the issue's UUID. */
export const TASK_BOUND_ROW = {
  decision: { decision_id: 'd-tb', question: 'Ship the scanned fix?', options: OPTIONS },
  decisionCase: ['A scan found a blocker.'],
  anchor: {
    loopId: null,
    issueId: TASK_ISSUE_UUID,
    issueIdentifier: 'LIN-7',
    workspaceUrlKey: 'w',
    target: null,
    followUpTo: null,
    taskDecisionId: TASK_DECISION_ID,
    source: 'github'
  },
  disposition: 'task-bound',
  canReply: true,
  effect: 'record',
  declaredEffect: 'record'
};
