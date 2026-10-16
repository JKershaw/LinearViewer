// Tiny shared CLI helpers for diff.mjs / observe.mjs / outputs.mjs.
import { resolve, sep } from 'node:path'
import { DEFAULT_PRIVATE_PATH } from './corpus.mjs'

const KIT = resolve(new URL('..', import.meta.url).pathname)

export function parseCli(argv, flags = []) {
  const opts = { positional: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) { opts.positional.push(a); continue }
    const key = a.slice(2)
    if (flags.includes(key)) {
      // optional value: `--private` or `--private <path>`
      if (argv[i + 1] && !argv[i + 1].startsWith('--') && key === 'private' && argv[i + 1].endsWith('.json')) opts[key] = argv[++i]
      else opts[key] = true
    } else opts[key] = argv[++i]
  }
  return opts
}

export function privatePathFrom(opts) {
  if (!opts.private) return null
  return opts.private === true ? DEFAULT_PRIVATE_PATH : resolve(opts.private)
}

/** Refuse to write anything derived from the private corpus under kit/. */
export function assertNotInKit(path, what) {
  const abs = resolve(path)
  if (abs === KIT || abs.startsWith(KIT + sep)) {
    throw new Error(`${what} would be written under kit/ (${abs}); private-derived output must live outside the kit (e.g. baseline/private/)`)
  }
}
