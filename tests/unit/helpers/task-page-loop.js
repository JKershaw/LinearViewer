/**
 * A worker loop as the task page's loader reads it (LIN-4254 piece 5): the one factory the task-page suites share, so a
 * fixture is not copied between them. `over` replaces any field.
 */
export const NOW = new Date('2026-10-06T15:00:00.000Z');
export const PAGE_OPTIONS = { deployInfo: { version: 't', commit: 't' }, featureFlags: {}, workspaces: [] };
const UUID = '11111111-2222-3333-4444-555555555555';

export function loop(over = {}) {
  return {
    loopId: 'loop-x', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'T', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running', target: 'cli',
    dispatchedAt: '2026-10-06T10:00:00.000Z', takenAt: '2026-10-06T10:01:00.000Z', resolvedAt: '2026-10-06T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null, feedback: [],
    telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null,
    ...over,
  };
}
