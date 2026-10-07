/**
 * LIN-3331 — the one task-page href builder and its client twin.
 *
 * The server helper (`lib/task-page-href.js`) and `window.taskPageHref`
 * (`public/common.js`) must produce byte-identical hrefs for the same inputs,
 * and the server helper must carry the `source`/`bindingScope` pair exactly as
 * the Edit link (`lib/render.js`) does. This pins the path shape, the encoding,
 * the pair order, and the empty-input contract.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { taskPageHref, bindingQuery } from '../../lib/task-page-href.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, '../..', p), 'utf8');

// Load the REAL public/common.js in a vm context so the parity test exercises
// the shipped client function, not a copy (same seam as
// tests/unit/lin-3126-residual-forwarding.test.js).
function loadClient() {
  const ctx = {
    window: {},
    document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console: { warn() {}, error() {}, log() {} },
    URLSearchParams, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(read('public/common.js'), ctx, { filename: 'common.js' });
  return ctx.window;
}

describe('taskPageHref (server)', () => {
  test('path shape is /workspace/:urlKey/task/:identifier', () => {
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: 'LIN-50' }), '/workspace/acme/task/LIN-50');
  });

  test('carries source then bindingScope, as the Edit link does', () => {
    // The Edit link's pre-change string, built inline in lib/render.js:
    //   .../edit?source=<provider>&bindingScope=<scope>
    const editStyle = `/workspace/acme/task/${encodeURIComponent('11111111-2222-3333-4444-555555555555')}/edit`
      + `?source=${encodeURIComponent('linear')}&bindingScope=${encodeURIComponent('team-a')}`;
    const editQuery = editStyle.slice(editStyle.indexOf('?') + 1);
    assert.equal(bindingQuery('linear', 'team-a'), editQuery);
    assert.equal(
      taskPageHref({ urlKey: 'acme', identifier: 'LIN-50', source: 'linear', bindingScope: 'team-a' }),
      `/workspace/acme/task/LIN-50?source=linear&bindingScope=team-a`
    );
  });

  test('drops an absent or empty half of the pair', () => {
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: 'LIN-50', source: 'linear' }), '/workspace/acme/task/LIN-50?source=linear');
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: 'LIN-50', bindingScope: 'team-a' }), '/workspace/acme/task/LIN-50?bindingScope=team-a');
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: 'LIN-50', source: '', bindingScope: null }), '/workspace/acme/task/LIN-50');
    assert.equal(bindingQuery('', ''), '');
  });

  test('URL-encodes the identifier (and urlKey/source/bindingScope)', () => {
    assert.equal(taskPageHref({ urlKey: 'ws a/b', identifier: 'a/b' }), '/workspace/ws%20a%2Fb/task/a%2Fb');
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: 'x y?' }), '/workspace/acme/task/x%20y%3F');
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: 'ü' }), '/workspace/acme/task/%C3%BC');
    assert.equal(
      taskPageHref({ urlKey: 'acme', identifier: 'LIN-50', source: 'li near', bindingScope: 'team/a b' }),
      '/workspace/acme/task/LIN-50?source=li%20near&bindingScope=team%2Fa%20b'
    );
  });

  test('returns empty string when urlKey or identifier is missing', () => {
    assert.equal(taskPageHref({ urlKey: '', identifier: 'LIN-50' }), '');
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: '' }), '');
    assert.equal(taskPageHref({ urlKey: 'acme', identifier: null }), '');
    assert.equal(taskPageHref({}), '');
    assert.equal(taskPageHref(), '');
  });
});

describe('window.taskPageHref (client twin)', () => {
  const client = loadClient();

  test('is defined and builds the path', () => {
    assert.equal(typeof client.taskPageHref, 'function');
    assert.equal(client.taskPageHref({ urlKey: 'acme', identifier: 'LIN-50' }), '/workspace/acme/task/LIN-50');
  });

  test('output is byte-identical to the server helper over a table of inputs', () => {
    const CASES = [
      { urlKey: 'acme', identifier: 'LIN-50' },
      { urlKey: 'acme', identifier: 'LIN-50', source: 'linear' },
      { urlKey: 'acme', identifier: 'LIN-50', bindingScope: 'team-a' },
      { urlKey: 'acme', identifier: 'LIN-50', source: 'linear', bindingScope: 'team-a' },
      { urlKey: 'ws a/b', identifier: 'a/b', source: 'li near', bindingScope: 'team/a b' },
      { urlKey: 'acme', identifier: 'ü?x' },
      { urlKey: '', identifier: 'LIN-50' },
      { urlKey: 'acme', identifier: '' },
      {},
    ];
    for (const opts of CASES) {
      assert.equal(client.taskPageHref(opts), taskPageHref(opts), JSON.stringify(opts));
    }
  });
});
