// TAP reading for the perturbation probe (LIN-3628, from experiments/consolidate-4-entrance/4c/probe/fails.sh and fails2.sh).
// Pure, no acorn. Written against the Node test runner's `tap` reporter; the test command must print TAP.

// Failing (sub)tests at any depth: [{ file, name }], sorted and unique. `root` is the tree the tests
// ran in; it is cut from locations so a baseline run and a rewrite run compare equal. A test marked
// TODO is an expected failure and a SKIP is not a failure, so neither is listed.
export function parseTap(text, { root = null } = {}) {
  const roots = [root, ...(root ? [root.replace(/^\/private(?=\/)/, '')] : [])].filter(Boolean).map((r) => r.replace(/\/+$/, '') + '/');
  const lines = text.split('\n');
  const found = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*not ok \d+ - (.*)$/.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (/\s#\s*(TODO|SKIP)\b/i.test(name)) continue;
    let file = null;
    // The YAML block that follows carries `location: '<file>:<line>:<col>'`; stop at its end or the next test line.
    for (let j = i + 1; j < lines.length && !/^\s*(not ok|ok) \d+ - /.test(lines[j]) && !/^\s*# Subtest/.test(lines[j]); j++) {
      const loc = /^\s*location:\s*'?(.*?)'?\s*$/.exec(lines[j]);
      if (loc) { file = loc[1].replace(/:\d+:\d+$/, ''); break; }
    }
    if (file) for (const r of roots) { const at = file.indexOf(r); if (at !== -1) { file = file.slice(at + r.length); break; } }
    const f = { file: file ?? '(no location)', name };
    found.set(`${f.file} :: ${f.name}`, f);
  }
  return [...found.values()].sort((a, b) => (`${a.file} :: ${a.name}` < `${b.file} :: ${b.name}` ? -1 : 1));
}

export const failureKey = (f) => `${f.file} :: ${f.name}`;

// Failures a rewrite adds to the baseline, and those it no longer shows.
export function diffFailures(baseline, rewritten) {
  const had = new Set(baseline.map(failureKey)), has = new Set(rewritten.map(failureKey));
  return { addedFailures: rewritten.filter((f) => !had.has(failureKey(f))), noLongerFailing: baseline.filter((f) => !has.has(failureKey(f))) };
}

// Whether the text looks like TAP at all (a version line or any ok / not ok line).
export const looksLikeTap = (text) => /^TAP version \d+/m.test(text) || /^\s*(not ok|ok) \d+/m.test(text);
