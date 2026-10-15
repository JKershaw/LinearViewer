// Shape signatures: a content-free description of an input, used to group
// differences / observations. Letters, digits and non-ASCII runs collapse to a
// single class character; ASCII punctuation and whitespace are kept, because
// in a Markdown codec those ARE the construct.

export function abstractText(s, max = 48) {
  let out = ''
  let prev = ''
  for (const ch of String(s)) {
    let c
    if (/[A-Za-z]/.test(ch)) c = 'a'
    else if (/[0-9]/.test(ch)) c = '0'
    else if (ch === ' ') c = '␠'
    else if (ch === '\t') c = '⇥'
    else if (ch === '\n') c = '⏎'
    else if (ch === '\r') c = '␍'
    else if (/\s/.test(ch)) c = '⍽'
    else if (ch.codePointAt(0) < 128) c = ch
    else c = 'u'
    if ((c === 'a' || c === '0' || c === 'u') && c === prev) continue
    out += c
    prev = c
  }
  return out.length > max ? `${out.slice(0, max)}…` : out
}

/** Skeleton of an ADF value: types, mark types, attrs keys, abstracted text. */
export function adfSignature(v, depth = 0) {
  if (depth > 12) return '…'
  if (v === null) return 'null'
  if (v === undefined) return 'undef'
  if (typeof v === 'string') return `"${abstractText(v, 24)}"`
  if (typeof v !== 'object') return typeof v === 'number' ? `#${Number.isInteger(v) ? v : 'f'}` : typeof v
  if (Array.isArray(v)) return `[${v.map(x => adfSignature(x, depth + 1)).join(',')}]`
  let s = typeof v.type === 'string' ? (v.type || "''") : v.type === undefined ? '?' : `?${typeof v.type}`
  if ('marks' in v) s += Array.isArray(v.marks) ? `[${v.marks.map(m => (m && typeof m === 'object' ? m.type ?? '?' : String(m))).join('+')}]` : `[${v.marks === null ? 'null' : typeof v.marks}]`
  if ('attrs' in v) {
    if (v.attrs && typeof v.attrs === 'object') {
      const parts = Object.keys(v.attrs).sort().map(k => {
        const val = v.attrs[k]
        if (k === 'level' || k === 'order') return `${k}=${JSON.stringify(val) ?? 'undef'}`
        if (k === 'language' || k === 'href') return `${k}="${abstractText(val ?? '', 12)}"`
        return k
      })
      s += `{${parts.join(',')}}`
    } else s += `{${v.attrs === null ? 'null' : typeof v.attrs}}`
  }
  if ('text' in v) s += typeof v.text === 'string' ? `:"${abstractText(v.text, 24)}"` : `:${v.text === null ? 'null' : typeof v.text}`
  if ('content' in v) s += Array.isArray(v.content) ? `(${v.content.map(x => adfSignature(x, depth + 1)).join(',')})` : `(${v.content === null ? 'null' : typeof v.content})`
  return s
}

export function mdSignature(v) {
  if (typeof v !== 'string') return `<${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v}>`
  return abstractText(v, 60)
}

export const signatureFor = (domain, v) => (domain === 'adf' ? adfSignature(v) : mdSignature(v))

/** Coarse features: which node/mark types (ADF) or which constructs (Markdown) the input involves. */
export function features(domain, v) {
  const set = new Set()
  if (domain === 'adf') {
    const walk = (n, d) => {
      if (d > 40 || n === null || typeof n !== 'object') return
      if (Array.isArray(n)) { n.forEach(x => walk(x, d + 1)); return }
      if (typeof n.type === 'string') set.add(n.type)
      if (Array.isArray(n.marks)) for (const m of n.marks) if (m && typeof m.type === 'string') set.add(`mark:${m.type}`)
      if (Array.isArray(n.content)) n.content.forEach(x => walk(x, d + 1))
    }
    walk(v, 0)
    if (set.size === 0) set.add(v === null ? 'null-root' : typeof v)
  } else {
    if (typeof v !== 'string') return [`non-string:${v === null ? 'null' : typeof v}`]
    const checks = [
      ['heading', /^ {0,3}#{1,6}(\s|$)/m], ['heading7+', /^#{7,}/m], ['setext', /\n(=+|-+)\s*$/m], ['fence', /^ {0,3}(```|~~~)/m], ['bullet', /^\s*[-*+]\s/m],
      ['ordered', /^\s*\d+[.)]\s/m], ['quote', /^\s*>/m], ['table', /\|/], ['hr', /^ {0,3}([-*_])( *\1){2,}\s*$/m], ['strong', /\*\*|__/], ['em', /(^|[^*])\*[^*\s]|(^|\W)_[^_\s]/],
      ['strike', /~~/], ['code-span', /`/], ['link', /\]\(/], ['autolink', /<[a-z]+:[^>]*>/i], ['html', /<\/?[a-z!][^>]*>/i], ['escape', /\\[!-/:-@[-`{-~]/],
      ['backslash', /\\(?![!-/:-@[-`{-~])/], ['trailing-space', / +$/m], ['blank-line', /\n[ \t]*\n/], ['crlf', /\r/], ['tab', /\t/], ['non-ascii', /[^\x00-\x7f]/], ['leading-space', /^ +\S/m],
    ]
    for (const [name, re] of checks) if (re.test(v)) set.add(name)
    if (v === '') set.add('empty')
    if (set.size === 0) set.add('plain')
  }
  return [...set].sort()
}
