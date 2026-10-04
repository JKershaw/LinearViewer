/**
 * LIN-3300: the routing eval makes its model an explicit choice and will not start a
 * full-corpus run by accident. A run on 4 Oct went to the library default model instead
 * of the workspace's router model and had to be repeated; the key is close to its limit.
 *
 * - `--model <id>` (or MODEL) is required for any run that calls a model: no default.
 * - Every run prints its planned call count and approximate input size first.
 * - A full-corpus run that calls a model stops there unless `--confirm` is passed.
 *
 * The CLI test runs the script with a placeholder key and checks it exits before any call
 * (a model call would need the network, which this suite never has).
 *
 * Run with: node --test tests/unit/jev-routing-eval-gate.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, refusalReason, planRun, loadCases, EXPECTED_FIXTURES } from '../../scripts/eval/jev-routing-eval.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/eval/jev-routing-eval.mjs', import.meta.url));

describe('the routing eval gate (LIN-3300)', () => {
  test('flags: --model in both spellings, and --confirm', () => {
    assert.deepEqual(parseCliArgs([]), { model: null, confirm: false });
    assert.deepEqual(parseCliArgs(['--model', 'openai/x']), { model: 'openai/x', confirm: false });
    assert.deepEqual(parseCliArgs(['--model=openai/x', '--confirm']), { model: 'openai/x', confirm: true });
  });

  test('a model-calling run needs a model, and a full-corpus one needs --confirm', () => {
    assert.match(refusalReason({ callsModels: true, model: null, fullCorpus: false, confirm: true }), /no model chosen/);
    assert.match(refusalReason({ callsModels: true, model: 'm', fullCorpus: true, confirm: false }), /--confirm/);
    assert.equal(refusalReason({ callsModels: true, model: 'm', fullCorpus: true, confirm: true }), null);
    assert.equal(refusalReason({ callsModels: true, model: 'm', fullCorpus: false, confirm: false }), null, 'a focused ONLY run needs no confirm');
    assert.equal(refusalReason({ callsModels: false, model: null, fullCorpus: true, confirm: false }), null, 'DRY and STUB call no model');
  });

  test('the plan counts calls without making any: a code-settled route sends nothing', async () => {
    const cases = loadCases().filter((c) => ['NSC-LIN-3309-REVISED', 'LIN-420'].includes(c.id));
    assert.equal(cases.length, 2);
    const plan = await planRun(cases, { k: 6, armKeys: ['arm3'], routingOnly: true });
    assert.equal(plan.perArm.arm3.calls, 6, 'LIN-420 is model-routed (6 runs); the revised plan is settled in code');
    assert.ok(plan.inputChars > 6 * 5000, 'the selector prompt is measured');
  });

  test('the corpus holds the 4 Oct trial points, with LIN-3304\'s contested point accepting both stages', () => {
    const cases = loadCases();
    assert.equal(cases.length, EXPECTED_FIXTURES);
    const scoped = cases.find((c) => c.id === 'OCT4-LIN-3304-SCOPED');
    assert.deepEqual(scoped.gold.expect, ['plan', 'implementation']);
    assert.ok(cases.filter((c) => c.id.startsWith('OCT4-')).length >= 18);
  });

  test('the CLI refuses a full-corpus run without --confirm, after printing the plan', () => {
    const env = { ...process.env, OPENROUTER_API_KEY: 'placeholder-not-a-key', ARMS: '3', ROUTING_ONLY: '1', K: '6' };
    delete env.ONLY; delete env.DRY; delete env.STUB; delete env.MODEL;
    const run = spawnSync(process.execPath, [SCRIPT, '--model', 'openai/test-model'], { env, encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 2, `exit status (stderr: ${run.stderr.slice(-400)})`);
    assert.match(run.stdout, /plan: 110 fixtures, K=6, arms arm3, model openai\/test-model/);
    assert.match(run.stdout, /arm3: \d+ calls, ~\d+k input chars/);
    assert.match(run.stderr, /REFUSED: a full-corpus run calls the model for every fixture: re-run with --confirm/);
    assert.doesNotMatch(run.stdout, /^\. /m, 'no fixture was run');

    const noModel = spawnSync(process.execPath, [SCRIPT], { env: { ...env, ONLY: 'LIN-420' }, encoding: 'utf8', timeout: 120000 });
    assert.equal(noModel.status, 2);
    assert.match(noModel.stderr, /REFUSED: no model chosen: pass --model/);
  });
});
