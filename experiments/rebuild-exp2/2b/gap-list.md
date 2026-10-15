# Test gaps in `lib/providers/jira/adf.js` at `e7f7bd57` (computed, not judged)

Each row is a one-line fault planted in today's code that **every test in `tests/unit/jira-provider-adf-codec.test.js` (138 tests) still passes**, yet that **changes some output** on the replay corpus (8,916 inputs). Each is a place where behaviour can change without a test noticing.

Totals: {'survivors': 83, 'distinguished': 46, 'distinguishedByPublicCorpus': 44, 'hangOrCrashOnSomeBatch': 2, 'distinguishedOnlyByPrivateCorpus': 0, 'undistinguished': 37}

Produced by `experiments/rebuild-exp1/kit/mutate.mjs` + `survivor-probe.mjs` (operator set `adf-kit-ops/1`). Line numbers are in `e7f7bd57:lib/providers/jira/adf.js`. "Example" is the smallest corpus input that tells the fault apart from today's code.

| # | function | line | fault | outputs that change | example input |
|---|---|---|---|---|---|
| 1 | <module:DELIMITED_MARKS> | 91 | string-empty: `'*'` → `''` | m2a, rt_adf, rt_md | `"+ na\u00efve ***caf\u00e9***"` |
| 2 | <module:DELIMITED_MARKS> | 93 | string-empty: `'~'` → `''` | m2a, rt_adf, rt_md | `"~~~json\r    indented\rif (x) {\r- not list\r    indented\r~~~\r\r>  ~~CI~~ retry on CI build **retry snake_case_name t` |
| 3 | <module:RULE> | 42 | regex-anchor: `/^\s*-{3,}\s*$/` → `/^\s*-{3,}\s*/` | a2m, gate_m2a, m2a, rt_adf, rt_md | `"---\r\r\r"` |
| 4 | <module:WRITER_CHILDREN> | 450 | number-shift: `1` → `0` | gate | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": []}, {"type": "orderedList", "content": [{"ty` |
| 5 | <module:WRITER_CHILDREN> | 451 | number-shift: `1` → `0` | gate | `{"type": "doc", "version": 1, "content": [{"type": "blockquote", "content": null}]}` |
| 6 | <module:WRITER_CHILDREN> | 452 | number-shift: `1` → `2` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "\tindented\n\tinde` |
| 7 | NODE_RENDERERS.emoji | 148 | logical-swap: `\|\|` → `&&` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "emoji", "attrs": {"shortName": ":c` |
| 8 | NODE_RENDERERS.emoji | 148 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "+ plus"}, {"type":` |
| 9 | NODE_RENDERERS.inlineCard | 149 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "inlineCard", "attrs": {"data": {"@` |
| 10 | NODE_RENDERERS.mention | 147 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "mention"}, {"type": "text", "text"` |
| 11 | SHAPE_RULES.codeBlock | 546 | string-fill: `''` → `'__MUTANT__'` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "hardBreak"}]}]}` |
| 12 | SHAPE_RULES.codeBlock | 547 | number-shift: `0` → `1` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "const x = 1;\nC:\\` |
| 13 | SHAPE_RULES.heading | 511 | string-fill: `''` → `'__MUTANT__'` | gate, gate_m2a | `"# \n\n \n\n- padded\n\n leading\n\n---\n\n> trailing"` |
| 14 | SHAPE_RULES.paragraph | 524 | logical-swap: `\|\|` → `&&` | gate, gate_m2a | `"> a\n> \n> b"` |
| 15 | SHAPE_RULES.text | 563 | string-empty: `'link'` → `''` | gate, gate_m2a | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "- item\n}"}]}, {"t` |
| 16 | SHAPE_RULES.text | 563 | logical-swap: `\|\|` → `&&` | gate, gate_m2a | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "- item\n}"}]}, {"t` |
| 17 | SHAPE_RULES.text | 563 | return-value: `true` → `undefined` | gate, gate_m2a | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "- item\n}"}]}, {"t` |
| 18 | SHAPE_RULES.text | 563 | bool-flip: `true` → `false` | gate, gate_m2a | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "- item\n}"}]}, {"t` |
| 19 | WRITER_ATTRS.language | 470 | logical-swap: `&&` → `\|\|` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "attrs": {"language": "x\ny"}, "content": [{"type": "tex` |
| 20 | WRITER_ATTRS.language | 470 | string-fill: `''` → `'__MUTANT__'` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "attrs": {"language": ""}, "content": [{"type": "text", ` |
| 21 | WRITER_ATTRS.language | 470 | logical-swap: `&&` → `\|\|` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "attrs": {"language": "x\ny"}, "content": [{"type": "tex` |
| 22 | WRITER_ATTRS.language | 470 | logical-swap: `&&` → `\|\|` | gate | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "attrs": {"language": "x\ny"}, "content": [{"type": "tex` |
| 23 | WRITER_ATTRS.level | 467 | boundary: `<=` → `<` | gate, gate_m2a | `"###### Too deep"` |
| 24 | WRITER_ATTRS.level | 467 | number-shift: `6` → `5` | gate, gate_m2a | `"###### Too deep"` |
| 25 | attrsAreRebuildable | 484 | bool-flip: `false` → `true` | gate | `{"type": "doc", "version": 1, "content": [{"type": "heading", "attrs": null, "content": [{"type": "text", "text": "2) ep` |
| 26 | codeBody | 223 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "hardBreak"}]}]}` |
| 27 | codeBody | 223 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "\tindented\n\tinde` |
| 28 | codeBody | 223 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "codeBlock", "content": [{"type": "text", "text": "a\n"}]}]}` |
| 29 | findUnescaped | 407 | number-shift: `1` → `0` |  | `(hang/crash on a batch)` |
| 30 | hasAdjacentUnmarkedRuns | 579 | number-shift: `0` → `1` | gate | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "]( \ud83d\ude80 ](` |
| 31 | hasAdjacentUnmarkedRuns | 579 | arith: `-` → `+` | gate | `{"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "]( \ud83d\ude80 ](` |
| 32 | headingLevel | 209 | number-shift: `6` → `7` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "heading", "attrs": {"level": 7, "localId": "dedc-6156"}, "content": ` |
| 33 | headingLevel | 209 | number-shift: `6` → `5` | a2m, rt_adf, rt_md | `"###### Too deep"` |
| 34 | headingLevel | 209 | number-shift: `1` → `0` | a2m, rt_adf | `"(large; see id)"` |
| 35 | headingLevel | 209 | number-shift: `1` → `2` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "heading", "content": []}]}` |
| 36 | linkAt | 383 | arith: `+` → `-` | m2a, rt_adf, rt_md | `"> - <https://auto.link/path>\n\n- [ ] task\n\n\n_ _\nhttps://ex.com/(x) snake_case_name Fix ][build camelCase retry](ht` |
| 37 | linkAt | 384 | logical-swap: `\|\|` → `&&` | gate_m2a, m2a, rt_adf, rt_md | `"[a [b] c](http://x)"` |
| 38 | linkAt | 386 | number-shift: `0` → `(-1)` |  | `(hang/crash on a batch)` |
| 39 | linkAt | 390 | number-shift: `1` → `2` | gate_m2a, m2a, rt_adf, rt_md | `"[ok na\u00efve](/rel) build \u0645\u0631\u062d\u0628\u0627 _Fix_\n\n---"` |
| 40 | parseInline | 346 | string-empty: `'\\'` → `''` | m2a, rt_adf, rt_md | `":+1: \\[x\\] [x snake_case_name](https://example.com) **42 CI** when\n\n~~~bash\n  y()\n~~~"` |
| 41 | parseInline | 346 | arith: `+` → `-` | m2a, rt_adf, rt_md | `":+1: \\[x\\] [x snake_case_name](https://example.com) **42 CI** when\n\n~~~bash\n  y()\n~~~"` |
| 42 | parseInline | 346 | number-shift: `1` → `2` | m2a, rt_adf, rt_md | `":+1: \\[x\\] [x snake_case_name](https://example.com) **42 CI** when\n\n~~~bash\n  y()\n~~~"` |
| 43 | parseInline | 346 | logical-swap: `??` → `&&` | m2a, rt_adf, rt_md | `":+1: \\[x\\] [x snake_case_name](https://example.com) **42 CI** when\n\n~~~bash\n  y()\n~~~"` |
| 44 | renderNode | 154 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [0]}` |
| 45 | renderTextRun | 196 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "bulletList", "content": "not an array"}, {"type": "paragraph", "cont` |
| 46 | renderTextRun | 199 | string-fill: `''` → `'__MUTANT__'` | a2m, rt_adf | `{"type": "doc", "version": 1, "content": [{"type": "multiBodiedExtension", "content": [{"type": "blockquote", "content":` |
