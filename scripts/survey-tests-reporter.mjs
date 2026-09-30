// LIN-3151: a node:test custom reporter that writes one JSON line per finished test (file, name, nesting, duration_ms, pass/fail) for survey-tests-timing.mjs to aggregate per file.
// Usage: node --test --test-reporter=./scripts/survey-tests-reporter.mjs --test-reporter-destination=data/survey-tests/lv-timing.jsonl tests/unit/*.test.js
export default async function* surveyTestsReporter(source) {
  const started = Date.now();
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    yield JSON.stringify({
      file: d.file || null,
      name: d.name,
      nesting: d.nesting,
      ms: d.details?.duration_ms ?? null,
      ok: event.type === 'test:pass',
      skip: Boolean(d.skip),
      todo: Boolean(d.todo),
    }) + '\n';
  }
  yield JSON.stringify({ wallMs: Date.now() - started }) + '\n';
}
