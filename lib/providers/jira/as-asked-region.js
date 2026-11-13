// =============================================================================
// The "As asked" block on a Jira issue (LIN-4450, piece 1 of LIN-4445).
//
// Jira stores ADF, and the ADF codec does not give back the words it was handed
// (one emphasis mark, one bullet glyph, a fence split on a blank line). So the
// block is held in two places, and this module is the ONLY place that knows both:
//
//   - the description holds an ordinary block, an h2 "As asked" heading, the
//     words converted by markdownToAdf, and the italic end line. People see a
//     normal ticket;
//   - the issue property `harbour.asAsked = { v: 1, words, rendered }` holds the
//     exact words, and `rendered`, a SHA-256 digest of the block's rendering as
//     written. The digest, not the rendering, is stored: it is only ever compared.
//
// On read, the block is found by its nodes (the heading, then the first end
// paragraph whose plain text is the end sentence, whatever its marks). When the
// region still renders to `rendered` the exact words are served; when it does not,
// someone edited the block in Jira, and what the region renders now is served
// behind the canonical markers, so the edit becomes the words, as on Linear.
// A property with no block is ignored.
//
// Compare rendered content only, never ADF hashes: Jira adds `localId` and similar
// attributes on ordinary saves, and adfToMarkdown ignores attributes.
//
// The block's spellings come from lib/as-asked.js and are never retyped here; the
// node texts they become are derived by parsing those spellings through the codec.
// =============================================================================

import { createHash } from 'node:crypto'
import { adfToMarkdown, markdownToAdf, plainText } from './adf.js'
import { AS_ASKED_HEADING, AS_ASKED_END, sealAsAsked, splitAsAsked } from '../../as-asked.js'

/** The entity property that holds the exact words. */
export const AS_ASKED_PROPERTY = 'harbour.asAsked'

/**
 * The issue read that asks for the property. Every provider-side `getIssue` passes
 * it (review note 2 on LIN-4445): a confirmation re-read that omitted it would hand
 * back converted words in the write's own response.
 */
export const AS_ASKED_READ = { properties: [AS_ASKED_PROPERTY] }

/**
 * Atlassian's documented ceiling for one entity property value. The docs give it
 * in bytes on some pages and characters on others; the stricter reading is
 * enforced: UTF-8 bytes of the serialized value, JSON escaping included.
 * Source: https://developer.atlassian.com/cloud/jira/platform/jira-entity-properties/
 */
export const AS_ASKED_PROPERTY_LIMIT_BYTES = 32768

const PROPERTY_VERSION = 1

// The two node texts the block's spellings become. Derived, never retyped.
const HEADING_TEXT = plainText(markdownToAdf(AS_ASKED_HEADING).content[0])
const END_TEXT = plainText(markdownToAdf(AS_ASKED_END).content[0])

/** Raised when the block cannot be held: `reason` is 'unrenderable' or 'too-large'. */
export class AsAskedHoldError extends Error {
  constructor(message, { reason, bytes }) {
    super(message)
    this.name = 'AsAskedHoldError'
    this.reason = reason
    this.bytes = bytes
  }
}

const childrenOf = node => (Array.isArray(node?.content) ? node.content : [])
const render = content => adfToMarkdown({ type: 'doc', content })
const digest = content => createHash('sha256').update(render(content), 'utf8').digest('hex')

const isHeadingNode = node => node?.type === 'heading' && node.attrs?.level === 2 && plainText(node) === HEADING_TEXT
const isEndNode = node => node?.type === 'paragraph' && plainText(node) === END_TEXT

/**
 * Where the block sits in a node list: the heading's index and every end paragraph
 * after it, in order. Null when there is no heading or no end paragraph after it.
 * Several ends are possible when the words themselves hold the end sentence as
 * plain or underscore text; the reader picks the one whose digest matches.
 */
function locate(nodes) {
  const h = nodes.findIndex(isHeadingNode)
  if (h === -1) return null
  const ends = []
  for (let i = h + 1; i < nodes.length; i++) if (isEndNode(nodes[i])) ends.push(i)
  return ends.length ? { h, ends } : null
}

function isProperty(value) {
  return Boolean(value) && value.v === PROPERTY_VERSION
    && typeof value.words === 'string' && typeof value.rendered === 'string'
}

/** The markdown for a block whose heading is `h` and end paragraph is `e`, holding `words`. */
function assemble(nodes, h, e, words) {
  return [render(nodes.slice(0, h)), sealAsAsked(words), render(nodes.slice(e + 1))]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The description as markdown, read from a stored ADF document and the issue's
 * `harbour.asAsked` property (or undefined when the read did not ask for it).
 *
 * @param {{type?: string, content?: Array}|null|undefined} doc - the stored ADF
 * @param {{v: number, words: string, rendered: string}|null|undefined} property
 * @returns {string}
 */
export function readDescription(doc, property) {
  const nodes = childrenOf(doc)
  const found = locate(nodes)
  if (!found) return adfToMarkdown(doc)
  const { h, ends } = found
  if (isProperty(property)) {
    const exact = ends.find(e => digest(nodes.slice(h, e + 1)) === property.rendered)
    if (exact !== undefined) return assemble(nodes, h, exact, property.words)
  }
  // Edited in Jira (or no property): what the region renders now is the words.
  const e = ends[0]
  return assemble(nodes, h, e, render(nodes.slice(h + 1, e)))
}

/**
 * Prepare a markdown description for a write. Returns the ADF to store and, when the
 * description holds a block, the `harbour.asAsked` property to write beside it. The
 * block's words are taken from splitAsAsked of what was handed, and the end paragraph
 * is the first one whose interior renders to those words, so a words-level copy of
 * the end sentence is never mistaken for the end.
 *
 * Throws AsAskedHoldError when the block cannot be held: its ADF interior does not
 * read back as the words, or the serialized property is over the documented limit.
 * The seal decision and the write both call this, so they cannot disagree.
 *
 * @param {string|null|undefined} markdown
 * @returns {{ doc: object, property: {v: number, words: string, rendered: string}|null }}
 */
export function holdAsAsked(markdown) {
  const doc = markdownToAdf(markdown)
  const parts = splitAsAsked(markdown)
  if (!parts) return { doc, property: null }
  const nodes = doc.content
  const found = locate(nodes)
  const wordsRendering = render(markdownToAdf(parts.words).content)
  const e = found?.ends.find(i => render(nodes.slice(found.h + 1, i)) === wordsRendering)
  if (e === undefined) {
    throw new AsAskedHoldError(
      `the ${AS_ASKED_HEADING} block does not read back as its own words, so it cannot be held on Jira`,
      { reason: 'unrenderable' },
    )
  }
  const property = { v: PROPERTY_VERSION, words: parts.words, rendered: digest(nodes.slice(found.h, e + 1)) }
  const bytes = Buffer.byteLength(JSON.stringify(property), 'utf8')
  if (bytes > AS_ASKED_PROPERTY_LIMIT_BYTES) {
    throw new AsAskedHoldError(
      `the ${AS_ASKED_HEADING} block is too large to hold on Jira: its ${AS_ASKED_PROPERTY} property `
      + `serializes to ${bytes} bytes, over the ${AS_ASKED_PROPERTY_LIMIT_BYTES}-byte entity property limit`,
      { reason: 'too-large', bytes },
    )
  }
  return { doc, property }
}
