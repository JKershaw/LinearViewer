# Mutation sweep — adf.js

- impl: `/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rebuild-exp1/arms/2a-raw/adf.js` (sha256 `b027031db8285671…`)
- operator set: `adf-kit-ops/1`; node v22.22.0; 4 parallel jobs; per-mutant timeout 10000 ms
- [jira-provider-adf-codec.test.js] one unmutated test run: 343 ms median (304/343/407 ms; 133 tests); full sweep 94.2 s wall

kill rate = killed / (killed + survived + timeout); score = (killed + timeout) / (same). Invalid mutants are excluded from both.

| tests | mutants | killed | survived | timeout | invalid | kill rate | score |
|---|---|---|---|---|---|---|---|
| jira-provider-adf-codec.test.js | 488 | 391 | 88 | 9 | 0 (syntax 0, import 0) | 80.1% | 82.0% |

## By operator

| operator | mutants | survived |
|---|---|---|
| number-shift | 94 | 32 |
| string-fill | 27 | 15 |
| logical-swap | 55 | 9 |
| return-value | 36 | 9 |
| string-empty | 101 | 7 |
| boundary | 15 | 7 |
| arith | 25 | 3 |
| bool-flip | 13 | 3 |
| regex-anchor | 12 | 2 |
| index-swap | 8 | 1 |
| eq-flip | 38 | 0 |
| negate-cond | 50 | 0 |
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
| parseBlock | 41 | 5 |
| findUnescaped | 18 | 5 |
| headingLevel | 7 | 5 |
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
| constructAt | 11 | 1 |
| escapeBlockLeader | 9 | 1 |
| NODE_RENDERERS.mention | 4 | 1 |
| SHAPE_RULES.heading | 4 | 1 |
| SHAPE_RULES.paragraph | 4 | 1 |
| NODE_RENDERERS.blockCard | 3 | 1 |
| <module:RULE> | 2 | 1 |
| NODE_RENDERERS.inlineCard | 2 | 1 |

### linkAt — 13 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0241 | 378 | arith | `+` → `-` | `const textEnd = findUnescaped(text, i + 1, ']')` |
| M0243 | 378 | number-shift -1 | `1` → `0` | `const textEnd = findUnescaped(text, i + 1, ']')` |
| M0246 | 379 | boundary | `<` → `<=` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0247 | 379 | number-shift +1 | `0` → `1` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0248 | 379 | number-shift -1 | `0` → `(-1)` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0249 | 379 | logical-swap | `\|\|` → `&&` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0255 | 379 | return-value | `null` → `undefined` | `if (textEnd < 0 \|\| text[textEnd + 1] !== '(') return null` |
| M0258 | 380 | number-shift -1 | `2` → `1` | `const hrefEnd = findUnescaped(text, textEnd + 2, ')')` |
| M0261 | 381 | boundary | `<` → `<=` | `if (hrefEnd < 0) return null` |
| M0262 | 381 | number-shift +1 | `0` → `1` | `if (hrefEnd < 0) return null` |
| M0263 | 381 | number-shift -1 | `0` → `(-1)` | `if (hrefEnd < 0) return null` |
| M0264 | 381 | return-value | `null` → `undefined` | `if (hrefEnd < 0) return null` |
| M0274 | 385 | number-shift +1 | `1` → `2` | `end: hrefEnd + 1,` |

### attrsAreRebuildable — 7 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0349 | 478 | string-empty | `'heading'` → `''` | `if (node.attrs === undefined) return node.type !== 'heading'` |
| M0352 | 479 | return-value | `false` → `undefined` | `if (!isObject(node.attrs)) return false` |
| M0353 | 479 | bool-flip | `false` → `true` | `if (!isObject(node.attrs)) return false` |
| M0358 | 486 | return-value | `false` → `undefined` | `if (!keys.every(key => hasOwn(allowed, key) && allowed[key](attrs[key]))) return…` |
| M0362 | 487 | string-empty | `'heading'` → `''` | `if (node.type === 'heading') return keys.includes('level')` |
| M0364 | 489 | boundary | `>` → `>=` | `return keys.length > 0 \|\| 'localId' in node.attrs \|\| node.type === 'orderedL…` |
| M0366 | 489 | number-shift -1 | `0` → `(-1)` | `return keys.length > 0 \|\| 'localId' in node.attrs \|\| node.type === 'orderedL…` |

### parseInline — 6 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0203 | 341 | string-empty | `'\\'` → `''` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0205 | 341 | arith | `+` → `-` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0206 | 341 | number-shift +1 | `1` → `2` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0207 | 341 | number-shift -1 | `1` → `0` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0208 | 341 | logical-swap | `??` → `&&` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |
| M0209 | 341 | string-fill | `''` → `'__MUTANT__'` | `if (text[i] === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {` |

### <module:WRITER_CHILDREN> — 6 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0306 | 443 | number-shift -1 | `1` → `0` | `bulletList: { types: ['listItem'], min: 1 },` |
| M0309 | 444 | number-shift -1 | `1` → `0` | `orderedList: { types: ['listItem'], min: 1 },` |
| M0312 | 445 | number-shift -1 | `1` → `0` | `listItem: { types: ['paragraph'], min: 1, max: 1 },` |
| M0317 | 446 | number-shift -1 | `1` → `0` | `blockquote: { types: ['paragraph'], min: 1, max: 1 },` |
| M0320 | 447 | string-empty | `'text'` → `''` | `codeBlock: { types: ['text'], min: 1, max: 1 },` |
| M0323 | 447 | number-shift +1 | `1` → `2` | `codeBlock: { types: ['text'], min: 1, max: 1 },` |

### SHAPE_RULES.text — 6 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0401 | 547 | return-value | `true` → `undefined` | `if (typeof node.text !== 'string') return true` |
| M0402 | 547 | bool-flip | `true` → `false` | `if (typeof node.text !== 'string') return true` |
| M0425 | 558 | string-empty | `'link'` → `''` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |
| M0429 | 558 | logical-swap | `\|\|` → `&&` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |
| M0431 | 558 | return-value | `true` → `undefined` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |
| M0432 | 558 | bool-flip | `true` → `false` | `if (mark?.type === 'link' && (typeof mark.attrs?.href !== 'string' \|\| mark.att…` |

### headingLevel — 5 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0108 | 206 | number-shift +1 | `6` → `7` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0109 | 206 | number-shift -1 | `6` → `5` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0111 | 206 | number-shift -1 | `1` → `0` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0113 | 206 | number-shift +1 | `1` → `2` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |
| M0114 | 206 | number-shift -1 | `1` → `0` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` |

### parseBlock — 5 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0144 | 270 | boundary | `>=` → `>` | `if (lines.length >= 2 && lines[0].startsWith(FENCE) && lines.at(-1) === FENCE) {` |
| M0145 | 270 | number-shift +1 | `2` → `3` | `if (lines.length >= 2 && lines[0].startsWith(FENCE) && lines.at(-1) === FENCE) {` |
| M0146 | 270 | number-shift -1 | `2` → `1` | `if (lines.length >= 2 && lines[0].startsWith(FENCE) && lines.at(-1) === FENCE) {` |
| M0149 | 270 | logical-swap | `&&` → `\|\|` | `if (lines.length >= 2 && lines[0].startsWith(FENCE) && lines.at(-1) === FENCE) {` |
| M0167 | 286 | index-swap | `0` → `1` | `content: parseInline(block.slice(heading[0].length).trim()),` |

### findUnescaped — 5 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0277 | 394 | boundary | `<` → `<=` | `for (let j = from; j < text.length; j += 1) {` |
| M0290 | 400 | number-shift +1 | `1` → `2` | `if (text[j] === stopAt) return -1` |
| M0291 | 400 | number-shift -1 | `1` → `0` | `if (text[j] === stopAt) return -1` |
| M0292 | 402 | number-shift +1 | `1` → `2` | `return -1` |
| M0293 | 402 | number-shift -1 | `1` → `0` | `return -1` |

### WRITER_ATTRS.language — 4 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0335 | 465 | logical-swap | `&&` → `\|\|` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |
| M0337 | 465 | string-fill | `''` → `'__MUTANT__'` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |
| M0338 | 465 | logical-swap | `&&` → `\|\|` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |
| M0340 | 465 | logical-swap | `&&` → `\|\|` | `codeBlock: { language: language => typeof language === 'string' && language !== …` |

### hasAdjacentUnmarkedRuns — 4 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0443 | 574 | boundary | `>` → `>=` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |
| M0444 | 574 | number-shift +1 | `0` → `1` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |
| M0445 | 574 | number-shift -1 | `0` → `(-1)` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |
| M0448 | 574 | arith | `-` → `+` | `return children.some((node, index) => index > 0 && isUnmarkedRun(node) && isUnma…` |

### codeBody — 3 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0120 | 220 | string-fill | `''` → `'__MUTANT__'` | `return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(…` |
| M0121 | 220 | string-fill | `''` → `'__MUTANT__'` | `return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(…` |
| M0123 | 220 | string-fill | `''` → `'__MUTANT__'` | `return contentOf(node).map(child => String(child?.text ?? '')).join('').replace(…` |

### WRITER_ATTRS.level — 3 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0328 | 462 | number-shift -1 | `1` → `0` | `heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 }…` |
| M0330 | 462 | boundary | `<=` → `<` | `heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 }…` |
| M0332 | 462 | number-shift -1 | `6` → `5` | `heading: { level: level => Number.isInteger(level) && level >= 1 && level <= 6 }…` |

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
| M0095 | 193 | string-fill | `''` → `'__MUTANT__'` | `let markdown = escape(context, String(node.text ?? ''))` |
| M0101 | 196 | string-fill | `''` → `'__MUTANT__'` | `markdown = `[${markdown}](${escape(HREF, String(mark.attrs?.href ?? ''))})`` |

### SHAPE_RULES.codeBlock — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0386 | 541 | string-fill | `''` → `'__MUTANT__'` | `const body = String(run.text ?? '')` |
| M0388 | 542 | number-shift +1 | `0` → `1` | `return marksOf(run).length > 0 \|\| body === '' \|\| BLOCK_SEPARATOR.test(body)` |

### isUnrebuildable — 2 survivors

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0462 | 582 | number-shift -1 | `0` → `(-1)` | `const { min = 0, max = Infinity } = WRITER_CHILDREN[node.type]` |
| M0475 | 588 | return-value | `false` → `undefined` | `if (node.type === 'codeBlock') return false` |

### <module:RULE> — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0005 | 42 | regex-anchor drop $ | `/^-{3,}$/` → `/^-{3,}/` | `const RULE = /^-{3,}$/` |

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
| M0089 | 186 | regex-anchor drop ^ | `/^(\d+)\./` → `/(\d+)\./` | `return ORDERED_LINE.test(line) ? line.replace(/^(\d+)\./, '$1\\.') : line` |

### markdownToAdf — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0137 | 260 | string-fill | `''` → `'__MUTANT__'` | `const blocks = markdown.replace(/^\n+\|\n+$/g, '').split(BLOCK_SEPARATOR)` |

### constructAt — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0240 | 373 | return-value | `null` → `undefined` | `return null` |

### SHAPE_RULES.heading — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0374 | 506 | string-fill | `''` → `'__MUTANT__'` | `return markdown === '' \|\| isPadded(markdown) \|\| BLOCK_SEPARATOR.test(markdow…` |

### SHAPE_RULES.paragraph — 1 survivor

| id | line | operator | original → mutated | source line |
|---|---|---|---|---|
| M0377 | 519 | logical-swap | `\|\|` → `&&` | `return BLOCK_SEPARATOR.test(markdown) \|\| markdown.startsWith('\n') \|\| markdo…` |

