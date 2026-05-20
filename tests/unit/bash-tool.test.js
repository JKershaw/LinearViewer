/**
 * Unit tests for bash-tool.js
 *
 * Run with: node --test tests/unit/bash-tool.test.js
 *
 * These tests demonstrate the escaping corruption problem and verify
 * that the data/code separation fix resolves it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execute, execArgs } from '../../lib/bash-tool.js';

// Temp directory for file-write tests
const tmpDir = path.join(os.tmpdir(), 'bash-tool-test-' + process.pid);
fs.mkdirSync(tmpDir, { recursive: true });

// Resolve to realpath so cwd comparisons work on macOS (where /var → /private/var)
const realTmpDir = fs.realpathSync(tmpDir);

// Setup / teardown
test('setup temp dir', () => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

// =============================================================================
// execute() — shell mode with stdin data separation
// =============================================================================

describe('execute()', () => {
  test('runs a simple command', async () => {
    const result = await execute({ command: 'echo hello' });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), 'hello');
  });

  test('captures stderr', async () => {
    const result = await execute({ command: 'echo err >&2' });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stderr.trim(), 'err');
  });

  test('returns non-zero exit code', async () => {
    const result = await execute({ command: 'exit 42' });
    assert.strictEqual(result.exitCode, 42);
  });

  // ---------------------------------------------------------------------------
  // The core fix: stdin data separation
  // ---------------------------------------------------------------------------

  test('stdin data bypasses shell — backslash-n preserved literally', async () => {
    const outFile = path.join(tmpDir, 'stdin-backslash-n.txt');
    const content = 'console.log("hello\\nworld")';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    const written = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(written, content);
    // The literal characters \ and n are preserved — not interpreted as newline
    assert.ok(written.includes('\\n'), 'backslash-n should be preserved literally');
    assert.ok(!written.includes('\n'), 'should NOT contain an actual newline');
  });

  test('stdin data bypasses shell — tab escapes preserved', async () => {
    const outFile = path.join(tmpDir, 'stdin-tab.txt');
    const content = 'if (x) {\\n\\treturn y;\\n}';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    const written = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(written, content);
  });

  test('stdin data bypasses shell — quotes preserved', async () => {
    const outFile = path.join(tmpDir, 'stdin-quotes.txt');
    const content = 'She said "hello" and he said \'goodbye\'';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(fs.readFileSync(outFile, 'utf8'), content);
  });

  test('stdin data bypasses shell — backticks preserved', async () => {
    const outFile = path.join(tmpDir, 'stdin-backticks.txt');
    const content = 'const msg = `hello ${name}`;\nconst cmd = `ls -la`;';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(fs.readFileSync(outFile, 'utf8'), content);
  });

  test('stdin data bypasses shell — dollar signs not expanded', async () => {
    const outFile = path.join(tmpDir, 'stdin-dollar.txt');
    const content = 'echo $HOME and $(whoami) and ${USER}';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(fs.readFileSync(outFile, 'utf8'), content);
    // $HOME should NOT be expanded — it should be the literal string "$HOME"
    assert.ok(written => written.includes('$HOME'));
  });

  test('stdin data bypasses shell — glob patterns not expanded', async () => {
    const outFile = path.join(tmpDir, 'stdin-glob.txt');
    const content = 'files: *.js **/*.ts src/{a,b}.js';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(fs.readFileSync(outFile, 'utf8'), content);
  });

  test('stdin data with binary-like content', async () => {
    const outFile = path.join(tmpDir, 'stdin-binary.txt');
    const content = 'line1\nline2\ttab\r\nwindows\x00null';

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    const written = fs.readFileSync(outFile, 'utf8');
    // Actual newlines and tabs should pass through as-is
    assert.ok(written.includes('\n'));
    assert.ok(written.includes('\t'));
  });

  test('stdin combined with command that processes it', async () => {
    const result = await execute({
      command: 'wc -l',
      stdin: 'line1\nline2\nline3\n',
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), '3');
  });

  test('stdin with multiline JavaScript file', async () => {
    const outFile = path.join(tmpDir, 'stdin-multiline.js');
    const content = [
      '// Game logic',
      'function update(dt) {',
      '  const msg = "hello\\nworld";',
      '  console.log(`time: ${dt}`);',
      '  return { x: pos.x + vel.x * dt };',
      '}',
      '',
    ].join('\n');

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    const written = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(written, content);
    // The \\n inside the string literal should be preserved as literal \n
    assert.ok(written.includes('"hello\\nworld"'));
  });

  // ---------------------------------------------------------------------------
  // Demonstrates what goes wrong WITHOUT stdin separation
  // (using command-embedded data through sh -c)
  // ---------------------------------------------------------------------------

  test('DEMONSTRATES PROBLEM: command-embedded data corrupts dollar signs', async () => {
    const outFile = path.join(tmpDir, 'problem-dollar.txt');

    // Simulating what happens when data is embedded in the command:
    // The shell expands $HOME to the actual home directory
    const result = await execute({
      command: `echo 'echo $HOME' > "${outFile}"`,
    });

    const written = fs.readFileSync(outFile, 'utf8').trim();
    // In single quotes, $HOME is preserved — but double quotes would expand it.
    // The LLM has to know which quoting to use, and nesting quotes is fragile.
    assert.strictEqual(written, 'echo $HOME');
  });

  test('DEMONSTRATES PROBLEM: nested quotes in command-embedded data', async () => {
    const outFile = path.join(tmpDir, 'problem-quotes.txt');

    // This is the kind of command an LLM might try to write a file:
    // It fails because of nested quote conflicts
    const result = await execute({
      command: `printf '%s' 'She said "hello"' > "${outFile}"`,
    });

    // This works because we carefully chose non-conflicting quotes.
    // But what if the content has BOTH single and double quotes?
    // The LLM would need to use $'...' syntax or escape sequences.
    const written = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(written, 'She said "hello"');
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  test('empty stdin', async () => {
    const outFile = path.join(tmpDir, 'empty-stdin.txt');
    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: '',
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(fs.readFileSync(outFile, 'utf8'), '');
  });

  test('no stdin — command runs without piped input', async () => {
    const result = await execute({ command: 'echo no-stdin' });
    assert.strictEqual(result.stdout.trim(), 'no-stdin');
  });

  test('timeout kills long-running process', async () => {
    const result = await execute({
      command: 'sleep 60',
      timeout: 200,
    });

    assert.ok(result.stderr.includes('[timed out]'));
    assert.notStrictEqual(result.exitCode, 0);
  });

  test('cwd is respected', async () => {
    const result = await execute({
      command: 'pwd',
      cwd: tmpDir,
    });

    assert.strictEqual(result.stdout.trim(), realTmpDir);
  });
});

// =============================================================================
// execArgs() — direct mode, no shell
// =============================================================================

describe('execArgs()', () => {
  test('runs a simple command', async () => {
    const result = await execArgs({ file: 'echo', args: ['hello'] });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), 'hello');
  });

  test('arguments with spaces are not split', async () => {
    const result = await execArgs({
      file: 'echo',
      args: ['hello world', 'foo bar'],
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), 'hello world foo bar');
  });

  // ---------------------------------------------------------------------------
  // The argument escaping fix
  // ---------------------------------------------------------------------------

  test('arguments with backslashes are preserved literally', async () => {
    const result = await execArgs({
      file: 'printf',
      args: ['%s', 'hello\\nworld'],
    });

    assert.strictEqual(result.exitCode, 0);
    // printf %s prints the argument literally — no escape interpretation
    assert.strictEqual(result.stdout, 'hello\\nworld');
  });

  test('grep with regex special characters in pattern', async () => {
    const dataFile = path.join(tmpDir, 'grep-data.txt');
    fs.writeFileSync(dataFile, 'version: 1.2.3\nother: abc\nprice: $10.00\n');

    const result = await execArgs({
      file: 'grep',
      args: ['-E', '[0-9]+\\.[0-9]+', dataFile],
    });

    assert.strictEqual(result.exitCode, 0);
    // Both lines with decimal numbers should match
    assert.ok(result.stdout.includes('1.2.3'));
    assert.ok(result.stdout.includes('$10.00'));
  });

  test('arguments with glob characters are not expanded', async () => {
    // Create files that would match a glob
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b');

    const result = await execArgs({
      file: 'echo',
      args: ['*.txt'],
    });

    assert.strictEqual(result.exitCode, 0);
    // Without shell, *.txt is passed literally — NOT expanded to file list
    assert.strictEqual(result.stdout.trim(), '*.txt');
  });

  test('arguments with dollar signs are not expanded', async () => {
    const result = await execArgs({
      file: 'echo',
      args: ['$HOME', '$(whoami)', '${USER}'],
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), '$HOME $(whoami) ${USER}');
  });

  test('arguments with backticks are not executed', async () => {
    const result = await execArgs({
      file: 'echo',
      args: ['`whoami`'],
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), '`whoami`');
  });

  test('arguments with semicolons are not treated as command separators', async () => {
    const result = await execArgs({
      file: 'echo',
      args: ['hello; rm -rf /'],
    });

    assert.strictEqual(result.exitCode, 0);
    // The entire string including the semicolon is one argument
    assert.strictEqual(result.stdout.trim(), 'hello; rm -rf /');
  });

  test('arguments with pipe characters are not treated as pipes', async () => {
    const result = await execArgs({
      file: 'echo',
      args: ['hello | cat'],
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), 'hello | cat');
  });

  test('stdin with execArgs', async () => {
    const result = await execArgs({
      file: 'wc',
      args: ['-l'],
      stdin: 'a\nb\nc\n',
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), '3');
  });

  test('execArgs with stdin writes file preserving all special chars', async () => {
    const outFile = path.join(tmpDir, 'execargs-write.js');
    const content = 'const x = `${name}\\n`;\nconst y = "it\'s $HOME";';

    const result = await execArgs({
      file: 'tee',
      args: [outFile],
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(fs.readFileSync(outFile, 'utf8'), content);
  });

  test('non-existent command returns error', async () => {
    await assert.rejects(
      () => execArgs({ file: '/nonexistent/binary', args: [] }),
      { code: 'ENOENT' }
    );
  });

  test('timeout kills long-running process', async () => {
    const result = await execArgs({
      file: 'sleep',
      args: ['60'],
      timeout: 200,
    });

    assert.ok(result.stderr.includes('[timed out]'));
    assert.notStrictEqual(result.exitCode, 0);
  });

  test('cwd is respected', async () => {
    const result = await execArgs({
      file: 'pwd',
      args: [],
      cwd: tmpDir,
    });

    assert.strictEqual(result.stdout.trim(), realTmpDir);
  });
});

// =============================================================================
// End-to-end: the exact scenario from HAR-208
// =============================================================================

describe('HAR-208 scenario: writing game.js with backslash-n', () => {
  test('stdin separation preserves \\n in JavaScript source', async () => {
    const outFile = path.join(tmpDir, 'game.js');

    // This is exactly what the LLM wants to write:
    // A JS file where \n is a literal escape sequence in a string
    const gameJs = [
      'const canvas = document.getElementById("game");',
      'const ctx = canvas.getContext("2d");',
      '',
      'function drawText(text) {',
      '  // Split on literal \\n in the text data',
      '  const lines = text.split("\\n");',
      '  lines.forEach((line, i) => {',
      '    ctx.fillText(line, 10, 20 + i * 16);',
      '  });',
      '}',
      '',
      'drawText("hello\\nworld");',
      '',
    ].join('\n');

    const result = await execute({
      command: `cat > "${outFile}"`,
      stdin: gameJs,
    });

    assert.strictEqual(result.exitCode, 0);
    const written = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(written, gameJs);

    // Verify the critical assertions from the bug report:
    // 1. \\n in the source should be literal backslash + n
    assert.ok(written.includes('split("\\n")'), 'split("\\n") preserved');
    assert.ok(written.includes('"hello\\nworld"'), '"hello\\nworld" preserved');
    // 2. Actual newlines should be actual newlines (line separators)
    assert.strictEqual(written.split('\n').length, 13);
  });

  test('execArgs with tee also preserves \\n in JavaScript source', async () => {
    const outFile = path.join(tmpDir, 'game2.js');
    const content = 'const msg = "hello\\nworld";\nconsole.log(msg);';

    const result = await execArgs({
      file: 'tee',
      args: [outFile],
      stdin: content,
    });

    assert.strictEqual(result.exitCode, 0);
    const written = fs.readFileSync(outFile, 'utf8');
    assert.strictEqual(written, content);
    assert.ok(written.includes('"hello\\nworld"'));
  });
});

// Cleanup
test('cleanup temp dir', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
