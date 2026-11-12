/**
 * CI wiring, enforced (LIN-4441).
 *
 * `ci-success` is the one check branch protection requires (ruleset 17491666),
 * so a job that is not wired into it can go red without blocking a merge. This
 * file reads .github/workflows/test.yml as text (the file's own two-space job
 * shape, so no YAML parser is needed) and checks three things:
 *
 *   - every job except `ci-success` is listed in its `needs`, tested in its
 *     shell condition and named in its failure message;
 *   - the two unit arms are separate jobs with distinct environments, and both
 *     Mongo services use the same image and tunable (LIN-3693 pins production);
 *   - each job the rule set knows about is still present by name.
 *
 * `unwiredJobs` is the single rule. The first test runs it on the real file;
 * the broken-input tests run it on copies with one wire cut, each of which must
 * name the job, so a loosened rule cannot pass vacuously.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/ci-workflow.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const WORKFLOW = '.github/workflows/test.yml';
const GATE = 'ci-success';
const UNIT_ARMS = { unit: 'Unit tests', 'unit-proxy': 'Unit tests (proxy, clock +400d)' };

// Job key -> its block of text, from the line after `jobs:` to the next job key.
export function jobBlocks(text) {
  const lines = text.split('\n');
  const blocks = new Map();
  let current = null;
  let inJobs = false;
  for (const line of lines) {
    if (line === 'jobs:') { inJobs = true; continue; }
    if (!inJobs) continue;
    const key = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (key) { current = key[1]; blocks.set(current, []); continue; }
    if (current) blocks.get(current).push(line);
  }
  return new Map([...blocks].map(([name, body]) => [name, body.join('\n')]));
}

// The jobs, other than the gate, that the gate does not wire in: missing from its `needs`,
// not tested in its shell condition, or not named in its failure message.
export function unwiredJobs(text) {
  const jobs = jobBlocks(text);
  const gate = jobs.get(GATE) ?? '';
  const needs = /^ {4}needs: \[([^\]]*)\]/m.exec(gate)?.[1].split(',').map((s) => s.trim()) ?? [];
  return [...jobs.keys()].filter((job) => job !== GATE).filter((job) => !(
    needs.includes(job)
    && new RegExp(`needs\\.${job}\\.result \\}\\}" != "success"`).test(gate)
    && new RegExp(`[ (,]${job}=`).test(gate)
  ));
}

// Every Mongo service in the file, as { job, image, tunable }.
export function mongoServices(text) {
  const out = [];
  for (const [job, body] of jobBlocks(text)) {
    if (!/^ {4}services:/m.test(body)) continue;
    const image = /image: (\S+)/.exec(body)?.[1] ?? null;
    const tunable = /GLIBC_TUNABLES: (\S+)/.exec(body)?.[1] ?? null;
    out.push({ job, image, tunable });
  }
  return out;
}

const workflow = readFileSync(new URL(WORKFLOW, root), 'utf8');

test('every job except the gate is wired into ci-success: needs, shell condition and failure message', () => {
  assert.deepEqual(unwiredJobs(workflow), []);
});

test('the gate is the only job that reads the others: a job missing from any of its three places is named', () => {
  const cut = {
    needs: workflow.replace('needs: [unit, unit-proxy, e2e, secret-scan]', 'needs: [unit, e2e, secret-scan]'),
    condition: workflow.replace(' || [ "${{ needs.unit-proxy.result }}" != "success" ]', ''),
    message: workflow.replace(', unit-proxy=${{ needs.unit-proxy.result }}', ''),
  };
  for (const [where, text] of Object.entries(cut)) {
    assert.notEqual(text, workflow, `${where}: the cut applied`);
    assert.deepEqual(unwiredJobs(text), ['unit-proxy'], `cut from ${where}`);
  }
});

test('a new job added with no wiring is named, whatever its name', () => {
  const added = workflow.replace('  e2e:\n', '  lint:\n    name: Lint\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run lint\n\n  e2e:\n');
  assert.deepEqual(unwiredJobs(added), ['lint']);
});

test('both unit arms exist as separate jobs under their names, and each keeps its own environment', () => {
  const jobs = jobBlocks(workflow);
  for (const [job, name] of Object.entries(UNIT_ARMS)) {
    assert.ok(jobs.has(job), `job ${job} exists`);
    assert.match(jobs.get(job), new RegExp(`^ {4}name: ${name.replace(/[()+]/g, '\\$&')}$`, 'm'), `${job} is named "${name}"`);
  }
  assert.match(jobs.get('unit'), /npm run test:hermetic:keyed/);
  assert.doesNotMatch(jobs.get('unit'), /CLOCK_SHIFT_DAYS|test:hermetic:proxy/, 'the keyed arm stays on the real clock with no proxy arm');
  assert.match(jobs.get('unit-proxy'), /npm run test:hermetic:proxy/);
  assert.match(jobs.get('unit-proxy'), /CLOCK_SHIFT_DAYS: 400/);
  assert.doesNotMatch(jobs.get('unit-proxy'), /test:hermetic:keyed/);
});

test('both unit jobs run a Mongo service on the same image and tunable (LIN-3693)', () => {
  const services = mongoServices(workflow);
  assert.deepEqual(services.map((s) => s.job).sort(), ['unit', 'unit-proxy']);
  for (const s of services) {
    assert.equal(s.image, 'mongo:8.0.32', `${s.job} image`);
    assert.equal(s.tunable, 'glibc.pthread.rseq=1', `${s.job} tunable`);
  }
});

test('the drift check catches a unit job whose Mongo image moves alone', () => {
  const drifted = workflow.replace(/(  unit-proxy:[\s\S]*?image: )mongo:8\.0\.32/, '$1mongo:8.0.33');
  assert.notEqual(drifted, workflow, 'the drift applied');
  const images = mongoServices(drifted).map((s) => s.image);
  assert.ok(new Set(images).size > 1, 'the two services now differ');
});
