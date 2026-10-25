/**
 * LIN-3889 (Consolidate, decision 16): Dispatch's and Settings › Running's halt controls render
 * from one component. These tests pin what each presentation shows, that `current` hides the
 * matching control, and that a mode added to HALT_MODES must come with a label here.
 *
 * Run with: node --test tests/unit/halt-controls.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { haltControls, HALT_CONTROL_MODES, HALT_CONTROL_LABELS } from '../../lib/components/halt-controls.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';
import { renderDispatchPage } from '../../lib/render-dispatch.js';
import { runningBody } from '../../lib/render-settings-workspace.js';

const ACTION = '/workspace/acme/settings/running/halt';

describe('the buttons presentation (Dispatch)', () => {
  test('renders Pause, Stop and Resume, each with its mode and test id, in a form marked as the halt form', () => {
    const html = haltControls({ presentation: 'buttons', urlKey: 'acme' });
    assert.match(html, /<form [^>]*data-halt-form/);
    assert.match(html, /data-url-key="acme"/);
    for (const [mode, label] of [['pause', 'Pause'], ['stop', 'Stop'], ['resume', 'Resume']]) {
      assert.match(html, new RegExp(`<button type="button" class="btn--quiet halt-control halt-${mode}" data-halt-mode="${mode}" data-testid="dispatch-halt-${mode}">${label}</button>`));
    }
  });

  test('the buttons never post a form: they are type="button", the client fetches the route itself', () => {
    assert.doesNotMatch(haltControls({ presentation: 'buttons', urlKey: 'acme' }), /type="submit"/);
  });
});

describe('the ask presentation (Settings › Running)', () => {
  test('with nothing in force, pause and stop are asked in place and there is no resume', () => {
    const html = haltControls({ presentation: 'ask', current: 'none', action: ACTION });
    assert.match(html, /data-testid="settings-halt-pause"/);
    assert.match(html, /data-testid="settings-halt-stop"/);
    assert.doesNotMatch(html, /data-testid="settings-halt-resume"/);
  });

  test('a paused workspace hides Pause and offers Stop and Resume', () => {
    const html = haltControls({ presentation: 'ask', current: 'pause', action: ACTION });
    assert.doesNotMatch(html, /data-testid="settings-halt-pause"/);
    assert.match(html, /data-testid="settings-halt-stop"/);
    assert.match(html, /data-testid="settings-halt-resume"/);
  });

  test('a stopped workspace hides Stop', () => {
    const html = haltControls({ presentation: 'ask', current: 'stop', action: ACTION });
    assert.match(html, /data-testid="settings-halt-pause"/);
    assert.doesNotMatch(html, /data-testid="settings-halt-stop"/);
  });

  test('each ask posts its mode to the Settings halt route, with a reason and a confirm', () => {
    const html = haltControls({ presentation: 'ask', current: 'none', action: ACTION });
    assert.match(html, new RegExp(`action="${ACTION}"`));
    assert.match(html, /<input type="hidden" name="mode" value="pause">/);
    assert.match(html, /name="reason"/);
    assert.match(html, /data-testid="settings-halt-pause-confirm"/);
  });

  test('the confirm is a real filled tone of .btn, red for pause and stop (LIN-3889)', () => {
    const html = haltControls({ presentation: 'ask', current: 'none', action: ACTION });
    assert.match(html, /<button type="submit" class="btn btn--red settings-ask-confirm"[^>]*data-testid="settings-halt-pause-confirm"/);
  });
});

describe('one component, every mode labelled', () => {
  test('every mode in HALT_MODES has a label, so a new mode cannot ship with no control', () => {
    for (const mode of HALT_MODES) assert.ok(HALT_CONTROL_LABELS[mode], `no label for halt mode "${mode}"`);
  });

  test('the controls are the modes plus the clear, in order', () => {
    assert.deepEqual(HALT_CONTROL_MODES, [...HALT_MODES, 'resume']);
  });

  test('an unknown presentation is an error, not a silent empty control', () => {
    assert.throws(() => haltControls({ presentation: 'links' }), /unknown presentation/);
  });
});

describe('the owner gate stays at the call site (LIN-3849)', () => {
  test('a member gets no halt controls on Dispatch, whatever the flags', () => {
    const html = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags: {} });
    assert.doesNotMatch(html, /data-halt-form/);
    assert.doesNotMatch(html, /data-halt-mode/);
  });

  test('the owner gets the buttons on Dispatch', () => {
    const html = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags: { runControls: true } });
    assert.match(html, /data-halt-form/);
    assert.match(html, /data-halt-mode="pause"/);
  });

  test('a member sees the halt state on Settings › Running and no asks', () => {
    const html = runningBody({ urlKey: 'acme', isOwner: false, haltMode: 'none' });
    assert.match(html, /data-testid="settings-halt-state"/);
    assert.doesNotMatch(html, /settings-halt-(pause|stop|resume)/);
  });
});
