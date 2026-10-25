/**
 * The change panel (LIN-3855): the three fields a job or a group is set with, harness, model and
 * effort, each with a blank first option that means "follow the group" (or "inherit the default").
 * Built once here; the Models page uses it for every job and group row, and public/settings-models.js
 * reads the same field names.
 *
 * Field names are `c__<scope>__<surface>__<key>__<field>`, which lib/render-settings-models.js's
 * `stagedChanges` parses back. The server judges every value; the client only offers the right options
 * and clears effort when a harness has none (the convenience, never the guard).
 */

import { escapeHtml } from '../utils/html.js';
import { effortAppliesTo } from '../model-routing-harnesses.js';

/** The name a staged field posts under. Job, group and default rows all use this shape. */
export const fieldName = ({ scope, surface, key, field }) => `c__${scope}__${surface}__${key}__${field}`;

/**
 * @param {Object} opts
 * @param {{scope:string, surface:string, key:string}} opts.target - the row the fields set
 * @param {string|null} opts.harness - the value shown (the stored one, or the one in force)
 * @param {string|null} opts.model
 * @param {string|null} opts.effort
 * @param {Array<{id:string,label:string,free:boolean}>} opts.modelOptions - the model option set for the harness in force
 * @param {string[]} opts.harnesses - the harness suggestions
 * @param {string} opts.inheritLabel - the blank option's words, e.g. "Follow Make" or "Inherit the default"
 * @param {boolean} [opts.withHarness=true] - Harbour calls have no harness
 * @param {boolean} [opts.withEffort=true] - Harbour calls have no effort
 */
export function changePanel({ target, harness, model, effort, modelOptions, harnesses, inheritLabel, withHarness = true, withEffort = true }) {
  const harnessName = fieldName({ ...target, field: 'harness' });
  const modelName = fieldName({ ...target, field: 'model' });
  const effortName = fieldName({ ...target, field: 'effort' });
  const effortShown = withEffort && effortAppliesTo(harness);
  const harnessHtml = withHarness ? `
        <label class="settings-field">
          <span class="settings-field-label">Harness</span>
          <select name="${escapeHtml(harnessName)}" class="settings-field-control" data-models-field="harness">
            <option value=""${harness ? '' : ' selected'}>${escapeHtml(inheritLabel)}</option>${harnesses.map(h => `
            <option value="${escapeHtml(h)}"${h === harness ? ' selected' : ''}>${escapeHtml(h)}</option>`).join('')}
          </select>
        </label>` : '';
  const modelHtml = `
        <label class="settings-field">
          <span class="settings-field-label">Model</span>
          <select name="${escapeHtml(modelName)}" class="settings-field-control" data-models-field="model">
            <option value=""${model ? '' : ' selected'}>${escapeHtml(inheritLabel)}</option>${modelOptions.map(o => `
            <option value="${escapeHtml(o.id)}"${o.id === model ? ' selected' : ''}${o.free ? ' data-free="true"' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>`;
  const effortHtml = withEffort ? `
        <label class="settings-field" data-models-effort${effortShown ? '' : ' hidden'}>
          <span class="settings-field-label">Effort</span>
          <input type="text" name="${escapeHtml(effortName)}" class="settings-field-control" maxlength="200" value="${escapeHtml(effort || '')}" placeholder="blank = ${escapeHtml(inheritLabel.toLowerCase())}" data-models-field="effort">
        </label>` : '';
  return `
      <div class="settings-change-panel" data-testid="models-panel-${escapeHtml(`${target.scope}-${target.surface}-${target.key}`)}">${harnessHtml}${modelHtml}${effortHtml}
      </div>`;
}
