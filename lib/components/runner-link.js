/**
 * "run on my machine ›" (LIN-3098 S4b) — the server-rendered twin of
 * `PromptSection.runnerLinkHtml` (public/prompt-section.js). Byte-identical
 * markup, so every surface where a task opens carries the same link: the tree
 * view's task detail (lib/render.js) and the Swim popover (lib/render-swim.js);
 * Swipe renders its card client-side through the public twin.
 *
 * Always shown (LIN-3849: there are no proxy/dispatch switches any more):
 * `/workspace/:urlKey/runner` is where an owner mints the first runner key
 * (lib/render-runner-setup.js).
 */
import { escapeHtml } from '../utils/html.js';

/** @param {string} urlKey */
export function runnerSetupHref(urlKey) {
  return `/workspace/${encodeURIComponent(urlKey || '')}/runner`;
}

/** @param {string} urlKey @returns {string} the link's HTML */
export function renderRunnerLink(urlKey) {
  return `<a class="opened-task-runner-link" href="${escapeHtml(runnerSetupHref(urlKey))}" data-testid="opened-task-runner-link">run on my machine ›</a>`;
}
