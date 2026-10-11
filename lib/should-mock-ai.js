/**
 * Whether the AI layer should be mocked for this request (LIN-388).
 *
 * The AI surfaces (recap/brief/recommend/prompt) historically gated their mock
 * on `NODE_ENV==='test' && accessToken==='test-token'`, which conflated TWO
 * mocks: the Linear DATA mock (testMockData) and the OpenRouter AI mock. The
 * provider seam already serves the data layer, so the migration splits the gate:
 * data stays on the narrow `test-token` check (the local provider serves it
 * otherwise), while the AI mock is re-gated here onto BOTH test-token and
 * local-provider sessions. CI has no OpenRouter key, so a migrated local spec
 * still needs the server's deterministic mock to fire.
 *
 * This stays a SUPERSET of the old `test-token` predicate, so legacy specs are
 * unaffected. It deliberately does NOT widen to all test sessions — the 503
 * "AI not configured" tests run on `test-token` with the AI mock active; an
 * unconfigured non-local session must still 503.
 *
 * @param {Object} workspace - req.workspace (carries provider + accessToken)
 * @returns {boolean}
 */
export function shouldMockAi(workspace) {
  return process.env.NODE_ENV === 'test' &&
    (workspace?.accessToken === 'test-token' || workspace?.provider === 'local');
}
