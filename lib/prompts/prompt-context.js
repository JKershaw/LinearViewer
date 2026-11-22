// The task context a stage prompt reads, built once (LIN-4470). A fetched issue context carries the issue and its
// neighbourhood; generatePrompt takes the neighbourhood as its third argument. Every prompt surface that renders a
// stage from a fetched context (the pinned dispatch entrance, the proxy's /prompt and /recommend overrides, the
// workspace API's in-app prompt) hands generatePrompt this one projection, so a field added to the context reaches
// all of them from here. An explicit field list, not `{ ...ctx }`: a passthrough would hand the prompt every field a
// provider attaches. A leaf that imports nothing.

/**
 * @param {Object} ctx - a fetched task context ({ issue?, parent, siblings, project, children, comments, attachments, landingChanges?, reviewRound? })
 *   (landingChanges: the change records a blind read judges; reviewRound: the fix round an implementation prompt continues
 *   (LIN-4520, finding-2f1e89d3). Both are attached by lib/change-records.js attachLandingChanges and absent for other stages)
 * @returns {import('../prompt-templates.js').PromptContext}
 */
export function promptContextOf(ctx) {
  const { parent, siblings, project, children, comments, attachments, landingChanges, reviewRound } = ctx;
  return {
    parent, siblings, project, children, comments, attachments,
    ...(landingChanges !== undefined ? { landingChanges } : {}),
    ...(reviewRound !== undefined ? { reviewRound } : {})
  };
}
