You are rebuilding one JavaScript module from its documentation and tests, in a clean room: you never see the original code.

**Your folder** is `<ROOM>`. It holds:

- `SPEC.md`: every comment from the original module, in order, with all code removed;
- `tests/unit/jira-provider-adf-codec.test.js`: the module's test file, 200 tests;
- `node_modules/marked`: the Markdown renderer Harbour's browser uses to display descriptions. Some tests use it to check what users actually see;
- `lib/providers/jira/index.js`: a stub caller;
- `lib/providers/jira/adf.js`: empty. This is the file you write.

**The clean-room rule.**

- Read and write only inside that folder. Do not open, list or search any other path on this machine, including the folder's parent and the current working directory you started in.
- Start every shell command with `cd <ROOM> &&` and use relative paths after that.
- Give Read, Write, Edit, Glob and Grep absolute paths inside the folder.
- Do not use git, and do not look for the original source anywhere, local or online.
- You may read public documentation on the web: Atlassian's ADF structure pages (https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) and the CommonMark spec.
- Every tool call you make will be audited against this rule afterwards. If you're unsure whether something is allowed, don't do it, and say so in your report.

**The goal.** Rebuild `lib/providers/jira/adf.js` as a whole. It is a pure ES module with no imports, exporting exactly three functions:

- `adfToMarkdown(doc)`;
- `markdownToAdf(markdown)`;
- `adfHasUnrenderableContent(doc)`.

The code that does it should be cleaner. The owner, John, defines cleaner as "cognitively simpler, less room for bugs, easy to maintain". He defines success as: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Decision.**

- **Same output for any input the tests or the recorded decisions cover.** The recorded decisions are the comments in `SPEC.md`. They are behaviour and stay. For example:
  - escaping is unconditional;
  - unknown nodes fall back to their text;
  - the gate is derived from what the writer can rebuild, with its four named exceptions.

  Change nothing else on purpose. The tests are the evidence of equivalence; don't build a comparison harness.
- **Keep the reasons a reader needs, with their ticket or ruling references, beside the code they govern.** The history of how the code got there can go.
- **Don't change or delete any existing test.** If one looks wrong, leave it and report it.
- **New tests are optional.** If you add any, put them at the end of the test file. They must pin behaviour the spec or the existing tests already describe; don't add new behaviour. They will later be run against the original module.
- **If the spec and the tests seem to disagree, or leave something open, the tests win.** Note every such point.
- Don't edit the stub. Run the tests with `node --test tests/unit/*.test.js` from the folder.

**Report back** (under 500 words):

- that the tests pass, with the counts;
- each place where the spec or tests left behaviour open, or seemed to disagree, and what you chose;
- any part you found hard to get right;
- roughly how long it took;
- confirmation that you stayed inside the folder.
