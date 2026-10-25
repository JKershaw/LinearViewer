// LIN-3950: renderButton can render the live button looks it was not able to, so the Buttons section
// of /styleguide is rendered from this builder instead of hand-written HTML. The quiet look is
// `btn--quiet` WITHOUT the `btn` base (the live emitters never carry `btn`), and a tone is one of
// green, blue or red. `teal` is retired (lin-3890-dead-button-classes.test.js) and must fail loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderButton } from '../../lib/components/button.js';

function classOf(html) {
  return html.match(/class="([^"]*)"/)[1];
}

test('quiet renders the chromeless look with no `btn` base class', () => {
  const html = renderButton({ label: 'Cancel', quiet: true });
  assert.equal(classOf(html), 'btn--quiet');
});

test('quiet with a tone stacks the tone class after the quiet look', () => {
  for (const tone of ['green', 'blue', 'red']) {
    const html = renderButton({ label: 'go', quiet: true, tone });
    assert.equal(classOf(html), `btn--quiet btn--${tone}`);
  }
});

test('a tone without quiet is the bordered look in that tone (the ask confirm and key revoke)', () => {
  assert.equal(classOf(renderButton({ label: 'Remove', tone: 'red' })), 'btn btn--red');
});

test('an unknown tone throws, so a retired or misspelt tone cannot render', () => {
  assert.throws(() => renderButton({ label: 'x', quiet: true, tone: 'teal' }), /tone must be one of green, blue, red/);
  assert.throws(() => renderButton({ label: 'x', tone: 'amber' }), /tone must be one of green, blue, red/);
});

test('the existing outputs are unchanged when neither quiet nor tone is given', () => {
  assert.equal(
    renderButton({ label: 'default' }),
    '<button class="btn" type="button"><span class="btn__label">default</span></button>',
  );
  assert.equal(classOf(renderButton({ label: 'primary', variant: 'primary' })), 'btn btn--primary');
  assert.equal(classOf(renderButton({ label: 'ghost', variant: 'ghost' })), 'btn btn--ghost');
});
