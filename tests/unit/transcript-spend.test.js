/**
 * Unit tests for lib/transcript-spend.js (LIN-1235, Track B / D3).
 *
 * The inside-view parser: reads a worker's Claude Code session transcript
 * (`~/.claude/projects/…/<sessionId>.jsonl`) and derives the per-session SPEND
 * profile — orientation / core / rework / verify — that the outside-view Track A
 * (heartbeat tool-counts) could not resolve because Bash is opaque there.
 *
 * Cases are pinned to the REAL JSONL shapes observed in the corpus:
 *  - assistant lines carry `message.usage` (input/output/cache tokens) + `model`
 *    + `content[]` with `tool_use` blocks ({name, input}).
 *  - user lines carry `content[]` with `tool_result` blocks whose `content` is
 *    USUALLY a raw string, SOMETIMES a list of {type:'text'|'tool_reference'}.
 *  - `is_error:true` marks a failed tool (e.g. a `<tool_use_error>` string).
 *  - dispatched sessions have NO Grep/Glob tool — search routes through Bash
 *    `grep`/`find`, so Bash command classification is load-bearing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  classifyTool,
  parseTranscriptLines,
  sessionSpend,
  normalizeRepoPath,
  __internal,
} from '../../lib/transcript-spend.js';

describe('normalizeRepoPath — cross-session file identity (H4 trap)', () => {
  test('strips the .claude projects double-uuid prefix', () => {
    assert.equal(
      normalizeRepoPath('/Users/work/.claude/projects/-x-workspaces-65f38940-b004-4864-b807-6d362d716d9b/65f38940-b004-4864-b807-6d362d716d9b/lib/a.js'),
      'lib/a.js');
  });
  test('strips the -workspaces/<uuid>/ clone prefix', () => {
    assert.equal(
      normalizeRepoPath('/Users/work/development/simple-dispatcher-workspaces/6b72a062-6b08-4296-8e6f-ebdacd269989/docs/x.md'),
      'docs/x.md');
  });
  test('two different-session clones of the same file normalize equal', () => {
    const a = normalizeRepoPath('/x/sd-workspaces/aaaaaaaa-1111-2222-3333-444444444444/lib/foo.js');
    const b = normalizeRepoPath('/x/sd-workspaces/bbbbbbbb-5555-6666-7777-888888888888/lib/foo.js');
    assert.equal(a, b);
    assert.equal(a, 'lib/foo.js');
  });
  test('session-local scratch (tool-results) is dropped as null', () => {
    assert.equal(normalizeRepoPath('/x/-workspaces-65f38940-b004-4864-b807-6d362d716d9b/65f38940-b004-4864-b807-6d362d716d9b/tool-results/z.txt'), null);
  });
  test('a plain path with no workspace segment is returned unchanged', () => {
    assert.equal(normalizeRepoPath('/repo/x.js'), '/repo/x.js');
  });
});

// ─── classifyTool — the load-bearing piece ───────────────────────────────────

describe('classifyTool — named tools', () => {
  test('Read/LS are ORIENT', () => {
    assert.equal(classifyTool('Read', { file_path: '/a/b.js' }).cls, 'ORIENT');
    assert.equal(classifyTool('LS', { path: '/a' }).cls, 'ORIENT');
  });
  test('Edit/Write/MultiEdit are CORE', () => {
    assert.equal(classifyTool('Edit', { file_path: '/a.js' }).cls, 'CORE');
    assert.equal(classifyTool('Write', { file_path: '/a.js' }).cls, 'CORE');
    assert.equal(classifyTool('MultiEdit', {}).cls, 'CORE');
  });
  test('mcp__/ToolSearch/WebFetch are COORD', () => {
    assert.equal(classifyTool('mcp__harbour__get_working_token', {}).cls, 'COORD');
    assert.equal(classifyTool('ToolSearch', {}).cls, 'COORD');
    assert.equal(classifyTool('WebFetch', {}).cls, 'COORD');
  });
});

describe('classifyTool — Bash command classification (the resolution Track A lacked)', () => {
  const bash = (command) => classifyTool('Bash', { command }).cls;
  test('git archaeology + file reads are ORIENT', () => {
    assert.equal(bash('git log --oneline -20'), 'ORIENT');
    assert.equal(bash('git diff HEAD~1'), 'ORIENT');
    assert.equal(bash('cat package.json'), 'ORIENT');
    assert.equal(bash('grep -rn "foo" lib/'), 'ORIENT');
    assert.equal(bash('find . -name "*.test.js"'), 'ORIENT');
    assert.equal(bash('ls -la routes/'), 'ORIENT');
  });
  test('tests / builds / CI are VERIFY (reuses the wall-clock CI signature)', () => {
    assert.equal(bash('npm test'), 'VERIFY');
    assert.equal(bash('npm run test tests/unit/foo.test.js'), 'VERIFY');
    assert.equal(bash('node --test tests/unit/x.test.js'), 'VERIFY');
    assert.equal(bash('npx playwright test'), 'VERIFY');
    assert.equal(bash('gh pr checks 123'), 'VERIFY');
  });
  test('mutating git / fs commands are CORE', () => {
    assert.equal(bash('git commit -m "x"'), 'CORE');
    assert.equal(bash('git add -A && git commit -m "y"'), 'CORE');
    assert.equal(bash('mkdir -p lib/new'), 'CORE');
    assert.equal(bash('sed -i "" s/a/b/ f.js'), 'CORE');
  });
  test('proxy/api curls are COORD, not orientation', () => {
    assert.equal(bash('curl -H "Authorization: Bearer x" https://projects.jkershaw.com/api/proxy/issues/LIN-1'), 'COORD');
    assert.equal(bash('curl -sS https://projects.jkershaw.com/api/proxy/dispatch/abc'), 'COORD');
  });
  test('pure scaffolding is SCAFFOLD (echo/cd/export/pwd-only)', () => {
    assert.equal(bash('echo "done"'), 'SCAFFOLD');
    assert.equal(bash('cd /a/b'), 'SCAFFOLD');
    assert.equal(bash('export FOO=bar'), 'SCAFFOLD');
  });
  test('unrecognised Bash is UNKNOWN, not silently ORIENT', () => {
    assert.equal(bash('python3 analyze.py'), 'UNKNOWN');
    assert.equal(bash('some-novel-tool --flag'), 'UNKNOWN');
  });
  test('leading env-var assignment / cd prefix does not fool the classifier', () => {
    assert.equal(bash('cd /repo && git log --oneline -5'), 'ORIENT');
    assert.equal(bash('cd /repo && npm test'), 'VERIFY');
  });
  test('COORD wins over other matches when a proxy curl is present', () => {
    // A compound line that both greps and curls the proxy → the proxy call dominates intent
    assert.equal(bash('grep foo f && curl https://projects.jkershaw.com/api/proxy/me'), 'COORD');
  });
});

// ─── parseTranscriptLines — tolerant, real shapes ─────────────────────────────

const asstLine = (ts, tools, usage) => JSON.stringify({
  type: 'assistant', timestamp: ts,
  message: { role: 'assistant', model: 'claude-opus-4-8', usage,
             content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })) },
});
const resultLine = (ts, id, content, isError = false) => JSON.stringify({
  type: 'user', timestamp: ts,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});
const USAGE = (o) => ({ input_tokens: 100, output_tokens: o, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 });

describe('parseTranscriptLines — tolerant', () => {
  test('skips malformed lines without throwing', () => {
    const events = parseTranscriptLines(['not json', '', '{"type":"mode"}', asstLine('2026-07-10T10:00:00Z', [], USAGE(50))]);
    assert.equal(events.filter((e) => e.type === 'assistant').length, 1);
  });
  test('extracts tool_use + usage from an assistant turn', () => {
    const [e] = parseTranscriptLines([asstLine('2026-07-10T10:00:00Z', [{ id: 't1', name: 'Read', input: { file_path: '/a' } }], USAGE(80))]);
    assert.equal(e.type, 'assistant');
    assert.equal(e.model, 'claude-opus-4-8');
    assert.equal(e.usage.output_tokens, 80);
    assert.equal(e.tools[0].name, 'Read');
  });
  test('measures tool_result bytes from a raw-string content', () => {
    const events = parseTranscriptLines([resultLine('2026-07-10T10:00:01Z', 't1', 'x'.repeat(400))]);
    const r = events.find((e) => e.type === 'result');
    assert.equal(r.toolUseId, 't1');
    assert.equal(r.bytes, 400);
    assert.equal(r.isError, false);
  });
  test('measures tool_result bytes from a list-of-blocks content', () => {
    const events = parseTranscriptLines([resultLine('2026-07-10T10:00:01Z', 't2', [{ type: 'text', text: 'hello' }, { type: 'tool_reference', name: 'X' }])]);
    const r = events.find((e) => e.type === 'result');
    assert.equal(r.bytes, 'hello'.length);
  });
  test('flags is_error results', () => {
    const events = parseTranscriptLines([resultLine('2026-07-10T10:00:01Z', 't3', '<tool_use_error>No such tool: Grep</tool_use_error>', true)]);
    assert.equal(events.find((e) => e.type === 'result').isError, true);
  });
});

// ─── sessionSpend — the metrics ───────────────────────────────────────────────

describe('sessionSpend — orientation ratio three ways', () => {
  // One ORIENT Read (400-byte result, 20 out-tok turn) + one CORE Edit (10-byte result, 200 out-tok turn)
  const lines = [
    asstLine('2026-07-10T10:00:00Z', [{ id: 'r1', name: 'Read', input: { file_path: '/a.js' } }], USAGE(20)),
    resultLine('2026-07-10T10:00:02Z', 'r1', 'x'.repeat(400)),
    asstLine('2026-07-10T10:00:05Z', [{ id: 'e1', name: 'Edit', input: { file_path: '/a.js' } }], USAGE(200)),
    resultLine('2026-07-10T10:00:06Z', 'e1', 'ok'),
  ];
  const s = sessionSpend(parseTranscriptLines(lines), { sessionId: 'sess-1' });

  test('by count: 1 of 2 tools orient = 50%', () => {
    assert.equal(s.toolCounts.ORIENT, 1);
    assert.equal(s.toolCounts.CORE, 1);
    assert.equal(s.orientation.byCount, 0.5);
  });
  test('by result bytes: 400 of 402 ≈ 0.995', () => {
    assert.ok(Math.abs(s.orientation.byResultBytes - 400 / 402) < 1e-6);
  });
  test('by output tokens: 20 of 220 ≈ 0.0909', () => {
    assert.ok(Math.abs(s.orientation.byOutputTokens - 20 / 220) < 1e-6);
  });
});

describe('sessionSpend — time-to-first-productive-action', () => {
  const lines = [
    asstLine('2026-07-10T10:00:00Z', [{ id: 'a', name: 'Read', input: { file_path: '/a' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:01Z', 'a', 'aa'),
    asstLine('2026-07-10T10:00:02Z', [{ id: 'b', name: 'Bash', input: { command: 'git log' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:03Z', 'b', 'bb'),
    asstLine('2026-07-10T10:00:04Z', [{ id: 'c', name: 'Edit', input: { file_path: '/a' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:05Z', 'c', 'cc'),
  ];
  const s = sessionSpend(parseTranscriptLines(lines), { sessionId: 's' });
  test('counts 2 tools before the first CORE edit', () => {
    assert.equal(s.toolsBeforeFirstCore, 2);
  });
  test('edit-bearing session is flagged', () => {
    assert.equal(s.editBearing, true);
  });
});

describe('sessionSpend — rework (repeat edits + verify-fail→edit)', () => {
  const lines = [
    asstLine('2026-07-10T10:00:00Z', [{ id: 'e1', name: 'Edit', input: { file_path: '/same.js' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:01Z', 'e1', 'ok'),
    asstLine('2026-07-10T10:00:02Z', [{ id: 'v1', name: 'Bash', input: { command: 'npm test' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:03Z', 'v1', 'FAIL: 1 test failed', true),
    asstLine('2026-07-10T10:00:04Z', [{ id: 'e2', name: 'Edit', input: { file_path: '/same.js' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:05Z', 'e2', 'ok'),
  ];
  const s = sessionSpend(parseTranscriptLines(lines), { sessionId: 's' });
  test('detects a re-edited file', () => {
    assert.equal(s.reworkFiles.includes('/same.js'), true);
    assert.equal(s.reworkEditCount, 1); // second edit to same file
  });
  test('detects a failed-verify → edit loop', () => {
    assert.equal(s.verifyFailToEdit, 1);
  });
});

describe('sessionSpend — file sets for cross-session overlap (H4)', () => {
  const lines = [
    asstLine('2026-07-10T10:00:00Z', [{ id: 'r', name: 'Read', input: { file_path: '/repo/x.js' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:01Z', 'r', 'aa'),
    asstLine('2026-07-10T10:00:02Z', [{ id: 'e', name: 'Edit', input: { file_path: '/repo/y.js' } }], USAGE(10)),
    resultLine('2026-07-10T10:00:03Z', 'e', 'ok'),
  ];
  const s = sessionSpend(parseTranscriptLines(lines), { sessionId: 's' });
  test('filesRead and filesEdited are captured', () => {
    assert.deepEqual(s.filesRead, ['/repo/x.js']);
    assert.deepEqual(s.filesEdited, ['/repo/y.js']);
  });
});

describe('fileReadOverlap — H4 across sessions on one task', () => {
  test('Jaccard overlap of read-sets', () => {
    const o = __internal.jaccard(['/a', '/b', '/c'], ['/b', '/c', '/d']);
    assert.ok(Math.abs(o - 2 / 4) < 1e-6);
  });
  test('empty sets → 0', () => {
    assert.equal(__internal.jaccard([], []), 0);
  });
});
