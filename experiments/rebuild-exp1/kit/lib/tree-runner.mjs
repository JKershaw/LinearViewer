// Run node:test files inside a scratch tree with a candidate in the slot.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = new URL('.', import.meta.url).pathname
export const REPORTER_URL = pathToFileURL(join(HERE, 'test-reporter.mjs')).href
export const GUARD_URL = pathToFileURL(join(HERE, 'no-network.mjs')).href

/** Copy the base tree once per worker (node_modules stays a symlink). */
export function prepareWorkerTrees(baseTree, workDir, n) {
  mkdirSync(workDir, { recursive: true })
  const dirs = []
  for (let i = 0; i < n; i += 1) {
    const dir = join(workDir, `w${i}`)
    if (!existsSync(dir)) execFileSync('cp', ['-a', `${resolve(baseTree)}/.`, dir])
    dirs.push(dir)
  }
  return dirs
}

/** Replace the slot with new content WITHOUT writing through a shared inode. */
export function writeSlot(treeDir, slot, content) {
  const p = join(treeDir, slot)
  try { if (lstatSync(p)) unlinkSync(p) } catch { /* absent */ }
  writeFileSync(p, content)
}

export function testEnv(extra = {}) {
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${GUARD_URL}`].filter(Boolean).join(' ')
  return { ...process.env, NODE_OPTIONS: nodeOptions, ...extra }
}

export function runTests(treeDir, testFiles, { timeoutMs = 10000, env = {} } = {}) {
  const files = testFiles.map(f => (isAbsolute(f) ? f : join(treeDir, f)))
  const started = process.hrtime.bigint()
  return new Promise(res => {
    const child = spawn(process.execPath, ['--test', `--test-reporter=${REPORTER_URL}`, ...files], {
      cwd: treeDir,
      env: testEnv(env),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    let timedOut = false
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000) })
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
    }, timeoutMs)
    child.on('close', code => {
      clearTimeout(timer)
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* group gone */ }
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const failing = []
      let summary = null
      for (const line of out.split('\n')) {
        if (line.startsWith('KIT-FAIL\t')) { const [, file, name] = line.split('\t'); failing.push(`${file} :: ${name}`) }
        if (line.startsWith('KIT-SUMMARY\t')) summary = JSON.parse(line.slice(12))
      }
      const network = [...err.matchAll(/^KIT-NETWORK (.+)$/gm)].map(m => m[1])
      const status = timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail'
      res({ status, code, ms, failing, summary, network, stderrTail: err.slice(-2000) })
    })
  })
}

/** Does the slot module import (evaluate) cleanly? Used to tell "crashed at import" from "killed". */
export function importCheck(treeDir, slot, timeoutMs = 10000) {
  const url = pathToFileURL(join(treeDir, slot)).href
  return new Promise(res => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], {
      cwd: treeDir, env: testEnv(), detached: true, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    child.stderr.on('data', d => { err += d })
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, timeoutMs)
    child.on('close', code => {
      clearTimeout(timer)
      const firstError = err.split('\n').find(l => /Error|error/.test(l)) || err.split('\n')[0] || ''
      res({ ok: code === 0, error: code === 0 ? null : firstError.trim().slice(0, 300) })
    })
  })
}
