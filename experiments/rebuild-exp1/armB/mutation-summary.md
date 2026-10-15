# Mutation sweep — adf.js

- impl: `/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rebuild-exp1/arms/B/adf.js` (sha256 `f77b85cac7bfb9ac…`)
- operator set: `adf-kit-ops/1`; node v22.22.0; 4 parallel jobs; per-mutant timeout 10000 ms
- [jira-provider-adf-codec.test.js] one unmutated test run: 455 ms median (384/455/470 ms; 133 tests); full sweep 102.0 s wall
- [jira-provider-adf-codec.test.js + jira-provider.test.js] one unmutated test run: 528 ms median (504/528/530 ms; 268 tests); full sweep 156.3 s wall

kill rate = killed / (killed + survived + timeout); score = (killed + timeout) / (same). Invalid mutants are excluded from both.

| tests | mutants | killed | survived | timeout | invalid | kill rate | score |
|---|---|---|---|---|---|---|---|
| jira-provider-adf-codec.test.js | 451 | 378 | 66 | 7 | 0 (syntax 0, import 0) | 83.8% | 85.4% |
| jira-provider-adf-codec.test.js + jira-provider.test.js | 451 | 378 | 66 | 7 | 0 (syntax 0, import 0) | 83.8% | 85.4% |

## By operator

| operator | mutants | survived (1) | survived (2) |
|---|---|---|---|
| number-shift | 70 | 26 | 26 |
| string-fill | 21 | 11 | 11 |
| logical-swap | 55 | 9 | 9 |
| boundary | 12 | 8 | 8 |
| return-value | 36 | 5 | 5 |
| string-empty | 114 | 4 | 4 |
| regex-anchor | 11 | 1 | 1 |
| arith | 17 | 1 | 1 |
| index-swap | 3 | 1 | 1 |
| eq-flip | 38 | 0 | 0 |
| negate-cond | 45 | 0 | 0 |
| delete-call | 7 | 0 | 0 |
| not-remove | 12 | 0 | 0 |
| bool-flip | 10 | 0 | 0 |

## Survivors by function / region (run 1)

| function / region | mutants | survived (1) | survived (2) |
|---|---|---|---|
| linkAt | 35 | 12 | 12 |
| attrsRebuildable | 33 | 7 | 7 |
| parseInline | 22 | 6 | 6 |
| renderNode | 48 | 5 | 5 |
| findClose | 18 | 5 | 5 |
| headingLevel | 7 | 5 | 5 |
| parseFence | 20 | 4 | 4 |
| hasAdjacentPlainRuns | 14 | 4 | 4 |
| shapeUnrebuildable | 39 | 3 | 3 |
| textUnrebuildable | 30 | 3 | 3 |
| wrapperUnrebuildable | 22 | 2 | 2 |
| <module:DELIMITED_MARKS> | 10 | 2 | 2 |
| renderCodeBlock | 7 | 2 | 2 |
| parseBlock | 19 | 1 | 1 |
| wrapInMark | 11 | 1 | 1 |
| constructAt | 11 | 1 | 1 |
| markdownToAdf | 10 | 1 | 1 |
| textOf | 4 | 1 | 1 |
| <module:RULE> | 2 | 1 | 1 |
| parseParagraph | 11 | 0 | 0 |
| escapeBlockLeader | 10 | 0 | 0 |
| unrebuildable | 10 | 0 | 0 |
| withoutLocalId | 6 | 0 | 0 |
| parseList | 5 | 0 | 0 |
| adfHasUnrenderableContent | 5 | 0 | 0 |
| edgesUnrebuildable | 5 | 0 | 0 |
| isObject | 4 | 0 | 0 |
| renderList | 4 | 0 | 0 |
| renderText | 3 | 0 | 0 |
| textNode | 3 | 0 | 0 |
| renderDocument | 2 | 0 | 0 |
| renderParagraph | 2 | 0 | 0 |
| pushPlain | 2 | 0 | 0 |
| hasOnlyKeys | 2 | 0 | 0 |
| hasHardBreak | 2 | 0 | 0 |
| arrayOf | 1 | 0 | 0 |
| INLINE_TEXT.escape | 1 | 0 | 0 |
| INLINE_TEXT.unescape | 1 | 0 | 0 |
| CODE_TEXT.escape | 1 | 0 | 0 |
| CODE_TEXT.unescape | 1 | 0 | 0 |
| HREF_TEXT.escape | 1 | 0 | 0 |
| HREF_TEXT.unescape | 1 | 0 | 0 |
| <module:FENCE> | 1 | 0 | 0 |
| <module:HEADING> | 1 | 0 | 0 |
| <module:QUOTE_LINE> | 1 | 0 | 0 |
| <module:BULLET_LINE> | 1 | 0 | 0 |
| <module:ORDERED_LINE> | 1 | 0 | 0 |
| renderAll | 1 | 0 | 0 |

### linkAt — 12 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0234 | 360 | number-shift -1 | `1` → `0` | `const textEnd = findClose(md, ']', i + 1)` | survived |
| M0236 | 361 | boundary | `<` → `<=` | `if (textEnd < 0 \|\| md[textEnd + 1] !== '(') return null` | survived |
| M0237 | 361 | number-shift +1 | `0` → `1` | `if (textEnd < 0 \|\| md[textEnd + 1] !== '(') return null` | survived |
| M0238 | 361 | number-shift -1 | `0` → `(-1)` | `if (textEnd < 0 \|\| md[textEnd + 1] !== '(') return null` | survived |
| M0239 | 361 | logical-swap | `\|\|` → `&&` | `if (textEnd < 0 \|\| md[textEnd + 1] !== '(') return null` | survived |
| M0245 | 361 | return-value | `null` → `undefined` | `if (textEnd < 0 \|\| md[textEnd + 1] !== '(') return null` | survived |
| M0249 | 362 | number-shift -1 | `2` → `1` | `const hrefEnd = findClose(md, ')', textEnd + 2)` | survived |
| M0251 | 363 | boundary | `<` → `<=` | `if (hrefEnd < 0) return null` | survived |
| M0252 | 363 | number-shift +1 | `0` → `1` | `if (hrefEnd < 0) return null` | survived |
| M0253 | 363 | number-shift -1 | `0` → `(-1)` | `if (hrefEnd < 0) return null` | survived |
| M0254 | 363 | return-value | `null` → `undefined` | `if (hrefEnd < 0) return null` | survived |
| M0264 | 365 | number-shift +1 | `1` → `2` | `return { node: textNode(INLINE_TEXT.unescape(md.slice(i + 1, textEnd)), mark), e…` | survived |

### attrsRebuildable — 7 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0305 | 483 | number-shift -1 | `1` → `0` | `return hasOnlyKeys(attrs, 'level') && Number.isInteger(attrs.level) && attrs.lev…` | survived |
| M0307 | 483 | boundary | `<=` → `<` | `return hasOnlyKeys(attrs, 'level') && Number.isInteger(attrs.level) && attrs.lev…` | survived |
| M0309 | 483 | number-shift -1 | `6` → `5` | `return hasOnlyKeys(attrs, 'level') && Number.isInteger(attrs.level) && attrs.lev…` | survived |
| M0323 | 493 | logical-swap | `&&` → `\|\|` | `return attrs === undefined \|\| (hasOnlyKeys(attrs, 'language') && typeof attrs.…` | survived |
| M0326 | 494 | logical-swap | `&&` → `\|\|` | `&& attrs.language !== '' && attrs.language === attrs.language.trim())` | survived |
| M0328 | 494 | string-fill | `''` → `'__MUTANT__'` | `&& attrs.language !== '' && attrs.language === attrs.language.trim())` | survived |
| M0329 | 494 | logical-swap | `&&` → `\|\|` | `&& attrs.language !== '' && attrs.language === attrs.language.trim())` | survived |

### parseInline — 6 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0196 | 318 | number-shift -1 | `0` → `(-1)` | `let i = 0` | survived |
| M0198 | 319 | boundary | `<` → `<=` | `while (i < md.length) {` | survived |
| M0201 | 320 | string-empty | `'\\'` → `''` | `const construct = md[i] === '\\' ? null : constructAt(md, i)` | survived |
| M0207 | 322 | string-empty | `'\\'` → `''` | `i += md[i] === '\\' ? 2 : 1 // an escaped character never opens a construct` | survived |
| M0208 | 322 | number-shift +1 | `2` → `3` | `i += md[i] === '\\' ? 2 : 1 // an escaped character never opens a construct` | survived |
| M0209 | 322 | number-shift -1 | `2` → `1` | `i += md[i] === '\\' ? 2 : 1 // an escaped character never opens a construct` | survived |

### renderNode — 5 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0071 | 149 | string-fill | `''` → `'__MUTANT__'` | `case 'mention': return node.attrs?.text \|\| `@${node.attrs?.id ?? ''}`` | survived |
| M0074 | 150 | logical-swap | `\|\|` → `&&` | `case 'emoji': return node.attrs?.text \|\| node.attrs?.shortName \|\| ''` | survived |
| M0075 | 150 | string-fill | `''` → `'__MUTANT__'` | `case 'emoji': return node.attrs?.text \|\| node.attrs?.shortName \|\| ''` | survived |
| M0078 | 151 | string-fill | `''` → `'__MUTANT__'` | `case 'inlineCard': return node.attrs?.url ?? ''` | survived |
| M0083 | 152 | string-fill | `''` → `'__MUTANT__'` | `case 'blockCard': return `${node.attrs?.url ?? ''}\n\n`` | survived |

### headingLevel — 5 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0088 | 165 | number-shift +1 | `6` → `7` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` | survived |
| M0089 | 165 | number-shift -1 | `6` → `5` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` | survived |
| M0091 | 165 | number-shift -1 | `1` → `0` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` | survived |
| M0093 | 165 | number-shift +1 | `1` → `2` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` | survived |
| M0094 | 165 | number-shift -1 | `1` → `0` | `return Math.min(6, Math.max(1, Math.trunc(Number(node.attrs?.level)) \|\| 1))` | survived |

### findClose — 5 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0267 | 374 | boundary | `<` → `<=` | `for (let j = from; j < md.length; j += 1) {` | survived |
| M0280 | 380 | number-shift +1 | `1` → `2` | `if (md[j] === stopAt) return -1` | survived |
| M0281 | 380 | number-shift -1 | `1` → `0` | `if (md[j] === stopAt) return -1` | survived |
| M0282 | 382 | number-shift +1 | `1` → `2` | `return -1` | survived |
| M0283 | 382 | number-shift -1 | `1` → `0` | `return -1` | survived |

### parseFence — 4 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0158 | 270 | boundary | `>` → `>=` | `const closed = lines.length > 1 && lines[lines.length - 1].trim() === FENCE` | survived |
| M0159 | 270 | number-shift +1 | `1` → `2` | `const closed = lines.length > 1 && lines[lines.length - 1].trim() === FENCE` | survived |
| M0160 | 270 | number-shift -1 | `1` → `0` | `const closed = lines.length > 1 && lines[lines.length - 1].trim() === FENCE` | survived |
| M0161 | 270 | logical-swap | `&&` → `\|\|` | `const closed = lines.length > 1 && lines[lines.length - 1].trim() === FENCE` | survived |

### hasAdjacentPlainRuns — 4 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0439 | 612 | boundary | `>` → `>=` | `return arrayOf(node.content).some((child, i, all) => i > 0 && isPlainRun(child) …` | survived |
| M0440 | 612 | number-shift +1 | `0` → `1` | `return arrayOf(node.content).some((child, i, all) => i > 0 && isPlainRun(child) …` | survived |
| M0441 | 612 | number-shift -1 | `0` → `(-1)` | `return arrayOf(node.content).some((child, i, all) => i > 0 && isPlainRun(child) …` | survived |
| M0444 | 612 | arith | `-` → `+` | `return arrayOf(node.content).some((child, i, all) => i > 0 && isPlainRun(child) …` | survived |

### shapeUnrebuildable — 3 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0344 | 523 | return-value | `false` → `undefined` | `return false` | survived |
| M0347 | 531 | logical-swap | `\|\|` → `&&` | `return BLOCK_SPLIT.test(md) \|\| md.startsWith('\n') \|\| md.endsWith('\n') \|\|…` | survived |
| M0367 | 549 | logical-swap | `&&` → `\|\|` | `const body = run?.type === 'text' && !arrayOf(run.marks).length && !rest.length …` | survived |

### textUnrebuildable — 3 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0412 | 588 | return-value | `false` → `undefined` | `if (marks.length === 0) return false` | survived |
| M0423 | 595 | logical-swap | `??` → `&&` | `if (mark?.type === 'link') return String(mark.attrs?.href ?? '').includes('\n')` | survived |
| M0424 | 595 | string-fill | `''` → `'__MUTANT__'` | `if (mark?.type === 'link') return String(mark.attrs?.href ?? '').includes('\n')` | survived |

### <module:DELIMITED_MARKS> — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0018 | 84 | string-empty | `'*'` → `''` | `{ type: 'strong', delimiter: '**', stopAt: '*', text: INLINE_TEXT },` | survived |
| M0023 | 86 | string-empty | `'~'` → `''` | `{ type: 'strike', delimiter: '~~', stopAt: '~', text: INLINE_TEXT },` | survived |

### renderCodeBlock — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0095 | 174 | string-fill | `''` → `'__MUTANT__'` | `const body = arrayOf(node.content).map(textOf).join('').replace(/\n+$/, '')` | survived |
| M0097 | 174 | string-fill | `''` → `'__MUTANT__'` | `const body = arrayOf(node.content).map(textOf).join('').replace(/\n+$/, '')` | survived |

### wrapperUnrebuildable — 2 survivors

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0393 | 574 | boundary | `>` → `>=` | `if (md === '' && arrayOf(paragraph.content).length > 0) return true` | survived |
| M0395 | 574 | number-shift -1 | `0` → `(-1)` | `if (md === '' && arrayOf(paragraph.content).length > 0) return true` | survived |

### textOf — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0009 | 19 | string-fill | `''` → `'__MUTANT__'` | `const textOf = node => (typeof node?.text === 'string' ? node.text : '')` | survived |

### <module:RULE> — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0029 | 103 | regex-anchor drop $ | `/^-{3,}$/` → `/^-{3,}/` | `const RULE = /^-{3,}$/` | survived |

### wrapInMark — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0123 | 213 | string-fill | `''` → `'__MUTANT__'` | `if (mark?.type === 'link') return `[${md}](${HREF_TEXT.escape(String(mark.attrs?…` | survived |

### markdownToAdf — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0133 | 240 | string-fill | `''` → `'__MUTANT__'` | `const blocks = source.trim() ? source.replace(/^\n+\|\n+$/g, '').split(BLOCK_SPL…` | survived |

### parseBlock — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0141 | 252 | index-swap | `0` → `1` | `const text = block.slice(heading[0].length).trim()` | survived |

### constructAt — 1 survivor

| id | line | operator | original → mutated | source line | run 2 |
|---|---|---|---|---|---|
| M0230 | 355 | return-value | `null` → `undefined` | `return null` | survived |

## Survivors of run 1 that run 2 kills: 0 of 66

Run 2 killed mutants with ≥1 failing test, per file: jira-provider-adf-codec.test.js 378; jira-provider.test.js 99. Killed ONLY by files not in run 1: 0.

Consistency: same candidate (mutant ids comparable); mutants killed in run 1 but surviving run 2: 0.

