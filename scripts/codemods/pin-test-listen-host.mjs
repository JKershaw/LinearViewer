#!/usr/bin/env node
/**
 * scripts/codemods/pin-test-listen-host.mjs  (LIN-2023)
 *
 * Pins every ephemeral `tests/unit` server bind from hostless `app.listen(0)`
 * to `app.listen(0, '127.0.0.1')`. A hostless `listen(0)` binds IPv6
 * dual-stack; SO_REUSEADDR then lets that coexist with an unrelated
 * IPv4-only process already squatting the same port number, so an IPv4
 * request can be misdelivered to the squatter instead of the test's own
 * server. See LIN-2023.
 *
 * Idempotent: the negative lookahead skips call sites already pinned, so
 * re-running this script on an already-converted tree is a no-op (verified
 * across all four observed call shapes — bare, named-callback, inline-arrow,
 * self-referencing-arrow).
 *
 * Usage:
 *   node scripts/codemods/pin-test-listen-host.mjs [--dry-run] [<file>...]
 *
 *   With no file args, operates on every file matched by
 *   `grep -rl "listen(0" --include="*.js" tests/unit/` (run from repo root).
 *   --dry-run reports which files would change without writing them.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// The inner group captures the whitespace that FOLLOWED the original comma, so
// the callback's existing separator (a plain space, or a newline + indent on a
// wrapped call) survives the rewrite. Emitting a bare `,` instead would produce
// `.listen(0, '127.0.0.1',resolve)` — this repo has no formatter to absorb that.
const PATTERN = /\.listen\(0(?!\s*,\s*'127\.0\.0\.1')(\s*,(\s*))?/g

function transform(source) {
  return source.replace(PATTERN, (_match, trailingComma, spacingAfterComma) =>
    trailingComma
      ? `.listen(0, '127.0.0.1',${spacingAfterComma || ' '}`
      : `.listen(0, '127.0.0.1'`
  )
}

// The enforcement test (LIN-2023) carries deliberately UNPINNED `.listen(0)`
// calls inside string literals — they are the fixtures proving the guard
// catches a violation. Rewriting them would invert those cases into asserting
// that a pinned call is a violation, so it is excluded from discovery. Pass it
// explicitly as a file argument if you ever genuinely mean to transform it.
const EXCLUDED = new Set(['tests/unit/test-server-listen-bind.test.js'])

function discoverFiles() {
  const out = execFileSync(
    'grep',
    ['-rl', 'listen(0', '--include=*.js', 'tests/unit/'],
    { encoding: 'utf8' }
  )
  return out.split('\n').filter(Boolean).filter((f) => !EXCLUDED.has(f)).sort()
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fileArgs = args.filter((a) => a !== '--dry-run')
const files = fileArgs.length > 0 ? fileArgs : discoverFiles()

let changed = 0
for (const file of files) {
  const before = readFileSync(file, 'utf8')
  const after = transform(before)
  if (after !== before) {
    changed++
    if (dryRun) {
      console.log(`would change: ${file}`)
    } else {
      writeFileSync(file, after)
      console.log(`changed: ${file}`)
    }
  }
}

console.log(`${dryRun ? 'would change' : 'changed'} ${changed}/${files.length} files`)
