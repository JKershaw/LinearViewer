// LIN-4251: the preamble's write mode reaches every entrance that builds a worker's preamble, and
// `work` is unchanged. Three witnesses:
//   1. `work` bytes: every endpoint-hint variant, in both delivery modes, equals the block captured at
//      HEAD before this change (tests/fixtures/lin-4251-work-blocks.json). Nothing here names a stage.
//   2. stageWrites: the one lookup every entrance uses to hand the preamble a kind's `writes`.
//   3. A census of the call sites of attachProxyContext in lib/ and routes/: each must be listed with
//      the reason it passes (or does not pass) `writes`. A new site fails until its author decides.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { stageWrites } from '../../lib/prompt-templates.js';
import { WRITES } from '../../lib/stage-writes.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/lin-4251-work-blocks.json'), 'utf8'));

describe('LIN-4251 — the work block is byte-identical to HEAD before the change', () => {
  // The same enumeration the baseline was captured with: issue or not, delivery, and the eight
  // provider-flag combinations that pick each endpoint-hint branch. Keys match the fixture's.
  for (const issueIdentifier of ['LIN-42', null]) {
    for (const tokenDelivery of ['prose', 'mcp']) {
      for (const issueDetail of [true, false]) for (const relations of [true, false]) for (const search of [true, false]) {
        const key = `${issueIdentifier ?? 'none'}|${tokenDelivery}|detail=${issueDetail}|rel=${relations}|search=${search}|Linear`;
        test(`${key}: work, and no writes, both equal the HEAD block`, () => {
          const input = { baseUrl: 'https://host', token: 'TOK123', issueIdentifier: issueIdentifier ?? undefined, tokenDelivery, providerDisplayName: 'Linear', providerUi: { issueDetail, relations, search } };
          assert.equal(buildProxyContextPreamble({ ...input, writes: WRITES.WORK }), BASELINE[key]);
          assert.equal(buildProxyContextPreamble(input), BASELINE[key]);
        });
      }
    }
  }

  for (const tokenDelivery of ['prose', 'mcp']) {
    for (const issueIdentifier of ['LIN-42', null]) {
      const key = `${issueIdentifier ?? 'none'}|${tokenDelivery}|no-provider`;
      test(`${key}: no provider name or ui, still the HEAD block`, () => {
        assert.equal(buildProxyContextPreamble({ baseUrl: 'https://host', token: 'TOK123', issueIdentifier: issueIdentifier ?? undefined, tokenDelivery, writes: WRITES.WORK }), BASELINE[key]);
      });
    }
  }
});

describe('LIN-4251 — stageWrites: the one lookup the entrances share', () => {
  test('a template\'s declared value comes back', () => {
    assert.equal(stageWrites('triage'), WRITES.TICKET_FIELDS);
    assert.equal(stageWrites('retro'), WRITES.NONE);
    assert.equal(stageWrites('context'), WRITES.ONE_COMMENT);
    assert.equal(stageWrites('implementation'), WRITES.WORK);
  });

  test('a kind with no template is undefined, which the preamble reads as work', () => {
    assert.equal(stageWrites('autopilot'), undefined);
    assert.equal(stageWrites('custom'), undefined);
    assert.equal(stageWrites(undefined), undefined);
    assert.equal(stageWrites(null), undefined);
  });

  test('an inherited property name is not a template (hasOwn, not a bare index)', () => {
    assert.equal(stageWrites('constructor'), undefined);
    assert.equal(stageWrites('__proto__'), undefined);
  });
});

// ─── The census of attachProxyContext call sites ─────────────────────────────
// Each file that calls attachProxyContext, with how many calls and why each passes (or does not
// pass) `writes`. The definition in lib/proxy-preamble.js is not a call and is not counted. A new
// call site anywhere in lib/ or routes/ fails this until it is listed here with its reason.
const CENSUS = {
  'lib/dispatch-entrance.js': { calls: 1, why: 'the launch arm passes writes: stageWrites(resolvedKind)' },
  'lib/proxy-preamble.js': { calls: 2, why: 'both calls in provisionResumeCredential forward attach.writes (the follow-up\'s stage)' },
  'routes/collective.js': { calls: 1, why: 'kind custom, which has no template: writes is absent, so work. Out of scope.' },
  'routes/workspace-api-feedback.js': { calls: 2, why: 'feedback triage and feedback autopilot pass writes: stageWrites(kind) from the factory\'s finalizePrompt' },
};

function sourceFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(ROOT, dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(join(dir, name));
    return name.endsWith('.js') ? [relative(ROOT, path).split(sep).join('/')] : [];
  });
}

function callsIn(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  return text.split('\n').filter(line => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    if (/export\s+async\s+function\s+attachProxyContext\(/.test(line)) return false;
    return line.includes('attachProxyContext(');
  }).length;
}

describe('LIN-4251 — census: every attachProxyContext call site is listed with its reason', () => {
  const files = [...sourceFiles('lib'), ...sourceFiles('routes')];
  const found = Object.fromEntries(files.map(f => [f, callsIn(f)]).filter(([, n]) => n > 0));

  test('the files that call it are exactly the census', () => {
    assert.deepEqual(Object.keys(found).sort(), Object.keys(CENSUS).sort());
  });

  for (const [file, row] of Object.entries(CENSUS)) {
    test(`${file}: ${row.calls} call(s), each with its reason`, () => {
      assert.equal(found[file], row.calls, `${file} call count`);
      assert.ok(row.why.length > 20, 'a reason is recorded');
    });
  }
});
