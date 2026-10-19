/**
 * LIN-3496 — `parseCredentialBlock` is the one reader of the /runner credential
 * block and does the joining of a line broken in the middle (rehearsal on
 * LIN-2953: `ownerAccountI` / `d: ...`). `login` reads every field from it.
 * Fake values only; the upstream is an injected `fetchImpl`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCredentialBlock, runCommand } from '../../lib/runner-kit/runner.mjs';

const OWNER = 'acc_0123456789abcdef';
const BOOT = 'bootAbc_123-xyz_456-LONGtokenvalue';
const served = (over = {}) => [
  '## Your runner credential',
  '',
  `- baseUrl: ${over.baseUrl || 'https://harbour.example'}`,
  '- urlKey: acme',
  `- ownerAccountId: ${OWNER}`,
  `- bootstrap: ${BOOT}`,
  '- expiresAt: 2026-09-29T13:00:00.000Z',
  '',
  'Pipe this block into `runner.mjs login` (see "Set up" above); never echo it. The bootstrap works once, and only until the time above.'
];
const FULL = { baseUrl: 'https://harbour.example', urlKey: 'acme', ownerAccountId: OWNER, bootstrap: BOOT, expiresAt: '2026-09-29T13:00:00.000Z' };

describe('parseCredentialBlock', () => {
  test('the served block verbatim: heading, blank, keys, blank, prose', () => {
    assert.deepEqual(parseCredentialBlock(served().join('\n')), FULL);
  });

  test('a key broken before its colon is joined (the rehearsal)', () => {
    const lines = served();
    lines[4] = '- ownerAccountI';
    lines.splice(5, 0, `d: ${OWNER}`);
    assert.deepEqual(parseCredentialBlock(lines.join('\n')), FULL);
  });

  test('a value broken mid-token is joined', () => {
    const lines = served();
    lines[4] = `- ownerAccountId: ${OWNER.slice(0, 8)}`;
    lines.splice(5, 0, `  ${OWNER.slice(8)}`);
    assert.equal(parseCredentialBlock(lines.join('\n')).ownerAccountId, OWNER);
  });

  test('an empty value takes the next line; still empty sets nothing', () => {
    assert.equal(parseCredentialBlock(`- bootstrap:\n${BOOT}`).bootstrap, BOOT);
    const out = parseCredentialBlock('- bootstrap:\n\n- bootstrap: later');
    assert.equal(out.bootstrap, undefined);
  });

  test('a token wrapped onto a line beginning base/boot is not cut', () => {
    for (const lower of ['baseAAAA1111', 'bootstrapBBBB2222', 'owner9999']) {
      const out = parseCredentialBlock(`- urlKey: acme\n- bootstrap: tok123\n${lower}\n- ownerAccountId: ${OWNER}`);
      assert.equal(out.bootstrap, `tok123${lower}`);
      assert.equal(out.ownerAccountId, OWNER);
    }
  });

  test('bullet, bold and backtick forms', () => {
    const text = [`* **urlKey**: acme`, '- `ownerAccountId`: `' + OWNER + '`', `bootstrap: ${BOOT}`, 'Base: https://harbour.example'].join('\n');
    assert.deepEqual(parseCredentialBlock(text), {
      urlKey: 'acme', ownerAccountId: OWNER, bootstrap: BOOT, baseUrl: 'https://harbour.example'
    });
  });

  test('keys, a blank line, then prose: the prose is not glued on, later keys are not read', () => {
    const out = parseCredentialBlock(`- urlKey: acme\n\nsome prose\n- ownerAccountId: ${OWNER}`);
    assert.deepEqual(out, { urlKey: 'acme' });
    assert.equal(parseCredentialBlock(served().join('\n')).expiresAt, FULL.expiresAt);
  });

  test('a whitespace-only line ends the block', () => {
    assert.deepEqual(parseCredentialBlock('- urlKey: acme\n   \t\n- ownerAccountId: x'), { urlKey: 'acme' });
  });

  test('CRLF, including a split key', () => {
    const lines = served();
    lines[4] = '- ownerAccountI';
    lines.splice(5, 0, `d: ${OWNER}`);
    assert.deepEqual(parseCredentialBlock(lines.join('\r\n')), FULL);
  });

  test('a bare token is the bootstrap; a wrapped one is not recovered', () => {
    assert.equal(parseCredentialBlock(`${BOOT}\n`).bootstrap, BOOT);
    assert.equal(parseCredentialBlock('abc\ndef').bootstrap, undefined);
  });

  test('the first occurrence of a key wins', () => {
    const out = parseCredentialBlock('- urlKey: first\n- urlKey: second\n- bootstrap: a\n- bootstrap: b');
    assert.equal(out.urlKey, 'first');
    assert.equal(out.bootstrap, 'a');
  });

  test('empty and unknown input', () => {
    assert.deepEqual(parseCredentialBlock(''), {});
    assert.deepEqual(parseCredentialBlock(undefined), {});
    assert.deepEqual(parseCredentialBlock('- colour: red'), {});
  });
});

describe('login reads the block only through the parser', () => {
  const run = async (args, stdin) => {
    const home = mkdtempSync(join(tmpdir(), 'lin3496-'));
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      return { ok: true, status: 200, json: async () => ({ token: 'tok-fake', grants: ['take'], expiresAt: null }) };
    };
    try {
      await runCommand(['login', ...args], { home, stdin, fetchImpl });
      const state = JSON.parse(readFileSync(join(home, 'acme', 'runner.json'), 'utf8'));
      return { state, calls };
    } finally { rmSync(home, { recursive: true, force: true }); }
  };
  const split = () => {
    const lines = served();
    lines[4] = '- ownerAccountI';
    lines.splice(5, 0, `d: ${OWNER}`);
    lines[6] = `- bootstrap: ${BOOT.slice(0, 10)}`;
    lines.splice(7, 0, BOOT.slice(10));
    return lines.join('\n');
  };

  test('a split block logs in with the joined owner id and bootstrap', async () => {
    const { state, calls } = await run([], split());
    assert.equal(state.ownerAccountId, OWNER);
    assert.equal(calls[0].auth, `Bearer ${BOOT}`);
    assert.equal(calls[0].url, 'https://harbour.example/api/proxy/token');
  });

  test('--base, --url-key and --owner still override the block', async () => {
    const { state, calls } = await run(['--base', 'http://127.0.0.1:1', '--url-key', 'acme', '--owner', 'flag-owner'], split());
    assert.equal(state.ownerAccountId, 'flag-owner');
    assert.equal(state.baseUrl, 'http://127.0.0.1:1');
    assert.equal(calls[0].url, 'http://127.0.0.1:1/api/proxy/token');
  });
});
