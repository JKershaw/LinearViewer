// worker_threads worker for survivor-probe.mjs: loads the original and every
// surviving mutant, evaluates a batch of corpus inputs on all of them, and
// returns only where a mutant's output differs from the original's.
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { evaluate, compareResults, FNS_BY_DOMAIN } from './fns.mjs'

const original = await import(`${pathToFileURL(workerData.original).href}?adf-kit-side=orig`)
const mutants = []
for (const m of workerData.mutants) {
  try { mutants.push({ id: m.id, mod: await import(`${pathToFileURL(m.path).href}?adf-kit-side=${m.id}`) }) } catch (err) { mutants.push({ id: m.id, error: String(err?.message || err) }) }
}
parentPort.postMessage({ type: 'ready', loadErrors: mutants.filter(m => m.error).map(m => ({ id: m.id, error: m.error })) })

parentPort.on('message', ({ id, batch }) => {
  const hits = [] // [mutantId, itemIndex, fn, cls]
  for (const { index, domain, input } of batch) {
    for (const fn of FNS_BY_DOMAIN[domain]) {
      const base = evaluate(original, fn, structuredClone(input))
      for (const m of mutants) {
        if (!m.mod) continue
        const cls = compareResults(base, evaluate(m.mod, fn, structuredClone(input)))
        if (cls !== 'identical') hits.push([m.id, index, fn, cls])
      }
    }
  }
  parentPort.postMessage({ type: 'result', id, hits })
})
