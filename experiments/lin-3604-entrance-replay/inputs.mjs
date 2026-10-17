/**
 * LIN-3604 replay inputs. Pure and seeded: the same `seed` yields the same stream, whatever tree
 * it is later run against. Four classes:
 *
 *   seeded     ~1,000 inputs (S 300, P 300, Ro 120, Rl 120, K 160): a valid body template for the
 *              entrance, then 0-3 field mutations (absent / valid / wrong-typed / at-length) and 0-3
 *              world changes (auth state, grants, faults, provider, credential, hang-up, keepalive).
 *   steps      the multi-fault class (plan-review F3): one fault per check step of each entrance,
 *              every ordered pair of steps in one body, seeded triples, and pairs inside the shared
 *              payload validator. First-failure order only shows when a body has two bad fields.
 *   grants     valid issue + a token lacking `dispatch` on P, Ro, Rl and K: nothing may be enqueued.
 *   fixtures   the plan-review's named inputs.
 *
 * The pair inputs carry tag `pair:<lane>:<i>:<j>` and their single faults `single:<lane>:<i>`;
 * compare.mjs uses them for the vacuity guard (the old tree must answer a pair with its EARLIER
 * step's single-fault answer).
 */
import { DISPATCH_RUNGS, SURFACES } from '../../lib/task-mode-store.js';
import { PERIODICAL_AUTOPILOT_TAIL } from '../../lib/periodicals.js';

const UUID = '11111111-2222-4333-8444-555555555555';
const UUID_B = '99999999-8888-4777-8666-555555555555';
const DELETE = Symbol('delete');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const long = (n, ch = 'x') => ch.repeat(n);

/** Per-field pools: `ok` values a validator accepts, `bad` values it rejects or must handle. */
const POOLS = {
  prompt: { ok: ['do the thing', 'multi\nline prompt', long(40)], bad: [123, '', 'bad\u0001char', true, null, [], {}] },
  promptName: { ok: ['Impl', 'Run it'], bad: [long(1001), 5, 'bad\u0002name'] },
  kind: { ok: ['implementation', 'plan', 'autopilot', 'periodical', 'custom'], bad: ['nonsense', 5, null, ''] },
  issueId: { ok: ['issue-id-1'], bad: ['bad id!', long(5, '!')] },
  issueIdentifier: { ok: ['TEST-1', 'TEST-2', 'GATE-1', 'LIN-5', 'NOPE-1', 'GONE-1', 'BOOM-1', 'BOOM-2'], bad: [long(101), 'bad id', 5, '', null] },
  issueTitle: { ok: ['A title'], bad: [long(1001), 'bad\u0003t'] },
  issueUrl: { ok: ['https://example.test/x'], bad: [long(8001)] },
  issueSource: { ok: ['linear', 'github-projects', 'jira'], bad: ['weird', 5] },
  target: { ok: ['cli', 'web', 'dash', 'local'], bad: ['bogus', 5, null] },
  repo: { ok: ['my-repo', 'owner/name'], bad: [long(1001), 5, 'bad\u0004repo'] },
  model: { ok: ['some-model'], bad: [5, long(1001), 'bad\u0005m'] },
  harness: { ok: ['claude-code', 'opencode', 'codex'], bad: [5, long(1001)] },
  terminal: { ok: ['kitty', 'xterm'], bad: [5, long(1001)] },
  effort: { ok: ['low', 'high', 'max', 'turbo'], bad: [5, long(1001)] },
  followUpTo: { ok: [UUID, UUID_B], bad: ['not-a-uuid', 5, null, ''] },
  force: { ok: [true, false], bad: ['y', 1] },
  abort: { ok: [true, false], bad: ['y', 1] },
  abortTo: { ok: [UUID], bad: ['nope', 5, ''] },
  cascade: { ok: [true, false], bad: ['x', 1] },
  sessionId: { ok: ['sess-1', 'parent-run'], bad: ['__meta__', '', 5, long(129), 'bad\nid'] },
  periodicalId: { ok: ['documentation-review', 'api-quality'], bad: ['unknown', 5] },
  waitForFollowUps: { ok: [true, false], bad: ['x', 1] },
  queueIfBusy: { ok: [true, false], bad: ['x', 1] },
  subscription: { ok: ['everything', 'terminal-only'], bad: ['bad', true, 5] },
  attachProxy: { ok: [true, false], bad: ['x', 1] },
  appendProxyContext: { ok: [true, false], bad: ['x', null] },
  presetId: { ok: ['preset-1'], bad: ['', 5, '  ', null] },
  maxTasks: { ok: [1, 3, 50], bad: [0, -1, 'x', 2.5] },
  composedRunMarker: { ok: ['marker-1'], bad: ['', 5] },
  entryRung: { ok: [...DISPATCH_RUNGS], bad: ['nonsense', 5] },
  surface: { ok: [...SURFACES], bad: ['nope', 5] },
  stopAt: { ok: ['pr'], bad: ['nope', 5] },
  variant: { ok: ['standard', 'stepper'], bad: ['nope', 5] },
  noDescend: { ok: [true, false], bad: ['x', 1] },
  goal: { ok: ['ship the thing', long(300)], bad: [5, long(100001)] },
  mode: { ok: ['write', 'readonly'], bad: ['nope', 5] },
  ifParked: { ok: [false], bad: [true, 'x'] }
};

const LANE_FIELDS = {
  S: ['prompt', 'promptName', 'kind', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'issueSource', 'target', 'repo', 'model', 'harness', 'terminal', 'effort', 'followUpTo', 'force', 'abort', 'abortTo', 'cascade', 'sessionId', 'periodicalId', 'waitForFollowUps', 'queueIfBusy', 'subscription', 'attachProxy', 'presetId', 'maxTasks', 'composedRunMarker', 'entryRung', 'surface', 'stopAt', 'variant', 'ifParked'],
  P: ['prompt', 'promptName', 'kind', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'issueSource', 'target', 'repo', 'model', 'harness', 'terminal', 'effort', 'followUpTo', 'force', 'abort', 'abortTo', 'cascade', 'sessionId', 'periodicalId', 'waitForFollowUps', 'queueIfBusy', 'subscription', 'appendProxyContext', 'maxTasks', 'ifParked', 'presetId', 'stopAt', 'variant', 'entryRung', 'attachProxy', 'surface', 'composedRunMarker'],
  R: ['issueIdentifier', 'issueSource', 'target', 'repo', 'model', 'harness', 'effort', 'appendProxyContext', 'noDescend', 'kind', 'sessionId', 'waitForFollowUps', 'queueIfBusy', 'subscription', 'periodicalId', 'followUpTo', 'force', 'terminal', 'maxTasks', 'prompt'],
  K: ['goal', 'mode', 'variant', 'issueIdentifier', 'issueSource', 'target', 'repo', 'appendProxyContext', 'sessionId', 'subscription', 'model', 'harness', 'effort', 'presetId', 'maxTasks', 'terminal', 'followUpTo']
};

// Valid body templates per entrance. Each passes every check and reaches the enqueue in the default world.
const TEMPLATES = {
  S: [
    { prompt: 'do it', target: 'cli' },
    { prompt: 'do it', issueIdentifier: 'TEST-1', issueSource: 'linear' },
    { abort: true, abortTo: UUID, target: 'cli' },
    { abort: true, cascade: true, abortTo: UUID },
    { prompt: 'again', followUpTo: UUID, target: 'cli' },
    { prompt: 'again', followUpTo: UUID, target: 'web', attachProxy: true, harness: 'claude-code', issueIdentifier: 'TEST-1' },
    { prompt: 'attach me', attachProxy: true, harness: 'claude-code', issueIdentifier: 'TEST-1' },
    { prompt: 'attach me', attachProxy: true, harness: 'opencode', issueIdentifier: 'TEST-1' },
    { prompt: 'autopilot', kind: 'autopilot', attachProxy: true, harness: 'claude-code', stopAt: 'pr', variant: 'stepper', issueIdentifier: 'TEST-1' },
    { prompt: `periodical${PERIODICAL_AUTOPILOT_TAIL}`, kind: 'periodical', periodicalId: 'documentation-review', attachProxy: true, harness: 'claude-code' },
    { prompt: 'periodical', kind: 'periodical', periodicalId: 'documentation-review', attachProxy: true },
    { prompt: 'preset run', presetId: 'preset-1' },
    { prompt: 'ladder', issueIdentifier: 'TEST-1', entryRung: DISPATCH_RUNGS[0], surface: SURFACES[0] },
    { prompt: 'forced', issueIdentifier: 'TEST-1', force: true },
    { prompt: 'composed', issueIdentifier: 'TEST-1', composedRunMarker: 'marker-1' },
    { prompt: 'budgeted', issueIdentifier: 'TEST-1', sessionId: 'sess-1', maxTasks: 3 },
    { prompt: 'everything', subscription: 'everything', waitForFollowUps: true, queueIfBusy: true, sessionId: 'sess-1', model: 'm', harness: 'claude-code', effort: 'high', terminal: 'kitty', repo: 'my-repo' }
  ],
  P: [
    { prompt: 'do it' },
    { prompt: 'do it', issueIdentifier: 'TEST-1', issueSource: 'linear' },
    { prompt: 'do it', repo: 'my-repo' },
    { abort: true, abortTo: UUID },
    { abort: true, cascade: true, abortTo: UUID, target: 'web' },
    { prompt: 'again', followUpTo: UUID },
    { prompt: 'again', followUpTo: UUID, appendProxyContext: true, harness: 'claude-code' },
    { prompt: 'again', followUpTo: UUID, appendProxyContext: false, harness: 'claude-code' },
    { prompt: 'attach me', harness: 'claude-code', issueIdentifier: 'TEST-1' },
    { prompt: 'attach me', harness: 'opencode', issueIdentifier: 'TEST-2' },
    { prompt: 'no attach', appendProxyContext: false, harness: 'claude-code' },
    { prompt: 'forced', issueIdentifier: 'TEST-1', force: true },
    { prompt: 'budgeted', issueIdentifier: 'TEST-1', sessionId: 'sess-1', maxTasks: 3, subscription: 'everything' },
    { prompt: 'periodical', kind: 'periodical', periodicalId: 'api-quality' },
    { prompt: 'everything', subscription: 'everything', waitForFollowUps: true, queueIfBusy: true, sessionId: 'sess-1', model: 'm', harness: 'claude-code', effort: 'high', terminal: 'kitty', repo: 'my-repo', promptName: 'Named', issueId: 'issue-1', issueTitle: 'T', issueUrl: 'https://example.test/x' }
  ],
  Ro: [
    { issueIdentifier: 'TEST-1', kind: 'implementation' },
    { issueIdentifier: 'TEST-2', kind: 'plan', harness: 'claude-code', sessionId: 'sess-1' },
    { issueIdentifier: 'GATE-1', kind: 'implementation' },
    { issueIdentifier: 'GATE-1', kind: 'implementation', periodicalId: 'api-quality' },
    { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: UUID },
    { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: UUID, appendProxyContext: true, harness: 'claude-code' },
    { issueIdentifier: 'TEST-1', kind: 'implementation', appendProxyContext: false },
    { issueIdentifier: 'TEST-1', kind: 'implementation', repo: 'my-repo', target: 'web', force: true, waitForFollowUps: true, queueIfBusy: true, subscription: 'everything' }
  ],
  Rl: [
    { issueIdentifier: 'TEST-1' },
    { issueIdentifier: 'TEST-2', harness: 'claude-code', sessionId: 'sess-1' },
    { issueIdentifier: 'TEST-1', noDescend: true },
    { issueIdentifier: 'TEST-1', followUpTo: UUID },
    { issueIdentifier: 'TEST-1', followUpTo: UUID, appendProxyContext: true, harness: 'claude-code' },
    { issueIdentifier: 'TEST-1', appendProxyContext: false },
    { issueIdentifier: 'TEST-1', repo: 'my-repo', target: 'dash', force: true, waitForFollowUps: true, queueIfBusy: true, subscription: 'everything', periodicalId: 'api-quality' }
  ],
  K: [
    {},
    { goal: 'ship it' },
    { issueIdentifier: 'TEST-1' },
    { issueIdentifier: 'TEST-1', goal: 'also this', mode: 'readonly', variant: 'stepper' },
    { goal: 'x', appendProxyContext: false },
    { issueIdentifier: 'TEST-1', harness: 'claude-code', model: 'm', effort: 'high' },
    { goal: 'x', presetId: 'preset-1' },
    { goal: 'x', maxTasks: 4, sessionId: 'sess-1', subscription: 'everything' },
    { issueIdentifier: 'TEST-1', repo: 'my-repo', target: 'web', variant: 'standard' }
  ]
};

const WORLD_KNOBS = {
  S: [
    () => ({ account: 'member' }), () => ({ account: 'none' }), () => ({ ownerCheck: 'not-owner' }), () => ({ ownerCheck: 'unwired' }), () => ({ ownerCheck: 'throws' }),
    () => ({ sessionApiKey: 'sk-paid' }), () => ({ freeEnv: true, runGate: 'deny' }), () => ({ freeEnv: true, runGate: 'unverified' }), () => ({ freeEnv: true }),
    () => ({ dangling: true, danglingId: 'TEST-1' }), () => ({ noInjectedProvider: true }), () => ({ providerNoWrite: true }), () => ({ accessTokenNull: true }), () => ({ noAccessToken: true }), () => ({ noFetchContext: true }),
    () => ({ addThrows: 'duplicate' }), () => ({ addThrows: 'runLimit429' }), () => ({ addThrows: 'runLimit503' }), () => ({ addThrows: 'closeOut' }), () => ({ addThrows: 'runaway' }), () => ({ addThrows: 'budget' }),
    () => ({ addThrows: 'attachFailed' }), () => ({ addThrows: 'structural' }), () => ({ addThrows: 'anchorTerminal' }), () => ({ addThrows: 'composedInvalid' }), () => ({ addThrows: 'generic' }),
    () => ({ mint: 'throws' }), () => ({ mint: 'none' }), () => ({ grantMint: 'refuse' }), () => ({ grantMint: 'transient' }), () => ({ grantMint: 'throws' }), () => ({ grantMint: 'none' }),
    () => ({ grantLookup: 'record' }), () => ({ grantLookup: 'throws' }), () => ({ grantLookup: 'corrupt' }), () => ({ noPreset: true }), () => ({ noPresetStore: true }),
    () => ({ parent: { stopAt: 'pr' } }), () => ({ statusThrows: true }), () => ({ budgeted: true }), () => ({ seen: '2026-10-17T11:59:00.000Z' }), () => ({ seen: null }),
    () => ({ noTaskMode: true }), () => ({ taskModeThrows: true }), () => ({ defaults: { model: 'dflt-model', harness: 'dflt-harness' } }), () => ({ planThrows: true }), () => ({ parser: false })
  ]
};
WORLD_KNOBS.P = [
  () => ({ createdBy: null }), () => ({ noStore: true }), () => ({ token: null }), () => ({ token: 'test-token' }), () => ({ reason: 'expired' }),
  () => ({ accessThrows: 'auth401' }), () => ({ accessThrows: 'auth503' }), () => ({ dangling: true, danglingId: 'TEST-1' }), () => ({ providerNoWrite: true }), () => ({ providerNoContext: true }),
  () => ({ sessionApiKey: 'sk-paid' }), () => ({ freeEnv: true, runGate: 'deny' }), () => ({ freeEnv: true, runGate: 'unverified' }), () => ({ freeEnv: true }), () => ({ keyThrows: true }),
  () => ({ addThrows: 'duplicate' }), () => ({ addThrows: 'runLimit429' }), () => ({ addThrows: 'runLimit503' }), () => ({ addThrows: 'closeOut' }), () => ({ addThrows: 'runaway' }), () => ({ addThrows: 'budget' }),
  () => ({ addThrows: 'attachFailed' }), () => ({ addThrows: 'structural' }), () => ({ addThrows: 'generic' }), () => ({ addThrows: 'auth401' }),
  () => ({ mint: 'throws' }), () => ({ mint: 'none' }), () => ({ grantLookup: 'record' }), () => ({ grantLookup: 'throws' }), () => ({ grantLookup: 'corrupt' }), () => ({ grantMint: 'refuse' }), () => ({ grantMint: 'transient' }),
  () => ({ parent: { stopAt: 'pr' } }), () => ({ budgeted: true }), () => ({ seen: '2026-10-17T11:59:00.000Z' }), () => ({ defaults: { model: 'dflt-model', harness: 'dflt-harness' } }),
  () => ({ planThrows: true }), () => ({ parser: false }), () => ({ providerUi: { displayName: 'Fake' } }), () => ({ declared: false })
];
WORLD_KNOBS.R = [
  ...WORLD_KNOBS.P,
  () => ({ unsupported: ['fetchIssueContext'] }), () => ({ unsupported: ['fetchRecommendationContext'] }), () => ({ slowMs: 60 }), () => ({ slowMs: 60, hangupAfterMs: 25 }),
  () => ({ computeThrows: 'auth401' }), () => ({ computeThrows: 'generic' }), () => ({ recommendation: { recommendedAction: 'defer', prompt: null } }), () => ({ recommendation: { prompt: '' } }),
  () => ({ recommendation: { identifier: 'TEST-2', periodicalId: 'api-quality' } }), () => ({ recommendation: { recommendedAction: 'research' } }), () => ({ recommendation: { recommendedAction: null } }), () => ({ charge: 'deny' }), () => ({ freeEnv: true, charge: 'deny' }),
  () => ({ freeEnv: true, charge: 'allow' })
];
WORLD_KNOBS.K = [
  ...WORLD_KNOBS.P.filter((k) => !['providerNoWrite'].includes(Object.keys(k())[0])),
  () => ({ noKeyReader: true }), () => ({ noPresetStore: true }), () => ({ noPreset: true }), () => ({ workspaceId: undefined, noWorkspace: true }), () => ({ createdBy: null, grantMint: 'refuse' })
];

// Pairs that cannot share a body: the second fault changes what the first one needs to be a fault.
// Each is skipped with its reason in the run output (and the old-tree vacuity guard confirms no other
// pair is vacuous).
const INCOMPATIBLE = {
  'S:promptRequired+abortEligibility': 'abortEligibility sets abort:true, and an abort carries no prompt, so promptRequired is no longer a fault',
  'S:ownerGate+abortEligibility': 'abortEligibility sets target local, which the owner gate lets through untouched',
  'S:ownerGate+localHost': 'localHost sets target local, which the owner gate lets through untouched',
  'S:abortTo+abortEligibility': 'abortEligibility sets abort:true, so abortTo is no longer a fault'
};

function makeId(counter, lane, kind) { return `${lane}-${kind}-${String(counter).padStart(4, '0')}`; }

function applyMutation(body, field, value) {
  if (value === DELETE) delete body[field]; else body[field] = value;
}

/** Faults, one per check step. `set` is a body patch; `world`/`headers` accompany it. */
const FAULTS = {
  S: [
    ['abortFollowUp', { set: { abort: true, abortTo: UUID, followUpTo: UUID_B } }],
    ['promptRequired', { set: { prompt: DELETE } }],
    ['target', { set: { target: 'bogus' } }],
    ['ownerGate', { world: { account: 'member' } }],
    ['abortTo', { set: { abortTo: UUID } }],
    ['abortEligibility', { set: { abort: true, abortTo: UUID, target: 'local' } }],
    ['cascadeShape', { set: { cascade: 'x' } }],
    ['cascadeNeedsAbort', { set: { cascade: true } }],
    ['kind', { set: { kind: 'nonsense' } }],
    ['periodicalId', { set: { periodicalId: 'nope' } }],
    ['waitForFollowUps', { set: { waitForFollowUps: 'x' } }],
    ['queueIfBusy', { set: { queueIfBusy: 'x' } }],
    ['subscription', { set: { subscription: 'bad' } }],
    ['presetShape', { set: { presetId: 5 } }],
    ['presetLookup', { set: { presetId: 'p1' }, world: { noPreset: true } }],
    ['maxTasks', { set: { maxTasks: 0 } }],
    ['attachProxy', { set: { attachProxy: 'x' } }],
    ['entryRung', { set: { entryRung: 'nonsense' } }],
    ['stopAt', { set: { stopAt: 'nope' } }],
    ['variant', { set: { variant: 'nope' } }],
    ['surface', { set: { surface: 'nope' } }],
    ['localHost', { set: { target: 'local' }, headers: { Host: 'evil.example' } }],
    ['payload', { set: { model: 5 } }]
  ],
  P: [
    ['storeMissing', { world: { noStore: true } }],
    ['abortFollowUp', { set: { abort: true, abortTo: UUID, followUpTo: UUID_B } }],
    ['promptRequired', { set: { prompt: DELETE } }],
    ['target', { set: { target: 'bogus' } }],
    ['abortTo', { set: { abortTo: UUID } }],
    ['cascadeShape', { set: { cascade: 'x' } }],
    ['cascadeNeedsAbort', { set: { cascade: true } }],
    ['kind', { set: { kind: 'nonsense' } }],
    ['periodicalId', { set: { periodicalId: 'nope' } }],
    ['waitForFollowUps', { set: { waitForFollowUps: 'x' } }],
    ['queueIfBusy', { set: { queueIfBusy: 'x' } }],
    ['subscription', { set: { subscription: 'bad' } }],
    ['maxTasks', { set: { maxTasks: 0 } }],
    ['payload', { set: { model: 5 } }]
  ],
  R: [
    ['storeMissing', { world: { noStore: true } }],
    ['issueRequired', { set: { issueIdentifier: DELETE } }],
    ['issueIdFormat', { set: { issueIdentifier: 'bad id' } }],
    ['target', { set: { target: 'bogus' } }],
    ['noDescend', { set: { noDescend: 'x' } }],
    ['waitForFollowUps', { set: { waitForFollowUps: 'x' } }],
    ['queueIfBusy', { set: { queueIfBusy: 'x' } }],
    ['subscription', { set: { subscription: 'bad' } }],
    ['repo', { set: { repo: 5 } }],
    ['model', { set: { model: 5 } }],
    ['harness', { set: { harness: 5 } }],
    ['effort', { set: { effort: 5 } }],
    ['kindTemplateKey', { set: { kind: 'nonsense' } }],
    ['periodicalId', { set: { periodicalId: 'nope' } }],
    ['sessionId', { set: { sessionId: '__meta__' } }],
    ['followUpTo', { set: { followUpTo: 'bad' } }],
    ['force', { set: { force: 'y' } }]
  ],
  K: [
    ['storeMissing', { world: { noStore: true } }],
    ['mode', { set: { mode: 'nope' } }],
    ['variantEnum', { set: { variant: 'nope' } }],
    ['goal', { set: { goal: 5 } }],
    ['target', { set: { target: 'bogus' } }],
    ['repo', { set: { repo: 5 } }],
    ['issueIdFormatIfPresent', { set: { issueIdentifier: 'bad id' } }],
    ['sessionId', { set: { sessionId: '__meta__' } }],
    ['subscription', { set: { subscription: 'bad' } }],
    ['model', { set: { model: 5 } }],
    ['harness', { set: { harness: 5 } }],
    ['effort', { set: { effort: 5 } }],
    ['presetShape', { set: { presetId: 5 } }],
    ['presetLookup', { set: { presetId: 'p1' }, world: { noPreset: true } }],
    ['maxTasks', { set: { maxTasks: 0 } }]
  ]
};

// The shared payload validator's own faults (S and P): pairs inside the atomic `payload` step.
const PAYLOAD_FAULTS = [
  ['promptName-cap', { promptName: long(1001) }], ['issueIdentifier-cap', { issueIdentifier: long(101) }], ['issueTitle-cap', { issueTitle: long(1001) }],
  ['issueUrl-cap', { issueUrl: long(8001) }], ['repo-cap', { repo: long(1001) }], ['model-type', { model: 5 }], ['harness-type', { harness: 5 }], ['terminal-type', { terminal: 5 }],
  ['effort-type', { effort: 5 }], ['prompt-ctl', { prompt: 'bad\u0001' }], ['issueId-format', { issueId: 'bad id!' }], ['followUpTo-format', { followUpTo: 'bad' }],
  ['force-type', { force: 'y' }], ['force-cascade', { force: true, cascade: true }], ['force-bare', { force: true, issueIdentifier: DELETE }], ['ifParked', { ifParked: true }], ['sessionId-reserved', { sessionId: '__meta__' }]
];

const BASE = {
  S: { prompt: 'do it' }, P: { prompt: 'do it' }, R: { issueIdentifier: 'TEST-1', kind: 'implementation' }, K: { issueIdentifier: 'TEST-1' }
};

function clean(body) { for (const k of Object.keys(body)) if (body[k] === DELETE) delete body[k]; return body; }

export function buildInputs({ seed = 3604 } = {}) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const out = [];
  let counter = 0;
  const skips = [];
  const add = (lane, tag, body, world = {}, extra = {}) => { counter += 1; out.push({ id: makeId(counter, lane, tag.split(':')[0]), lane, tag, body: clean(body), world, ...extra }); };

  // ── seeded: template + mutations ──────────────────────────────────────────────
  const COUNTS = { S: 300, P: 300, Ro: 120, Rl: 120, K: 160 };
  for (const lane of ['S', 'P', 'Ro', 'Rl', 'K']) {
    const fields = LANE_FIELDS[lane === 'Ro' || lane === 'Rl' ? 'R' : lane];
    const knobs = WORLD_KNOBS[lane === 'Ro' || lane === 'Rl' ? 'R' : lane];
    for (let i = 0; i < COUNTS[lane]; i += 1) {
      const body = { ...pick(TEMPLATES[lane]) };
      const nMut = pick([0, 0, 1, 1, 2, 3]);
      for (let m = 0; m < nMut; m += 1) {
        const field = pick(fields);
        const pool = POOLS[field];
        const roll = rnd();
        if (roll < 0.15) applyMutation(body, field, DELETE);
        else if (roll < 0.6) applyMutation(body, field, pick(pool.ok));
        else applyMutation(body, field, pick(pool.bad));
      }
      if (lane === 'Rl') delete body.kind;
      if (lane === 'Ro' && body.kind === undefined) body.kind = 'implementation';
      const world = { sessionApiKey: lane === 'Rl' || lane === 'Ro' ? 'sk-paid' : undefined };
      const nWorld = pick([0, 0, 1, 1, 2, 3]);
      for (let m = 0; m < nWorld; m += 1) Object.assign(world, pick(knobs)());
      if (lane === 'Rl' && world.sessionApiKey === undefined && !world.freeEnv && world.token !== 'test-token') world.sessionApiKey = 'sk-paid';
      const headers = lane === 'S' && body.target === 'local' && chance(0.6) ? { Host: 'evil.example' } : undefined;
      add(lane, `seeded:${lane}`, body, world, headers ? { headers } : {});
    }
  }

  // ── grants: a valid issue and a token lacking `dispatch` ──────────────────────
  for (const [lane, bodies] of [
    ['P', [{ prompt: 'p', issueIdentifier: 'TEST-1' }, { prompt: 'p' }, { abort: true, abortTo: UUID, cascade: true }]],
    ['Ro', [{ issueIdentifier: 'TEST-1', kind: 'implementation' }]],
    ['Rl', [{ issueIdentifier: 'TEST-1' }]],
    ['K', [{ issueIdentifier: 'TEST-1' }, {}]]
  ]) {
    for (const body of bodies) add(lane, `grant:${lane}`, { ...body }, { noGrant: true, sessionApiKey: 'sk-paid' });
  }

  // ── multi-fault: singles, exhaustive ordered pairs, seeded triples ───────────
  const stepLanes = [['S', 'S'], ['P', 'P'], ['Ro', 'R'], ['K', 'K']];
  const mergeFault = (acc, fault) => {
    const [, spec] = fault;
    for (const [k, v] of Object.entries(spec.set || {})) {
      if (k in acc.set && acc.set[k] !== v) return false;
      acc.set[k] = v;
    }
    Object.assign(acc.world, spec.world || {});
    Object.assign(acc.headers, spec.headers || {});
    return true;
  };
  const build = (lane, tableKey, faults) => {
    const acc = { set: {}, world: { sessionApiKey: 'sk-paid' }, headers: {} };
    for (const f of faults) if (!mergeFault(acc, f)) return null;
    const body = { ...BASE[tableKey] };
    for (const [k, v] of Object.entries(acc.set)) applyMutation(body, k, v);
    return { body, world: acc.world, headers: Object.keys(acc.headers).length ? acc.headers : undefined };
  };
  for (const [lane, tableKey] of stepLanes) {
    const table = FAULTS[tableKey];
    table.forEach((fault, i) => {
      const b = build(lane, tableKey, [fault]);
      add(lane, `single:${lane}:${i}:${fault[0]}`, b.body, b.world, b.headers ? { headers: b.headers } : {});
    });
    for (let i = 0; i < table.length; i += 1) {
      for (let j = i + 1; j < table.length; j += 1) {
        const incompatible = INCOMPATIBLE[`${lane}:${table[i][0]}+${table[j][0]}`];
        if (incompatible) { skips.push(`${lane} ${table[i][0]}+${table[j][0]}: ${incompatible}`); continue; }
        const b = build(lane, tableKey, [table[i], table[j]]);
        if (!b) { skips.push(`${lane} ${table[i][0]}+${table[j][0]}: both set the same field to different values`); continue; }
        add(lane, `pair:${lane}:${i}:${j}:${table[i][0]}+${table[j][0]}`, b.body, b.world, b.headers ? { headers: b.headers } : {});
      }
    }
    for (let t = 0; t < 100; t += 1) {
      const idx = new Set();
      while (idx.size < 3) idx.add(Math.floor(rnd() * table.length));
      const picked = [...idx].sort((a, c) => a - c).map((x) => table[x]);
      const b = build(lane, tableKey, picked);
      if (!b) { skips.push(`${lane} triple ${picked.map((p) => p[0]).join('+')}: field conflict`); continue; }
      add(lane, `triple:${lane}:${picked.map((p) => p[0]).join('+')}`, b.body, b.world, b.headers ? { headers: b.headers } : {});
    }
  }
  // The recommendation arm shares R's list (it runs before the arm fork): the same faults with no `kind`.
  const rlTable = FAULTS.R.filter(([name]) => name !== 'kindTemplateKey');
  for (let i = 0; i < rlTable.length; i += 1) {
    for (let j = i + 1; j < rlTable.length; j += 1) {
      const acc = { set: {}, world: { sessionApiKey: 'sk-paid' }, headers: {} };
      if (!mergeFault(acc, rlTable[i]) || !mergeFault(acc, rlTable[j])) continue;
      const body = { issueIdentifier: 'TEST-1' };
      for (const [k, v] of Object.entries(acc.set)) applyMutation(body, k, v);
      add('Rl', `pairRl:Rl:${i}:${j}:${rlTable[i][0]}+${rlTable[j][0]}`, body, acc.world);
    }
  }
  // Pairs inside the shared payload validator, S and P.
  for (const lane of ['S', 'P']) {
    for (let i = 0; i < PAYLOAD_FAULTS.length; i += 1) {
      for (let j = i + 1; j < PAYLOAD_FAULTS.length; j += 1) {
        const body = { ...BASE[lane] };
        let conflict = false;
        for (const f of [PAYLOAD_FAULTS[i], PAYLOAD_FAULTS[j]]) {
          for (const [k, v] of Object.entries(f[1])) { if (k in body && body[k] !== v && k !== 'prompt') conflict = true; applyMutation(body, k, v); }
        }
        if (conflict) { skips.push(`${lane} payload ${PAYLOAD_FAULTS[i][0]}+${PAYLOAD_FAULTS[j][0]}: field conflict`); continue; }
        add(lane, `payloadPair:${lane}:${i}:${j}:${PAYLOAD_FAULTS[i][0]}+${PAYLOAD_FAULTS[j][0]}`, body, { sessionApiKey: 'sk-paid' });
      }
    }
  }

  // ── fixtures named in the plan review ─────────────────────────────────────────
  add('S', 'fixture:S-abort-local-cascade', { abort: true, abortTo: UUID, target: 'local', cascade: 'yes' }, { account: 'owner', ownerCheck: 'owner' });
  add('P', 'fixture:P-force-effort', { prompt: 'x', force: 'y', effort: long(1001) }, {});

  // ── keepalive: the 25s flush commits a 200, so every later exit travels as `statusCode` in the body ──
  const slow = { sessionApiKey: 'sk-paid', slowMs: 60 };
  for (const [lane, body, world] of [
    ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation' }, {}],
    ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation' }, { addThrows: 'duplicate' }],
    ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation' }, { addThrows: 'attachFailed', harness: 'claude-code' }],
    ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'claude-code' }, { mint: 'none' }],
    ['Ro', { issueIdentifier: 'GONE-1', kind: 'implementation' }, {}],
    ['Ro', { issueIdentifier: 'NOPE-1', kind: 'implementation' }, {}],
    ['Ro', { issueIdentifier: 'BOOM-1', kind: 'implementation' }, {}],
    ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation' }, { hangupAfterMs: 25 }],
    ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: UUID, harness: 'claude-code' }, { grantLookup: 'record', grantMint: 'refuse' }],
    ['Rl', { issueIdentifier: 'TEST-1' }, {}],
    ['Rl', { issueIdentifier: 'TEST-1' }, { addThrows: 'runLimit429' }],
    ['Rl', { issueIdentifier: 'TEST-1' }, { addThrows: 'generic' }],
    ['Rl', { issueIdentifier: 'TEST-1' }, { computeThrows: 'auth401' }],
    ['Rl', { issueIdentifier: 'TEST-1' }, { computeThrows: 'generic' }],
    ['Rl', { issueIdentifier: 'TEST-1' }, { recommendation: { recommendedAction: 'defer', prompt: null } }],
    ['Rl', { issueIdentifier: 'TEST-1' }, { hangupAfterMs: 25 }],
    ['Rl', { issueIdentifier: 'TEST-1', followUpTo: UUID, harness: 'claude-code' }, { grantLookup: 'throws' }]
  ]) add(lane, `keepalive:${lane}`, { ...body }, { ...slow, ...world });

  // ── no body-parser output, per lane ──────────────────────────────────────────
  for (const [lane, body] of [['S', { prompt: 'p' }], ['P', { prompt: 'p' }], ['Ro', { issueIdentifier: 'TEST-1', kind: 'implementation' }], ['Rl', { issueIdentifier: 'TEST-1' }], ['K', { goal: 'x' }]]) {
    add(lane, `noparser:${lane}`, body, { parser: false, sessionApiKey: 'sk-paid' });
    add(lane, `nobody:${lane}`, body, { sessionApiKey: 'sk-paid' }, { noBody: true });
  }

  out.skips = skips;
  return out;
}
