/**
 * The Dispatch page's "No job" section (LIN-3952 item 6). The row moved here from Settings › Models: the stored value is
 * the same (`defaults['agent-session']`), the reader is the same (resolveAgentFromTable, the Dispatch prefill), and the save
 * is the same route with `back=dispatch`, so a refusal comes back here. Nothing a job runs reads it; it is what Dispatch
 * suggests when no job is chosen.
 *
 * The section is one self-contained block with its own data-testid, so the Dispatch send controls can be rebuilt around it
 * later (LIN-3978) without unpicking it. It is built from the shared decision panel and holds nothing Models-specific.
 *
 * Audience: the same as before the move (LIN-3952 open question, recorded in the PR): anyone who can save Models can set
 * this. A member sees the section as a form they can save, not a read-only view, because the route has no owner gate:
 * the page's run controls are owner-only (LIN-3849), this one write is not.
 */

import { escapeHtml } from '../utils/html.js';
import { decisionPanel, fieldName, agentLists, suggestionsByHarness } from './decision-panel.js';
import { SURFACES } from '../llm-jobs.js';
import { harnessInForce } from '../model-routing-harnesses.js';
import { REFUSAL_MESSAGES } from '../model-routing-edit.js';

const AGENT = SURFACES.AGENT_SESSION;
const TARGET = Object.freeze({ scope: 'default', surface: AGENT, key: 'default' });

export const NO_JOB_NOTE = 'What the Dispatch page suggests when no job is chosen. It is not a job, and no run reads it.';

/** What a Dispatch return says about its save, read from the query the save redirected with (never reflected as markup). */
const RESULT_WORDS = { saved: 'Saved.', nothing: 'Nothing to change.' };
const SAVE_FAILED = 'The save did not go through. Check the values and save again.';

/**
 * The notice to show above the section, from the query a save returned with. `no_job_error` is a refusal code the store
 * named (REFUSAL_MESSAGES) or a code this page does not know, which reads as a plain failure.
 *
 * @param {{no_job?: string, no_job_error?: string}} query
 * @returns {{tone: 'ok'|'bad', text: string}|null}
 */
export function noJobNoticeOf(query = {}) {
  if (typeof query.no_job_error === 'string') {
    return { tone: 'bad', text: REFUSAL_MESSAGES[query.no_job_error] || SAVE_FAILED };
  }
  if (typeof query.no_job === 'string' && RESULT_WORDS[query.no_job]) {
    return { tone: 'ok', text: RESULT_WORDS[query.no_job] };
  }
  return null;
}

/**
 * The section's body: the note, the notice, and the form. It posts the staged save, the same fields the Models page posts.
 *
 * @param {Object} opts
 * @param {string} opts.urlKey
 * @param {Object} opts.table - the stored routing table (its version and its agent default)
 * @param {Array} [opts.catalog] - the live catalog ({id, name, free}), for the model search list
 * @param {{tone: string, text: string}|null} [opts.notice] - noJobNoticeOf(...)
 * @returns {string} HTML
 */
export function noJobBody({ urlKey, table, catalog = [], notice = null }) {
  const stored = table.defaults?.[AGENT] || {};
  const field = (name) => fieldName({ ...TARGET, field: name });
  const harness = stored.harness ?? null;
  const panel = decisionPanel({
    testid: 'dispatch-no-job-panel',
    harness: { value: harness, inForce: harnessInForce(harness), follow: 'Not set' },
    model: { value: stored.model ?? null, follow: 'Not set', lists: agentLists(catalog), suggestions: suggestionsByHarness([]) },
    effort: { value: stored.effort ?? null, follow: 'Not set' },
    nameOf: (name) => field(name),
    autoSwitch: true,
    clearEffort: true
  });
  const noticeHtml = notice
    ? `<p class="settings-flash${notice.tone === 'bad' ? ' settings-flash-error' : ''}" data-testid="dispatch-no-job-notice">${escapeHtml(notice.text)}</p>`
    : '';
  return `
    <div class="dispatch-no-job" data-testid="dispatch-no-job">
      <p class="settings-note">${escapeHtml(NO_JOB_NOTE)}</p>${noticeHtml}
      <form action="/workspace/${encodeURIComponent(urlKey)}/settings/models/changes" method="POST" class="settings-form dispatch-no-job-form" data-testid="dispatch-no-job-form">
        <input type="hidden" name="version" value="${escapeHtml(String(table.version))}">
        <input type="hidden" name="back" value="dispatch">
        ${panel}
        <label class="settings-ask-label">Why
          <input type="text" name="reason" required maxlength="500" class="settings-ask-reason" data-testid="dispatch-no-job-reason" placeholder="Why this suggestion is changing">
        </label>
        <button type="submit" class="btn btn--primary" data-testid="dispatch-no-job-save">Save</button>
      </form>
    </div>`;
}
