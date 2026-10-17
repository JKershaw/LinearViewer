/**
 * Deterministic test-mode builders for routes/workspace-api.js (LIN-3596).
 *
 * Pure functions only: each derives a small canned answer from the fixtures in
 * lib/sample-data/mock-data.js or from the context a route already holds, so a
 * test-token / local (AI-mocked) session never reaches a model or a provider.
 * Nothing here reads a store, a credential or the network, and nothing here
 * names a pre-flight gate: the router keeps those calls itself (the source-text
 * censuses scan routes/workspace-api.js for them).
 */
import { testMockTeams, testMockData } from './sample-data/mock-data.js';
import { isBlocked, isTerminalState } from './tree.js';
import { WORK_ISSUE_LABELS } from './workflow-config.js';

// Mirrors lib/feedback-title.js's MAX_TITLE_LENGTH.
const MAX_FEEDBACK_MOCK_TITLE_LENGTH = 120;

// The canned reasoning / goal pair per kind of task the mock recognises.
const RECOMMENDATION_STANCES = {
  blocked: {
    reasoning: 'This task is blocked. Analyzing the blocker will help identify ways to unblock progress.',
    goal: 'Identify the blocker type and root cause, evaluate options to unblock, and recommend the best path.',
  },
  bug: {
    reasoning: 'This is a bug. Investigating the issue systematically will help find the root cause and fix.',
    goal: 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
  },
  ready: {
    reasoning: 'This task is ready to start. Creating an implementation plan will provide a clear path forward.',
    goal: 'Research the codebase, identify files to modify, and create a step-by-step implementation plan.',
  },
  overview: {
    reasoning: 'Start by getting an overview of what this task involves before deciding on the next steps.',
    goal: 'Summarize what this task involves and how it fits into the broader project context.',
  },
};

/**
 * Generate mock recommendation content for the AI mock (LIN-185, LIN-405).
 *
 * Shared by the streaming and non-streaming recommend endpoints. Kept
 * SHAPE-TOLERANT so it serves BOTH the canonical provider issue (local
 * sessions, post-LIN-405) and the Linear-shaped `testMockData` issue still
 * passed by the `isTestMode` stream / GET blocks. (LIN-413 verdict: those
 * blocks are RETAINED — free-tier.spec still drives the stream on the
 * test-token path and the recommend GET directly, so they are not orphaned.):
 *   - labels arrive either as a plain `['bug']` array or as `{ nodes: [...] }`;
 *   - the identifier is read from `issue.identifier` (canonical urls end in a
 *     UUID, so the historic `url.split('/').pop()` is only a last-ditch fallback).
 * @param {Object} mockIssue - A canonical or Linear-shaped issue.
 * @returns {{ reasoning: string, prompt: string, identifier: string }}
 */
export function generateMockRecommendation(mockIssue) {
  const labels = Array.isArray(mockIssue.labels)
    ? mockIssue.labels
    : (mockIssue.labels?.nodes || []).map(l => l.name);
  const stateType = mockIssue.state?.type;

  // First matching stance wins. LIN-357: blocked-ness is the incomplete blocking
  // relationship, not a label.
  const stances = [
    [isBlocked(mockIssue), RECOMMENDATION_STANCES.blocked],
    [labels.includes(WORK_ISSUE_LABELS.BUG), RECOMMENDATION_STANCES.bug],
    [stateType === 'backlog' || stateType === 'unstarted', RECOMMENDATION_STANCES.ready],
  ];
  const { reasoning, goal } = (stances.find(([applies]) => applies) || [null, RECOMMENDATION_STANCES.overview])[1];

  const identifier = mockIssue.identifier || mockIssue.url?.split('/').pop() || 'ISSUE';
  const labelLine = labels.length ? `**Labels:** ${labels.join(', ')}` : '';
  const prompt = [
    `Help me with task ${identifier}`,
    '',
    '## Context',
    '',
    '**Project:** Test Project',
    `**Status:** ${mockIssue.state?.name || 'Unknown'}`,
    labelLine,
    '',
    '## Goal',
    '',
    goal,
  ].join('\n');

  return { reasoning, prompt, identifier };
}

/**
 * Build one mock recommendation hop from provider context for the resolver's
 * `computeOne` (LIN-405). Deterministically mirrors what a single
 * getRecommendation(Stream) call would return so a local (AI-mocked) session
 * drives the SAME `resolveRecommendation` descent the real path uses:
 *   - a parent whose focused child is non-terminal synthesises a `defer` to that
 *     child (passing `children`/`state` through so the resolver's LIN-353
 *     terminal-edge guard can validate the hop), so e.g. TEST-1 → TEST-2 descends;
 *   - a leaf returns a real (non-defer) action carrying the mock prompt.
 * @param {Object} ctx - provider.fetchRecommendationContext result.
 * @returns {Object} A computeOne hop record.
 */
export function buildMockRecommendationHop(ctx) {
  const base = {
    identifier: ctx.issue.identifier,
    truncated: false,
    completionTokens: null,
    issueUrl: ctx.issue.url,
    state: ctx.issue.state,
    children: ctx.children,
  };
  const focusChild = ctx.focusedChild?.issue;
  if (focusChild) {
    return {
      ...base,
      reasoning: `${ctx.issue.identifier} is a container → routing to ${focusChild.identifier}`,
      prompt: null,
      recommendedAction: 'defer',
      deferTo: focusChild.identifier,
    };
  }
  const { reasoning, prompt } = generateMockRecommendation(ctx.issue);
  return {
    ...base,
    reasoning,
    prompt,
    recommendedAction: 'recommend',
    deferTo: null,
  };
}

/**
 * The test-token stream's descent through `testMockData` (LIN-327): the chain of
 * containers from `mockIssue` down to its first incomplete leaf, as the mock stream
 * walks it (cycle-safe, at most 10 deep).
 * @returns {{ terminal: Object, deferredVia: string[], idOf: (issue: Object) => string, path: Object[] }|null}
 *   null when `mockIssue` has no incomplete child (a plain leaf).
 */
export function planMockDescent(mockIssue) {
  const idOf = (iss) => iss.url?.split('/').pop() || iss.identifier;
  const incompleteChild = (iss) => testMockData.issues.find(
    i => i.parent?.id === iss.id && i.state?.type !== 'completed' && i.state?.type !== 'canceled'
  );
  if (!incompleteChild(mockIssue)) return null;

  const path = [];
  const seen = new Set();
  let node = mockIssue;
  while (node && !seen.has(node.id) && path.length < 10) {
    seen.add(node.id);
    path.push(node);
    node = incompleteChild(node);
  }
  return { path, terminal: path[path.length - 1], deferredVia: path.map(idOf), idOf };
}

/**
 * The prompt route's test-token inputs: the fixture issue (identifier + label-name
 * array applied) and the parent / siblings / project / children context the prompt
 * templates read. Null when `issueId` names no fixture.
 */
export function buildMockPromptInput(issueId) {
  const mockIssue = testMockData.issues.find(i => i.id === issueId);
  if (!mockIssue) return null;

  // Identifier comes from the URL tail (https://linear.app/test/issue/TEST-6 -> TEST-6).
  const tail = (iss) => iss.url.split('/').pop();
  const brief = (iss) => ({ id: iss.id, identifier: tail(iss), title: iss.title, state: iss.state });
  const identifier = tail(mockIssue);
  const mockProject = testMockData.projects.find(p => p.id === mockIssue.project?.id);
  const mockParent = mockIssue.parent
    ? testMockData.issues.find(i => i.id === mockIssue.parent.id)
    : null;

  return {
    identifier,
    issue: { ...mockIssue, identifier, labels: (mockIssue.labels?.nodes || []).map(l => l.name) },
    context: {
      parent: mockParent ? brief(mockParent) : null,
      siblings: mockParent
        ? testMockData.issues.filter(i => i.parent?.id === mockParent.id && i.id !== issueId).slice(0, 5).map(brief)
        : [],
      project: mockProject ? { name: mockProject.name, description: mockProject.content } : null,
      children: testMockData.issues.filter(i => i.parent?.id === issueId).map(brief)
    }
  };
}

/** A mock recommendation context from test fixtures (recap, brief, scan, retire). Null when absent. */
export function buildMockRecapContext(issueId) {
  const fixture = testMockData.issues.find(i => [i.id, i.identifier].includes(issueId) || i.url?.endsWith(`/${issueId}`));
  if (!fixture) return null;
  const labelNames = (node) => (node.labels?.nodes || []).map(l => l.name);
  const project = testMockData.projects.find(p => p.id === fixture.project?.id);
  return {
    issue: {
      id: fixture.id,
      identifier: fixture.identifier || fixture.id,
      title: fixture.title,
      description: fixture.description || '',
      state: fixture.state,
      labels: labelNames(fixture),
      url: fixture.url
    },
    parent: null,
    siblings: [],
    project: project ? { id: project.id, name: project.name } : null,
    children: (fixture.children?.nodes || []).map(child => ({
      id: child.id,
      identifier: child.identifier || child.id,
      title: child.title,
      state: child.state || { type: 'unstarted', name: 'Todo' },
      labels: labelNames(child)
    })),
    comments: (fixture.comments?.nodes || []).map(({ id, body, createdAt, user }) => (
      { id, body, createdAt, user: { name: user?.name || 'Unknown' } }
    )),
    focusedChild: null
  };
}

// The context's subtasks that are not yet in a terminal state.
const unfinishedChildren = (context) => (context.children || []).filter(c => !isTerminalState(c.state?.type));

/** A small deterministic recap for test mode. */
export function buildMockRecap(context) {
  const commentCount = (context.comments || []).length;
  const done = [
    commentCount && { item: 'Discussion captured in comments', evidence: `${commentCount} comment(s) recorded` },
    context.issue?.description && { item: 'Description documented', evidence: 'Description is present on the issue' },
  ].filter(Boolean);

  const pending = unfinishedChildren(context).slice(0, 3).map(child => (
    { item: `Complete subtask ${child.identifier}`, predicted: child.title || '' }
  ));
  if (!pending.length) {
    pending.push({ item: 'Continue implementation', predicted: 'Pick up from current state' });
  }
  return { done, pending, deviations: [] };
}

/** A small deterministic brief (Markdown) for test mode. */
export function buildMockBrief(context) {
  const issue = context.issue || {};
  const remaining = unfinishedChildren(context);
  const commentCount = (context.comments || []).length;
  const summary = issue.description ? issue.description.split('\n')[0] : 'No description provided.';

  return [
    '## Current',
    `${issue.title || 'Untitled task'} — ${summary}`,
    ...(remaining.length ? ['', `Remaining: ${remaining.map(c => c.identifier).join(', ')}.`] : []),
    '',
    '## Constraints',
    '- _None._',
    '',
    '## Open questions',
    '- _None._',
    '',
    '## Changelog',
    commentCount
      ? `- **Discussion captured in ${commentCount} comment(s)** — context lives in the thread, not yet folded into the spec.`
      : '- _None._',
  ].join('\n');
}

/**
 * A small deterministic mock scan response. Unlike the recap / brief builders this
 * returns raw JSON TEXT, so the route can push the mock through the same
 * parseScanResponse gate a real model response goes through.
 */
export function buildMockScanText(context) {
  const haystack = `${context.issue?.description || ''} ${(context.comments || []).map(c => c.body || '').join(' ')}`;
  const triggersDecision = /\b(waiting|blocked|research|unclear|decide|decision|question)\b/i.test(haystack);
  if (!triggersDecision) {
    return JSON.stringify({ has_decision: false });
  }
  return JSON.stringify({
    has_decision: true,
    question: `How should ${context.issue?.identifier || 'this task'} proceed?`,
    options: [
      { id: 'proceed', label: 'Proceed with the current approach' },
      { id: 'wait', label: 'Wait for the blocker to clear' }
    ],
    recommended: 'wait',
    free_text: false
  });
}

/**
 * A small deterministic mock feedback-ticket title, derived from the message with no
 * model call (LIN-2981: a test-mode session must never open the live chat socket).
 * @param {string} message - The raw feedback message text.
 */
export function buildMockFeedbackTitle(message) {
  const firstLine = message.trim().split('\n')[0];
  return `Triage: ${firstLine}`.slice(0, MAX_FEEDBACK_MOCK_TITLE_LENGTH);
}

/** The deterministic workspace data the audit computes its report from in test mode. */
export function buildMockAuditData() {
  return {
    teams: testMockTeams,
    projects: testMockData.projects.map(p => ({ ...p, state: 'started' })),
    workflowStates: [
      { id: 'ws1', name: 'Backlog', type: 'backlog', team: { id: 'team1', name: 'Test Team' } },
      { id: 'ws2', name: 'In Progress', type: 'started', team: { id: 'team1', name: 'Test Team' } },
      { id: 'ws3', name: 'Done', type: 'completed', team: { id: 'team1', name: 'Test Team' } }
    ],
    labels: [
      { id: 'l1', name: 'breakdown', color: '#000', issues: { nodes: [{ id: 'i1' }] } },
      { id: 'l2', name: 'ready', color: '#000', issues: { nodes: [{ id: 'i2' }, { id: 'i3' }] } },
      { id: 'l3', name: 'bug', color: '#f00', issues: { nodes: [] } }
    ],
    issues: testMockData.issues.map(i => ({
      ...i,
      labels: { nodes: [] }
    }))
  };
}
