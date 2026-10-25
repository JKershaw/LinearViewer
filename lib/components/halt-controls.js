/**
 * Halt controls (LIN-3889, decision 16): Pause, Stop and Resume, rendered for the two surfaces
 * that offer them. Dispatch and Settings › Running keep their own looks and both stay (John,
 * 24 October: "Keep both"), but they now share one implementation: the labels, the tone and the
 * copy that says what will happen live here once, and each surface picks a presentation.
 *
 *  - `presentation: 'buttons'`  Dispatch: a form of three `type="button"` controls. The client
 *                               (public/dispatch.js) finds the form by `data-halt-form` and each
 *                               control by `data-halt-mode`; it fetches the halt route itself.
 *  - `presentation: 'ask'`      Settings › Running: an ask-in-place form per control (a reason, then
 *                               confirm), posting to the Settings halt route. The control that
 *                               matches the current state is hidden.
 *
 * The owner gate is NOT in here. Each call site keeps `isOwner` around the call (LIN-3849):
 * `haltControls()` takes no owner parameter, so it cannot be asked to render the controls for a
 * member by passing a wrong flag. The modes come from HALT_MODES (lib/workspace-halt.js), the
 * declared single source; `resume` is not a mode, it is the clear. A unit test fails if HALT_MODES
 * gains a mode this file has no label for.
 */
import { escapeHtml } from '../utils/html.js';
import { HALT_MODES } from '../workspace-halt.js';
import { askInPlace } from '../render-settings-shell.js';

const CONTROLS = {
  pause: {
    short: 'Pause', long: 'Pause runs', tone: 'red',
    willHappen: 'New steps wait. Steps already running carry on. The runner applies this on its next poll.',
  },
  stop: {
    short: 'Stop', long: 'Stop runs', tone: 'red',
    willHappen: 'Running sessions are stopped too. The queue is not cleared. The runner applies this on its next poll.',
  },
  resume: {
    short: 'Resume', long: 'Resume runs', tone: 'teal',
    willHappen: 'Runs start again. The runner applies this on its next poll.',
  },
};

/** The controls in display order: each mode, then the clear. */
export const HALT_CONTROL_MODES = Object.freeze([...HALT_MODES, 'resume']);

/**
 * @param {Object} opts
 * @param {'buttons'|'ask'} opts.presentation
 * @param {string} [opts.urlKey] - the workspace key (raw); `buttons` puts it on the form.
 * @param {string} [opts.current] - the halt now in force ('none', 'pause' or 'stop'); `ask` hides the matching control.
 * @param {string} [opts.action] - the route an `ask` form posts to.
 * @returns {string} HTML
 */
export function haltControls({ presentation, urlKey = '', current = 'none', action = '' } = {}) {
  if (presentation === 'buttons') {
    const buttons = HALT_CONTROL_MODES.map(mode => (
      `<button type="button" class="btn--quiet halt-control halt-${mode}" data-halt-mode="${mode}" data-testid="dispatch-halt-${mode}">${CONTROLS[mode].short}</button>`
    )).join('\n        ');
    return `
      <form class="dispatch-form halt-form" data-url-key="${escapeHtml(urlKey)}" data-halt-form>
        ${buttons}
      </form>`;
  }
  if (presentation === 'ask') {
    return HALT_CONTROL_MODES
      .filter(mode => mode === 'resume' ? current !== 'none' : mode !== current)
      .map(mode => askInPlace({
        summary: CONTROLS[mode].long,
        willHappen: CONTROLS[mode].willHappen,
        askWhy: true,
        tone: CONTROLS[mode].tone,
        confirmLabel: CONTROLS[mode].long,
        action,
        fields: [['mode', mode]],
        testid: `settings-halt-${mode}`,
      }))
      .join('');
  }
  throw new Error(`haltControls: unknown presentation "${presentation}"`);
}

/** For the unit test: the label map, so a missing mode can be found. */
export const HALT_CONTROL_LABELS = Object.freeze(Object.fromEntries(Object.entries(CONTROLS).map(([m, c]) => [m, c.short])));
