# Mutation sweep — adf.js

- impl: `/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rebuild-exp1/arms/A/adf.js` (sha256 `daf87bb1d02f41f4…`)
- operator set: `adf-kit-ops/1`; node v22.22.0; 4 parallel jobs; per-mutant timeout 10000 ms
- [jira-provider-adf-codec.test.js] one unmutated test run: 293 ms median (281/293/361 ms; 133 tests); full sweep 141.3 s wall
- [jira-provider-adf-codec.test.js + jira-provider.test.js] one unmutated test run: 377 ms median (363/377/397 ms; 268 tests); full sweep 201.4 s wall

kill rate = killed / (killed + survived + timeout); score = (killed + timeout) / (same). Invalid mutants are excluded from both.

| tests | mutants | killed | survived | timeout | invalid | kill rate | score |
|---|---|---|---|---|---|---|---|
| jira-provider-adf-codec.test.js | 613 | 509 | 81 | 23 | 0 (syntax 0, import 0) | 83.0% | 86.8% |
| jira-provider-adf-codec.test.js + jira-provider.test.js | 613 | 509 | 81 | 23 | 0 (syntax 0, import 0) | 83.0% | 86.8% |

## By operator

| operator | mutants | survived (1) | survived (2) |
|---|---|---|---|
| number-shift | 108 | 22 | 22 |
| string-fill | 35 | 15 | 15 |
| logical-swap | 59 | 10 | 10 |
| return-value | 63 | 9 | 9 |
| regex-anchor | 21 | 7 | 7 |
| boundary | 12 | 7 | 7 |
| string-empty | 113 | 5 | 5 |
| arith | 29 | 3 | 3 |
| bool-flip | 26 | 2 | 2 |
| eq-flip | 48 | 1 | 1 |
| negate-cond | 67 | 0 | 0 |
| index-swap | 7 | 0 | 0 |
| not-remove | 17 | 0 | 0 |
| delete-call | 8 | 0 | 0 |

## Survivors by function / region (run 1)

| function / region | mutants | survived (1) | survived (2) |
|---|---|---|---|
| renderAdfNode | 76 | 14 | 14 |
| nodeIsUnrebuildable | 55 | 12 | 12 |
| matchInlineConstruct | 54 | 12 | 12 |
| parseBlock | 47 | 7 | 7 |
| textRunIsUnrebuildable | 36 | 6 | 6 |
| WRITER_EMITTED_ATTRS.codeBlock | 17 | 5 | 5 |
| isEscapeAt | 11 | 4 | 4 |
| markdownToAdf | 18 | 3 | 3 |
| WRITER_EMITTED_ATTRS.heading | 12 | 3 | 3 |
| escapeBlockLeader | 30 | 2 | 2 |
| scanForClose | 19 | 2 | 2 |
| <module:PAIRED_INLINE_MARKS> | 10 | 2 | 2 |
| renderCodeBlockText | 7 | 2 | 2 |
| isUnmarkedTextRun | 7 | 2 | 2 |
| SHAPE_RULES.paragraph | 6 | 2 | 2 |
| SHAPE_RULES.codeBlock | 17 | 1 | 1 |
| <module:WRITER_REBUILDABLE_NODE_TYPES> | 11 | 1 | 1 |
| SHAPE_RULES.heading | 7 | 1 | 1 |
| parseInline | 34 | 0 | 0 |
| adfHasUnrenderableContent | 18 | 0 | 0 |
| unescapeInline | 17 | 0 | 0 |
| WRITER_EMITTED_ATTRS.orderedList | 17 | 0 | 0 |
| withoutLocalId | 10 | 0 | 0 |
| parseParagraphContent | 9 | 0 | 0 |
| adfToMarkdown | 7 | 0 | 0 |
| isSingleParagraph | 7 | 0 | 0 |
| SHAPE_RULES.listItem | 7 | 0 | 0 |
| renderTextNode | 6 | 0 | 0 |
| parseList | 5 | 0 | 0 |
| containsHardBreak | 5 | 0 | 0 |
| MARK_RENDERERS.link | 4 | 0 | 0 |
| attrsAreUnrebuildable | 3 | 0 | 0 |
| escaper | 2 | 0 | 0 |
| MARK_RENDERERS.strong | 2 | 0 | 0 |
| MARK_RENDERERS.em | 2 | 0 | 0 |
| MARK_RENDERERS.code | 2 | 0 | 0 |
| MARK_RENDERERS.strike | 2 | 0 | 0 |
| renderMarks | 2 | 0 | 0 |
| renderAdfNodes | 2 | 0 | 0 |
| hasEdgeNewline | 2 | 0 | 0 |
| SHAPE_RULES.blockquote | 2 | 0 | 0 |
| unescapeCode | 1 | 0 | 0 |
| unescapeHref | 1 | 0 | 0 |
| <module:BULLET_MARKER> | 1 | 0 | 0 |
| <module:ORDERED_MARKER> | 1 | 0 | 0 |
| renderedParagraphText | 1 | 0 | 0 |
| hasEdgeWhitespace | 1 | 0 | 0 |

### renderAdfNode — 14 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0064 | 103 | logical-swap | `\|\|` → `&&` | `if (!node \|\| typeof node !== 'object') return ''` | survived |
| M0067 | 103 | return-value | `''` → `undefined` | `if (!node \|\| typeof node !== 'object') return ''` | survived |
| M0068 | 103 | string-fill | `''` → `'__MUTANT__'` | `if (!node \|\| typeof node !== 'object') return ''` | survived |
| M0077 | 110 | number-shift +1 | `1` → `2` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0078 | 110 | number-shift -1 | `1` → `0` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0080 | 110 | number-shift -1 | `1` → `0` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0081 | 110 | number-shift +1 | `6` → `7` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0082 | 110 | number-shift -1 | `6` → `5` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0107 | 119 | string-fill | `''` → `'__MUTANT__'` | `const code = renderCodeBlockText(node.content).replace(/\n+$/, '')` | survived |
| M0127 | 129 | string-empty | `'user'` → `''` | `return node.attrs?.text \|\| `@${node.attrs?.id \|\| 'user'}`` | survived |
| M0131 | 132 | string-fill | `''` → `'__MUTANT__'` | `return node.attrs?.url \|\| ''` | survived |
| M0134 | 134 | logical-swap | `\|\|` → `&&` | `return node.attrs?.text \|\| node.attrs?.shortName \|\| ''` | survived |
| M0135 | 134 | string-fill | `''` → `'__MUTANT__'` | `return node.attrs?.text \|\| node.attrs?.shortName \|\| ''` | survived |
| M0137 | 136 | string-fill | `''` → `'__MUTANT__'` | `return node.content ? renderAdfNodes(node.content) : ''` | survived |

### matchInlineConstruct — 12 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0207 | 222 | arith | `+` → `-` | `const textEnd = scanForClose(text, i + 1, ']', null)` | survived |
| M0209 | 222 | number-shift -1 | `1` → `0` | `const textEnd = scanForClose(text, i + 1, ']', null)` | survived |
| M0213 | 223 | number-shift +1 | `1` → `2` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0214 | 223 | number-shift -1 | `1` → `0` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0215 | 223 | logical-swap | `\|\|` → `&&` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0221 | 223 | return-value | `null` → `undefined` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0224 | 224 | number-shift -1 | `2` → `1` | `const hrefEnd = scanForClose(text, textEnd + 2, ')', null)` | survived |
| M0228 | 225 | number-shift +1 | `1` → `2` | `if (hrefEnd === -1) return null` | survived |
| M0229 | 225 | number-shift -1 | `1` → `0` | `if (hrefEnd === -1) return null` | survived |
| M0230 | 225 | return-value | `null` → `undefined` | `if (hrefEnd === -1) return null` | survived |
| M0233 | 227 | number-shift +1 | `1` → `2` | `end: hrefEnd + 1,` | survived |
| M0257 | 245 | return-value | `null` → `undefined` | `return null` | survived |

### nodeIsUnrebuildable — 12 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0541 | 533 | bool-flip | `false` → `true` | `function nodeIsUnrebuildable(node, newlineOk = false) {` | survived |
| M0544 | 534 | logical-swap | `\|\|` → `&&` | `if (!node \|\| typeof node !== 'object') return false` | survived |
| M0547 | 534 | return-value | `false` → `undefined` | `if (!node \|\| typeof node !== 'object') return false` | survived |
| M0548 | 534 | bool-flip | `false` → `true` | `if (!node \|\| typeof node !== 'object') return false` | survived |
| M0562 | 540 | return-value | `false` → `undefined` | `if (node.type === 'codeBlock') return false` | survived |
| M0574 | 545 | number-shift -1 | `0` → `(-1)` | `for (let i = 0; i < node.content.length; i += 1) {` | survived |
| M0576 | 545 | boundary | `<` → `<=` | `for (let i = 0; i < node.content.length; i += 1) {` | survived |
| M0584 | 547 | boundary | `>` → `>=` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0585 | 547 | number-shift +1 | `0` → `1` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0586 | 547 | number-shift -1 | `0` → `(-1)` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0588 | 547 | arith | `-` → `+` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0594 | 550 | return-value | `false` → `undefined` | `return false` | survived |

### parseBlock — 7 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0309 | 291 | regex-anchor drop $ | `/^(#{1,6})\s+([\s\S]*)$/` → `/^(#{1,6})\s+([\s\S]*)/` | `const headingMatch = block.match(/^(#{1,6})\s+([\s\S]*)$/)` | survived |
| M0316 | 296 | regex-anchor drop ^ | `/^```/` → `/```/` | `if (/^```/.test(block)) {` | survived |
| M0318 | 297 | regex-anchor drop ^ | `/^```([^\n]*)\n([\s\S]*?)\n?```$/` → `/```([^\n]*)\n([\s\S]*?)\n?```$/` | `const m = block.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/)` | survived |
| M0326 | 300 | regex-anchor drop ^ | `/^```[^\n]*\n?/` → `/```[^\n]*\n?/` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0327 | 300 | string-fill | `''` → `'__MUTANT__'` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0328 | 300 | regex-anchor drop $ | `/```$/` → `/```/` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0329 | 300 | string-fill | `''` → `'__MUTANT__'` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |

### textRunIsUnrebuildable — 6 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0500 | 502 | string-fill | `''` → `'__MUTANT__'` | `if (/\n/.test(node.text \|\| '') && !newlineOk) return true` | survived |
| M0507 | 503 | return-value | `false` → `undefined` | `if (!Array.isArray(node.marks)) return false` | survived |
| M0529 | 517 | eq-flip | `===` → `!==` | `const link = node.marks.find(m => m?.type === 'link')` | survived |
| M0530 | 517 | string-empty | `'link'` → `''` | `const link = node.marks.find(m => m?.type === 'link')` | survived |
| M0532 | 518 | logical-swap | `\|\|` → `&&` | `return Boolean(link && /\n/.test(link.attrs?.href \|\| ''))` | survived |
| M0533 | 518 | string-fill | `''` → `'__MUTANT__'` | `return Boolean(link && /\n/.test(link.attrs?.href \|\| ''))` | survived |

### WRITER_EMITTED_ATTRS.codeBlock — 5 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0419 | 405 | logical-swap | `&&` → `\|\|` | `return typeof lang === 'string' && lang !== '' && lang === lang.trim()` | survived |
| M0421 | 405 | string-fill | `''` → `'__MUTANT__'` | `return typeof lang === 'string' && lang !== '' && lang === lang.trim()` | survived |
| M0422 | 405 | logical-swap | `&&` → `\|\|` | `return typeof lang === 'string' && lang !== '' && lang === lang.trim()` | survived |
| M0424 | 406 | logical-swap | `&&` → `\|\|` | `&& !/\n/.test(lang) && Object.keys(node.attrs).length === 1` | survived |
| M0426 | 406 | logical-swap | `&&` → `\|\|` | `&& !/\n/.test(lang) && Object.keys(node.attrs).length === 1` | survived |

### isEscapeAt — 4 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0148 | 181 | arith | `+` → `-` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |
| M0150 | 181 | number-shift -1 | `1` → `0` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |
| M0151 | 181 | boundary | `<` → `<=` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |
| M0155 | 181 | number-shift -1 | `1` → `0` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |

### markdownToAdf — 3 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0365 | 344 | string-fill | `''` → `'__MUTANT__'` | `.map(b => b.replace(/^\n+\|\n+$/g, ''))` | survived |
| M0366 | 345 | boundary | `>` → `>=` | `.filter(b => b.length > 0)` | survived |
| M0368 | 345 | number-shift -1 | `0` → `(-1)` | `.filter(b => b.length > 0)` | survived |

### WRITER_EMITTED_ATTRS.heading — 3 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0387 | 380 | number-shift -1 | `1` → `0` | `return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.a…` | survived |
| M0389 | 380 | boundary | `<=` → `<` | `return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.a…` | survived |
| M0391 | 380 | number-shift -1 | `6` → `5` | `return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.a…` | survived |

### escapeBlockLeader — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0015 | 58 | regex-anchor drop ^ | `/^\s*-{3,}\s*$/` → `/\s*-{3,}\s*$/` | `if (/^\s*-{3,}\s*$/.test(line)) return line.replace('-', '\\-')` | survived |
| M0016 | 58 | regex-anchor drop $ | `/^\s*-{3,}\s*$/` → `/^\s*-{3,}\s*/` | `if (/^\s*-{3,}\s*$/.test(line)) return line.replace('-', '\\-')` | survived |

### renderCodeBlockText — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0058 | 95 | string-fill | `''` → `'__MUTANT__'` | `return (nodes \|\| []).map(n => (n?.type === 'text' ? (n.text \|\| '') : renderA…` | survived |
| M0059 | 95 | string-fill | `''` → `'__MUTANT__'` | `return (nodes \|\| []).map(n => (n?.type === 'text' ? (n.text \|\| '') : renderA…` | survived |

### scanForClose — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0176 | 203 | boundary | `<` → `<=` | `for (let i = from; i < text.length; i += 1) {` | survived |
| M0191 | 206 | number-shift -1 | `1` → `0` | `if (stopAt && text[i] === stopAt) return -1` | survived |

### <module:PAIRED_INLINE_MARKS> — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0196 | 213 | string-empty | `'*'` → `''` | `['**', 'strong', '*', unescapeInline],` | survived |
| M0201 | 215 | string-empty | `'~'` → `''` | `['~~', 'strike', '~', unescapeInline],` | survived |

### SHAPE_RULES.paragraph — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0468 | 471 | string-fill | `''` → `'__MUTANT__'` | `if (text === '') return false` | survived |
| M0469 | 471 | return-value | `false` → `undefined` | `if (text === '') return false` | survived |

### isUnmarkedTextRun — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0538 | 526 | boundary | `>` → `>=` | `const isUnmarkedTextRun = node => node?.type === 'text' && !(node.marks?.length …` | survived |
| M0540 | 526 | number-shift -1 | `0` → `(-1)` | `const isUnmarkedTextRun = node => node?.type === 'text' && !(node.marks?.length …` | survived |

### <module:WRITER_REBUILDABLE_NODE_TYPES> — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0373 | 366 | string-empty | `'doc'` → `''` | `'doc', 'text', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',` | survived |

### SHAPE_RULES.heading — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0463 | 462 | string-fill | `''` → `'__MUTANT__'` | `return text === '' \|\| hasEdgeWhitespace(text) \|\| BLOCK_SPLIT_PATTERN.test(te…` | survived |

### SHAPE_RULES.codeBlock — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0485 | 491 | logical-swap | `\|\|` → `&&` | `if (node.content?.length !== 1 \|\| node.content[0]?.type !== 'text') return tru…` | survived |

## Survivors of run 1 that run 2 kills: 0 of 81

Run 2 killed mutants with ≥1 failing test, per file: jira-provider-adf-codec.test.js 509; jira-provider.test.js 138. Killed ONLY by files not in run 1: 0.

Consistency: same candidate (mutant ids comparable); mutants killed in run 1 but surviving run 2: 0.

