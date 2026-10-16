# Mutation sweep — adf.js

- impl: `/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rebuild-exp1/arms/2a-final/adf.js` (sha256 `96888fbed2909e3d…`)
- operator set: `adf-kit-ops/1`; node v22.22.0; 4 parallel jobs; per-mutant timeout 10000 ms
- [jira-provider-adf-codec.test.js] one unmutated test run: 336 ms median (315/336/339 ms; 133 tests); full sweep 89.2 s wall

kill rate = killed / (killed + survived + timeout); score = (killed + timeout) / (same). Invalid mutants are excluded from both.

| tests | mutants | killed | survived | timeout | invalid | kill rate | score |
|---|---|---|---|---|---|---|---|
| jira-provider-adf-codec.test.js | 490 | 394 | 87 | 9 | 0 (syntax 0, import 0) | 80.4% | 82.2% |

## By operator

| operator | mutants | survived |
|---|---|---|
| number-shift | 94 | 32 |
| string-fill | 27 | 15 |
| return-value | 36 | 9 |
| logical-swap | 53 | 8 |
| string-empty | 103 | 7 |
| boundary | 15 | 7 |
| arith | 25 | 3 |
| bool-flip | 13 | 3 |
| regex-anchor | 12 | 2 |
| index-swap | 8 | 1 |
| eq-flip | 38 | 0 |
| negate-cond | 52 | 0 |
| not-remove | 10 | 0 |
| delete-call | 4 | 0 |

## Survivors by function / region

| function / region | mutants | survived |
|---|---|---|
| linkAt | 35 | 13 |
| attrsAreRebuildable | 26 | 7 |
| SHAPE_RULES.text | 39 | 6 |
| parseInline | 37 | 6 |
| <module:WRITER_CHILDREN> | 24 | 6 |
| findUnescaped | 18 | 5 |
| headingLevel | 7 | 5 |
| parseBlock | 41 | 4 |
| hasAdjacentUnmarkedRuns | 14 | 4 |
| WRITER_ATTRS.language | 10 | 4 |
| WRITER_ATTRS.level | 8 | 3 |
| codeBody | 5 | 3 |
| isUnrebuildable | 27 | 2 |
| renderTextRun | 17 | 2 |
| SHAPE_RULES.codeBlock | 13 | 2 |
| <module:DELIMITED_MARKS> | 10 | 2 |
| renderNode | 5 | 2 |
| NODE_RENDERERS.emoji | 3 | 2 |
| markdownToAdf | 17 | 1 |
| escapeBlockLeader | 11 | 1 |
| constructAt | 11 | 1 |
| NODE_RENDERERS.mention | 4 | 1 |
| SHAPE_RULES.heading | 4 | 1 |
| SHAPE_RULES.paragraph | 4 | 1 |
| NODE_RENDERERS.blockCard | 3 | 1 |
| <module:RULE> | 2 | 1 |
| NODE_RENDERERS.inlineCard | 2 | 1 |

### linkAt — 13 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0243 | 383 | arith | `+` → `-` | `const textEnd = findUnescaped(text, i + 1, ']')` |
| M0245 | 383 | number-shift -1 | `1` → `0` | `const textEnd = findUnescaped(text, i + 1, ']')` |
| M0248 | 384 | boundary | `<` → `<=` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0249 | 384 | number-shift +1 | `0` → `1` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0250 | 384 | number-shift -1 | `0` → `(-1)` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0251 | 384 | logical-swap | `\|\|` → `&&` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0257 | 384 | return-value | `null` → `undefined` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0260 | 385 | number-shift -1 | `2` → `1` | `const hrefEnd = findUnescaped(text, textEnd + 2, ')')` |
| M0263 | 386 | boundary | `<` → `<=` | `if (hrefEnd < 0) return null` |
| M0264 | 386 | number-shift +1 | `0` → `1` | `if (hrefEnd < 0) return null` |
| M0265 | 386 | number-shift -1 | `0` → `(-1)` | `if (hrefEnd < 0) return null` |
| M0266 | 386 | return-value | `null` → `undefined` | `if (hrefEnd < 0) return null` |
| M0276 | 390 | number-shift +1 | `1` → `2` | `end: hrefEnd + 1,` |

### attrsAreRebuildable — 7 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0351 | 483 | string-empty | `'heading'` → `''` | `if (node.attrs === undefined) return node.type !== 'heading'` |
| M0354 | 484 | return-value | `false` → `undefined` | `if (!isObject(node.attrs)) return false` |
| M0355 | 484 | bool-flip | `false` → `true` | `if (!isObject(node.attrs)) return false` |
| M0360 | 491 | return-value | `false` → `undefined` | `if (!keys.every(key => hasOwn(allowed, key) && allowed[key](attrs[key]))) return…` |
| M0364 | 492 | string-empty | `'heading'` → `''` | `if (node.type === 'heading') return keys.includes('level')` |
| M0366 | 494 | boundary | `>` → `>=` | `return keys.length > 0 \|\| 'localId' in node.attrs \|\| node.type === 'orderedL…` |
| M0368 | 494 | number-shift -1 | `0` → `(-1)` | `return keys.length > 0 \|\| 'localId' in node.attrs \|\| node.type === 'orderedL…` |

### parseInline — 6 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0205 | 346 | string-empty | `'\\'` → `''` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0207 | 346 | arith | `+` → `-` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0208 | 346 | number-shift +1 | `1` → `2` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0209 | 346 | number-shift -1 | `1` → `0` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0210 | 346 | logical-swap | `??` → `&&` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0211 | 346 | string-fill | `''` → `'__MUTANT__'` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |

### <module:WRITER_CHILDREN> — 6 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0308 | 448 | number-shift -1 | `1` → `0` | `bulletList: { types: ['listItem'], min: 1 },` |
| M0311 | 449 | number-shift -1 | `1` → `0` | `orderedList: { types: ['listItem'], min: 1 },` |
| M0314 | 450 | number-shift -1 | `1` → `0` | `listItem: { types: ['paragraph'], min: 1, max: 1 },` |
| M0319 | 451 | number-shift -1 | `1` → `0` | `blockquote: { types: ['paragraph'], min: 1, max: 1 },` |
| M0322 | 452 | string-empty | `'text'` → `''` | `codeBlock: { types: ['text'], min: 1, max: 1 },` |
| M0325 | 452 | number-shift +1 | `1` → `2` | `codeBlock: { types: ['text'], min: 1, max: 1 },` |

### SHAPE_RULES.text — 6 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0403 | 552 | return-value | `true` → `undefined` | `if (typeof node.text !== 'string') return true` |
| M0404 | 552 | bool-flip | `true` → `false` | `if (typeof node.text !== 'string') return true` |
| M0427 | 563 | string-empty | `'link'` → `''` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |
| M0431 | 563 | logical-swap | `\|\|` → `&&` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |
| M0433 | 563 | return-value | `true` → `undefined` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |
| M0434 | 563 | bool-flip | `true` → `false` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |

### headingLevel — 5 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0110 | 209 | number-shift +1 | `6` → `7` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0111 | 209 | number-shift -1 | `6` → `5` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0113 | 209 | number-shift -1 | `1` → `0` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0115 | 209 | number-shift +1 | `1` → `2` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0116 | 209 | number-shift -1 | `1` → `0` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |

### findUnescaped — 5 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0279 | 399 | boundary | `<` → `<=` | `for (let j = from; j < text.length; j += 1) {` |
| M0292 | 405 | number-shift +1 | `1` → `2` | `if (text[j] === stopAt) return -1` |
| M0293 | 405 | number-shift -1 | `1` → `0` | `if (text[j] === stopAt) return -1` |
| M0294 | 407 | number-shift +1 | `1` → `2` | `return -1` |
| M0295 | 407 | number-shift -1 | `1` → `0` | `return -1` |

### parseBlock — 4 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0146 | 274 | boundary | `>=` → `>` | `if (lines.length >= 2 && lines[0].startsWith(FENCE)) {` |
| M0147 | 274 | number-shift +1 | `2` → `3` | `if (lines.length >= 2 && lines[0].startsWith(FENCE)) {` |
| M0148 | 274 | number-shift -1 | `2` → `1` | `if (lines.length >= 2 && lines[0].startsWith(FENCE)) {` |
| M0169 | 291 | index-swap | `0` → `1` | `content: parseInline(block.slice(heading[0].length).trim()),` |

### WRITER_ATTRS.language — 4 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0337 | 470 | logical-swap | `&&` → `\|\|` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |
| M0339 | 470 | string-fill | `''` → `'__MUTANT__'` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |
| M0340 | 470 | logical-swap | `&&` → `\|\|` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |
| M0342 | 470 | logical-swap | `&&` → `\|\|` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |

### hasAdjacentUnmarkedRuns — 4 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0445 | 579 | boundary | `>` → `>=` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |
| M0446 | 579 | number-shift +1 | `0` → `1` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |
| M0447 | 579 | number-shift -1 | `0` → `(-1)` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |
| M0450 | 579 | arith | `-` → `+` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |

### codeBody — 3 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0122 | 223 | string-fill | `''` → `'__MUTANT__'` | `return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(…` |
| M0123 | 223 | string-fill | `''` → `'__MUTANT__'` | `return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(…` |
| M0125 | 223 | string-fill | `''` → `'__MUTANT__'` | `return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(…` |

### WRITER_ATTRS.level — 3 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0330 | 467 | number-shift -1 | `1` → `0` | `heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 }…` |
| M0332 | 467 | boundary | `<=` → `<` | `heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 }…` |
| M0334 | 467 | number-shift -1 | `6` → `5` | `heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 }…` |

### <module:DELIMITED_MARKS> — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0014 | 91 | string-empty | `'*'` → `''` | `['strong', '**', '*', INLINE],` |
| M0019 | 93 | string-empty | `'~'` → `''` | `['strike', '~~', '~', INLINE],` |

### NODE_RENDERERS.emoji — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0064 | 148 | logical-swap | `\|\|` → `&&` | `emoji: node => node.attrs?.text \|\| node.attrs?.shortName \|\| '',` |
| M0065 | 148 | string-fill | `''` → `'__MUTANT__'` | `emoji: node => node.attrs?.text \|\| node.attrs?.shortName \|\| '',` |

### renderNode — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0073 | 154 | return-value | `''` → `undefined` | `if (!isObject(node)) return ''` |
| M0074 | 154 | string-fill | `''` → `'__MUTANT__'` | `if (!isObject(node)) return ''` |

### renderTextRun — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0097 | 196 | string-fill | `''` → `'__MUTANT__'` | `let markdown = escape(context, String(node.text ?? ''))` |
| M0103 | 199 | string-fill | `''` → `'__MUTANT__'` | `markdown = `[${markdown}](${escape(HREF, String(mark.attrs?.href ?? ''))})`` |

### SHAPE_RULES.codeBlock — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0388 | 546 | string-fill | `''` → `'__MUTANT__'` | `const body = String(run.text ?? '')` |
| M0390 | 547 | number-shift +1 | `0` → `1` | `return marksOf(run).length > 0 \|\| body === '' \|\| BLOCK_SEPARATOR.test(body)` |

### isUnrebuildable — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0464 | 587 | number-shift -1 | `0` → `(-1)` | `const { min = 0, max = Infinity } = WRITER_CHILDREN[node.type]` |
| M0477 | 593 | return-value | `false` → `undefined` | `if (node.type === 'codeBlock') return false` |

### <module:RULE> — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0005 | 42 | regex-anchor drop $ | `/^\s*-{3,}\s*$/` → `/^\s*-{3,}\s*/` | `const RULE = /^\s*-{3,}\s*$/` |

### NODE_RENDERERS.mention — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0062 | 147 | string-fill | `''` → `'__MUTANT__'` | `mention: node => node.attrs?.text \|\| `@${node.attrs?.id ?? ''}`,` |

### NODE_RENDERERS.inlineCard — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0067 | 149 | string-fill | `''` → `'__MUTANT__'` | `inlineCard: node => node.attrs?.url ?? '',` |

### NODE_RENDERERS.blockCard — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0069 | 150 | string-fill | `''` → `'__MUTANT__'` | `blockCard: node => (node.attrs?.url ?? '') + BLOCK_END,` |

### escapeBlockLeader — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0091 | 189 | regex-anchor drop ^ | `/^(\d+)\./` → `/(\d+)\./` | `return ORDERED_LINE.test(line) ? line.replace(/^(\d+)\./, '$1\\.') : line` |

### markdownToAdf — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0139 | 263 | string-fill | `''` → `'__MUTANT__'` | `const blocks = markdown.replace(/^\n+\|\n+$/g, '').split(BLOCK_SEPARATOR)` |

### constructAt — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0242 | 378 | return-value | `null` → `undefined` | `return null` |

### SHAPE_RULES.heading — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0376 | 511 | string-fill | `''` → `'__MUTANT__'` | `return markdown === '' \|\| isPadded(markdown) \|\| BLOCK_SEPARATOR.test(markdow…` |

### SHAPE_RULES.paragraph — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0379 | 524 | logical-swap | `\|\|` → `&&` | `return BLOCK_SEPARATOR.test(markdown) \|\| markdown.startsWith('\n') \|\| markdo…` |

