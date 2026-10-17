// Generators for lib/render-session.js: the run page (renderSessionPage) and
// its PR line. Session/loop shapes follow lib/pipeline-loops.js +
// lib/run-view.js + lib/render-run-steps.js (the fields those read).
import { DAY, HOUR, ESC, HAZARD, text, markdown, clean } from './gen-common.mjs';
import { makeFeatureFlags, makeWorkspaces, makeDeployInfo, URL_KEYS } from './gen-world.mjs';

const KINDS = [['autopilot', 2], ['wake', 1], ['plan', 2], ['implementation', 3], ['review', 2], ['close-out', 1], ['research', 1], ['bug', 1], ['custom', 1], [null, 0.5], ['mystery-kind', 0.3]];
const MODELS = ['claude-opus-4-8', 'anthropic/claude-sonnet-4.6', 'gpt-5.5-mini', 'claude-haiku-4.5', 'gpt-5.6-sol', 'fable', 'weird-model', '', null];

function iso(nowMs, d) { return new Date(nowMs + d).toISOString(); }

function feedbackEntry(rng, nowMs) {
  const msg = rng.weighted([
    [() => `[blocked] ${text(rng)}`, 2], [() => `[pending] ${text(rng)}`, 1], [() => '[usage] tokens=10', 2], [() => `[done] ${text(rng)}`, 1],
    [() => '[failed] boom', 0.5], [() => markdown(rng), 3], [() => '  [Blocked] leading space', 0.5], [() => 'mid [blocked] sentence', 0.5], [() => '', 0.3], [() => undefined, 0.2]
  ]);
  return clean({
    message: msg,
    url: rng.maybe(0.2, () => rng.pick(['https://github.com/o/r/pull/1', `https://e.example/?q="${ESC}"`])),
    urlLabel: rng.maybe(0.15, () => rng.pick(['PR', ESC])),
    timestamp: rng.maybe(0.85, () => iso(nowMs, -rng.int(0, 5 * DAY))),
    kind: rng.maybe(0.25, () => rng.pick(['decision', 'decision-answer', 'decision-withdrawn', 'status', 'usage']))
  });
}

function telemetry(rng, nowMs) {
  if (rng.chance(0.25)) return undefined;
  return clean({
    model: rng.maybe(0.7, () => rng.pick(MODELS)),
    usage: rng.maybe(0.5, () => clean({ costUsd: rng.pick([0.4123, 1.5, 0, null, 12.999, -1, Infinity]), harness: rng.pick(['claude-code', 'opencode', undefined]) })),
    runtime: rng.maybe(0.6, () => ({ ms: rng.pick([0, 999, 59_000, 61_000, 3_600_000, 7_380_000, -5, null]) })),
    metrics: rng.maybe(0.3, () => Array.from({ length: rng.int(0, 4) }, (_, i) => ({ i }))),
    producedArtifacts: rng.maybe(0.3, () => Array.from({ length: rng.int(0, 3) }, (_, i) => ({ path: `f${i}` }))),
    resources: rng.maybe(0.3, () => ({ peakRssBytes: rng.pick([0, 1023, 1048576, 2.5e9, null]) })),
    parkedWait: rng.maybe(0.1, () => ({ since: iso(nowMs, -HOUR) })),
    ticketWalk: rng.maybe(0.15, () => Array.from({ length: rng.int(0, 3) }, () => clean({ identifier: rng.pick(['LIN-1', 'LIN-2', ESC]), state: rng.pick(['done', 'started', 'blocked', 'refused', 'dissolved', 'trimmed', 'odd']), outcomeLine: rng.maybe(0.5, () => text(rng)) })))
  });
}

export function makeSession(rng, nowMs) {
  const seedIssue = rng.weighted([[() => `LIN-${rng.int(1, 999)}`, 6], [() => undefined, 1.5], [() => '', 0.3], [() => `X-${ESC}`, 0.3]]);
  const sessionId = rng.weighted([[() => rng.uuid(), 5], [() => `sess-${rng.int(1, 99)}`, 2], [() => '', 0.3], [() => undefined, 0.3], [() => 'short', 0.5]]);
  const nLineages = rng.weighted([[0, 1], [1, 4], [2, 3], [3, 2], [5, 1]]);
  const loops = [];
  let iter = 1;
  for (let l = 0; l < nLineages; l++) {
    const len = rng.weighted([[1, 5], [2, 2], [3, 1]]);
    const lineageId = rng.chance(0.7) ? `lin-${l}` : undefined;
    let prev = null;
    for (let k = 0; k < len; k++) {
      const loopId = rng.chance(0.97) ? `loop-${l}-${k}` : undefined;
      const ident = rng.weighted([[() => seedIssue, 4], [() => `LIN-${rng.int(1, 999)}`, 2], [() => undefined, 1]]);
      const terminalStatus = rng.weighted([[undefined, 3], ['done', 4], ['failed', 1], ['aborted', 0.5], ['skipped', 0.3]]);
      const fb = rng.weighted([[() => undefined, 1], [() => [], 1], [() => Array.from({ length: rng.int(1, 4) }, () => feedbackEntry(rng, nowMs)), 6]]);
      loops.push(clean({
        loopId,
        lineageId: len > 1 || rng.chance(0.3) ? (lineageId ?? (k === 0 ? undefined : prev?.loopId)) : undefined,
        followUpTo: k > 0 && rng.chance(0.85) ? prev?.loopId : undefined,
        kind: rng.weighted(KINDS),
        terminalStatus,
        iteration: rng.chance(0.9) ? iter++ : undefined,
        issueIdentifier: ident,
        issueId: rng.maybe(0.6, () => rng.uuid()),
        issueTitle: rng.maybe(0.5, () => rng.pick(['Fix the thing', `Title ${ESC}`, 'Ünï', ''])),
        issueSource: rng.maybe(0.4, () => rng.pick(['linear', 'github', 'jira', 'local'])),
        target: rng.weighted([['cli', 4], ['web', 2], [undefined, 1], ['local', 0.5], [ESC, 0.2]]),
        sessionId: rng.maybe(0.5, () => sessionId),
        source: rng.maybe(0.3, () => rng.pick(['live', 'history'])),
        dispatchedAt: rng.maybe(0.9, () => iso(nowMs, -rng.int(HOUR, 3 * DAY))),
        terminalCompletedAt: terminalStatus ? rng.maybe(0.9, () => iso(nowMs, -rng.int(0, HOUR))) : undefined,
        bookkeeping: rng.maybe(0.08, () => ({ at: iso(nowMs, -rng.int(0, DAY)) })),
        wakeMarker: rng.maybe(0.2, () => rng.pick(['blocked', 'pending', 'done', null])),
        feedback: fb,
        telemetry: telemetry(rng, nowMs),
        agentTokenId: rng.maybe(0.4, () => rng.pick(['tok-dead', 'tok-ok', 'tok-unknown', ''])),
        agentTokenLabel: rng.maybe(0.3, () => rng.pick(['runner A', ESC]))
      }));
      prev = loops[loops.length - 1];
    }
  }
  // (no null loops: lib/run-view.js groupLoopsByLineage throws on them before the renderer runs)
  if (rng.chance(0.15)) { const i = rng.int(0, Math.max(0, loops.length - 1)); if (loops[i]) { loops[i].kind = 'autopilot'; loops[i].loopId = sessionId; } }
  return clean({
    sessionId,
    seedIssue,
    tasksTouched: rng.weighted([[() => undefined, 1], [() => [], 1], [() => [...new Set(loops.filter(Boolean).map(l => l.issueIdentifier).filter(Boolean))], 4], [() => ['LIN-1', ESC, 'LIN-2'], 1]]),
    loops: rng.chance(0.03) ? undefined : loops,
    dispatchedAt: rng.maybe(0.85, () => iso(nowMs, -rng.int(HOUR, 4 * DAY))),
    completedAt: rng.maybe(0.4, () => iso(nowMs, -rng.int(0, HOUR)))
  });
}

function makeDecisionRow(rng, loops) {
  const anchor = loops.length && rng.chance(0.9) ? rng.pick(loops) : {};
  return clean({
    decision: rng.maybe(0.95, () => clean({
      decision_id: rng.maybe(0.9, () => `d-${rng.int(1, 99)}`),
      question: rng.maybe(0.9, () => rng.pick(['Which approach?', `Pick ${ESC}`, markdown(rng)])),
      options: rng.maybe(0.7, () => Array.from({ length: rng.int(0, 3) }, (_, i) => clean({ id: rng.maybe(0.9, `o${i}`), label: rng.maybe(0.9, () => rng.pick(['Option A', `B ${ESC}`, ''])) }))),
      if_unanswered: rng.maybe(0.5, () => ({ summary: rng.pick(['Harbour picks A.', '  ', ESC, 42]) })),
      on_answer: rng.maybe(0.5, () => ({ record_on: rng.pick(['issue', 'run', '']) }))
    })),
    anchor: clean({ loopId: anchor.loopId, target: anchor.target, issueId: anchor.issueId, issueIdentifier: anchor.issueIdentifier, source: anchor.issueSource }),
    stampLoopId: rng.maybe(0.3, () => `stamp-${rng.int(1, 9)}`),
    disposition: rng.pick(['resumable', 'mid-turn', 'indeterminate', 'ended', undefined]),
    effect: rng.pick(['resume', 'record', 'none', undefined]),
    canReply: rng.maybe(0.3, () => rng.chance(0.5)),
    decisionCase: rng.maybe(0.6, () => Array.from({ length: rng.int(0, 3) }, (_, i) => rng.pick([`(recap ${i + 1}/3) ${text(rng)}`, ESC, markdown(rng)])))
  });
}

function makeRunEvidence(rng, pool) {
  if (pool.length && rng.chance(0.6)) return structuredClone(rng.pick(pool));
  return clean({
    state: rng.maybe(0.5, () => ({ phase: rng.pick(['open', 'merged']) })),
    evidence: rng.maybe(0.8, () => clean({ asked: rng.maybe(0.7, () => text(rng)), done: rng.maybe(0.7, () => text(rng)), checked: rng.maybe(0.5, () => rng.pick([[], [{ label: 'CI', state: 'passing' }], 'odd'])) })),
    ledger: rng.maybe(0.5, () => rng.pick([null, { items: [] }, { items: [{ id: 'L1', scope: 'in', claim: ESC, discharged: true }] }, { raw: 'raw ledger' }])),
    closeOut: rng.maybe(0.6, () => clean({ owner: rng.chance(0.8), status: rng.pick(['merged', 'partial', 'open', 'unknown', undefined]), variant: rng.pick(['standard', 'stepper', 'x']), pr: rng.maybe(0.5, { url: 'https://github.com/o/r/pull/9', headSha: 'abc123' }), urlKey: rng.maybe(0.5, 'acme'), stopAt: rng.maybe(0.3, 'review') }))
  });
}

export function sessionCase(rng, nowMs, deps) {
  if (rng.chance(0.08)) {
    return { module: 'session', export: 'renderPrLine', args: rng.chance(0.1) ? [] : [clean({ text: rng.maybe(0.9, () => text(rng)), pollUrl: rng.maybe(0.8, () => rng.pick(['/workspace/a/api/run/x/pr-state', `/q?a="${ESC}"`])), live: rng.maybe(0.8, () => rng.pick([true, false, 1, 'yes'])) })] };
  }
  const urlKey = rng.weighted(URL_KEYS);
  const session = rng.chance(0.06) ? null : makeSession(rng, nowMs);
  const loops = (session?.loops || []).filter(Boolean);
  const loopIds = loops.map(l => l.loopId).filter(Boolean);
  const waiting = rng.chance(0.3);
  const data = clean({
    session,
    sessionId: rng.maybe(0.7, () => rng.pick(['abc', ESC, ''])),
    issueContext: rng.maybe(0.5, () => Array.from({ length: rng.int(0, 3) }, () => clean({
      issueIdentifier: rng.maybe(0.85, () => rng.pick(['LIN-1', ESC])), issueId: rng.maybe(0.5, 'uuid-1'),
      brief: rng.weighted([[() => undefined, 1], [() => markdown(rng), 3], [() => '   ', 0.5], [() => ({ not: 'string' }), 0.3]]),
      briefModel: rng.maybe(0.5, 'gpt-x'), briefGeneratedAt: rng.maybe(0.5, () => iso(nowMs, -HOUR)),
      recap: rng.weighted([[() => undefined, 1], [() => ({ done: [{ item: 'x', evidence: ESC }], pending: [{ item: 'p', predicted: 'soon' }], deviations: [{ item: 'd', type: 'scope' }] }), 2], [() => ({ done: [], pending: [] }), 0.5], [() => 'string recap', 0.5]]),
      recapModel: rng.maybe(0.5, 'm'), recapGeneratedAt: rng.maybe(0.5, () => iso(nowMs, -DAY))
    }))),
    urlKey: urlKey === null && rng.chance(0.5) ? undefined : urlKey,
    waiting: rng.maybe(0.8, waiting),
    waitingMessage: rng.maybe(waiting ? 0.8 : 0.2, () => rng.pick(['[blocked] need input', ESC, markdown(rng)])),
    decision: rng.maybe(0.2, () => ({ question: 'q?' })),
    decisionCase: rng.maybe(0.4, () => rng.pick([[], ['chunk one', ESC], 'not-array'])),
    producer: rng.maybe(0.4, () => clean({ loopId: rng.maybe(0.8, () => (loopIds.length ? rng.pick(loopIds) : 'p1')), target: rng.maybe(0.5, 'web'), issueId: rng.maybe(0.5, 'i'), issueIdentifier: rng.maybe(0.5, 'LIN-5'), issueSource: rng.maybe(0.4, 'github'), case: rng.maybe(0.6, () => [text(rng), ESC]) })),
    decisions: rng.maybe(0.5, () => Array.from({ length: rng.int(0, 3) }, () => makeDecisionRow(rng, loops))),
    canReply: rng.maybe(0.85, () => rng.chance(0.6)),
    sessionTerminal: rng.maybe(0.7, () => rng.chance(0.5)),
    credentialByToken: rng.maybe(0.6, () => rng.pick([{}, { 'tok-dead': 'credential_dead', 'tok-ok': 'ok', 'tok-unknown': 'weird' }, { 'tok-ok': 'ok' }, null])),
    anchorIssueTitle: rng.maybe(0.4, () => rng.pick(['Anchor title', session?.seedIssue, ESC, ''])),
    runView: rng.maybe(0.08, () => (session ? deps.buildRunView(session, { now: nowMs - rng.int(0, DAY) }) : undefined)),
    proposals: rng.maybe(0.35, () => Array.from({ length: rng.int(0, 3) }, (_, i) => clean({ id: rng.maybe(0.9, `pr-${i}`), runId: rng.maybe(0.7, 'run-1'), stepLoopId: rng.pick([...loopIds, 'nope', undefined]), prompt: rng.maybe(0.9, () => rng.pick(['Do X', ESC, markdown(rng)])), status: rng.pick(['proposed', 'applied', 'declined', undefined]) }))),
    runEvidence: rng.maybe(0.35, () => makeRunEvidence(rng, deps.evidencePool)),
    runParagraph: rng.maybe(0.35, () => rng.pick(['The run did X.', '   ', ESC, 42, markdown(rng)])),
    prState: rng.maybe(0.4, () => clean({ state: rng.pick(['open', 'merged', 'closed', 'none', 'weird', undefined]), number: rng.maybe(0.7, () => rng.pick([12, 0, '7'])), checks: rng.maybe(0.6, () => rng.pick(['passing', 'failing', 'running', 'x'])) }))
  });
  const options = clean({
    deployInfo: makeDeployInfo(rng),
    openRouterSource: rng.weighted([[null, 3], ['oauth', 2], ['env', 1], ['free', 1], [undefined, 1]]),
    workspaces: rng.maybe(0.8, () => makeWorkspaces(rng, urlKey)),
    featureFlags: rng.maybe(0.9, () => makeFeatureFlags(rng, deps)),
    now: rng.maybe(0.3, () => rng.pick([nowMs - HOUR, new Date(nowMs).toISOString(), 'bad']))
  });
  const argc = rng.weighted([[2, 9], [1, 0.6], [0, 0.2]]);
  return { module: 'session', export: 'renderSessionPage', args: [data, options].slice(0, argc) };
}
