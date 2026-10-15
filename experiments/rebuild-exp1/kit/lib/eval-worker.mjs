// worker_threads worker: loads one or two implementations (each as its own
// module instance) and answers eval / shrink requests. Run under a watchdog
// (lib/pool.mjs), so an implementation that hangs on an input costs one
// timeout, not the whole run.
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { evaluate, compareResults } from './fns.mjs'
import { shrink } from './shrink.mjs'
import { PREDICATES } from './observations.mjs'

const mods = {}
const loadErrors = {}
for (const [side, path] of Object.entries(workerData.impls)) {
  try {
    mods[side] = await import(`${pathToFileURL(path).href}?adf-kit-side=${side}`)
    for (const name of ['adfToMarkdown', 'markdownToAdf', 'adfHasUnrenderableContent']) {
      if (typeof mods[side][name] !== 'function') loadErrors[side] = `missing export ${name}`
    }
  } catch (err) {
    loadErrors[side] = `${err?.name}: ${err?.message}`
  }
}
parentPort.postMessage({ type: 'ready', loadErrors })

function safePost(msg) {
  try { parentPort.postMessage(msg) } catch (err) {
    parentPort.postMessage({ type: 'result', id: msg.id, result: { unclonable: String(err?.message || err) } })
  }
}

parentPort.on('message', msg => {
  if (msg.type === 'eval') {
    const mod = mods[msg.side]
    const result = mod ? evaluate(mod, msg.fn, msg.input) : { threw: { name: 'LoadError', message: loadErrors[msg.side] } }
    safePost({ type: 'result', id: msg.id, result })
    return
  }
  if (msg.type === 'shrink') {
    let pred
    if (msg.kind === 'differs') {
      // each side gets its own copy, in case an implementation mutates its input
      pred = c => compareResults(evaluate(mods.A, msg.fn, structuredClone(c)), evaluate(mods.B, msg.fn, structuredClone(c))) === msg.cls
    } else if (msg.kind === 'throws') {
      pred = c => { const t = evaluate(mods[msg.side], msg.fn, c).threw; return t?.name === msg.errorName && t?.message === msg.errorMessage }
    } else {
      const p = PREDICATES[msg.kind]
      pred = c => p(mods[msg.side || 'A'], c)
    }
    const r = shrink(msg.domain, msg.input, pred, { budget: msg.budget })
    const final = {}
    if (msg.kind === 'differs' || msg.kind === 'throws') {
      for (const side of Object.keys(mods)) final[side] = evaluate(mods[side], msg.fn, r.value)
    }
    safePost({ type: 'result', id: msg.id, result: { ...r, final } })
  }
})
