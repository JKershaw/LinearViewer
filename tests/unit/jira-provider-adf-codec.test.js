/**
 * Unit tests for lib/providers/jira/adf.js (LIN-2399): the Jira ADF <->
 * Markdown codec, extracted from tests/unit/jira-provider.test.js (formerly
 * inline with the rest of the Jira provider suite, LIN-2378 code quality
 * review finding F3).
 *
 * Pins the same behavior the pre-extraction suite pinned, byte-for-byte:
 *   - adfToMarkdown covering the ADF node/mark types real Jira content uses;
 *   - markdownToAdf, the write-direction inverse;
 *   - the ADF -> markdown -> ADF round-trip property (LIN-1886 review
 *     Blocker 3) over hand-written fixtures, the reviewer's adversarial
 *     battery (LIN-1886 review F1), and a generated adversarial corpus
 *     (LIN-1886 review F2);
 *   - adfHasUnrenderableContent (D1 write-refusal policy).
 *
 * Also pins the extraction's own invariant (LIN-2399): index.js must reach
 * this codec only through an import from './adf.js', never by re-defining it
 * — see the 'index.js reaches the codec only through adf.js' test below.
 *
 * Run with: node --test tests/unit/jira-provider-adf-codec.test.js
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import { adfToMarkdown, markdownToAdf, adfHasUnrenderableContent } from '../../lib/providers/jira/adf.js'

describe('LIN-2399 — the codec extraction stays extracted', () => {
  test('index.js reaches the codec only through adf.js, never by re-defining it', () => {
    const indexPath = fileURLToPath(new URL('../../lib/providers/jira/index.js', import.meta.url))
    const src = readFileSync(indexPath, 'utf8')

    const specifiers = [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?['"](.+?)['"]\s*;?\s*$/gm)].map(m => m[1])
    assert.ok(
      specifiers.includes('./adf.js'),
      'lib/providers/jira/index.js must import the codec from ./adf.js — a future re-inlining of the codec would drop this import',
    )

    const adfImportLine = src.split('\n').find(line => line.includes("from './adf.js'"))
    for (const name of ['adfToMarkdown', 'markdownToAdf', 'adfHasUnrenderableContent']) {
      assert.ok(
        adfImportLine && adfImportLine.includes(name),
        `lib/providers/jira/index.js's ./adf.js import must name ${name}`,
      )
      // A re-inlined `function adfToMarkdown(...)`/`export function adfToMarkdown(...)`
      // in index.js would silently shadow the import above (or throw a duplicate
      // declaration) — assert no such local definition exists either.
      assert.doesNotMatch(
        src, new RegExp(`\\bfunction\\s+${name}\\s*\\(`),
        `lib/providers/jira/index.js must not itself define ${name} — that is a re-inlining of the extracted codec`,
      )
    }
  })
})

// =============================================================================
// ADF → Markdown
// =============================================================================

describe('adfToMarkdown', () => {
  test('null/undefined/non-object → empty string', () => {
    assert.equal(adfToMarkdown(null), '')
    assert.equal(adfToMarkdown(undefined), '')
    assert.equal(adfToMarkdown('not adf'), '')
  })

  test('paragraph + text marks (strong/em/code/strike/link)', () => {
    const doc = {
      type: 'doc', version: 1, content: [{
        type: 'paragraph', content: [
          { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      }],
    }
    assert.equal(
      adfToMarkdown(doc),
      '**bold** and _italic_ and `code` and ~~struck~~ and [a link](https://example.com)'
    )
  })

  test('heading level clamps into 1-6', () => {
    const doc = { content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }] }
    assert.equal(adfToMarkdown(doc), '## Title')
  })

  test('bulletList and orderedList', () => {
    const bullets = { content: [{ type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
    ] }] }
    assert.equal(adfToMarkdown(bullets), '- one\n- two')

    const ordered = { content: [{ type: 'orderedList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
    ] }] }
    assert.equal(adfToMarkdown(ordered), '1. first\n2. second')
  })

  test('codeBlock preserves the language and fenced body', () => {
    const doc = { content: [{ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: "console.log('hi')" }] }] }
    assert.equal(adfToMarkdown(doc), "```js\nconsole.log('hi')\n```")
  })

  test('blockquote prefixes every line with >', () => {
    const doc = { content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] }] }
    assert.equal(adfToMarkdown(doc), '> quoted')
  })

  test('rule and hardBreak', () => {
    assert.equal(adfToMarkdown({ content: [{ type: 'rule' }] }), '---')
    const doc = { content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' },
    ] }] }
    assert.equal(adfToMarkdown(doc), 'line one\nline two')
  })

  test('mention falls back to attrs.text, then a synthesized @id', () => {
    assert.equal(adfToMarkdown({ content: [{ type: 'mention', attrs: { text: '@ada' } }] }), '@ada')
    assert.equal(adfToMarkdown({ content: [{ type: 'mention', attrs: { id: '123' } }] }), '@123')
  })

  test('an unknown node type falls through to its child content instead of vanishing', () => {
    const doc = { content: [{ type: 'someFutureNode', content: [{ type: 'text', text: 'still here' }] }] }
    assert.equal(adfToMarkdown(doc), 'still here')
  })
})

// =============================================================================
// markdownToAdf — the write-direction inverse of adfToMarkdown (LIN-1886 Step 1)
// =============================================================================

describe('markdownToAdf', () => {
  test('null/undefined/blank → an empty doc', () => {
    assert.deepEqual(markdownToAdf(null), { type: 'doc', version: 1, content: [] })
    assert.deepEqual(markdownToAdf(undefined), { type: 'doc', version: 1, content: [] })
    assert.deepEqual(markdownToAdf('   '), { type: 'doc', version: 1, content: [] })
  })

  // NOTE: this is the markdown → ADF → markdown direction — it proves REPEATED
  // EDITS are idempotent, nothing more. It is deliberately NOT called a round
  // trip over the modeled node types: it cannot see whether stored ADF survives
  // a write (that is the ADF → markdown → ADF property suite below, added by
  // LIN-1886 review Blocker 3 — this test was green through that whole bug).
  test('markdown → ADF → markdown is idempotent for each hand-written block form', () => {
    const md = [
      '# Round trip',
      'plain **bold** and _em_ and `code` and ~~strike~~ and [a link](https://example.com)',
      '- one\n- two',
      '1. first\n2. second',
      '```js\nconsole.log(1)\n```',
      '> quoted',
      '---',
      'line one\nline two',
    ]
    for (const original of md) {
      const roundTripped = adfToMarkdown(markdownToAdf(original))
      assert.equal(roundTripped, original, `round trip failed for: ${JSON.stringify(original)}`)
    }
  })

  test('a full multi-block document round-trips as a whole', () => {
    const original = [
      '# Title',
      'A paragraph with **bold** text.',
      '- item one\n- item two',
      '```js\nconst x = 1\n```',
    ].join('\n\n')
    assert.equal(adfToMarkdown(markdownToAdf(original)), original)
  })

  test('never throws on unsupported Markdown — degrades to a plain paragraph', () => {
    assert.doesNotThrow(() => markdownToAdf('| a | b |\n| - | - |\n| 1 | 2 |'))
    const adf = markdownToAdf('| a | b |')
    assert.equal(adf.content[0].type, 'paragraph')
  })
})

// =============================================================================
// THE write-direction property: ADF → markdown → ADF (LIN-1886 review Blocker 3)
// =============================================================================
//
// The invariant the D1 write gate exists to buy, stated as a property over
// fixtures:
//
//     adfHasUnrenderableContent(doc) === false
//       ⟹  markdownToAdf(adfToMarkdown(doc)) deep-equals doc
//
// This is the direction that proves STORED CONTENT SURVIVES A WRITE. The
// markdown → ADF → markdown test above only ever proved repeated edits are
// idempotent, which is why CI stayed green while a 200-OK append was flattening
// a mention/emoji/smart-link description into one anonymous text run.
//
// Every fixture is written in the canonical shape `markdownToAdf` itself emits
// (`{type:'doc', version:1, content:[...]}`, no empty `marks: []`, no extra
// attrs) so a deep-equal is a real claim rather than one defeated by incidental
// field differences. A fixture that must be REFUSED asserts the gate is `true`
// — the property's precondition is then false and no round-trip is claimed.

const adfDoc = (...content) => ({ type: 'doc', version: 1, content })
const adfText = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const adfPara = (...content) => ({ type: 'paragraph', content })
const adfItem = (...content) => ({ type: 'listItem', content })
const HARD_BREAK = { type: 'hardBreak' }
const nestedList = (type, ...heads) => ({ type, content: heads.map(head => adfItem(adfPara(adfText(head)))) })

/** Docs the writer CAN rebuild — the gate must permit these AND they must deep-equal. */
const WRITER_SAFE_ADF = {
  'plain paragraph': adfDoc(adfPara(adfText('Hello world.'))),
  'two paragraphs': adfDoc(adfPara(adfText('One.')), adfPara(adfText('Two.'))),
  heading: adfDoc({ type: 'heading', attrs: { level: 3 }, content: [adfText('Deep')] }),
  'heading carrying a mark': adfDoc({ type: 'heading', attrs: { level: 2 }, content: [adfText('B', [{ type: 'strong' }])] }),
  'strong mark': adfDoc(adfPara(adfText('bold', [{ type: 'strong' }]))),
  'em mark': adfDoc(adfPara(adfText('italic', [{ type: 'em' }]))),
  'code mark': adfDoc(adfPara(adfText('x', [{ type: 'code' }]))),
  'strike mark': adfDoc(adfPara(adfText('struck', [{ type: 'strike' }]))),
  'link mark': adfDoc(adfPara(adfText('a link', [{ type: 'link', attrs: { href: 'https://example.com' } }]))),
  'mixed inline runs': adfDoc(adfPara(adfText('plain '), adfText('bold', [{ type: 'strong' }]), adfText(' tail'))),
  bulletList: adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText('one'))), adfItem(adfPara(adfText('two')))] }),
  orderedList: adfDoc({ type: 'orderedList', content: [adfItem(adfPara(adfText('first'))), adfItem(adfPara(adfText('second')))] }),
  'list item carrying a mark': adfDoc({ type: 'orderedList', content: [adfItem(adfPara(adfText('b', [{ type: 'strong' }])))] }),
  'codeBlock with a language': adfDoc({ type: 'codeBlock', attrs: { language: 'js' }, content: [adfText('console.log(1)')] }),
  'codeBlock without a language': adfDoc({ type: 'codeBlock', content: [adfText('plain code')] }),
  'multi-line codeBlock': adfDoc({ type: 'codeBlock', content: [adfText('a\nb\nc')] }),
  'single-paragraph blockquote': adfDoc({ type: 'blockquote', content: [adfPara(adfText('quoted'))] }),
  'blockquote with a hardBreak': adfDoc({ type: 'blockquote', content: [adfPara(adfText('l1'), HARD_BREAK, adfText('l2'))] }),
  rule: adfDoc({ type: 'rule' }),
  'rule followed by a paragraph': adfDoc({ type: 'rule' }, adfPara(adfText('after'))),
  'hardBreak inside a paragraph': adfDoc(adfPara(adfText('line one'), HARD_BREAK, adfText('line two'))),
  'a whole realistic document': adfDoc(
    { type: 'heading', attrs: { level: 1 }, content: [adfText('Title')] },
    adfPara(adfText('Body with '), adfText('bold', [{ type: 'strong' }]), adfText(' in it.')),
    { type: 'bulletList', content: [adfItem(adfPara(adfText('one'))), adfItem(adfPara(adfText('two')))] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [adfText('const x = 1')] },
    { type: 'rule' },
    { type: 'blockquote', content: [adfPara(adfText('closing thought'))] },
  ),
  // ---------------------------------------------------------------------
  // LIN-1886 re-review `5ae61f22` — the two counterexamples the reviewer
  // reproduced at head `36a53a80`, pinned here so neither can regress. Both
  // belong in the SAFE list: after the fix each is permitted AND round-trips,
  // which is the whole claim. Before it, the first was permitted and silently
  // DELETED its `#` line (a false docstring invariant, not an over-refusal),
  // and the second was refused although it round-tripped perfectly.
  // ---------------------------------------------------------------------
  'paragraph whose first line is a bare "#" (re-review R2)':
    adfDoc(adfPara(adfText('#'), HARD_BREAK, adfText('1  Scope of works'))),
  'codeBlock whose blank separator line carries a stray space (re-review R3.1)':
    adfDoc({ type: 'codeBlock', attrs: { language: 'python' }, content: [adfText('def a():\n    pass\n \ndef b():\n    pass')] }),
  'heading at level 6': adfDoc({ type: 'heading', attrs: { level: 6 }, content: [adfText('Six')] }),
  // LIN-3570: nested lists. An empty nested item that is not first must keep
  // its trailing space on the way out (`  - `, not `  -`), and outer siblings
  // follow the ones that end in it.
  'nested bulletList': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('parent')), nestedList('bulletList', 'child'))],
  }),
  'nested list with an outer sibling': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b')), adfItem(adfPara(adfText('c')))],
  }),
  'bullets under a numbered item': adfDoc({
    type: 'orderedList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b', 'c')), adfItem(adfPara(adfText('d')))],
  }),
  'an item holding a bulletList then an orderedList': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b'), nestedList('orderedList', 'c'))],
  }),
  'three levels': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), {
      type: 'orderedList',
      content: [adfItem(adfPara(adfText('b')), nestedList('bulletList', 'c')), adfItem(adfPara(adfText('d')))],
    })],
  }),
  'nested list under the tenth ordered item': adfDoc({
    type: 'orderedList',
    content: [...'abcdefghi'].map(c => adfItem(adfPara(adfText(c)))).concat(adfItem(adfPara(adfText('j')), nestedList('bulletList', 'k'))),
  }),
  'nested list ending in an empty item, then an outer sibling': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b', '')), adfItem(adfPara(adfText('c')))],
  }),
  'nested list with an empty middle item': adfDoc({
    type: 'orderedList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b', '', 'd')), adfItem(adfPara(adfText('e')))],
  }),
  'an empty item holding a nested list, not first': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a'))), adfItem(adfPara(adfText('')), nestedList('bulletList', 'b'))],
  }),
  'empty depth-2 item before a depth-1 sibling': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), {
      type: 'bulletList',
      content: [adfItem(adfPara(adfText('b')), nestedList('bulletList', 'c', '')), adfItem(adfPara(adfText('d')))],
    }), adfItem(adfPara(adfText('e')))],
  }),
  'em mark in a nested item': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), { type: 'bulletList', content: [adfItem(adfPara(adfText('b', [{ type: 'em' }])))] })],
  }),
}

/**
 * Docs the writer CANNOT rebuild — the gate must refuse these. Each entry
 * records what a write would have destroyed had the gate stayed derived from
 * the READER's vocabulary (LIN-1886 review Blocker 3).
 */
const WRITER_UNSAFE_ADF = {
  // No markdown → ADF inverse exists for these four ANYWHERE in the writer;
  // they render for display and re-parse as anonymous text.
  mention: adfDoc(adfPara(adfText('hi '), { type: 'mention', attrs: { id: '1', text: '@ada' } })),
  inlineCard: adfDoc(adfPara(adfText('see '), { type: 'inlineCard', attrs: { url: 'https://example.com/x' } })),
  blockCard: adfDoc({ type: 'blockCard', attrs: { url: 'https://example.com/y' } }),
  emoji: adfDoc(adfPara({ type: 'emoji', attrs: { shortName: ':smile:', text: '🙂' } })),
  'ordinary Jira prose mixing mention + inlineCard + emoji': adfDoc(adfPara(
    adfText('hi '), { type: 'mention', attrs: { text: '@ada' } },
    adfText(' see '), { type: 'inlineCard', attrs: { url: 'https://e.com' } },
    adfText(' '), { type: 'emoji', attrs: { text: '🙂' } },
  )),
  // Structural: shapes markdownToAdf never emits.
  'listItem with a list first': adfDoc({ type: 'bulletList', content: [adfItem({ type: 'bulletList', content: [adfItem(adfPara(adfText('b')))] })] }),
  'listItem with text after its nested list': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b'), adfPara(adfText('c')))],
  }),
  'listItem with two neighbouring lists of one kind': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b'), nestedList('bulletList', 'c'))],
  }),
  'listItem holding two paragraphs and a list': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), adfPara(adfText('b')), nestedList('bulletList', 'c'))],
  }),
  // `markdownToAdf` trims its source, so a trailing ` -` loses its space and
  // is no longer a marker; the document-edge rule refuses it.
  'nested list ending in an empty item at the document end': adfDoc({
    type: 'bulletList',
    content: [adfItem(adfPara(adfText('a')), nestedList('bulletList', 'b', ''))],
  }),
  'listItem holding two paragraphs': adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText('a')), adfPara(adfText('b')))] }),
  'listItem holding nothing': adfDoc({ type: 'bulletList', content: [{ type: 'listItem', content: [] }] }),
  'listItem whose paragraph has a hardBreak': adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText('a'), HARD_BREAK, adfText('b')))] }),
  'heading with a hardBreak': adfDoc({ type: 'heading', attrs: { level: 1 }, content: [adfText('a'), HARD_BREAK, adfText('b')] }),
  'multi-paragraph blockquote': adfDoc({ type: 'blockquote', content: [adfPara(adfText('one')), adfPara(adfText('two'))] }),
  'empty blockquote': adfDoc({ type: 'blockquote', content: [] }),
  'blockquote holding a codeBlock': adfDoc({ type: 'blockquote', content: [{ type: 'codeBlock', content: [adfText('x')] }] }),
  'blockquote holding a heading': adfDoc({ type: 'blockquote', content: [{ type: 'heading', attrs: { level: 1 }, content: [adfText('x')] }] }),
  'codeBlock containing a blank line': adfDoc({ type: 'codeBlock', content: [adfText('a\n\nb')] }),
  'codeBlock with a leading newline': adfDoc({ type: 'codeBlock', content: [adfText('\na')] }),
  'codeBlock with a trailing newline': adfDoc({ type: 'codeBlock', content: [adfText('a\n')] }),
  'empty codeBlock': adfDoc({ type: 'codeBlock', content: [] }),
  // Adjacent code runs (LIN-3564): their fences touch, and CommonMark reads
  // ``a``b`` as ONE span. The same two runs with a different mark between them
  // are fine.
  'two adjacent code runs': adfDoc(adfPara(adfText('a', [{ type: 'code' }]), adfText('b', [{ type: 'code' }]))),
  // A code span cannot be escaped, so one that opens a multi-line paragraph
  // with a fence would read back as a code block.
  'a paragraph opening with a fence-length code span, then a line break':
    adfDoc(adfPara(adfText('``x', [{ type: 'code' }]), { type: 'hardBreak' }, adfText('y'))),
  // Marks: INLINE_PATTERN is a single non-nesting scan, so two marks on one run
  // render as `_**x**_` and re-parse as ONE em run whose text is literally `**x**`.
  'text carrying strong + em': adfDoc(adfPara(adfText('x', [{ type: 'strong' }, { type: 'em' }]))),
  'text carrying link + strong': adfDoc(adfPara(adfText('x', [{ type: 'link', attrs: { href: 'https://e.com' } }, { type: 'strong' }]))),
  // Shapes that are refused wherever they sit, not only at the document's edge.
  'empty listItem followed by another item': adfDoc({ type: 'bulletList', content: [{ type: 'listItem', content: [] }, adfItem(adfPara(adfText('b')))] }),
  'empty blockquote between paragraphs': adfDoc(adfPara(adfText('a')), { type: 'blockquote', content: [] }, adfPara(adfText('b'))),
  'empty heading between paragraphs': adfDoc(adfPara(adfText('a')), { type: 'heading', attrs: { level: 1 }, content: [] }, adfPara(adfText('b'))),
  'paragraph with a blank line made of two hardBreaks': adfDoc(adfPara(adfText('a'), HARD_BREAK, HARD_BREAK, adfText('b'))),
  'paragraph split into two plain text runs': adfDoc(adfPara(adfText('a'), adfText('b'))),
  'codeBlock split into two text runs': adfDoc({ type: 'codeBlock', content: [adfText('const a = '), adfText('1')] }),
  'codeBlock with a blank language': adfDoc({ type: 'codeBlock', attrs: { language: '' }, content: [adfText('x')] }),
  'codeBlock with a space-padded language': adfDoc({ type: 'codeBlock', attrs: { language: ' js' }, content: [adfText('x')] }),
  'codeBlock whose text carries a mark': adfDoc({ type: 'codeBlock', content: [adfText('x', [{ type: 'strong' }])] }),
  'link whose href contains a newline': adfDoc(adfPara(adfText('x', [{ type: 'link', attrs: { href: 'https://e.com/a\nb' } }]))),
}

/**
 * Docs the gate PERMITS that do NOT deep-equal round-trip — the two enumerated
 * exceptions in `adfHasUnrenderableContent`'s docstring, made executable
 * (LIN-1886, John's Option C ruling `d38d3755`).
 *
 * The docstring used to assert the invariant unqualified and it was not true.
 * Option C reworded it to what actually holds; these fixtures are what stop the
 * reworded version drifting in EITHER direction. Each entry asserts three
 * things at once:
 *
 *   1. the gate permits it (it is an exception, not a refusal);
 *   2. the rendered Markdown is byte-identical across the round trip — the
 *      whole reason each exception is tolerable is that nothing a reader sees
 *      changes;
 *   3. it does NOT deep-equal — which is the exception itself, and the part a
 *      future change is most likely to close by accident.
 *
 * Assertion 3 failing is GOOD NEWS, not a regression: it means someone closed
 * the gap. The message says so and says what to do about it. A test that
 * silently kept passing after the gap closed would leave the docstring
 * under-claiming, which is the same class of defect as over-claiming.
 */
const WRITER_PERMITTED_LOSSY_ADF = {
  'orderedList identity attrs {order: 1} (ruling d38d3755)': {
    doc: adfDoc({
      type: 'orderedList',
      attrs: { order: 1 },
      content: [adfItem(adfPara(adfText('first'))), adfItem(adfPara(adfText('second')))],
    }),
    lost: 'the `attrs` key itself — `markdownToAdf` emits none for an orderedList, and `renderAdfNode` renumbers from 1 whatever is stored, so the list reads identically',
    closedBy: 'the writer modelling `order`, which is explicitly out of scope — see the note on WRITER_EMITTED_ATTRS',
  },
  'orderedList bare empty attrs {} (ruling d38d3755)': {
    doc: adfDoc({
      type: 'orderedList',
      attrs: {},
      content: [adfItem(adfPara(adfText('first'))), adfItem(adfPara(adfText('second')))],
    }),
    lost: 'the empty `attrs` key itself; there is nothing in it to preserve, but its PRESENCE is not reproducible',
    closedBy: 'the writer emitting an empty `attrs` on every orderedList, which would break the far commoner no-attrs list instead',
  },
  // Pre-existing and orthogonal: unchanged by LIN-1886, deliberately not fixed
  // here, tracked as its own ticket per the ruling's scope rule. Pinned so the
  // docstring's claim about it is executable rather than prose — and so whoever
  // fixes LIN-1939 is told, by a failing test, to update the docstring with it.
  'empty unmarked text run between marked runs (LIN-1939)': {
    doc: adfDoc(adfPara(adfText(''), adfText('x', [{ type: 'em' }]))),
    lost: 'the empty run — it slips the empty-run rule (which needs a mark) and the adjacent-unmarked-pair rule (which needs both neighbours unmarked). Nothing visible: the run is empty',
    closedBy: 'LIN-1939 — teaching one of those two rules about an empty unmarked run whose neighbours are marked',
  },
  // LIN-2019 exception 3: `localId` is Jira-editor-stamped collaborative-editing
  // metadata, present on virtually every node a human has touched in Jira's web
  // editor. The writer emits no `localId` anywhere, so the key is simply ABSENT
  // after the round trip — same shape of exception as the orderedList entries
  // above, just keyed on an attrs NAME rather than a node type.
  'paragraph carrying a localId (LIN-2019)': {
    doc: adfDoc({ type: 'paragraph', attrs: { localId: '0647076c05f3' }, content: [adfText('hello')] }),
    lost: 'the `localId` attrs key itself — the writer emits no `attrs` for a paragraph, so the key is absent after the round trip; the rendered text is untouched',
    closedBy: 'the writer round-tripping arbitrary editor-stamped attrs verbatim, which is explicitly out of scope — see PRESENTATION_NEUTRAL_ATTRS',
  },
  'heading carrying a level and a localId (LIN-2019)': {
    doc: adfDoc({ type: 'heading', attrs: { level: 2, localId: '901afc0118a6' }, content: [adfText('H')] }),
    lost: 'the `localId` attrs key; `level` survives untouched',
    closedBy: 'the writer round-tripping arbitrary editor-stamped attrs verbatim, which is explicitly out of scope — see PRESENTATION_NEUTRAL_ATTRS',
  },
  'listItem carrying a localId (LIN-2019)': {
    doc: adfDoc({ type: 'bulletList', content: [{ type: 'listItem', attrs: { localId: 'abc123' }, content: [adfPara(adfText('a'))] }] }),
    lost: 'the `localId` attrs key itself — the writer emits no `attrs` for a listItem',
    closedBy: 'the writer round-tripping arbitrary editor-stamped attrs verbatim, which is explicitly out of scope — see PRESENTATION_NEUTRAL_ATTRS',
  },
}

describe('ADF → markdown → ADF property (LIN-1886 review Blocker 3)', () => {
  for (const [name, doc] of Object.entries(WRITER_SAFE_ADF)) {
    test(`permitted and survives the round trip: ${name}`, () => {
      assert.equal(adfHasUnrenderableContent(doc), false, 'the write gate must permit this doc')
      assert.deepEqual(
        markdownToAdf(adfToMarkdown(doc)), doc,
        `markdownToAdf(adfToMarkdown(doc)) lost content for: ${name}\nmarkdown was: ${JSON.stringify(adfToMarkdown(doc))}`,
      )
    })
  }

  for (const [name, doc] of Object.entries(WRITER_UNSAFE_ADF)) {
    test(`refused, because the writer cannot rebuild it: ${name}`, () => {
      // The gate must be true — so the property's precondition is false and no
      // round trip is claimed. Asserting the round trip genuinely FAILS as well
      // is what stops this fixture quietly becoming a needless over-refusal.
      assert.equal(adfHasUnrenderableContent(doc), true, 'the write gate must refuse this doc')
      assert.notDeepEqual(
        markdownToAdf(adfToMarkdown(doc)), doc,
        `${name} actually round-trips fine — refusing it is a needless capability cost`,
      )
    })
  }

  test('the read path is untouched: adfToMarkdown still renders refused content for display', () => {
    // Only the WRITE tightened. Mentions, emoji and cards must still render.
    assert.equal(adfToMarkdown(WRITER_UNSAFE_ADF.mention), 'hi @ada')
    assert.equal(adfToMarkdown(WRITER_UNSAFE_ADF.inlineCard), 'see https://example.com/x')
    assert.equal(adfToMarkdown(WRITER_UNSAFE_ADF.emoji), '🙂')
    assert.equal(adfToMarkdown(WRITER_UNSAFE_ADF.blockCard), 'https://example.com/y')
  })
})

describe('LIN-1886 ruling d38d3755 & LIN-2019 — the invariant\'s non-lossy attrs exceptions', () => {
  for (const [name, { doc, lost, closedBy }] of Object.entries(WRITER_PERMITTED_LOSSY_ADF)) {
    test(`permitted, renders identically, but does NOT deep-equal: ${name}`, () => {
      assert.equal(
        adfHasUnrenderableContent(doc), false,
        'the gate must PERMIT this — it is a documented exception to the invariant, not a refusal',
      )

      const back = markdownToAdf(adfToMarkdown(doc))

      // What makes the exception tolerable: a write changes no rendered character.
      assert.equal(
        adfToMarkdown(back), adfToMarkdown(doc),
        `a write must not change what a reader sees here. Only structure is lost: ${lost}`,
      )

      // The exception itself. If this starts failing, the gap has been CLOSED.
      assert.notDeepEqual(
        back, doc,
        `This now round-trips exactly, so the exception is closed (${closedBy}). `
        + 'Move it to WRITER_SAFE_ADF and delete the matching clause from '
        + "adfHasUnrenderableContent's docstring — an invariant that under-claims is "
        + 'as wrong as one that over-claims.',
      )
    })
  }

  // The boundary of the relaxation. `{order: 1}` is permitted because dropping
  // it renumbers nothing; every one of these renumbers something or loses a
  // key, so the exception must not swallow them. `{order: 0}` and `{order: 2}`
  // are the pointed cases: the ruling's words were "relax to `order > 1`", but
  // a non-positive order is not an identity value either and is refused too.
  for (const [label, attrs] of Object.entries({
    '{order: 5} — the review\'s original counterexample': { order: 5 },
    '{order: 2}': { order: 2 },
    '{order: 0} — renumbers a 0-based list to 1-based': { order: 0 },
    '{order: -3}': { order: -3 },
    '{order: "1"} — a string is not the integer identity': { order: '1' },
    '{order: 1, start: 4} — an extra key the writer cannot re-emit': { order: 1, start: 4 },
  })) {
    test(`a non-identity orderedList attrs ${label} is still refused`, () => {
      const doc = adfDoc({
        type: 'orderedList',
        attrs,
        content: [adfItem(adfPara(adfText('first'))), adfItem(adfPara(adfText('second')))],
      })
      assert.equal(
        adfHasUnrenderableContent(doc), true,
        'only the exact identity `{order: 1}` (or a bare `{}`) is harmless — this one is not',
      )
      assert.notDeepEqual(
        markdownToAdf(adfToMarkdown(doc)), doc,
        'this round-trips fine, so refusing it is a needless capability cost',
      )
    })
  }

  // LIN-2019: the `localId` allowlist is exactly one key. Any OTHER unrecognized
  // attrs key must still refuse, whether or not `localId` is also present —
  // fail-closed by construction, not a heuristic.
  for (const [label, attrs] of Object.entries({
    '{localId, unknownKey} — an extra key alongside localId still refuses': { localId: 'x', unknownKey: 'y' },
    '{unknownKey} alone still refuses': { unknownKey: 'y' },
  })) {
    test(`a paragraph with attrs ${label}`, () => {
      const doc = adfDoc({ type: 'paragraph', attrs, content: [adfText('hello')] })
      assert.equal(adfHasUnrenderableContent(doc), true, 'only a bare localId is allowlisted')
    })
  }

  // LIN-2019: the attrs relaxation must not paper over an independently
  // unrebuildable SHAPE — structural refusals still win over `localId`.
  test('a nested bulletList carrying localId on the inner list is permitted (LIN-3570)', () => {
    const doc = adfDoc({
      type: 'bulletList',
      content: [adfItem(adfPara(adfText('parent')), { type: 'bulletList', attrs: { localId: 'x' }, content: [adfItem(adfPara(adfText('child')))] })],
    })
    assert.equal(adfHasUnrenderableContent(doc), false)
    assert.deepEqual(markdownToAdf(adfToMarkdown(doc)), adfDoc({
      type: 'bulletList',
      content: [adfItem(adfPara(adfText('parent')), nestedList('bulletList', 'child'))],
    }), 'it rebuilds minus the localId')
  })

  test('a different structural refusal still wins under a localId on a nested list', () => {
    const doc = adfDoc({
      type: 'bulletList',
      content: [adfItem(adfPara(adfText('parent')), {
        type: 'bulletList',
        attrs: { localId: 'x' },
        content: [adfItem(adfPara(adfText('one')), adfPara(adfText('two')))],
      })],
    })
    assert.equal(adfHasUnrenderableContent(doc), true, 'an inner item holding two paragraphs is still unrebuildable')
  })

  test('a multi-paragraph blockquote carrying localId still refuses', () => {
    const doc = adfDoc({
      type: 'blockquote',
      attrs: { localId: 'x' },
      content: [adfPara(adfText('one')), adfPara(adfText('two'))],
    })
    assert.equal(adfHasUnrenderableContent(doc), true, 'a multi-paragraph blockquote is unrebuildable regardless of attrs')
  })

  test('a non-identity orderedList order carrying localId still refuses', () => {
    const doc = adfDoc({
      type: 'orderedList',
      attrs: { order: 5, localId: 'x' },
      content: [adfItem(adfPara(adfText('first'))), adfItem(adfPara(adfText('second')))],
    })
    assert.equal(adfHasUnrenderableContent(doc), true, 'a non-identity order still renumbers the list regardless of localId')
  })
})

// =============================================================================
// LIN-2019 exception 4: a top-level empty paragraph. Its own describe block —
// unlike the attrs exceptions above, the render is NOT identical across the
// round trip for the mid-document/trailing cases (a blank line is genuinely
// dropped), so it cannot share WRITER_PERMITTED_LOSSY_ADF's render-identical
// assertion.
// =============================================================================

describe('LIN-2019 exception 4 — a top-level empty paragraph', () => {
  test('mid-document: permitted, and the blank line collapses', () => {
    const doc = adfDoc(adfPara(adfText('one')), adfPara(), adfPara(adfText('two')))
    assert.equal(adfHasUnrenderableContent(doc), false, 'a mid-document empty paragraph must be permitted')
    assert.equal(adfToMarkdown(doc), 'one\n\n\n\ntwo')
    const rebuilt = markdownToAdf(adfToMarkdown(doc))
    assert.equal(adfToMarkdown(rebuilt), 'one\n\ntwo', 'the blank line collapses to a single blank line on read-back')
    assert.notDeepEqual(rebuilt, doc, 'the empty paragraph node itself is dropped, so this is not a deep-equal round trip')
  })

  test('trailing: permitted, and the trailing empty paragraph is silently dropped', () => {
    const doc = adfDoc(adfPara(adfText('one')), adfPara())
    assert.equal(adfHasUnrenderableContent(doc), false, 'a trailing empty paragraph must be permitted')
    const rebuilt = markdownToAdf(adfToMarkdown(doc))
    assert.equal(rebuilt.content.length, doc.content.length - 1, 'the rebuilt doc must have one fewer top-level node')
    assert.equal(adfToMarkdown(rebuilt), 'one')
    assert.notDeepEqual(rebuilt, doc)
  })

  test('leading: still refused — the doc-edge trimStart rule has no relief for this position', () => {
    const doc = adfDoc(adfPara(), adfPara(adfText('one')))
    assert.equal(adfHasUnrenderableContent(doc), true, 'a leading empty paragraph must still refuse')
    assert.notDeepEqual(
      markdownToAdf(adfToMarkdown(doc)), doc,
      'the leading empty paragraph is genuinely dropped, which is exactly why refusing it is not a needless capability cost',
    )
  })

  test('empty paragraph alone: still refused', () => {
    const doc = adfDoc(adfPara())
    assert.equal(adfHasUnrenderableContent(doc), true, 'a description that is a single empty paragraph must still refuse')
  })
})

// =============================================================================
// THE REVIEWER'S ADVERSARIAL BATTERY (LIN-1886 review F1) — the acceptance
// fixture for fix cycle 3, John's Option A.
// =============================================================================
//
// Fix cycle 2 shipped the property suite above over fixtures the IMPLEMENTER
// chose. The re-review (`49a3757c`) then probed the same docstring invariant
// with an adversarial battery of its own and found **16 counterexamples in two
// sub-classes** — permitted by the gate, silently rewritten by the write. The
// human decision (`599551c2`) made that battery, not implementer-chosen
// fixtures, the acceptance fixture for this cycle. This is the LIN-1731
// real-fixture lesson: the cases are transcribed from the review, not picked.
//
// Option A routes them three ways, and every case below is labelled with which:
//
//   ESCAPE  — sub-class (a), Markdown-syntax collisions. `adfToMarkdown` now
//             escapes them, so the content ROUND-TRIPS FAITHFULLY. Refusing
//             ordinary prose was explicitly ruled out.
//   FIX     — the two outright codec bugs in sub-class (b): `(`-in-href
//             truncation and `]`-in-link-text destroying the link mark. Also
//             round-trips.
//   REFUSE  — what genuinely remains unrebuildable after the two above; a
//             D1-style 422, never a silent lossy 200.
//
// ACCOUNTING. The review states 16 counterexamples and enumerates 13 of them in
// prose (3 carried from fix cycle 2 + 5 under sub-class (a) + 5 under sub-class
// (b)); the remaining 3 are counted but not individually named. Rather than
// guess at them, the battery below encodes all 13 named cases PLUS every
// sibling construct in the classes the human decision names ("inline `_`/`*`/
// backtick runs") — `*`, backtick, `~~`, and literal link syntax — for 17
// transcribed cases, and then a further block of residue cases found while
// implementing. It over-covers rather than under-covers.

/** Sub-class (a) + the two codec bugs: these must now ROUND-TRIP, not refuse. */
const F1_MUST_ROUND_TRIP = {
  // -- the three carried from fix cycle 2 ------------------------------------
  // F1.1 "call foo_bar_baz now" -> text "call foo" + em "bar" + text "baz now"
  'ESCAPE — an inline _ run must not invent an em mark':
    adfDoc(adfPara(adfText('call foo_bar_baz now'))),
  // F1.2 a paragraph whose text is "- not a list" -> an actual bulletList
  'ESCAPE — a paragraph beginning "- " must not be promoted to a bulletList':
    adfDoc(adfPara(adfText('- not a list'))),

  // -- sub-class (a), block-level promotion ----------------------------------
  'ESCAPE — a paragraph beginning "# " must not be promoted to a heading':
    adfDoc(adfPara(adfText('# not a heading'))),
  'ESCAPE — a paragraph beginning "> " must not be promoted to a blockquote':
    adfDoc(adfPara(adfText('> not a quote'))),
  'ESCAPE — a paragraph beginning "1. " must not be promoted to an orderedList':
    adfDoc(adfPara(adfText('1. not a list'))),
  'ESCAPE — a paragraph whose text is "---" must not be promoted to a rule':
    adfDoc(adfPara(adfText('---'))),
  // "the worst case in the whole set": the text is DELETED, not reinterpreted.
  'ESCAPE — a paragraph beginning with a fence marker must not have its text deleted':
    adfDoc(adfPara(adfText('```js'))),

  // -- the inline-run siblings the human decision names ----------------------
  'ESCAPE — an inline ** run must not invent a strong mark':
    adfDoc(adfPara(adfText('a ** b ** c'))),
  'ESCAPE — an inline backtick run must not invent a code mark':
    adfDoc(adfPara(adfText('use `x` in the shell'))),
  'ESCAPE — an inline ~~ run must not invent a strike mark':
    adfDoc(adfPara(adfText('a ~~b~~ c'))),
  'ESCAPE — literal link syntax must not invent a link mark':
    adfDoc(adfPara(adfText('see [1](2) below'))),

  // -- the two outright codec bugs -------------------------------------------
  // F1 (b): href TRUNCATED to ".../Foo_(bar" — a silently broken link.
  'FIX — a "(" in an href must not truncate it':
    adfDoc(adfPara(adfText('Foo', [{ type: 'link', attrs: { href: 'https://e.com/wiki/Foo_(bar)' } }]))),
  // F1 (b): the link mark is LOST and raw "[a]b](http://x)" leaks into the body.
  'FIX — a "]" in link text must not destroy the link mark':
    adfDoc(adfPara(adfText('a]b', [{ type: 'link', attrs: { href: 'http://x' } }]))),

  // -- the same collisions where they are easiest to get wrong ---------------
  'ESCAPE — collisions inside a heading':
    adfDoc({ type: 'heading', attrs: { level: 2 }, content: [adfText('Release 1.0_rc *notes*')] }),
  'ESCAPE — collisions inside a list item':
    adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText('- nested-looking _text_')))] }),
  'ESCAPE — collisions inside a blockquote':
    adfDoc({ type: 'blockquote', content: [adfPara(adfText('> deeper_looking'))] }),
  'ESCAPE — collisions inside marked runs':
    adfDoc(adfPara(
      adfText('a_b', [{ type: 'strong' }]),
      adfText(' and '),
      adfText('c*d', [{ type: 'em' }]),
      adfText(' and '),
      adfText('e`f', [{ type: 'code' }]),
    )),
  // A code BLOCK body is fenced and read back verbatim, so it must be left
  // exactly alone — escaping it would corrupt the very content it protects.
  'ESCAPE — a codeBlock body is NOT escaped':
    adfDoc({ type: 'codeBlock', attrs: { language: 'md' }, content: [adfText('# heading\n- item\n_under_')] }),
}

/** Sub-class (b) residue: genuinely unrebuildable, so a D1 refusal (not a lossy 200). */
const F1_MUST_REFUSE = {
  // F1.3 an empty spacer paragraph -> dropped entirely. There is no Markdown
  // for "an empty paragraph": it renders to a blank line, and blank lines are
  // exactly what markdownToAdf splits blocks ON. Escaping cannot reach it.
  'REFUSE — an empty spacer paragraph is dropped': adfDoc(adfPara(), adfPara(adfText('after'))),
  // F1 (b): attrs dropped; the list silently renumbers 5,6 -> 1,2.
  'REFUSE — orderedList attrs {order:5} are dropped and the list renumbers':
    adfDoc({ type: 'orderedList', attrs: { order: 5 }, content: [adfItem(adfPara(adfText('first'))), adfItem(adfPara(adfText('second')))] }),
  // F1 (b): whitespace trimmed.
  'REFUSE — listItem text "  padded  " is trimmed':
    adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText('  padded  ')))] }),
  // F1 (b): clamped to 6. Not reachable in practice — ADF caps at 6 — but the
  // gate should not depend on that being true of every tenant.
  'REFUSE — heading attrs {level:7} are clamped to 6':
    adfDoc({ type: 'heading', attrs: { level: 7 }, content: [adfText('Too deep')] }),
}

describe('LIN-1886 review F1 — the reviewer\'s adversarial battery (Option A)', () => {
  for (const [name, doc] of Object.entries(F1_MUST_ROUND_TRIP)) {
    test(name, () => {
      assert.equal(
        adfHasUnrenderableContent(doc), false,
        'Option A escapes/fixes this rather than refusing it — refusing ordinary prose is not acceptable',
      )
      assert.deepEqual(
        markdownToAdf(adfToMarkdown(doc)), doc,
        `content was rewritten. markdown was: ${JSON.stringify(adfToMarkdown(doc))}`,
      )
    })
  }

  for (const [name, doc] of Object.entries(F1_MUST_REFUSE)) {
    test(name, () => {
      assert.equal(adfHasUnrenderableContent(doc), true, 'the write gate must refuse this doc')
      assert.notDeepEqual(
        markdownToAdf(adfToMarkdown(doc)), doc,
        'this actually round-trips fine now — refusing it is a needless capability cost',
      )
    })
  }
})

// =============================================================================
// adfHasUnrenderableContent — D1 policy detection (LIN-1886 Step 1)
// =============================================================================

describe('adfHasUnrenderableContent', () => {
  test('false for a doc using only modeled nodes and modeled marks', () => {
    const doc = {
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'strong' }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(doc), false)
  })

  test('null/undefined/non-object doc → false', () => {
    assert.equal(adfHasUnrenderableContent(null), false)
    assert.equal(adfHasUnrenderableContent(undefined), false)
  })

  for (const nodeType of ['table', 'media', 'panel', 'taskList', 'status', 'date']) {
    test(`true for a doc containing a bare '${nodeType}' node`, () => {
      const doc = { type: 'doc', version: 1, content: [{ type: nodeType, content: [] }] }
      assert.equal(adfHasUnrenderableContent(doc), true)
    })
  }

  test('true when the unmodeled node is nested inside otherwise-modeled structure (proves recursion)', () => {
    const doc = {
      type: 'doc', version: 1, content: [
        { type: 'bulletList', content: [
          { type: 'listItem', content: [
            { type: 'blockquote', content: [
              { type: 'table', content: [] },
            ] },
          ] },
        ] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(doc), true)
  })

  test('true for a paragraph carrying an unmodeled MARK only (no unmodeled node anywhere) — proves mark-walking, not just node-type walking', () => {
    const underline = {
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(underline), true)

    const textColor = {
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textColor', attrs: { color: '#ff0000' } }] }] },
      ],
    }
    assert.equal(adfHasUnrenderableContent(textColor), true)
  })
})

// =============================================================================
// The invariant as a GENERATED property (LIN-1886 review F2)
// =============================================================================
//
// F2's finding: the docstring states the round-trip invariant as a general
// property, but the suite establishes it over ~21 hand-picked fixtures — "the
// same failure mode as Blocker 3's proximate cause: a test whose framing claimed
// coverage it did not have". Correcting only the docstring would have been the
// cheap discharge; this is the other one. The corpus below is deliberately
// adversarial (every character the codecs treat as markup, in every position
// that matters) and it is CROSSED with every structural slot those characters
// can occupy, so the claim is checked over hundreds of documents rather than a
// list someone chose.
//
// Both directions are asserted, and the second is the one that keeps the gate
// honest: a refusal must be a refusal of something genuinely lossy. A rule that
// over-refuses shows up here as "refused, but actually round-trips", which is a
// capability cost masquerading as safety.

/** Payloads that collide with Markdown syntax in every way the codecs care about. */
const ADVERSARIAL_TEXTS = [
  'plain prose',
  'foo_bar_baz', 'a _b_ c', '_leading', 'trailing_',
  'a ** b ** c', '**bold-looking**', '*single*', 'a*b',
  'use `x` here', '`tick', 'a``b',
  'a ~~b~~ c', '~tilde',
  'see [1](2) below', '[unclosed(', 'a]b', '[a](b)(c)',
  'back\\slash', 'C:\\Users\\me', 'a \\* b', 'trailing\\',
  '# not a heading', '## also not', '#nospace',
  '> not a quote', '>nospace',
  '- not a list', '-nospace', '* not a list either',
  '1. not a list', '12. nor this', '1.nospace',
  '---', '----', '- - -',
  '```js', '```', '~~~',
  '| a | b |', '<html>&amp;', 'emoji 🙂 and — dashes',
  'mixed `code` and _em_ and [l](u) and **b**',
  // Code-span payloads (LIN-3564): they reach the code-mark slot, where text is
  // fenced rather than escaped.
  'dir\\', 'a\\\\b', 'a`b', '`x', 'x`', 'x`  ', 'a`b``', '`', '``', ' a ', ' ', '  ', ' `a` ',
  // Whitespace and newlines: these mostly drive the REFUSAL side of the
  // property (a `.trim()` or a block split destroys them), so they are here to
  // prove the refusals are earned rather than blanket.
  '', ' ', '  padded  ', ' leading', 'trailing ', '\ttab',
  'a\nb', 'a\n\nb', '\nleading newline', 'trailing newline\n',
  // BARE MARKERS (LIN-1886 re-review R2). The corpus above carries `'# not a
  // heading'` and `'#nospace'` but no marker ALONE, and that is exactly the gap
  // the escape asymmetry hid in: `escapeBlockLeader` wanted whitespace on the
  // same line, while `parseBlock`'s `\s+` is happy to consume the newline a
  // hardBreak rendered. A payload with nothing after the marker is the only
  // shape that tells those two rules apart. `-`/`>`/`1.` are here as the
  // controls — both sides require whitespace there, so they must stay safe.
  '#', '##', '###', '####', '#####', '######', '#######',
  '-', '>', '1.', '*', '+',
  // A blank-looking interior line that is not blank (R3.1). `markdownToAdf`
  // splits on `/\n{2,}/`, so this never splits a block and the content
  // survives — refusing it is a capability cost with no safety behind it.
  'a\n \nb', 'a\n\t\nb', ' \n \n ',
]

/** Hrefs exercising the paren-truncation bug and its neighbours. */
const ADVERSARIAL_HREFS = [
  'https://e.com', 'https://e.com/wiki/Foo_(bar)', 'https://e.com/a(b)c(d)',
  'https://e.com/a)b', 'https://e.com/a\\b', 'https://e.com/?q=a_b&r=*',
  '', 'not a url at all',
]

const p = t => adfDoc(adfPara(adfText(t)))

/** Every structural slot an adversarial payload can sit in. */
const SLOTS = {
  paragraph: t => p(t),
  'paragraph, second block': t => adfDoc(adfPara(adfText('first')), adfPara(adfText(t))),
  'paragraph with a hardBreak': t => adfDoc(adfPara(adfText(t), HARD_BREAK, adfText(t))),
  'paragraph, mid-run': t => adfDoc(adfPara(adfText('before '), adfText(t), adfText(' after'))),
  heading: t => adfDoc({ type: 'heading', attrs: { level: 2 }, content: [adfText(t)] }),
  'bullet item': t => adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText(t)))] }),
  'ordered item': t => adfDoc({ type: 'orderedList', content: [adfItem(adfPara(adfText(t)))] }),
  'two bullet items': t => adfDoc({ type: 'bulletList', content: [adfItem(adfPara(adfText(t))), adfItem(adfPara(adfText('plain')))] }),
  blockquote: t => adfDoc({ type: 'blockquote', content: [adfPara(adfText(t))] }),
  codeBlock: t => adfDoc({ type: 'codeBlock', content: [adfText(t)] }),
  'codeBlock with a language': t => adfDoc({ type: 'codeBlock', attrs: { language: 'js' }, content: [adfText(t)] }),
  'strong mark': t => adfDoc(adfPara(adfText(t, [{ type: 'strong' }]))),
  'em mark': t => adfDoc(adfPara(adfText(t, [{ type: 'em' }]))),
  'code mark': t => adfDoc(adfPara(adfText(t, [{ type: 'code' }]))),
  'strike mark': t => adfDoc(adfPara(adfText(t, [{ type: 'strike' }]))),
  'link text': t => adfDoc(adfPara(adfText(t, [{ type: 'link', attrs: { href: 'https://e.com' } }]))),
  // ASYMMETRIC multi-line slots (LIN-1886 re-review R2). The `'paragraph with a
  // hardBreak'` slot above puts the SAME payload on both sides of the break, so
  // "marker alone before, ordinary content after" — the shape that promotes a
  // whole paragraph to a heading and deletes the marker line — was unreachable
  // by construction. Both orders, because only the leading position is a block
  // leader and the trailing one is the control that proves it.
  'paragraph, payload before a hardBreak': t => adfDoc(adfPara(adfText(t), HARD_BREAK, adfText('1  Scope of works'))),
  'paragraph, payload after a hardBreak': t => adfDoc(adfPara(adfText('1  Scope of works'), HARD_BREAK, adfText(t))),
  'paragraph, payload across three lines': t => adfDoc(adfPara(adfText(t), HARD_BREAK, adfText('middle'), HARD_BREAK, adfText('tail'))),
}

// LIN-2019: the ONE corpus cell the empty-paragraph relaxation (exception 4)
// actually produces — 'paragraph, second block' builds `doc(para('first'),
// para(t))`, and `t === ''` is exactly the newly-permitted TRAILING
// empty-paragraph shape. Permitted ⟹ deep-equal no longer holds for this cell,
// same discipline as WRITER_PERMITTED_LOSSY_ADF's exceptions: assert
// render-identity and the notDeepEqual gap explicitly rather than either
// silently swallowing it in the generic branch or deleting `''` from
// `ADVERSARIAL_TEXTS` and shrinking the corpus. Every OTHER permitted cell in
// the matrix keeps the strict deep-equal assertion below, so a NEW
// unaccounted-for permission anywhere else still fails loud.
const GENERATED_CORPUS_EXCEPTIONS = new Set([
  'paragraph, second block::',
])

describe('ADF → markdown → ADF, as a generated property over an adversarial corpus', () => {
  for (const [slot, build] of Object.entries(SLOTS)) {
    test(`every adversarial payload holds the invariant in: ${slot}`, () => {
      for (const text of ADVERSARIAL_TEXTS) {
        const doc = build(text)
        const md = adfToMarkdown(doc)
        const rebuilt = markdownToAdf(md)
        const isKnownException = GENERATED_CORPUS_EXCEPTIONS.has(`${slot}::${text}`)
        if (adfHasUnrenderableContent(doc)) {
          assert.notDeepEqual(
            rebuilt, doc,
            `over-refusal: ${slot} / ${JSON.stringify(text)} round-trips fine but the gate refuses it`,
          )
        } else if (isKnownException) {
          assert.equal(
            adfToMarkdown(rebuilt), md,
            `LIN-2019 exception 4 must not change what a reader sees: ${slot} / ${JSON.stringify(text)}`,
          )
          assert.notDeepEqual(
            rebuilt, doc,
            `GOOD NEWS, NOT A FAILURE: ${slot} / ${JSON.stringify(text)} now deep-equals — the gap has closed. `
            + 'Remove this cell from GENERATED_CORPUS_EXCEPTIONS.',
          )
        } else {
          assert.deepEqual(
            rebuilt, doc,
            `INVARIANT BROKEN: ${slot} / ${JSON.stringify(text)}\nmarkdown was: ${JSON.stringify(md)}`,
          )
        }
      }
    })
  }

  test('every adversarial href holds the invariant', () => {
    for (const href of ADVERSARIAL_HREFS) {
      for (const text of ['link text', 'a]b', 'a_b']) {
        const doc = adfDoc(adfPara(adfText(text, [{ type: 'link', attrs: { href } }])))
        const rebuilt = markdownToAdf(adfToMarkdown(doc))
        if (adfHasUnrenderableContent(doc)) {
          assert.notDeepEqual(rebuilt, doc, `over-refusal: href ${JSON.stringify(href)}`)
        } else {
          assert.deepEqual(
            rebuilt, doc,
            `INVARIANT BROKEN: href ${JSON.stringify(href)} / text ${JSON.stringify(text)}\nmarkdown was: ${JSON.stringify(adfToMarkdown(doc))}`,
          )
        }
      }
    }
  })

  // Whole documents, not one payload in isolation: block ADJACENCY is its own
  // hazard (a paragraph promoted to a rule changes how the NEXT block parses).
  test('adversarial payloads hold the invariant when stacked into one document', () => {
    for (let i = 0; i < ADVERSARIAL_TEXTS.length; i += 1) {
      const doc = adfDoc(
        { type: 'heading', attrs: { level: 1 }, content: [adfText(ADVERSARIAL_TEXTS[i])] },
        adfPara(adfText(ADVERSARIAL_TEXTS[(i + 1) % ADVERSARIAL_TEXTS.length])),
        { type: 'bulletList', content: [adfItem(adfPara(adfText(ADVERSARIAL_TEXTS[(i + 2) % ADVERSARIAL_TEXTS.length])))] },
        adfPara(adfText(ADVERSARIAL_TEXTS[(i + 3) % ADVERSARIAL_TEXTS.length])),
        { type: 'rule' },
        { type: 'blockquote', content: [adfPara(adfText(ADVERSARIAL_TEXTS[(i + 4) % ADVERSARIAL_TEXTS.length]))] },
      )
      const rebuilt = markdownToAdf(adfToMarkdown(doc))
      if (adfHasUnrenderableContent(doc)) {
        assert.notDeepEqual(rebuilt, doc, `over-refusal on stacked document ${i}`)
      } else {
        assert.deepEqual(
          rebuilt, doc,
          `INVARIANT BROKEN on stacked document ${i}\nmarkdown was: ${JSON.stringify(adfToMarkdown(doc))}`,
        )
      }
    }
  })
})

// LIN-3557: the writer must never emit a document its own gate refuses. A rule
// or a closing fence followed by trailing whitespace or a CR (CRLF text) is
// still a rule / a fence, not a paragraph the gate then blocks with a 422.
describe('markdownToAdf: rule and closing fence tolerate trailing whitespace (LIN-3557)', () => {
  for (const md of ['a\n\n---  ', 'a\n\n---\r', 'x\n\n---\r\n']) {
    test(`rule with trailing whitespace ${JSON.stringify(md)}`, () => {
      const doc = markdownToAdf(md)
      assert.deepEqual(doc.content.map(n => n.type), ['paragraph', 'rule'])
      assert.equal(adfHasUnrenderableContent(doc), false)
    })
  }

  for (const md of ['```\nx\n```\r', '```\nx\n``` ']) {
    test(`closing fence with trailing whitespace ${JSON.stringify(md)}`, () => {
      const doc = markdownToAdf(md)
      assert.deepEqual(doc.content, [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }])
      assert.equal(adfHasUnrenderableContent(doc), false)
    })
  }
})

// LIN-3557 review R1/R2: block forms the writer must match as loosely as the
// code it replaced, or the input falls through to a paragraph.
describe('markdownToAdf: unclosed fence and indented rule (LIN-3557 review)', () => {
  test('an unclosed fence stays a code block, body verbatim', () => {
    const md = 'Repro:\n\n```python\nclass A:\n    def __init__(self, *args, **kw):\n        pass\n\nA()\n```'
    const doc = markdownToAdf(md)
    assert.equal(doc.content[1].type, 'codeBlock')
    assert.deepEqual(doc.content[1].content, [
      { type: 'text', text: 'class A:\n    def __init__(self, *args, **kw):\n        pass' },
    ])
  })

  test('an unclosed fence without a language is a code block the gate permits', () => {
    const doc = markdownToAdf('```js\nconst a = 1')
    assert.deepEqual(doc.content, [
      { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const a = 1' }] },
    ])
    assert.equal(adfHasUnrenderableContent(doc), false)
  })

  test('a closed fence with no body is an empty code block, not a block holding the closing fence', () => {
    assert.deepEqual(markdownToAdf('```js\n```').content, [
      { type: 'codeBlock', attrs: { language: 'js' }, content: [] },
    ])
  })

  test('a lone fence line stays text', () => {
    assert.deepEqual(markdownToAdf('```').content.map(n => n.type), ['paragraph'])
  })

  for (const md of [' ---', '\t---', 'a\n\n ---']) {
    test(`rule with leading whitespace ${JSON.stringify(md)}`, () => {
      const doc = markdownToAdf(md)
      assert.equal(doc.content.at(-1).type, 'rule')
      assert.equal(adfHasUnrenderableContent(doc), false)
    })
  }

  test('a stored paragraph that looks like an indented rule round-trips', () => {
    // Not first: a leading space at the document's own edge is trimmed (and gated).
    const para = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const doc = { type: 'doc', version: 1, content: [para('a'), para(' ---')] }
    assert.equal(adfToMarkdown(doc), 'a\n\n \\---')
    assert.deepEqual(markdownToAdf(adfToMarkdown(doc)), doc)
  })
})

// =============================================================================
// What users see and what Jira stores (LIN-3561)
//
// Tests of the codec's user-visible outputs only: the Markdown Harbour shows
// (and what `marked`, the dashboard renderer, makes of it with default
// options), and the ADF Harbour writes to Jira. The gate's refuse/allow
// decision is pinned in WRITER_UNSAFE_ADF / WRITER_SAFE_ADF above.
// =============================================================================

describe('what a reader sees: adfToMarkdown, and what marked renders from it', () => {
  const link = (text, href) => adfText(text, [{ type: 'link', attrs: { href } }])
  const cases = [
    ['a link whose href contains brackets', adfDoc(adfPara(link('wiki', 'https://en.wikipedia.org/wiki/Foo_(bar)'))),
      '[wiki](https://en.wikipedia.org/wiki/Foo_\\(bar\\))', '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a></p>\n'],
    ['a plain link', adfDoc(adfPara(link('docs', 'https://e.com/docs'))), '[docs](https://e.com/docs)', '<p><a href="https://e.com/docs">docs</a></p>\n'],
    ['a "]" in link text', adfDoc(adfPara(link('a]b', 'http://x'))), '[a\\]b](http://x)', '<p><a href="http://x">a]b</a></p>\n'],
    ['each mark', adfDoc(adfPara(adfText('b', [{ type: 'strong' }]), adfText(' '), adfText('i', [{ type: 'em' }]), adfText(' '), adfText('c', [{ type: 'code' }]), adfText(' '), adfText('s', [{ type: 'strike' }]))),
      '**b** _i_ `c` ~~s~~', '<p><strong>b</strong> <em>i</em> <code>c</code> <del>s</del></p>\n'],
    ['prose with underscores', p('call foo_bar_baz now'), 'call foo\\_bar\\_baz now', '<p>call foo_bar_baz now</p>\n'],
    ['prose with asterisks', p('a **b** c'), 'a \\*\\*b\\*\\* c', '<p>a **b** c</p>\n'],
    ['prose that looks like a link', p('see [1](2) below'), 'see \\[1\\](2) below', '<p>see [1](2) below</p>\n'],
    ['prose that looks like a heading', p('# not a heading'), '\\# not a heading', '<p># not a heading</p>\n'],
    ['prose that looks like a numbered list', p('1. not a list'), '1\\. not a list', '<p>1. not a list</p>\n'],
  ]
  for (const [name, doc, md, html] of cases) {
    test(name, () => {
      assert.equal(adfToMarkdown(doc), md)
      assert.equal(marked.parse(md), html)
    })
  }
})

describe('adfToMarkdown: what a reader sees for each node', () => {
  const cases = [
    ['an emoji with only a shortName shows the shortName', adfDoc(adfPara({ type: 'emoji', attrs: { shortName: ':party:' } })), ':party:'],
    ['a level-6 heading', adfDoc({ type: 'heading', attrs: { level: 6 }, content: [adfText('Six')] }), '###### Six'],
    ['a heading above level 6 is shown at level 6', adfDoc({ type: 'heading', attrs: { level: 7 }, content: [adfText('Deep')] }), '###### Deep'],
    ['a negative heading level is shown at level 1', adfDoc({ type: 'heading', attrs: { level: -2 }, content: [adfText('Neg')] }), '# Neg'],
    ['a heading without a level is shown at level 1', adfDoc({ type: 'heading', content: [adfText('None')] }), '# None'],
    ['a code block split into runs shows them joined', adfDoc({ type: 'codeBlock', content: [adfText('const a = '), adfText('1')] }), '```\nconst a = 1\n```'],
    ['a code block drops its trailing newlines', adfDoc({ type: 'codeBlock', content: [adfText('a\n\n')] }), '```\na\n```'],
  ]
  for (const [name, doc, md] of cases) test(name, () => assert.equal(adfToMarkdown(doc), md))
})

describe('markdownToAdf: what a write stores in Jira', () => {
  const link = (t, href) => adfText(t, [{ type: 'link', attrs: { href } }])
  const cases = [
    ['an escaped bracket in an href is stored without the backslash', '[Foo](https://e.com/wiki/Foo_\\(bar\\))', [adfPara(link('Foo', 'https://e.com/wiki/Foo_(bar)'))]],
    ['a line with dashes and words is a paragraph, not a rule', '--- draft ---', [adfPara(adfText('--- draft ---'))]],
    ['a backslash keeps link syntax literal', 'see \\[1](2) below', [adfPara(adfText('see [1](2) below'))]],
    ['a tag in brackets right before a link', '[WIP][Fix the build](https://x)', [adfPara(adfText('[WIP]'), link('Fix the build', 'https://x'))]],
    ['brackets not followed by ( stay text', 'see [docs] (soon)', [adfPara(adfText('see [docs] (soon)'))]],
    ['text after a link keeps its first character', '[docs](https://x) and more', [adfPara(link('docs', 'https://x'), adfText(' and more'))]],
  ]
  for (const [name, md, content] of cases) test(name, () => assert.deepEqual(markdownToAdf(md), adfDoc(...content)))

  // No `{ timeout }`: node:test cannot interrupt a synchronous loop, so it
  // would claim a guard it does not provide. A hang here aborts the process,
  // which fails the file.
  test('an unclosed link stays text', () => {
    assert.deepEqual(markdownToAdf('see [draft](https://x'), adfDoc(adfPara(adfText('see [draft](https://x'))))
  })
})

// LIN-3564: a code span shows exactly its own text, and a typed one stores its
// content as CommonMark defines it.
describe('code spans: what a reader sees, and what a typed span stores', () => {
  const code = text => adfDoc(adfPara(adfText(text, [{ type: 'code' }])))
  const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const shown = [
    ['a backslash', 'C:\\dir', '`C:\\dir`'],
    ['a trailing backslash', 'dir\\', '`dir\\`'],
    ['a double backslash', 'a\\\\b', '`a\\\\b`'],
    ['a backtick inside', 'a`b', '``a`b``'],
    ['a leading backtick', '`x', '`` `x ``'],
    ['a trailing backtick then spaces', 'x`  ', '``x`  ``'],
    ['a backtick and a double backtick', 'a`b``', '``` a`b`` ```'],
    ['a lone backtick', '`', '`` ` ``'],
    ['spaces on both edges', ' a ', '`  a  `'],
    ['one space', ' ', '` `'],
    ['two spaces', '  ', '`  `'],
  ]
  for (const [name, text, md] of shown) {
    test(`code with ${name}`, () => {
      assert.equal(adfToMarkdown(code(text)), md)
      assert.equal(marked.parse(md), `<p><code>${escapeHtml(text)}</code></p>\n`)
      assert.deepEqual(markdownToAdf(md), code(text))
      assert.equal(adfHasUnrenderableContent(code(text)), false)
    })
  }

  const stored = [
    ['a double backslash is kept', '`a\\\\b`', [adfPara(adfText('a\\\\b', [{ type: 'code' }]))]],
    ['a trailing backslash does not escape the fence', '`dir\\`', [adfPara(adfText('dir\\', [{ type: 'code' }]))]],
    ['a double fence holds a backtick', '`` a`b ``', [adfPara(adfText('a`b', [{ type: 'code' }]))]],
    ['one padding space is stripped from each side', '` a `', [adfPara(adfText('a', [{ type: 'code' }]))]],
    ['a longer run inside does not close the span', '`a``b`', [adfPara(adfText('a``b', [{ type: 'code' }]))]],
    ['no run of the same length is left: plain text','``a`', [adfPara(adfText('``a`'))]],
    ['the opening run is the whole run, not its tail', '```a`b`', [adfPara(adfText('```a'), adfText('b', [{ type: 'code' }]))]],
    ['text after an unclosed run still parses', '``a `b`', [adfPara(adfText('``a '), adfText('b', [{ type: 'code' }]))]],
  ]
  for (const [name, md, content] of stored) test(`typed: ${name}`, () => assert.deepEqual(markdownToAdf(md), adfDoc(...content)))
})

// LIN-3565: pins for what the clean-room rebuild (experiment 2b) changed and
// its replay showed. Each row is one behaviour change or fixed regression.
describe('LIN-3565: what the rebuild changed, as users see it', () => {
  const para = (...runs) => adfDoc(adfPara(...runs))
  const link = { type: 'link', attrs: { href: 'http://a.b' } }

  // Fix: a code run carrying another mark showed the other mark's syntax as
  // literal code text, and dropped the link or emphasis.
  const codeWith = [
    ['strong', { type: 'strong' }, '**`x`**', '<p><strong><code>x</code></strong></p>\n'],
    ['em', { type: 'em' }, '_`x`_', '<p><em><code>x</code></em></p>\n'],
    ['strike', { type: 'strike' }, '~~`x`~~', '<p><del><code>x</code></del></p>\n'],
    ['a link', link, '[`x`](http://a.b)', '<p><a href="http://a.b"><code>x</code></a></p>\n'],
  ]
  for (const [name, mark, md, html] of codeWith) {
    test(`code with ${name} shows both`, () => {
      assert.equal(adfToMarkdown(para(adfText('x', [mark, { type: 'code' }]))), md)
      assert.equal(marked.parse(md), html)
    })
  }

  // Fix: text that begins with spaces and a block marker was written bare, so
  // the dashboard showed a list, quote or numbered list instead of the text.
  const looksLikeBlock = [
    ['a numbered list', ' 1. a', '1\\. a', '<p>1. a</p>\n'],
    ['a bullet', ' - a', '\\- a', '<p>- a</p>\n'],
    ['a quote', ' > a', '\\> a', '<p>&gt; a</p>\n'],
  ]
  for (const [name, text, md, html] of looksLikeBlock) {
    test(`indented text that looks like ${name} stays text`, () => {
      assert.equal(adfToMarkdown(para(adfText(text))), md)
      assert.equal(marked.parse(md), html)
    })
  }

  // Fix: block markers the dashboard renders as blocks are stored as blocks.
  const blocks = [
    ['a * bullet', '* item', [{ type: 'bulletList', content: [adfItem(adfPara(adfText('item')))] }]],
    ['an indented numbered item', ' 1. item', [{ type: 'orderedList', content: [adfItem(adfPara(adfText('item')))] }]],
    ['an indented fence', ' ```\ncode\n```', [{ type: 'codeBlock', content: [adfText('code')] }]],
  ]
  for (const [name, md, content] of blocks) test(`typed: ${name} is stored as its block`, () => assert.deepEqual(markdownToAdf(md), adfDoc(...content)))

  // Regression fixed: a line ending counts as a space in a code span, so a
  // whitespace-only run is not padded (padding made the dashboard show more
  // whitespace than the run holds).
  test('code of spaces and a newline is shown as it is', () => {
    const doc = para(adfText(' \n ', [{ type: 'code' }]))
    const md = adfToMarkdown(doc)
    assert.equal(md, '` \n `')
    assert.equal(marked.parse(md), '<p><code>   </code></p>\n')
  })

  // Regression fixed: a newline in a code block's language moves the rest of
  // it into the body on the way back, so the write must be refused.
  test('a code block language with a newline is refused', () => {
    const doc = adfDoc({ type: 'codeBlock', attrs: { language: 'x\ny' }, content: [adfText('body')] })
    assert.equal(adfHasUnrenderableContent(doc), true)
  })
})

// =============================================================================
// LIN-3570: nested lists and *single-asterisk* italics
// =============================================================================

describe('LIN-3570: nested lists and *italics*, as users see them', () => {
  const asBullets = (...heads) => nestedList('bulletList', ...heads)
  const item = (head, ...lists) => adfItem(adfPara(adfText(head)), ...lists)
  const list = (type, ...items) => ({ type, content: items })
  const bullets = (...items) => list('bulletList', ...items)
  const numbered = (...items) => list('orderedList', ...items)
  const em = text => adfText(text, [{ type: 'em' }])
  const strong = text => adfText(text, [{ type: 'strong' }])
  const tenItems = [...'abcdefghi'].map(c => item(c))
  const tenth = `${[...'abcdefghi'].map((c, i) => `${i + 1}. ${c}`).join('\n')}\n10. j\n    - k`

  // [name, typed Markdown, stored content, markdown after reading it back]
  const rows = [
    ['a two-level bullet list', '- a\n  - b\n- c', [bullets(item('a', asBullets('b')), item('c'))], '- a\n  - b\n- c'],
    ['a three-level mixed list', '- a\n  1. b\n     - c\n  2. d\n- e',
      [bullets(item('a', numbered(item('b', asBullets('c')), item('d'))), item('e'))], '- a\n  1. b\n     - c\n  2. d\n- e'],
    ['bullets under a numbered item', '1. a\n   - sub\n2. b', [numbered(item('a', asBullets('sub')), item('b'))], '1. a\n   - sub\n2. b'],
    ['* bullets nested', '* a\n  * b', [bullets(item('a', asBullets('b')))], '- a\n  - b'],
    ['a nested list under the tenth ordered item', tenth, [numbered(...tenItems, item('j', asBullets('k')))], tenth],
    ['a bullet list then a numbered one in one item', '- a\n  - b\n  1. c', [bullets(item('a', asBullets('b'), nestedList('orderedList', 'c')))], '- a\n  - b\n  1. c'],
    ['*italic* in prose', 'text with *star* em', [adfPara(adfText('text with '), em('star'), adfText(' em'))], 'text with _star_ em'],
    ['*italic* inside a list item', '- an *it* item', [bullets(adfItem(adfPara(adfText('an '), em('it'), adfText(' item'))))], '- an _it_ item'],
    ['*italic* next to **bold**', '*it* and **bold**', [adfPara(em('it'), adfText(' and '), strong('bold'))], '_it_ and **bold**'],
    ['punctuation is a word boundary', '(*x*) "*y*" see *z*.', [adfPara(adfText('('), em('x'), adfText(') "'), em('y'), adfText('" see '), em('z'), adfText('.'))], '(_x_) "_y_" see _z_.'],
    ['a literal 2 * 3 * 4 stays text', '2 * 3 * 4', [adfPara(adfText('2 * 3 * 4'))], '2 \\* 3 \\* 4'],
    ['*"quoted"* inside a word stays text', 'a*"b"*c', [adfPara(adfText('a*"b"*c'))], 'a\\*"b"\\*c'],
  ]
  for (const [name, typed, content, readBack] of rows) {
    test(name, () => {
      const stored = markdownToAdf(typed)
      assert.deepEqual(stored, adfDoc(...content), 'what is stored')
      assert.equal(adfHasUnrenderableContent(stored), false, 'the writer never emits what its gate refuses')
      assert.equal(adfToMarkdown(stored), readBack, 'what a reader is given')
      const shown = marked.parse(adfToMarkdown(stored))
      assert.equal(shown, marked.parse(typed), 'what is displayed equals marked of what was typed')
      assert.deepEqual(markdownToAdf(adfToMarkdown(stored)), stored, 'and a second save changes nothing')
      assert.equal(marked.parse(adfToMarkdown(markdownToAdf(readBack))), shown)
    })
  }

  test('nesting is displayed as nesting', () => {
    const html = marked.parse(adfToMarkdown(markdownToAdf('- a\n  - b\n- c')))
    assert.equal(html.replace(/\s+/g, ''), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')
  })

  // Accepted differences: stored and displayed as asserted; the display is NOT
  // compared with marked, and each row says why.
  const accepted = [
    ['**bold *it* x**: strong runs do not nest, and an inner * voids them', '**bold *it* x**',
      [adfPara(adfText('**bold '), em('it'), adfText(' x**'))], '<p>**bold <em>it</em> x**</p>\n'],
    ['2*3*4 stays text: the reader writes _…_, which marked never shows inside a word', '2*3*4', [adfPara(adfText('2*3*4'))], '<p>2*3*4</p>\n'],
    ['a*b*c stays text', 'a*b*c', [adfPara(adfText('a*b*c'))], '<p>a*b*c</p>\n'],
    ['foo*bar* baz stays text', 'foo*bar* baz', [adfPara(adfText('foo*bar* baz'))], '<p>foo*bar* baz</p>\n'],
    ['an inner link keeps its link', '*see [docs](http://u)*',
      [adfPara(adfText('*see '), adfText('docs', [{ type: 'link', attrs: { href: 'http://u' } }]), adfText('*'))],
      '<p>*see <a href="http://u">docs</a>*</p>\n'],
    ['an inner code span keeps its code', '*run `npm test` now*',
      [adfPara(adfText('*run '), adfText('npm test', [{ type: 'code' }]), adfText(' now*'))], '<p>*run <code>npm test</code> now*</p>\n'],
    ['an inner strike keeps its strike', '*a ~~b~~ c*',
      [adfPara(adfText('*a '), adfText('b', [{ type: 'strike' }]), adfText(' c*'))], '<p>*a <del>b</del> c*</p>\n'],
    ['an inner _em_ keeps its em', '*a _b_ c*', [adfPara(adfText('*a '), em('b'), adfText(' c*'))], '<p>*a <em>b</em> c*</p>\n'],
    ['*use snake_case here* stays text (marked shows em)', '*use snake_case here*', [adfPara(adfText('*use snake_case here*'))], '<p>*use snake_case here*</p>\n'],
    ['*a [b c* stays text (marked shows em)', '*a [b c*', [adfPara(adfText('*a [b c*'))], '<p>*a [b c*</p>\n'],
    ['*a**b* is two runs; the reader joins them as _a__b_', '*a**b*', [adfPara(em('a'), em('b'))], '<p><em>a__b</em></p>\n'],
    ['an emoji beside the run is half a surrogate pair: stays text', '😀*x*', [adfPara(adfText('😀*x*'))], '<p>😀*x*</p>\n'],
    ['a combining mark after the run: stays text', '*x*́ z', [adfPara(adfText('*x*́ z'))], '<p>*x*́ z</p>\n'],
    ['a format character before the run: stays text', 'a‍*"x"* y', [adfPara(adfText('a‍*"x"* y'))], '<p>a‍*&quot;x&quot;* y</p>\n'],
    ['***x*** is today\'s result', '***x***', [adfPara(adfText('*'), strong('x'), adfText('*'))], '<p>*<strong>x</strong>*</p>\n'],
    ['a * list that is not flanked', '* *', [bullets(adfItem(adfPara(adfText('*'))))], null],
  ]
  for (const [name, typed, content, html] of accepted) {
    test(`accepted difference: ${name}`, () => {
      const stored = markdownToAdf(typed)
      assert.deepEqual(stored, adfDoc(...content))
      assert.equal(adfHasUnrenderableContent(stored), false)
      assert.deepEqual(markdownToAdf(adfToMarkdown(stored)), stored)
      if (html !== null) assert.equal(marked.parse(adfToMarkdown(stored)), html)
    })
  }

  // Unusual indentation is not chased. Stored and gate-clean is the claim.
  const indentation = [
    ['text continuing an item keeps today\'s paragraph', '- a\n  continued', 'paragraph'],
    ['a bullet then a numbered line keeps today\'s paragraph', '- a\n1. b', 'paragraph'],
    ['a marker indented less than a wide parent is a sibling, so two lists: a paragraph', '10. a\n  - b', 'paragraph'],
    ['mixed - and * markers form one list (marked splits them)', '- a\n* b', 'bulletList'],
    ['a one-space indent is a sibling (flat)', '- a\n - b', 'bulletList'],
  ]
  for (const [name, typed, type] of indentation) {
    test(`unusual indentation: ${name}`, () => {
      const stored = markdownToAdf(typed)
      assert.equal(stored.content.length, 1)
      assert.equal(stored.content[0].type, type)
      assert.equal(adfHasUnrenderableContent(stored), false)
      assert.deepEqual(markdownToAdf(adfToMarkdown(stored)), stored)
    })
  }

  test('extra spaces after a marker move the content column, up to four', () => {
    const wide = markdownToAdf('-   a\n    - b')
    assert.deepEqual(wide, adfDoc(bullets(item('a', asBullets('b')))))
    const tooWide = markdownToAdf('-      a\n       - b')
    assert.equal(tooWide.content[0].content.length, 1, 'six spaces: still one item, the child is at column 6 of 6 caps at 5')
  })

  test('a 100-level staircase neither throws nor changes on a round trip', () => {
    const typed = Array.from({ length: 100 }, (_, depth) => `${'  '.repeat(depth)}- level ${depth}`).join('\n')
    const stored = markdownToAdf(typed)
    assert.equal(adfHasUnrenderableContent(stored), false)
    assert.deepEqual(markdownToAdf(adfToMarkdown(stored)), stored)
    assert.equal(adfToMarkdown(stored), typed)
  })
})

describe('LIN-3570: the reader shows a nested list indented, and everything in an item', () => {
  const item = (...children) => adfItem(...children)
  const para = text => adfPara(adfText(text))
  const cases = [
    ['a nested list is indented by the marker width',
      adfDoc({ type: 'bulletList', content: [item(para('a'), nestedList('bulletList', 'b'))] }), '- a\n  - b'],
    ['a list under a numbered item is indented by three',
      adfDoc({ type: 'orderedList', content: [item(para('a'), nestedList('bulletList', 'b'))] }), '1. a\n   - b'],
    ['an empty nested item keeps its trailing space',
      adfDoc({ type: 'bulletList', content: [item(para('a'), nestedList('bulletList', 'b', '')), item(para('c'))] }), '- a\n  - b\n  - \n- c'],
    ['an empty head keeps its trailing space',
      adfDoc({ type: 'bulletList', content: [item(para('a')), item(para(''), nestedList('bulletList', 'b'))] }), '- a\n- \n  - b'],
    ['text and code after a list still show, inside the item',
      adfDoc({ type: 'bulletList', content: [item(para('a'), nestedList('bulletList', 'b'), para('c'), { type: 'codeBlock', content: [adfText('code')] })] }),
      '- a\n  - b\n\n  c\n\n  ```\n  code\n  ```'],
    ['a list as the first child of an item',
      adfDoc({ type: 'bulletList', content: [item(nestedList('bulletList', 'b'))] }), '- \n  - b'],
    ['several non-list children before the list',
      adfDoc({ type: 'bulletList', content: [item(para('a'), para('b'), nestedList('bulletList', 'c'))] }), '- a\n\nb\n  - c'],
    ['an item with no list is as it always was',
      adfDoc({ type: 'bulletList', content: [item(para('a'), para('b'))] }), '- a\n\nb'],
  ]
  for (const [name, doc, md] of cases) test(name, () => assert.equal(adfToMarkdown(doc), md))

  test('everything an item holds after a list is displayed', () => {
    const doc = adfDoc({ type: 'bulletList', content: [item(para('a'), nestedList('bulletList', 'b'), para('cc'), { type: 'codeBlock', content: [adfText('dd')] })] })
    const html = marked.parse(adfToMarkdown(doc))
    for (const text of ['a', 'b', 'cc', 'dd']) assert.match(html, new RegExp(`>${text}<|${text}`), text)
    assert.match(html, /<li>[\s\S]*cc[\s\S]*<\/li>/, 'the paragraph is inside the item')
  })

  test('no blank line is emitted inside an item holding only a paragraph and lists', () => {
    const doc = adfDoc({ type: 'bulletList', content: [item(para('a'), nestedList('bulletList', 'b'), nestedList('orderedList', 'c'))] })
    assert.doesNotMatch(adfToMarkdown(doc), /\n\n/)
  })

  test('a nested list whose first item is empty is refused, though the writer rebuilds it', () => {
    const doc = adfDoc({ type: 'bulletList', content: [item(para('a'), nestedList('bulletList', '', 'b'))] })
    assert.equal(marked.parse(adfToMarkdown(doc)).includes('<h2>'), true, 'marked shows a heading')
    assert.deepEqual(markdownToAdf(adfToMarkdown(doc)), doc, 'so the round trip itself would hold')
    assert.equal(adfHasUnrenderableContent(doc), true)
  })

  test('an empty head over a nested list is permitted when the item is not first', () => {
    const doc = adfDoc({ type: 'bulletList', content: [item(para('a')), item(para(''), nestedList('bulletList', 'b'))] })
    assert.equal(adfHasUnrenderableContent(doc), false)
    assert.match(marked.parse(adfToMarkdown(doc)).replace(/\s+/g, ''), /<ul><li>a<\/li><li><ul><li>b<\/li><\/ul><\/li><\/ul>/)
  })

  test('an empty first item over a nested list is the existing "- " quirk: stored, not compared with marked', () => {
    const typed = '- \n  - b'
    const stored = markdownToAdf(typed)
    assert.deepEqual(stored, adfDoc({ type: 'bulletList', content: [item(para(''), nestedList('bulletList', 'b'))] }))
    assert.equal(adfHasUnrenderableContent(stored), false)
    assert.equal(adfToMarkdown(stored), '- \n  - b')
  })
})

// A nested list's shape, in the exhaustive and seeded enumerations below.
// tree = { type, items: [{ head: 'x' | '', lists: [tree] }] }
const leaf = (type, ...heads) => ({ type, items: heads.map(head => ({ head, lists: [] })) })
const treeToAdf = tree => ({
  type: tree.type,
  content: tree.items.map(({ head, lists }) => adfItem(adfPara(adfText(head)), ...lists.map(treeToAdf))),
})
const treeSignature = tree => `<${tree.type === 'bulletList' ? 'ul' : 'ol'}>${tree.items
  .map(({ head, lists }) => `<li>${head}${lists.map(treeSignature).join('')}</li>`).join('')}</${tree.type === 'bulletList' ? 'ul' : 'ol'}>`
const htmlSignature = html => html.replace(/<\/?p>|\s+/g, '')
const KINDS = ['bulletList', 'orderedList']
const listsOf = (itemsFor, maxItems) => KINDS.flatMap(type => {
  const choices = itemsFor()
  const out = []
  for (const first of choices) {
    out.push({ type, items: [first] })
    if (maxItems > 1) for (const second of choices) out.push({ type, items: [first, second] })
  }
  return out
})
const itemsWith = (heads, listChoices) => () => heads.flatMap(head => listChoices.map(lists => ({ head, lists })))
const pairsOf = choices => [[]].concat(choices.map(c => [c]), choices.flatMap(a => choices.map(b => [a, b])))
const tailPara = adfPara(adfText('tail'))

/** "any nested list whose first item has an empty head" (the gate's display rule) */
const hasEmptyFirstNestedItem = (tree, nested = false) => (nested && tree.items[0].head === '')
  || tree.items.some(({ lists }) => lists.some(child => hasEmptyFirstNestedItem(child, true)))

function checkTree(tree, withTail, tally) {
  if (tree.items[0].head === '') { tally.skipped += 1; return }
  const doc = adfDoc(treeToAdf(tree), ...(withTail ? [tailPara] : []))
  const md = adfToMarkdown(doc)
  const rebuilt = markdownToAdf(md)
  const roundTrips = JSON.stringify(rebuilt) === JSON.stringify(doc)
  const shownRight = htmlSignature(marked.parse(md)) === treeSignature(tree) + (withTail ? 'tail' : '')
  if (!adfHasUnrenderableContent(doc)) {
    tally.permitted += 1
    if (!roundTrips) assert.fail(`permitted but does not round-trip: ${JSON.stringify(md)}`)
    if (adfHasUnrenderableContent(rebuilt)) assert.fail(`the writer emitted what its gate refuses: ${JSON.stringify(md)}`)
    if (!shownRight) assert.fail(`permitted but displayed wrong: ${JSON.stringify(md)}`)
  } else {
    tally.refused += 1
    if (roundTrips && shownRight) {
      // Over-refusal: only the display rule may do it, and the count is pinned.
      assert.ok(hasEmptyFirstNestedItem(tree), `refused but round-trips and displays right: ${JSON.stringify(md)}`)
      tally.residue += 1
    }
  }
}

describe('LIN-3570: nested shapes, permitted ⇒ round-trips and displays nested; refused ⇒ earns it', () => {
  test('every tree to depth 2 (two items per list, items hold 0-2 child lists)', () => {
    const leaves = listsOf(itemsWith(['x', ''], [[]]), 2)
    const itemChoices = itemsWith(['x', ''], pairsOf(leaves))()
    const tally = { permitted: 0, refused: 0, residue: 0, trees: 0, skipped: 0 }
    for (const type of KINDS) {
      const trees = [...itemChoices.map(first => [first]), ...itemChoices.flatMap(first => itemChoices.map(second => [first, second]))]
      for (const items of trees) {
        tally.trees += 1
        checkTree({ type, items }, false, tally)
        checkTree({ type, items }, true, tally)
      }
    }
    assert.equal(tally.trees, 197820, 'the enumeration did not silently shrink')
    assert.equal(tally.permitted + tally.refused + tally.skipped, 2 * tally.trees, 'every tree was checked')
    // The pins come from the first run: a tree skipped because the document
    // starts with an empty item (the existing `- \n- x` quirk), the rest
    // permitted or refused, and the refused ones that still round-trip and
    // display right (the display rule's deliberate residue).
    assert.deepEqual(tally, { permitted: 4234, refused: 193586, residue: 764, trees: 197820, skipped: 197820 })
  })
})

describe('LIN-3570: deeper nested shapes (restricted depth 3, a seeded sample to depth 4)', () => {
  test('depth 3, restricted: lists of at most two items, one child list each, a one-item innermost list', () => {
    const innermost = KINDS.flatMap(type => ['x', ''].map(head => leaf(type, head)))
    const middle = KINDS.flatMap(type => {
      const items = ['x', ''].flatMap(head => [[], ...innermost.map(inner => [inner])].map(lists => ({ head, lists })))
      return [...items.map(first => ({ type, items: [first] })), ...items.flatMap(first => items.map(second => ({ type, items: [first, second] })))]
    })
    const tops = KINDS.flatMap(type => {
      const items = ['x', ''].flatMap(head => [[], ...middle.map(child => [child])].map(lists => ({ head, lists })))
      const leaves = ['x', ''].map(head => ({ head, lists: [] }))
      return [...items.map(first => ({ type, items: [first] })), ...items.flatMap(first => leaves.map(second => ({ type, items: [first, second] })))]
    })
    const tally = { permitted: 0, refused: 0, residue: 0, skipped: 0 }
    for (const tree of tops) {
      checkTree(tree, false, tally)
      checkTree(tree, true, tally)
    }
    assert.equal(tops.length, 2652, 'the enumeration did not silently shrink')
    assert.ok(tally.permitted > 0 && tally.refused > 0)
  })

  test('2,000 seeded trees to depth 4, any shape', () => {
    let seed = 3570
    const random = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const make = depth => ({
      type: KINDS[random(2)],
      items: Array.from({ length: 1 + random(3) }, () => ({
        head: random(5) === 0 ? '' : 'x',
        lists: depth < 4 ? Array.from({ length: random(3) === 0 ? 1 + random(2) : 0 }, () => make(depth + 1)) : [],
      })),
    })
    const tally = { permitted: 0, refused: 0, residue: 0, skipped: 0 }
    for (let i = 0; i < 2000; i += 1) checkTree(make(1), i % 2 === 0, tally)
    assert.ok(tally.permitted > 100, `a sample that permits nothing proves nothing: ${JSON.stringify(tally)}`)
  })

  // Each adversarial payload at the review's six positions, one at a time.
  test('adversarial payloads hold the invariant at six nested positions', () => {
    const item = (t, ...lists) => adfItem(adfPara(adfText(t)), ...lists)
    const positions = {
      'head of an item with a child': t => adfDoc({ type: 'bulletList', content: [item(t, nestedList('bulletList', 'b'))] }),
      'first of a nested list': t => adfDoc({ type: 'bulletList', content: [item('a', nestedList('bulletList', t, 'b', 'c'))] }),
      'middle of a nested list': t => adfDoc({ type: 'bulletList', content: [item('a', nestedList('bulletList', 'b', t, 'c'))] }),
      'last of a nested list': t => adfDoc({ type: 'bulletList', content: [item('a', nestedList('bulletList', 'b', 'c', t))] }),
      'last nested item before an outer sibling': t => adfDoc({ type: 'bulletList', content: [item('a', nestedList('bulletList', 'b', t)), item('z')] }),
      'depth-2 item before a depth-1 sibling': t => adfDoc({
        type: 'orderedList',
        content: [item('a', { type: 'bulletList', content: [item('b', nestedList('bulletList', 'q', t)), item('c')] }), item('z')],
      }),
    }
    for (const [name, build] of Object.entries(positions)) {
      for (const text of ADVERSARIAL_TEXTS) {
        // An empty first nested item is refused for how `marked` shows it, though
        // the writer rebuilds it (see the display-rule test above).
        if (text === '' && name === 'first of a nested list') continue
        const doc = build(text)
        const rebuilt = markdownToAdf(adfToMarkdown(doc))
        if (adfHasUnrenderableContent(doc)) assert.notDeepEqual(rebuilt, doc, `over-refusal: ${name} / ${JSON.stringify(text)}`)
        else assert.deepEqual(rebuilt, doc, `INVARIANT BROKEN: ${name} / ${JSON.stringify(text)}\n${JSON.stringify(adfToMarkdown(doc))}`)
      }
    }
  })
})

// The `*` property (plan-review `38766a08`): whatever a typed `*` run stores,
// the gate permits it, it survives the reader's `_…_`, and `marked` shows the
// em runs that were stored. The alphabet carries each character class of
// `marked`'s word-boundary rule: a combining mark, a format character, a
// control character, a private-use one, an astral emoji, and a backslash.
describe('LIN-3570: a typed *run* is only stored as emphasis when it can be shown', () => {
  const ALPHABET = ['*', '*', 'a', 'b', '1', 'é', '😀', ' ', ' ', '"', '(', ')', '[', ']', '.', '~', '$', '-', '`',
    '́', '‍', '️', '­', '\u0007', '', '\\']
  const countEm = nodes => nodes.filter(node => node.marks?.some(mark => mark.type === 'em')).length
  const adjacentEm = nodes => nodes.some((node, i) => i > 0 && [node, nodes[i - 1]].every(n => n.marks?.some(mark => mark.type === 'em')))

  test('300,000 seeded strings: every stored em is permitted, survives the round trip, and is shown', () => {
    let seed = 20261016
    const random = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n }
    let withEm = 0
    for (let i = 0; i < 300000; i += 1) {
      const typed = Array.from({ length: 1 + random(12) }, () => ALPHABET[random(ALPHABET.length)]).join('')
      const stored = markdownToAdf(typed)
      const runs = stored.content[0]?.content ?? []
      if (stored.content.length !== 1 || stored.content[0].type !== 'paragraph' || !countEm(runs) || adjacentEm(runs)) continue
      withEm += 1
      assert.equal(adfHasUnrenderableContent(stored), false, `gate refused ${JSON.stringify(typed)}`)
      const md = adfToMarkdown(stored)
      assert.deepEqual(markdownToAdf(md), stored, `round trip changed ${JSON.stringify(typed)}`)
      const shown = (marked.parse(md).match(/<em>/g) ?? []).length
      assert.equal(shown, countEm(runs), `${JSON.stringify(typed)} stores ${countEm(runs)} em, shows ${shown}: ${JSON.stringify(md)}`)
    }
    assert.ok(withEm > 5000, `the property needs em runs to check: ${withEm}`)
  })
})
