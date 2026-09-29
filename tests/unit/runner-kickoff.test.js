/**
 * LIN-3098 S3 — the served runner prompt (`docs/runner-prompt.md`, built by
 * `lib/prompts/runner-kickoff.js`).
 *
 * The prompt is what turns a person's Claude Code session into their
 * workspace's runner. These tests pin that it says every thing the ticket's
 * "What the served prompt must do" requires, the honesty copy, the review
 * steps (NB2, B1, B4, B5, recover), and that its interpolated values come
 * from their sources rather than hard-coded copies.
 *
 * NB4 (kit integrity): the kit is served from `GET /runner-kit/:file`
 * (routes/runner-kit.js) and the prompt pins each file's sha256. The pins are
 * checked against the files at HEAD, and the prompt's own verify command is
 * executed against a copy of the kit (passes) and a tampered copy (refuses).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRunnerKickoff, createRunnerKickoffBuilder, RUNNER_KIT_FILES } from '../../lib/prompts/runner-kickoff.js';
import { createRunnerKitRoutes } from '../../routes/runner-kit.js';
import { RUNNER_BOOTSTRAP_TTL_SECONDS, RUNNER_WORKING_TTL_SECONDS } from '../../lib/proxy-scopes.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';
import { FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-store.js';
import {
  OTHER_CONSUMER_RECENT_MS, FRESH_TAKE_MIN_TOKEN_LIFE_MS, WATCHDOG_STALL_MIN, WATCHDOG_FAIL_MIN, WAIT_CAP_MS, WAIT_HEARTBEAT_MS
} from '../../lib/runner-kit/runner.mjs';
import { BROKER_STALE_MS, BROKER_MAX_LIFETIME_MS } from '../../lib/runner-kit/broker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KIT_DIR = join(ROOT, 'lib', 'runner-kit');
const BASE = 'https://harbour.example';
const prompt = buildRunnerKickoff({ baseUrl: BASE });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

describe('what the served prompt must do (each bullet has an anchor)', () => {
  const anchors = [
    ['poll and take with the carried credential', /`runner poll`/, /`runner take <id>`/, /runner\.mjs login/],
    ['confirm against /dispatch/:id/prompt and refuse on a mismatch', /\/api\/proxy\/dispatch\/:id\/prompt/, /mismatch/i],
    ['one subagent per item', /one subagent per item/i],
    ['a followUpTo item continues the same subagent', /followUpTo[^\n]*same subagent/i],
    ['tokens kept away from subagents (the broker)', /--unix-socket/, /never (?:give|hand|pass)[^.\n]*token/i],
    ['[handoff] per subagent', /\[handoff\] item /],
    ['[usage] with the realised harness and model', /\[usage\] \{/, /realised/i],
    ['terminal markers', /\[done\]/, /\[failed\]/, /\[blocked\]/],
    ['its own watchdog', /watchdog/i, /\[blocked\] stalled/],
    ['N1: background wait plus re-arm, /loop fallback', /`runner wait`/, /run_in_background/, /re-arm/i, /\/loop/],
    ['halts with Simple Dispatcher\'s meaning, binding', /halts are binding/i, /stopped by operator/],
    ['Claude Code only (opencode has no subagents)', /Claude Code only/, /opencode has no subagents/i],
    ['N2: items for another harness are left', /items asked for another harness are left for a runner of that harness/i],
    ['Q3: items without a bootstrap run with no API access', /no workspace API access/i],
    ['the end summary', /## (?:\d+\. )?End summary/]
  ];
  for (const [name, ...res] of anchors) {
    test(name, () => {
      for (const re of res) assert.match(prompt, re, `${name}: missing ${re}`);
    });
  }
});

describe('the honesty copy', () => {
  test('what happens when the laptop sleeps or closes, with the B4 orphan truth', () => {
    assert.match(prompt, /laptop sleeps/i);
    assert.match(prompt, /laptop closes/i);
    assert.match(prompt, /stay `taken`/);
    assert.match(prompt, /30 days/);
    assert.match(prompt, /Autopilot[^.\n]*hangs/i);
    assert.match(prompt, /re-dispatch/i);
  });

  test('the 24h token life, and that a task running longer loses its original rows\' terminals (NB3)', () => {
    assert.match(prompt, new RegExp(`${RUNNER_WORKING_TTL_SECONDS / 3600}h`));
    assert.match(prompt, /longer than about 24h/i);
  });

  test('before T3, only items the owner enqueued run (Q4)', () => {
    assert.match(prompt, /only items the workspace owner enqueued/i);
    assert.match(prompt, /T3/);
  });

  test('the same-user boundary, stated plainly', () => {
    assert.match(prompt, /same OS user/i);
    assert.match(prompt, /subagents? included|including subagents/i);
    assert.match(prompt, /credential file/i);
    assert.match(prompt, /live broker/i);
  });

  test('halts: the stale /instructions line is named and not to be followed', () => {
    assert.match(prompt, /does not yet honor/);
    assert.doesNotMatch(prompt, /halts are advisory/i);
  });
});

// N1 (S3 review 49b9f290): §2 must handle every reason `runner wait` can
// print, read straight from waitLoop in runner.mjs, and must not end the
// runner on a transient failure.
describe('N1: the wait reasons match what runner.mjs returns', () => {
  const src = readFileSync(join(KIT_DIR, 'runner.mjs'), 'utf8');
  const waitLoop = src.slice(src.indexOf('async function waitLoop('));
  const reasons = [...new Set([...waitLoop.matchAll(/reason: '([a-z]+)'/g)].map((m) => m[1]))];
  const section = prompt.slice(prompt.indexOf('## 2.'), prompt.indexOf('## 3.'));

  test('waitLoop\'s reasons were found', () => {
    assert.deepEqual([...reasons].sort(), ['abort', 'cap', 'credential', 'error', 'halt', 'stall', 'work']);
  });
  test('§2 handles every one', () => {
    for (const r of reasons) assert.match(section, new RegExp(`^- \`${r}\` →`, 'm'), `§2 has no line for reason ${r}`);
  });
  test('`error` (a 429, a 5xx) re-arms', () => {
    assert.match(section, /^- `error` →[^\n]*re-arm/m);
  });
  test('`credential` ends the runner only on the kit\'s own "rejected (expired or revoked)" text; anything else re-arms', () => {
    assert.ok(src.includes('rejected (expired or revoked)'), 'the kit\'s 401 message carries the phrase the prompt keys on');
    const line = section.split('\n').find((l) => l.startsWith('- `credential` →'));
    const rest = section.slice(section.indexOf(line));
    assert.match(rest, /rejected \(expired or revoked\)/);
    assert.match(rest, /anything else[^\n]*re-arm/i);
  });
});

// N2 (S3 review 49b9f290): only `wait` refreshes the heartbeat the brokers
// need and runs the watchdog, so the no-background fallback must run `wait`
// (in the foreground, on each /loop tick), never `poll` alone.
describe('N2: the /loop fallback keeps brokers alive', () => {
  const section = prompt.slice(prompt.indexOf('## 2.'), prompt.indexOf('## 3.'));
  const fallback = section.slice(section.indexOf('`/loop'));
  test('each /loop tick runs `runner wait` in the foreground', () => {
    assert.match(fallback, /`\/loop 2m`[^.]*`runner wait` in the foreground/);
  });
  test('it says why: only wait keeps the heartbeat and the watchdog', () => {
    assert.match(fallback, /heartbeat/);
    assert.match(fallback, /watchdog/);
  });
  test('the fallback never tells you to loop on `runner poll` alone', () => {
    assert.doesNotMatch(fallback, /\/loop 2m`?\s+with `runner poll`/);
  });
  test('the kit agrees: only waitLoop touches the heartbeat', () => {
    const src = readFileSync(join(KIT_DIR, 'runner.mjs'), 'utf8');
    const touches = [...src.matchAll(/touch\(p\.heartbeat\)/g)].length;
    assert.equal(touches, 1);
    assert.ok(src.slice(src.indexOf('async function waitLoop(')).includes('touch(p.heartbeat)'));
  });
});

describe('the review steps', () => {
  test('NB2: stop if another consumer is polling', () => {
    assert.match(prompt, /another consumer/i);
    assert.match(prompt, /stop this runner/i);
  });
  test('B5: an abort-row step', () => {
    assert.match(prompt, /abort row/i);
    assert.match(prompt, /\[aborted\] Cancelled running session/);
  });
  test('B1: refused items are left queued; a take-time mismatch posts [skipped] refused:', () => {
    assert.match(prompt, /left queued/i);
    assert.match(prompt, /never take[^.\n]*then fail|never taken and then failed/i);
    assert.match(prompt, /\[skipped\] refused:/);
  });
  test('a recover step before login', () => {
    const recover = prompt.indexOf('runner.mjs recover');
    const login = prompt.indexOf('runner.mjs login');
    assert.ok(recover !== -1 && login !== -1 && recover < login, 'recover comes before login');
  });
});

describe('interpolated values come from their sources', () => {
  test('the bootstrap and working TTLs', () => {
    assert.match(prompt, new RegExp(`${RUNNER_BOOTSTRAP_TTL_SECONDS / 3600}h`));
    assert.match(prompt, new RegExp(`${RUNNER_WORKING_TTL_SECONDS / 3600}h`));
  });
  test('every HALT_MODES value is present', () => {
    for (const mode of HALT_MODES) assert.ok(prompt.includes(`\`${mode}\``), `halt mode ${mode}`);
  });
  test('FEEDBACK_ENTRY_KINDS are listed from the source', () => {
    assert.ok(prompt.includes(FEEDBACK_ENTRY_KINDS.map((k) => `\`${k}\``).join(', ')));
  });
  test('the runner kit\'s own thresholds', () => {
    assert.match(prompt, new RegExp(`${OTHER_CONSUMER_RECENT_MS / 60_000} minutes`));
    assert.match(prompt, new RegExp(`${FRESH_TAKE_MIN_TOKEN_LIFE_MS / 3_600_000}h`));
    assert.match(prompt, new RegExp(`${WATCHDOG_STALL_MIN} minutes`));
    assert.match(prompt, new RegExp(`${WATCHDOG_FAIL_MIN} minutes`));
    assert.match(prompt, new RegExp(`${WAIT_CAP_MS / 60_000} minutes`));
  });
  test('the template holds no hard-coded copy of an interpolated value', () => {
    const raw = readFileSync(join(ROOT, 'docs', 'runner-prompt.md'), 'utf8');
    const body = raw.slice(raw.search(/^---$/m) + 4);
    const copies = [
      `${RUNNER_BOOTSTRAP_TTL_SECONDS / 3600}h`, `${RUNNER_WORKING_TTL_SECONDS / 3600}h`,
      `${OTHER_CONSUMER_RECENT_MS / 60_000} minutes`, `${FRESH_TAKE_MIN_TOKEN_LIFE_MS / 3_600_000}h`,
      `${WATCHDOG_STALL_MIN} minutes`, `${WATCHDOG_FAIL_MIN} minutes`, `${WAIT_CAP_MS / 60_000} minutes`,
      `${WAIT_HEARTBEAT_MS / 1000} seconds`, `${BROKER_STALE_MS / 60_000} minutes`, `${BROKER_MAX_LIFETIME_MS / 3_600_000}h`,
      FEEDBACK_ENTRY_KINDS.map((k) => `\`${k}\``).join(', ')
    ];
    for (const copy of copies) {
      // Whole-token match: "1h" inside `cacheCreation1hInputTokens` is not a copy.
      const escaped = copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.ok(!new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(body), `hard-coded "${copy}" in docs/runner-prompt.md: use its placeholder`);
    }
  });

  test('baseUrl, and no placeholder left behind', () => {
    assert.ok(prompt.includes(`${BASE}/runner-kit/broker.mjs`));
    assert.ok(prompt.includes(`${BASE}/runner-kit/runner.mjs`));
    assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
    const other = buildRunnerKickoff({ baseUrl: 'http://127.0.0.1:3001' });
    assert.ok(other.includes('http://127.0.0.1:3001/runner-kit/runner.mjs'));
    assert.ok(!other.includes(BASE));
  });
  test('the preamble (the design notes above the first ---) is not served', () => {
    const raw = readFileSync(join(ROOT, 'docs', 'runner-prompt.md'), 'utf8');
    const preamble = raw.slice(0, raw.search(/^---$/m));
    assert.ok(preamble.length > 0);
    assert.ok(!prompt.includes(preamble.trim().split('\n')[0]));
  });
});

describe('NB4: kit integrity (served from /runner-kit, pinned by sha256)', () => {
  test('the kit is exactly the lib/runner-kit .mjs files', () => {
    assert.deepEqual([...RUNNER_KIT_FILES].sort(), ['broker.mjs', 'runner.mjs']);
  });

  test('each pinned hash equals the file at HEAD', () => {
    for (const file of RUNNER_KIT_FILES) {
      const want = sha256(readFileSync(join(KIT_DIR, file)));
      assert.ok(prompt.includes(want), `${file}: pinned ${want} missing from the prompt`);
    }
  });

  const verifyCommand = () => {
    const m = prompt.match(/```sh verify\n([\s\S]*?)```/);
    assert.ok(m, 'the prompt carries a ```sh verify block');
    return m[1].trim();
  };

  test('the prompt\'s verify command passes on the real kit and refuses a tampered one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rk-verify-'));
    try {
      for (const f of RUNNER_KIT_FILES) copyFileSync(join(KIT_DIR, f), join(dir, f));
      const ok = execFileSync('sh', ['-c', verifyCommand()], { cwd: dir, encoding: 'utf8' });
      assert.match(ok, /kit ok/);
      appendFileSync(join(dir, 'runner.mjs'), '\n// tampered\n');
      assert.throws(() => execFileSync('sh', ['-c', verifyCommand()], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }), /MISMATCH|Command failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the prompt fetches the kit, then verifies, before any recover or login', () => {
    const fetchAt = prompt.indexOf('/runner-kit/runner.mjs');
    const verifyAt = prompt.indexOf('```sh verify');
    const recoverAt = prompt.indexOf('runner.mjs recover');
    assert.ok(fetchAt < verifyAt && verifyAt < recoverAt);
  });
});

describe('no secrets', () => {
  test('no token-shaped string in the prompt (hex pins excepted)', () => {
    let text = prompt;
    for (const f of RUNNER_KIT_FILES) text = text.replaceAll(sha256(readFileSync(join(KIT_DIR, f))), '');
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{40,}/);
  });
});

describe('the builder', () => {
  test('a missing doc returns the FALLBACK, which is never cached', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rk-kick-'));
    try {
      const promptPath = join(dir, 'runner-prompt.md');
      const build = createRunnerKickoffBuilder({ promptPath, kitDir: KIT_DIR });
      const first = build({ baseUrl: BASE });
      assert.match(first, /could not be loaded/);
      writeFileSync(promptPath, `preamble\n---\nHello from {{BASE_URL}} ${randomBytes(4).toString('hex')}\n`);
      const second = build({ baseUrl: BASE });
      assert.match(second, /^Hello from https:\/\/harbour\.example/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unknown placeholder never ships braces: it serves the uncached FALLBACK', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rk-kick-'));
    try {
      const promptPath = join(dir, 'runner-prompt.md');
      writeFileSync(promptPath, 'p\n---\n{{NOT_A_THING}}\n');
      const build = createRunnerKickoffBuilder({ promptPath, kitDir: KIT_DIR });
      const out = build({ baseUrl: BASE });
      assert.match(out, /could not be loaded/);
      assert.doesNotMatch(out, /\{\{/);
      writeFileSync(promptPath, 'p\n---\nfixed {{BASE_URL}}\n');
      assert.equal(build({ baseUrl: BASE }), `fixed ${BASE}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('baseUrl is required', () => {
    assert.throws(() => buildRunnerKickoff({}), /baseUrl/);
  });
});

// F1 (S3 review 49b9f290): the setup must complete on a FRESH machine. Every
// setup block is taken from the SERVED prompt and run verbatim, in order, with
// HOME pointed at an empty directory and the prompt built against a local
// Harbour (the real /runner-kit route plus a fake token exchange). Async exec,
// so this process's server can answer the curl and the kit's own requests.
describe('F1: the served setup runs verbatim on a fresh machine', () => {
  const sh = promisify(execFile);
  const block = (served, info) => {
    const m = served.match(new RegExp('```sh ' + info + '\\n([\\s\\S]*?)```'));
    assert.ok(m, `the prompt carries a \`\`\`sh ${info} block`);
    return m[1].trim();
  };

  async function localHarbour() {
    const bootstrap = randomBytes(24).toString('base64url');
    const app = express();
    app.use(createRunnerKitRoutes());
    app.post('/api/proxy/token', (req, res) => {
      if (req.headers.authorization !== `Bearer ${bootstrap}`) return res.status(401).json({ error: 'spent' });
      res.json({ token: randomBytes(32).toString('base64url'), scope: 'readWrite', grants: ['take', 'dispatch'], expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
    });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return { bootstrap, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
  }

  test('fetch → verify → recover → login → status, with nothing on disk beforehand', { timeout: 30_000 }, async () => {
    const harbour = await localHarbour();
    const home = mkdtempSync(join(tmpdir(), 'rk-fresh-'));
    const env = { PATH: process.env.PATH, HOME: home };
    try {
      const served = buildRunnerKickoff({ baseUrl: harbour.base });
      await sh('sh', ['-c', block(served, 'setup')], { env });
      const kitDir = join(home, '.harbour-runner', 'kit');
      const verified = await sh('sh', ['-c', block(served, 'verify')], { env, cwd: kitDir });
      assert.match(verified.stdout, /kit ok/);

      const recoverCmd = block(served, 'recover');
      assert.match(recoverCmd, /--url-key <urlKey from the credential block>/);
      const recovered = JSON.parse((await sh('sh', ['-c', recoverCmd.replace('<urlKey from the credential block>', 'acme')], { env })).stdout);
      assert.match(recovered.session, /^[0-9a-f]{16}$/);
      assert.deepEqual([recovered.fail, recovered.orphans, recovered.lost, recovered.live], [[], [], [], []]);

      const credential = `## Your runner credential\n- baseUrl: ${harbour.base}\n- urlKey: acme\n- ownerAccountId: acct-owner\n- bootstrap: ${harbour.bootstrap}\n`;
      const loginCmd = block(served, 'login');
      assert.ok(loginCmd.includes('<paste the credential block here, unchanged>'));
      // The heredoc terminator must sit at column 0, or sh never matches it.
      assert.equal(loginCmd.split('\n').at(-1), 'CRED');
      for (const info of ['setup', 'verify', 'recover', 'login']) {
        assert.ok(served.includes('\n```sh ' + info + '\n'), `${info} block is not indented`);
      }
      const loggedIn = JSON.parse((await sh('sh', ['-c', loginCmd.replace('<paste the credential block here, unchanged>', credential.trim())], { env })).stdout);
      assert.equal(loggedIn.ok, true);
      assert.deepEqual(loggedIn.grants, ['take', 'dispatch']);

      const status = JSON.parse((await sh('sh', ['-c', 'node ~/.harbour-runner/kit/runner.mjs status'], { env })).stdout);
      assert.equal(status.loggedIn, true);
      assert.equal(status.urlKey, 'acme');
    } finally {
      await harbour.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the prompt says when later commands need --url-key too', () => {
    assert.match(prompt, /another workspace, add `--url-key <urlKey>` to every command/);
  });

  test('control: recover without --url-key fails on a fresh home (why the served step carries it)', { timeout: 30_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'rk-fresh-'));
    try {
      await assert.rejects(
        sh(process.execPath, [join(KIT_DIR, 'runner.mjs'), 'recover', '--home', home], { env: { PATH: process.env.PATH, HOME: home } }),
        /no workspace set up yet/
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
