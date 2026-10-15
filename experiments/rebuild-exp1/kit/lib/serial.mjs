// Lossless-enough JSON encoding for recorded arguments and outputs.
//
// Plain JSON drops `undefined` (as a value and as an object key's value) and
// cannot express NaN / ±Infinity / -0. The codec's inputs legitimately include
// `undefined` and `null` (and a new implementation might distinguish
// `{attrs: undefined}` from an absent key), so values are encoded with a small
// tag scheme:
//   {"$t":"undef"}            undefined
//   {"$t":"num","v":"NaN"}    NaN / Infinity / -Infinity / -0
//   {"$t":"obj","v":{...}}    a plain object that itself has a "$t" key
//   {"$t":"other","v":"..."}  anything else non-JSON (function, symbol, bigint): typeof + String()
// Arrays keep holes as undefined.

export function encode(value) {
  if (value === undefined) return { $t: 'undef' }
  if (value === null) return null
  const t = typeof value
  if (t === 'number') {
    if (Number.isNaN(value)) return { $t: 'num', v: 'NaN' }
    if (value === Infinity) return { $t: 'num', v: 'Infinity' }
    if (value === -Infinity) return { $t: 'num', v: '-Infinity' }
    if (Object.is(value, -0)) return { $t: 'num', v: '-0' }
    return value
  }
  if (t === 'string' || t === 'boolean') return value
  if (t === 'function' || t === 'symbol' || t === 'bigint') return { $t: 'other', v: `${t}:${String(value)}` }
  if (Array.isArray(value)) {
    const out = []
    for (let i = 0; i < value.length; i += 1) out.push(encode(value[i]))
    return out
  }
  const out = {}
  for (const key of Object.keys(value)) out[key] = encode(value[key])
  return Object.prototype.hasOwnProperty.call(value, '$t') ? { $t: 'obj', v: out } : out
}

export function decode(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decode)
  if (typeof value.$t === 'string') {
    if (value.$t === 'undef') return undefined
    if (value.$t === 'num') return value.v === '-0' ? -0 : Number(value.v)
    if (value.$t === 'obj') return decodeObject(value.v)
    if (value.$t === 'other') return `[${value.v}]`
  }
  return decodeObject(value)
}

function decodeObject(obj) {
  const out = {}
  for (const key of Object.keys(obj)) out[key] = decode(obj[key])
  return out
}

/** Canonical string (sorted keys) of an encoded value — used as a dedup key. */
export function canonical(value) {
  return JSON.stringify(sortKeys(encode(value)))
}

function sortKeys(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(sortKeys)
  const out = {}
  for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
  return out
}

/** Size of a value, for "smallest example" ordering. */
export function sizeOf(value) {
  return value === undefined ? 0 : JSON.stringify(encode(value)).length
}
