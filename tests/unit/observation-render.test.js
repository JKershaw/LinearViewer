// LIN-866: Observation activity-log / produced-artifact fidelity (design §6.3/§6.4).
//
// public/observation.js is a browser script (not an ES module), so we can't import
// it. It only touches `window`/`document` at load time via two addEventListener
// calls at the end. We evaluate its source in a vm sandbox that supplies a `module`
// object (so its guarded CommonJS test export runs) plus stubbed browser globals,
// then exercise the pure presentation helpers without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');
// `escapeHtml` is a browser global installed by common.js (`window.escapeHtml`),
// which observation.js references bare. Supply a faithful copy in the sandbox.
const escapeHtml = (str) => {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};
const sandbox = {
  module: { exports: {} },
  window: { addEventListener() {} },
  document: { addEventListener() {} },
  escapeHtml,
  console,
};
vm.runInNewContext(src, sandbox, { filename: 'observation.js' });
const { renderActivityLog, renderArtifacts, classifyArtifact } = sandbox.module.exports;

test.describe('renderActivityLog — §6.3 burst copy', () => {
  test('drops the redundant per-burst total when a breakdown sums it', () => {
    const html = renderActivityLog({ metrics: [{ toolCount: 18, breakdown: { Edit: 13, Bash: 5 }, elapsedSeconds: 142 }] });
    assert.match(html, /Edit×13/);
    assert.match(html, /Bash×5/);
    // The chips already sum to 18 — no separate "18 tools" total chip.
    assert.doesNotMatch(html, /18 tool/);
  });

  test('empty burst reads as a quiet "no tools", never "0 tools"', () => {
    const html = renderActivityLog({ metrics: [{ toolCount: 0, elapsedSeconds: 3 }] });
    assert.match(html, /no tools/);
    assert.doesNotMatch(html, /0 tool/);
    assert.match(html, /obs-act-idle/);
  });

  test('bare count is kept when there is no breakdown to sum it', () => {
    const one = renderActivityLog({ metrics: [{ toolCount: 1 }] });
    assert.match(one, /1 tool<\/span>/);
    const many = renderActivityLog({ metrics: [{ toolCount: 7 }] });
    assert.match(many, /7 tools<\/span>/);
  });

  test('a non-tool metric (no toolCount) still falls back to its raw line', () => {
    const html = renderActivityLog({ metrics: [{ raw: 'thinking' }] });
    assert.match(html, /obs-act-raw/);
    assert.match(html, /thinking/);
    assert.doesNotMatch(html, /no tools/);
  });
});

test.describe('classifyArtifact / renderArtifacts — §6.4 typed rendering', () => {
  test('classifies a GitHub PR url as a pr with a repo #num handle', () => {
    const c = classifyArtifact({ url: 'https://github.com/JKershaw/simple-dispatcher/pull/24' });
    assert.equal(c.pr, true);
    assert.equal(c.handle, 'simple-dispatcher #24');
  });

  test('classifies a GitLab merge request url as a pr', () => {
    const c = classifyArtifact({ url: 'https://gitlab.com/group/repo/-/merge_requests/5' });
    assert.equal(c.pr, true);
    assert.equal(c.handle, 'repo #5');
  });

  test('a non-PR url is a plain link', () => {
    assert.equal(classifyArtifact({ url: 'https://example.com/logs/run-1.txt' }).pr, false);
  });

  test('renders a PR with the branch glyph + mono handle', () => {
    const html = renderArtifacts({ producedArtifacts: [{ url: 'https://github.com/JKershaw/simple-dispatcher/pull/24', label: 'PR #24' }] });
    assert.match(html, /obs-artifact-pr/);
    assert.match(html, /⎇/);
    assert.match(html, /obs-artifact-handle/);
    assert.match(html, /simple-dispatcher #24/);
  });

  test('renders a plain link with the external glyph and its label', () => {
    const html = renderArtifacts({ producedArtifacts: [{ url: 'https://example.com/log.txt', label: 'run log' }] });
    assert.match(html, /↗/);
    assert.match(html, /run log/);
    assert.doesNotMatch(html, /obs-artifact-pr/);
  });

  test('no artifacts → empty string', () => {
    assert.equal(renderArtifacts({ producedArtifacts: [] }), '');
  });
});
