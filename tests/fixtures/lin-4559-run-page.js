/**
 * LIN-4559: the run page fixtures the run-page tests share (tests/unit/lin-4559-run-page-agent-threads.test.js, the
 * server embed and stylesheet; tests/unit/session-run-transcript-entries.test.js, the drawn page). A run's feedback
 * with the run's own entries and its child agents' (`agent-text`, `agent` naming the child), the run page as the server
 * renders it (renderSessionPage, through the fixture that builds its run view), and the transcript JSON it embeds.
 */
import assert from 'node:assert/strict';
import { renderSessionPageOf } from './cost-read-cores.js';

export const T0 = Date.UTC(2026, 10, 24, 10, 0, 0);
export const at = (sec) => new Date(T0 + sec * 1000).toISOString();
export const own = (message, sec, kind = 'assistant-text') => ({ message, url: null, urlLabel: null, timestamp: at(sec), ...(kind ? { kind } : {}) });
export const child = (agent, message, sec) => ({ message, url: null, urlLabel: null, timestamp: at(sec), kind: 'agent-text', agent });

export function loopWith(feedback, extra = {}) {
  return {
    loopId: 'loop-1', issueIdentifier: 'TEST-1', issueId: 'uuid-1', issueTitle: 'Seed task', iteration: 1,
    kind: 'implementation', target: 'cli', dispatchedAt: at(0), terminalStatus: null, terminalCompletedAt: null,
    feedback, telemetry: null, ...extra
  };
}

export function pageHtml(loop) {
  return renderSessionPageOf({
    session: {
      sessionId: 'run-1', seedIssue: 'TEST-1', tasksTouched: ['TEST-1'], dispatchedAt: at(0), completedAt: null,
      telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] }, loops: [loop]
    },
    sessionId: 'run-1', urlKey: 'ws', issueContext: [], canReply: false
  }, { now: at(600) });
}

/** The embedded `data-feedback` of the run's transcript, as the client reads it. */
export function embedded(html) {
  const m = html.match(/data-testid="session-run-transcript" data-feedback="([^"]*)"/);
  assert.ok(m, 'the run has a transcript');
  const unescaped = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(unescaped);
}
