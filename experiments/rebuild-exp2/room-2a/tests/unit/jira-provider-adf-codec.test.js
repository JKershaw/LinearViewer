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
  'nested bulletList': adfDoc({
    type: 'bulletList',
    content: [{
      type: 'listItem',
      content: [adfPara(adfText('parent')), { type: 'bulletList', content: [adfItem(adfPara(adfText('child')))] }],
    }],
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
  // Marks: INLINE_PATTERN is a single non-nesting scan, so two marks on one run
  // render as `_**x**_` and re-parse as ONE em run whose text is literally `**x**`.
  'text carrying strong + em': adfDoc(adfPara(adfText('x', [{ type: 'strong' }, { type: 'em' }]))),
  'text carrying link + strong': adfDoc(adfPara(adfText('x', [{ type: 'link', attrs: { href: 'https://e.com' } }, { type: 'strong' }]))),
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
  test('a nested bulletList carrying localId on the inner list still refuses', () => {
    const doc = adfDoc({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [adfPara(adfText('parent')), { type: 'bulletList', attrs: { localId: 'x' }, content: [adfItem(adfPara(adfText('child')))] }],
      }],
    })
    assert.equal(adfHasUnrenderableContent(doc), true, 'a nested list is unrebuildable regardless of attrs')
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
