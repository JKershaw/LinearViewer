/**
 * Unit tests for lib/yap-client.js
 *
 * Run with: node --test tests/unit/yap-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  createYapClient,
  yapClientFromEnv,
  normalizeYapChannel,
  nickFromWorkspaceName,
  randomChannelName,
  DEFAULT_YAP_BASE_URL,
} from '../../lib/yap-client.js';

describe('normalizeYapChannel', () => {
  test('keeps a well-formed channel', () => {
    assert.strictEqual(normalizeYapChannel('#Collective'), '#Collective');
  });

  test('adds a leading # when missing', () => {
    assert.strictEqual(normalizeYapChannel('Collective'), '#Collective');
  });

  test('preserves the & prefix', () => {
    assert.strictEqual(normalizeYapChannel('&ops'), '&ops');
  });

  test('strips disallowed characters and whitespace', () => {
    assert.strictEqual(normalizeYapChannel('  #my chan!! '), '#mychan');
  });

  test('returns null for empty / unsalvageable input', () => {
    assert.strictEqual(normalizeYapChannel('#'), null);
    assert.strictEqual(normalizeYapChannel('   '), null);
    assert.strictEqual(normalizeYapChannel(''), null);
    assert.strictEqual(normalizeYapChannel(null), null);
  });
});

describe('nickFromWorkspaceName', () => {
  test('slugifies a name into a valid nick', () => {
    assert.strictEqual(nickFromWorkspaceName('Linear Viewer'), 'Linear-Viewer');
  });

  test('strips disallowed characters', () => {
    assert.strictEqual(nickFromWorkspaceName('dash/build!'), 'dashbuild');
  });

  test('caps at 32 characters', () => {
    const nick = nickFromWorkspaceName('a'.repeat(50));
    assert.strictEqual(nick.length, 32);
  });

  test('falls back when the name yields nothing', () => {
    assert.strictEqual(nickFromWorkspaceName('!!!'), 'agent');
    assert.strictEqual(nickFromWorkspaceName(''), 'agent');
  });
});

describe('createYapClient', () => {
  function mockFetch(record) {
    return async (url, opts) => {
      record.url = url;
      record.opts = opts;
      record.body = JSON.parse(opts.body);
      record.headers = opts.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, echoed: record.body }),
      };
    };
  }

  test('requires a baseUrl', () => {
    assert.throws(() => createYapClient({}), /baseUrl/);
  });

  test('trims trailing slashes from the base URL', () => {
    const client = createYapClient({ baseUrl: 'https://yap.test/', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
    assert.strictEqual(client.baseUrl, 'https://yap.test');
  });

  test('say posts to /api/say with the right body', async () => {
    const record = {};
    const client = createYapClient({ baseUrl: 'https://yap.test', fetchImpl: mockFetch(record) });
    await client.say('#Collective', 'John', 'hello');
    assert.strictEqual(record.url, 'https://yap.test/api/say');
    assert.deepStrictEqual(record.body, { channel: '#Collective', nick: 'John', message: 'hello' });
  });

  test('poll posts since_id', async () => {
    const record = {};
    const client = createYapClient({ baseUrl: 'https://yap.test', fetchImpl: mockFetch(record) });
    await client.poll('#Collective', 'linearviewer', 42);
    assert.strictEqual(record.url, 'https://yap.test/api/poll');
    assert.strictEqual(record.body.since_id, 42);
  });

  test('includes the Authorization header when a password is set', async () => {
    const record = {};
    const client = createYapClient({ baseUrl: 'https://yap.test', password: 'sekret', fetchImpl: mockFetch(record) });
    await client.join('#Collective', 'linearviewer');
    assert.strictEqual(record.headers.authorization, 'Bearer sekret');
  });

  test('omits the Authorization header when no password', async () => {
    const record = {};
    const client = createYapClient({ baseUrl: 'https://yap.test', fetchImpl: mockFetch(record) });
    await client.join('#Collective', 'linearviewer');
    assert.strictEqual(record.headers.authorization, undefined);
  });

  test('throws with status + detail on non-2xx', async () => {
    const client = createYapClient({
      baseUrl: 'https://yap.test',
      fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
    });
    await assert.rejects(
      () => client.say('#c', 'n', 'm'),
      (err) => err.status === 429 && err.detail === 'rate limited'
    );
  });
});

describe('yapClientFromEnv', () => {
  test('defaults to yap.jkershaw.com when YAP_BASE_URL is unset', () => {
    const client = yapClientFromEnv({});
    assert.ok(client);
    assert.strictEqual(client.baseUrl, DEFAULT_YAP_BASE_URL);
    assert.strictEqual(DEFAULT_YAP_BASE_URL, 'https://yap.jkershaw.com');
  });

  test('builds a client from env', () => {
    const client = yapClientFromEnv({ YAP_BASE_URL: 'https://yap.test', YAP_PASSWORD: 'p' });
    assert.ok(client);
    assert.strictEqual(client.baseUrl, 'https://yap.test');
  });
});

describe('randomChannelName', () => {
  test('produces #adjective-noun-date with the given date', () => {
    const name = randomChannelName(new Date('2026-06-13T10:00:00Z'), () => 0);
    assert.match(name, /^#[a-z]+-[a-z]+-2026-06-13$/);
  });

  test('round-trips through normalizeYapChannel unchanged', () => {
    const name = randomChannelName(new Date('2026-06-13T10:00:00Z'), () => 0.5);
    assert.strictEqual(normalizeYapChannel(name), name);
  });

  test('varies with the RNG', () => {
    const a = randomChannelName(new Date('2026-06-13T10:00:00Z'), () => 0);
    const b = randomChannelName(new Date('2026-06-13T10:00:00Z'), () => 0.99);
    assert.notStrictEqual(a, b);
  });
});
