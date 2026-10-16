// A small pool of eval-worker threads with a per-request watchdog. A request
// that does not answer within its timeout gets {timeout: true}; the worker is
// terminated and replaced so the rest of the run continues.
import { Worker } from 'node:worker_threads'
import os from 'node:os'

const WORKER_URL = new URL('./eval-worker.mjs', import.meta.url)

export class EvalPool {
  constructor({ impls, size = Math.max(1, os.availableParallelism()), timeoutMs = 5000, shrinkTimeoutMs = 30000 }) {
    this.impls = impls
    this.size = size
    this.timeoutMs = timeoutMs
    this.shrinkTimeoutMs = shrinkTimeoutMs
    this.slots = []
    this.nextId = 1
    this.timeouts = 0
    this.loadErrors = null
  }

  async start() {
    this.slots = await Promise.all(Array.from({ length: this.size }, () => this.spawn()))
    return this
  }

  spawn() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_URL, { workerData: { impls: this.impls }, resourceLimits: { maxOldGenerationSizeMb: 1024 } })
      const slot = { worker, pending: null }
      worker.once('message', msg => {
        if (msg.type !== 'ready') return reject(new Error('worker did not start'))
        if (Object.keys(msg.loadErrors).length) this.loadErrors = msg.loadErrors
        worker.on('message', m => {
          if (m.type === 'result' && slot.pending && slot.pending.id === m.id) {
            const p = slot.pending
            slot.pending = null
            clearTimeout(p.timer)
            p.resolve(m.result)
          }
        })
        worker.on('error', err => {
          if (slot.pending) { const p = slot.pending; slot.pending = null; clearTimeout(p.timer); p.resolve({ threw: { name: 'WorkerCrash', message: String(err?.message || err) } }) }
        })
        resolve(slot)
      })
      worker.once('error', reject)
    })
  }

  async request(slotIndex, msg) {
    const slot = this.slots[slotIndex]
    const id = this.nextId++
    const timeoutMs = msg.type === 'shrink' ? this.shrinkTimeoutMs : this.timeoutMs
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (slot.pending?.id !== id) return
        slot.pending = null
        resolve({ timeout: true })
      }, timeoutMs)
      slot.pending = { id, resolve, timer }
      slot.worker.postMessage({ ...msg, id })
    })
    if (result.timeout) {
      this.timeouts += 1
      await slot.worker.terminate()
      this.slots[slotIndex] = await this.spawn()
    } else if (result.threw?.name === 'WorkerCrash') {
      await slot.worker.terminate().catch(() => {})
      this.slots[slotIndex] = await this.spawn()
    }
    return result
  }

  /** Run many requests; returns results in order. onProgress(done, total) optional. */
  async map(messages, onProgress) {
    const results = new Array(messages.length)
    let next = 0
    let done = 0
    const lane = async i => {
      for (;;) {
        const k = next++
        if (k >= messages.length) return
        results[k] = await this.request(i, messages[k])
        done += 1
        if (onProgress && done % 20000 === 0) onProgress(done, messages.length)
      }
    }
    await Promise.all(this.slots.map((_, i) => lane(i)))
    return results
  }

  async close() {
    await Promise.all(this.slots.map(s => s.worker.terminate()))
  }
}
