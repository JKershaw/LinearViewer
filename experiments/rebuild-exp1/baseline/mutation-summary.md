# Mutation sweep — adf.js

- impl: `/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rebuild-exp1/tree/lib/providers/jira/adf.js` (sha256 `9f11eee01b869613…`)
- operator set: `adf-kit-ops/1`; node v22.22.0; 4 parallel jobs; per-mutant timeout 10000 ms
- [jira-provider-adf-codec.test.js] one unmutated test run: 411 ms median (330/411/418 ms; 133 tests); full sweep 152.9 s wall
- [jira-provider-adf-codec.test.js + jira-provider.test.js] one unmutated test run: 396 ms median (351/396/397 ms; 268 tests); full sweep 215.7 s wall

kill rate = killed / (killed + survived + timeout); score = (killed + timeout) / (same). Invalid mutants are excluded from both.

| tests | mutants | killed | survived | timeout | invalid | kill rate | score |
|---|---|---|---|---|---|---|---|
| jira-provider-adf-codec.test.js | 645 | 538 | 84 | 23 | 0 (syntax 0, import 0) | 83.4% | 87.0% |
| jira-provider-adf-codec.test.js + jira-provider.test.js | 645 | 538 | 84 | 23 | 0 (syntax 0, import 0) | 83.4% | 87.0% |

## By operator

| operator | mutants | survived (1) | survived (2) |
|---|---|---|---|
| number-shift | 110 | 22 | 22 |
| string-fill | 36 | 15 | 15 |
| return-value | 68 | 10 | 10 |
| logical-swap | 61 | 10 | 10 |
| regex-anchor | 25 | 9 | 9 |
| boundary | 12 | 7 | 7 |
| string-empty | 123 | 5 | 5 |
| arith | 29 | 3 | 3 |
| bool-flip | 27 | 2 | 2 |
| eq-flip | 52 | 1 | 1 |
| negate-cond | 70 | 0 | 0 |
| index-swap | 8 | 0 | 0 |
| not-remove | 16 | 0 | 0 |
| delete-call | 8 | 0 | 0 |

## Survivors by function / region (run 1)

| function / region | mutants | survived (1) | survived (2) |
|---|---|---|---|
| nodeHasUnrenderableContent | 86 | 18 | 18 |
| renderAdfNode | 76 | 14 | 14 |
| matchInlineConstruct | 54 | 12 | 12 |
| parseBlock | 64 | 9 | 9 |
| nodeShapeIsUnrebuildable | 72 | 5 | 5 |
| WRITER_EMITTED_ATTRS.codeBlock | 17 | 5 | 5 |
| isEscapeAt | 11 | 4 | 4 |
| markdownToAdf | 18 | 3 | 3 |
| WRITER_EMITTED_ATTRS.heading | 12 | 3 | 3 |
| escapeBlockLeader | 30 | 2 | 2 |
| scanForClose | 19 | 2 | 2 |
| <module:PAIRED_INLINE_MARKS> | 10 | 2 | 2 |
| renderCodeBlockText | 7 | 2 | 2 |
| isUnmarkedTextRun | 7 | 2 | 2 |
| <module:WRITER_REBUILDABLE_NODE_TYPES> | 11 | 1 | 1 |
| parseInline | 34 | 0 | 0 |
| adfHasUnrenderableContent | 18 | 0 | 0 |
| unescapeInline | 17 | 0 | 0 |
| WRITER_EMITTED_ATTRS.orderedList | 17 | 0 | 0 |
| parseParagraphContent | 9 | 0 | 0 |
| withoutPresentationNeutralAttrs | 9 | 0 | 0 |
| adfToMarkdown | 7 | 0 | 0 |
| renderTextNode | 6 | 0 | 0 |
| containsHardBreak | 5 | 0 | 0 |
| MARK_RENDERERS.link | 4 | 0 | 0 |
| attrsAreUnrebuildable | 3 | 0 | 0 |
| escapeInlineText | 2 | 0 | 0 |
| escapeCodeText | 2 | 0 | 0 |
| escapeHref | 2 | 0 | 0 |
| MARK_RENDERERS.strong | 2 | 0 | 0 |
| MARK_RENDERERS.em | 2 | 0 | 0 |
| MARK_RENDERERS.code | 2 | 0 | 0 |
| MARK_RENDERERS.strike | 2 | 0 | 0 |
| renderMarks | 2 | 0 | 0 |
| renderAdfNodes | 2 | 0 | 0 |
| unescapeCode | 1 | 0 | 0 |
| unescapeHref | 1 | 0 | 0 |
| <module:PRESENTATION_NEUTRAL_ATTRS> | 1 | 0 | 0 |
| renderedParagraphText | 1 | 0 | 0 |

### nodeHasUnrenderableContent — 18 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0537 | 629 | logical-swap | `\|\|` → `&&` | `if (!node \|\| typeof node !== 'object') return false` | survived |
| M0540 | 629 | return-value | `false` → `undefined` | `if (!node \|\| typeof node !== 'object') return false` | survived |
| M0541 | 629 | bool-flip | `false` → `true` | `if (!node \|\| typeof node !== 'object') return false` | survived |
| M0552 | 636 | return-value | `false` → `undefined` | `if (node.type === 'codeBlock') return false` | survived |
| M0559 | 644 | string-fill | `''` → `'__MUTANT__'` | `if (/\n/.test(node.text \|\| '') && !ctx.newlinesSurviveInText) return true` | survived |
| M0585 | 665 | eq-flip | `===` → `!==` | `const link = node.marks.find(m => m?.type === 'link')` | survived |
| M0586 | 665 | string-empty | `'link'` → `''` | `const link = node.marks.find(m => m?.type === 'link')` | survived |
| M0589 | 666 | logical-swap | `\|\|` → `&&` | `if (link && /\n/.test(link.attrs?.href \|\| '')) return true` | survived |
| M0590 | 666 | string-fill | `''` → `'__MUTANT__'` | `if (link && /\n/.test(link.attrs?.href \|\| '')) return true` | survived |
| M0591 | 666 | return-value | `true` → `undefined` | `if (link && /\n/.test(link.attrs?.href \|\| '')) return true` | survived |
| M0592 | 666 | bool-flip | `true` → `false` | `if (link && /\n/.test(link.attrs?.href \|\| '')) return true` | survived |
| M0599 | 671 | number-shift -1 | `0` → `(-1)` | `for (let i = 0; i < node.content.length; i += 1) {` | survived |
| M0601 | 671 | boundary | `<` → `<=` | `for (let i = 0; i < node.content.length; i += 1) {` | survived |
| M0609 | 678 | boundary | `>` → `>=` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0610 | 678 | number-shift +1 | `0` → `1` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0611 | 678 | number-shift -1 | `0` → `(-1)` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0613 | 678 | arith | `-` → `+` | `if (i > 0 && isUnmarkedTextRun(node.content[i - 1]) && isUnmarkedTextRun(node.co…` | survived |
| M0619 | 681 | return-value | `false` → `undefined` | `return false` | survived |

### renderAdfNode — 14 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0068 | 127 | logical-swap | `\|\|` → `&&` | `if (!node \|\| typeof node !== 'object') return ''` | survived |
| M0071 | 127 | return-value | `''` → `undefined` | `if (!node \|\| typeof node !== 'object') return ''` | survived |
| M0072 | 127 | string-fill | `''` → `'__MUTANT__'` | `if (!node \|\| typeof node !== 'object') return ''` | survived |
| M0081 | 134 | number-shift +1 | `1` → `2` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0082 | 134 | number-shift -1 | `1` → `0` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0084 | 134 | number-shift -1 | `1` → `0` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0085 | 134 | number-shift +1 | `6` → `7` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0086 | 134 | number-shift -1 | `6` → `5` | `const level = Math.min(Math.max(node.attrs?.level \|\| 1, 1), 6)` | survived |
| M0111 | 143 | string-fill | `''` → `'__MUTANT__'` | `const code = renderCodeBlockText(node.content).replace(/\n+$/, '')` | survived |
| M0131 | 153 | string-empty | `'user'` → `''` | `return node.attrs?.text \|\| `@${node.attrs?.id \|\| 'user'}`` | survived |
| M0135 | 156 | string-fill | `''` → `'__MUTANT__'` | `return node.attrs?.url \|\| ''` | survived |
| M0138 | 158 | logical-swap | `\|\|` → `&&` | `return node.attrs?.text \|\| node.attrs?.shortName \|\| ''` | survived |
| M0139 | 158 | string-fill | `''` → `'__MUTANT__'` | `return node.attrs?.text \|\| node.attrs?.shortName \|\| ''` | survived |
| M0141 | 160 | string-fill | `''` → `'__MUTANT__'` | `return node.content ? renderAdfNodes(node.content) : ''` | survived |

### matchInlineConstruct — 12 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0211 | 265 | arith | `+` → `-` | `const textEnd = scanForClose(text, i + 1, ']', null)` | survived |
| M0213 | 265 | number-shift -1 | `1` → `0` | `const textEnd = scanForClose(text, i + 1, ']', null)` | survived |
| M0217 | 266 | number-shift +1 | `1` → `2` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0218 | 266 | number-shift -1 | `1` → `0` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0219 | 266 | logical-swap | `\|\|` → `&&` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0225 | 266 | return-value | `null` → `undefined` | `if (textEnd === -1 \|\| text[textEnd + 1] !== '(') return null` | survived |
| M0228 | 267 | number-shift -1 | `2` → `1` | `const hrefEnd = scanForClose(text, textEnd + 2, ')', null)` | survived |
| M0232 | 268 | number-shift +1 | `1` → `2` | `if (hrefEnd === -1) return null` | survived |
| M0233 | 268 | number-shift -1 | `1` → `0` | `if (hrefEnd === -1) return null` | survived |
| M0234 | 268 | return-value | `null` → `undefined` | `if (hrefEnd === -1) return null` | survived |
| M0237 | 270 | number-shift +1 | `1` → `2` | `end: hrefEnd + 1,` | survived |
| M0261 | 289 | return-value | `null` → `undefined` | `return null` | survived |

### parseBlock — 9 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0306 | 322 | regex-anchor drop $ | `/^(#{1,6})\s+([\s\S]*)$/` → `/^(#{1,6})\s+([\s\S]*)/` | `const headingMatch = block.match(/^(#{1,6})\s+([\s\S]*)$/)` | survived |
| M0313 | 327 | regex-anchor drop ^ | `/^```/` → `/```/` | `if (/^```/.test(block)) {` | survived |
| M0315 | 328 | regex-anchor drop ^ | `/^```([^\n]*)\n([\s\S]*?)\n?```$/` → `/```([^\n]*)\n([\s\S]*?)\n?```$/` | `const m = block.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/)` | survived |
| M0323 | 330 | regex-anchor drop ^ | `/^```[^\n]*\n?/` → `/```[^\n]*\n?/` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0324 | 330 | string-fill | `''` → `'__MUTANT__'` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0325 | 330 | regex-anchor drop $ | `/```$/` → `/```/` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0326 | 330 | string-fill | `''` → `'__MUTANT__'` | `const code = m ? m[2] : block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')` | survived |
| M0355 | 353 | regex-anchor drop ^ | `/^-\s+/` → `/-\s+/` | `content: [{ type: 'paragraph', content: parseInline(l.replace(/^-\s+/, '')) }],` | survived |
| M0365 | 363 | regex-anchor drop ^ | `/^\d+\.\s+/` → `/\d+\.\s+/` | `content: [{ type: 'paragraph', content: parseInline(l.replace(/^\d+\.\s+/, '')) …` | survived |

### WRITER_EMITTED_ATTRS.codeBlock — 5 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0438 | 511 | logical-swap | `&&` → `\|\|` | `return typeof lang === 'string' && lang !== '' && lang === lang.trim()` | survived |
| M0440 | 511 | string-fill | `''` → `'__MUTANT__'` | `return typeof lang === 'string' && lang !== '' && lang === lang.trim()` | survived |
| M0441 | 511 | logical-swap | `&&` → `\|\|` | `return typeof lang === 'string' && lang !== '' && lang === lang.trim()` | survived |
| M0443 | 512 | logical-swap | `&&` → `\|\|` | `&& !/\n/.test(lang) && Object.keys(node.attrs).length === 1` | survived |
| M0445 | 512 | logical-swap | `&&` → `\|\|` | `&& !/\n/.test(lang) && Object.keys(node.attrs).length === 1` | survived |

### nodeShapeIsUnrebuildable — 5 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0471 | 561 | string-fill | `''` → `'__MUTANT__'` | `return text === '' \|\| text !== text.trim() \|\| BLOCK_SPLIT_PATTERN.test(text)` | survived |
| M0478 | 581 | string-fill | `''` → `'__MUTANT__'` | `if (text === '') return false` | survived |
| M0479 | 581 | return-value | `false` → `undefined` | `if (text === '') return false` | survived |
| M0518 | 619 | logical-swap | `\|\|` → `&&` | `if (node.content?.length !== 1 \|\| node.content[0]?.type !== 'text') return tru…` | survived |
| M0533 | 624 | return-value | `false` → `undefined` | `return false` | survived |

### isEscapeAt — 4 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0152 | 222 | arith | `+` → `-` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |
| M0154 | 222 | number-shift -1 | `1` → `0` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |
| M0155 | 222 | boundary | `<` → `<=` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |
| M0159 | 222 | number-shift -1 | `1` → `0` | `const isEscapeAt = (text, i) => text[i] === '\\' && i + 1 < text.length && ASCII…` | survived |

### markdownToAdf — 3 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0379 | 397 | string-fill | `''` → `'__MUTANT__'` | `.map(b => b.replace(/^\n+\|\n+$/g, ''))` | survived |
| M0380 | 398 | boundary | `>` → `>=` | `.filter(b => b.length > 0)` | survived |
| M0382 | 398 | number-shift -1 | `0` → `(-1)` | `.filter(b => b.length > 0)` | survived |

### WRITER_EMITTED_ATTRS.heading — 3 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0406 | 492 | number-shift -1 | `1` → `0` | `return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.a…` | survived |
| M0408 | 492 | boundary | `<=` → `<` | `return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.a…` | survived |
| M0410 | 492 | number-shift -1 | `6` → `5` | `return Number.isInteger(level) && level >= 1 && level <= 6 && Object.keys(node.a…` | survived |

### escapeBlockLeader — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0019 | 76 | regex-anchor drop ^ | `/^\s*-{3,}\s*$/` → `/\s*-{3,}\s*$/` | `if (/^\s*-{3,}\s*$/.test(line)) return line.replace('-', '\\-')` | survived |
| M0020 | 76 | regex-anchor drop $ | `/^\s*-{3,}\s*$/` → `/^\s*-{3,}\s*/` | `if (/^\s*-{3,}\s*$/.test(line)) return line.replace('-', '\\-')` | survived |

### renderCodeBlockText — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0062 | 119 | string-fill | `''` → `'__MUTANT__'` | `return (nodes \|\| []).map(n => (n?.type === 'text' ? (n.text \|\| '') : renderA…` | survived |
| M0063 | 119 | string-fill | `''` → `'__MUTANT__'` | `return (nodes \|\| []).map(n => (n?.type === 'text' ? (n.text \|\| '') : renderA…` | survived |

### scanForClose — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0180 | 246 | boundary | `<` → `<=` | `for (let i = from; i < text.length; i += 1) {` | survived |
| M0195 | 249 | number-shift -1 | `1` → `0` | `if (stopAt && text[i] === stopAt) return -1` | survived |

### <module:PAIRED_INLINE_MARKS> — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0200 | 256 | string-empty | `'*'` → `''` | `['**', 'strong', '*', unescapeInline],` | survived |
| M0205 | 258 | string-empty | `'~'` → `''` | `['~~', 'strike', '~', unescapeInline],` | survived |

### isUnmarkedTextRun — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0625 | 684 | boundary | `>` → `>=` | `const isUnmarkedTextRun = node => node?.type === 'text' && !(node.marks?.length …` | survived |
| M0627 | 684 | number-shift -1 | `0` → `(-1)` | `const isUnmarkedTextRun = node => node?.type === 'text' && !(node.marks?.length …` | survived |

### <module:WRITER_REBUILDABLE_NODE_TYPES> — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0387 | 424 | string-empty | `'doc'` → `''` | `'doc', 'text', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',` | survived |

## Survivors of run 1 that run 2 kills: 0 of 84

Run 2 killed mutants with ≥1 failing test, per file: jira-provider-adf-codec.test.js 538; jira-provider.test.js 136. Killed ONLY by files not in run 1: 0.

Consistency: same candidate (mutant ids comparable); mutants killed in run 1 but surviving run 2: 0.

