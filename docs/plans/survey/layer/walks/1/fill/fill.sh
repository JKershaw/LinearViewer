#!/usr/bin/env bash
# Walk 1 retro fill: LIN-4450 (piece 1 of 3 of LIN-4445) into the walk-1 model.
# Rebuilds store.json from empty. Every command run, in order. See fill-log.md.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
M="$HERE/../model/layer.mjs"
S="$HERE/store.json"
rm -f "$S"

# L <layer args...>: run one layer command, print one summary line (id, version, op, hits or refusal).
L() {
  local res rc
  res=$(node "$M" --store "$S" --retro "$@"); rc=$?
  printf '%s\n' "$res" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const o=JSON.parse(s), rc=process.argv[1], cmd=process.argv.slice(2,4).join(" ");
      if (o.ok) { const r=o.record; console.log(`ok   ${cmd.padEnd(22)} -> ${r.id} v${r.v} ${r.state}` + (o.hits&&o.hits.length?`  HITS ${JSON.stringify(o.hits)}`:"")); }
      else console.log(`REFUSED (rc ${rc}) ${cmd}: ${JSON.stringify(o.refused||o.error)}`);
    });' "$rc" "$1" "$2"
}
# P <s1> <s2> <s3> [extra json]: build a plan JSON with the three session pieces.
P() { node -e 'const [a,b,c,x]=process.argv.slice(1);process.stdout.write(JSON.stringify({...(x?JSON.parse(x):{}),pieces:{"session-1":a,"session-2":b,"session-3":c}}))' "$@"; }

T_PRE=2026-11-13T12:00:00.000Z        # placeholder: records that existed before LIN-4445 (real time unknown)
T_TASK1=2026-11-13T12:08:08.059Z      # LIN-4445 createdAt
T_SCOPE1=2026-11-13T13:25:00.000Z     # GUESSED: parent Size record, between Survey global 13:18:53 and Design 13:31:04
T_DESIGN=2026-11-13T13:31:04.282Z     # "Design: LIN-4445"
T_PLAN=2026-11-13T13:36:00.000Z       # GUESSED: Implementation Plan, between Design and Plan Review
T_PREV=2026-11-13T13:40:55.240Z       # "Plan Review Verdict"
T_TASK2=2026-11-13T13:43:57.706Z      # LIN-4450 createdAt
T_BD=2026-11-13T13:44:23.509Z         # "Breakdown: LIN-4445"
T_ST=2026-11-13T13:47:23.104Z         # LIN-4450 "Survey open-0"
T_SP=2026-11-13T13:51:36.308Z         # LIN-4450 "Survey global"
T_SC=2026-11-13T13:55:31.686Z         # scoping: no comment; its last model request (cost record) as the write time
T_PROPEN=2026-11-13T14:07:17.000Z     # PR #2421 opened
T_DEP=2026-11-13T14:08:01.332Z        # LIN-4445 "Session 1 (LIN-4450): where the code moved the plan"
T_SUM=2026-11-13T14:13:35.898Z        # LIN-4450 "LIN-4450: summary"
T_LO=2026-11-13T15:11:36.148Z         # LIN-4450 "Leftovers"
T_RV=2026-11-13T15:18:12.503Z         # LIN-4450 "Review"
T_BR=2026-11-13T15:21:22.841Z         # LIN-4450 "Blind read"
T_MERGE=2026-11-13T15:32:12.000Z      # PR #2421 merged (close-out's fixes are in it)
T_DONE=2026-11-13T15:39:58.729Z       # LIN-4450 completedAt (close-out comment follows at 15:40:37)
T_RB1=2026-11-13T17:49:05.284Z        # LIN-4445 "LIN-4452 live check: runbook for John"
T_RB2=2026-11-13T18:06:33.869Z        # LIN-4445 "runbook for John (corrected, supersedes cf38cbf6)"

# ---------------------------------------------------------------- pre-existing: areas, area notes
L add area '{"name":"providers","paths":["lib/providers/"]}' --at $T_PRE --by Harbour                                   # area-1
L add area '{"name":"llm-and-prompts","paths":["lib/as-asked.js","lib/should-mock-ai.js","lib/prompts/","lib/size-of-move.js","lib/completion-signals.js"]}' --at $T_PRE --by Harbour  # area-2
L add area '{"name":"other-features"}' --at $T_PRE --by Harbour                                                         # area-3
L add area '{"name":"web-routes","paths":["routes/"]}' --at $T_PRE --by Harbour                                        # area-4

L add lesson "$(cat <<'EOF'
{"to":"area-2","in":"area-2","says":"The block's words have one owner: code that needs the As-asked block imports AS_ASKED_HEADING, AS_ASKED_END, splitAsAsked and sealAsAsked from lib/as-asked.js and never retypes their spellings.","about":["lib/as-asked.js"]}
EOF
)" --at $T_PRE --by "LIN-4362"                                                                                         # lesson-1
L add lesson "$(cat <<'EOF'
{"to":"area-2","in":"area-2","says":"Prompt size is frozen: prompt-text changes are re-measured against the budget and the Periodical sha256 tripwire; rebase first, then re-measure.","about":["lib/prompts/","lib/periodicals.js","tests/unit/prompt-size-budget.test.js"]}
EOF
)" --at $T_PRE --by "LIN-4393"                                                                                         # lesson-2
L add finding "$(cat <<'EOF'
{"to":"area-2","in":"area-2","says":"`lib/should-mock-ai.js`: `isHermeticTestToken` is a third test-token check beside `isTestToken` (`routes/workspace-api-steps.js`) and inline `isTestMode` in `routes/proxy-compute.js` and `routes/task-chat.js`.","about":["lib/should-mock-ai.js","routes/workspace-api-steps.js","routes/proxy-compute.js","routes/task-chat.js"]}
EOF
)" --at $T_PRE --by "LIN-4347"                                                                                         # finding-1

# ---------------------------------------------------------------- LIN-4445: the ask
L add task "$(cat <<'EOF'
{"in":"JKershaw/LinearViewer","asked":"Repository: JKershaw/LinearViewer (Harbour). What this is for. The first outside test will be a small team on Jira who already use agents and are looking to have agents build their product. John has used Harbour on Jira for a few weeks: 'it's mostly fine except for the gaps that you've identified.' The gaps: Harbour can't create a Jira issue, so on Jira the loop can't file a task with the person's words sealed, mint a Periodical, or file what a task's last step files; Jira can't yet hold the block that keeps the person's words exactly as asked. What we want. On a Jira-backed workspace, the loop does what it does on Linear: a task can be filed with the person's words sealed, a Periodical can be minted, and a task's last step can file what it files. It's checked on John's own Jira, which is already in real use. Every change names what it retires. Questions: settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.","done-when":"On John's Jira a task filed through Harbour keeps the person's words sealed, a Periodical mints, and a task's last step can file."}
EOF
)" --at $T_TASK1 --by John --via driving-session                                                                       # task-1

L add decision "$(cat <<'EOF'
{"in":"task-1","answer":"Size: just the task. Cuts: none.","basis":"policy: the standing size policy","why":"Jira gains issue creation and a description that keeps the person's words byte-exact through later writes, which opens all three filing lanes; the Surveys' converter, rich-content and capability findings are nearby but none binds on this ask."}
EOF
)" --at $T_SCOPE1 --by scoping                                                                                         # decision-1

L add decision "$(cat <<'EOF'
{"in":"task-1","answer":"Shape B: the exact words live in a Jira issue entity property harbour.asAsked = { v: 1, words, rendered }, written in the same create/edit request; the description holds an ordinary block (h2 'As asked', markdownToAdf(words), italic end line). On read, the region still rendering to `rendered` serves the exact words; otherwise the current rendering (Linear parity). descriptionRoundTrip becomes write-then-read, property included, so providerHoldsAsAsked turns true with no change to lib/as-asked-seal.js.","basis":"policy: the ask's 'settle engineering questions yourself; only John's calls go to him'","why":"B is the only shape that is exact for agents and leaves Jira looking like Jira for its people; the first-dispatch seal will touch tickets the team wrote. A (code-block carrier) turns every formatted Jira-native ticket into a grey raw-Markdown box; C (normalised baseline) needs John's ruling and B doesn't; a lossless codec is whack-a-mole. Would change: site refuses properties in bodies (then separate PUT, still B); John wants the ask shown verbatim as code (A); John rules render-exact acceptable (C)."}
EOF
)" --at $T_DESIGN --by design                                                                                          # decision-2

# ---------------------------------------------------------------- LIN-4445: the plan, v1
S1V1="Session 1: the seal (lands alone). Witnesses are unit tests against fake-client.js. (1) A pure region module beside the provider reads and writes the block. It imports AS_ASKED_HEADING, AS_ASKED_END, splitAsAsked and sealAsAsked from lib/as-asked.js and never retypes their spellings; adf.js stays import-free. The reader finds the region by nodes: an h2 whose text is the heading's text, then a paragraph whose plain text is the end sentence, regardless of marks, and applies the same position rule splitAsAsked applies. If the region's current rendering equals the stored rendered, it serves the exact words; if not, a human edited it in Jira and it serves what the region renders now, behind canonical markers. Without the end paragraph or the heading there is no block. A property with no region is ignored. Witness: reader tests for kept, edited-in-Jira, edited-below-the-line, end line deleted, end line re-marked (_..._ or plain), localId added, stale property with no block. (2) Comparison is on rendered content, never ADF hashes (Jira adds localId on ordinary saves). (3) Every description read in index.js goes through the one reader. Single-issue reads (fetchIssueFields, context issue, parent, issueDescription) fetch with properties=harbour.asAsked; the bulk path does not (display only, converted words). client.getIssue gains properties and the fake honours it. Witness: a test fails if adfToMarkdown is applied to a description field in index.js outside the reader. (4) updateIssue writes the property in the same PUT whenever the new description holds a block, words from splitAsAsked of what it was handed; no block, no property. client.updateIssue and the fake accept properties. Witness: byte equality of words after filing, a later write of what was read, a description/below write, and a human edit below the line. (5) descriptionRoundTrip becomes write-then-read, property included; providerHoldsAsAsked turns true with no change to lib/as-asked-seal.js apart from its stale header. Witness: Jira cases of as-asked-create-seal, as-asked-dispatch-seal and as-asked-readers flip from skipped to sealed and kept (* a bullets, *em*, a fence with a blank line, trailing spaces). (6) Size guard: Jira limits an entity property value to about 32 KB (builder confirms from Atlassian's docs). Too large: descriptionRoundTrip reports a non-kept read-back, so the lane files unsealed with the existing log line; updateIssue refuses with a 422 naming the size, before any write. Witness: an oversized body is filed unsealed with the log line; an oversized updateIssue writes nothing."
S2V1="Session 2: creation. (7) Client createIssue (POST /rest/api/3/issue, fields and properties) and getCreateMeta; provider createIssue creates, then re-reads and returns the canonical issue; property from splitAsAsked of the description given. createFields() becomes title, description, teamId (a Jira project key); apiWriteFields() adds projectId (an epic: parent on team-managed, Epic Link via _resolveEpicLinkFieldId on company-managed) and parentId, not stateId. (8) Issue type chosen inside the provider from createmeta: prefer Task, else first standard non-subtask at level 0; subtask type with a parent. A required field with no default beyond the basics returns 422 naming it and creates nothing. Cached briefly per site and project. (9) All three lanes work on the Jira fake end to end; inlineCreate turns true through supports('createIssue'); getCreateTaskUrl stays overridden because ui.write derives from it. (10) Retires: the deep-link create path on Jira; inlineCreate: false; the stale LIN-1557 comments; the 'Jira is skipped today' seal claims in lib/as-asked-seal.js, lib/as-asked.js and the descriptionRoundTrip comment; README line 60 and docs/proxy-integration.md 'Jira files unsealed'; CONSEQUENCE_TEST's 'cannot create tickets' branch; 'Linear task' wording in lib/periodicals.js. (11) Prompt-text changes re-measured against prompt-size-budget and the Periodical hash; rebase first."
S3V1="Session 3: live check and leftovers (needs John's Jira credentials). (12) On John's Jira: file one task through Harbour, mint one Periodical, perform one last-step filing; re-read each and check kept; write below the line once and re-check; record the createmeta result and whether the site accepted properties in create and edit bodies. Site rejects properties: separate PUT /issue/{key}/properties/harbour.asAsked straight after, failure through PartialWriteError (still shape B). A required custom field is a finding for a follow-up ticket. No credential: park it as a handoff to John (what to run, what to paste back), not as done. (13) File one ticket for the markdownToAdf fenced-block-with-blank-line bug; create docs/areas/providers.md with two Waiting entries: widening the D1 writer vocabulary, and an explicit 'holds verbatim text' provider capability."
L add plan "$(P "$S1V1" "$S2V1" "$S3V1" '{"in":"task-1"}')" --at $T_PLAN --by design                                   # plan-1 v1
L link task-1 about plan-1 --at $T_PLAN --by design

# ---------------------------------------------------------------- LIN-4445: plan review -> plan v2 + verdict
S1V2="$S1V1 Plan review: (note 2) every provider-side client.getIssue asks for the property, not just the four listed: updateIssue's confirmation re-read (~1267), updateIssueLabels' re-read (~1110) and the new createIssue re-read too; the bulk search path may stay display-only. (note 3) Store a SHA-256 digest of rendered, not the rendering itself; Atlassian documents the entity-property value limit as 32768 characters (confirm and cite); one shared size function that descriptionRoundTrip, updateIssue and (piece 2) createIssue all call, so the seal check and the 422 can never disagree. (note 6) adfToMarkdown legitimately remains at index.js:924 and :1295 for comment bodies; pin the guard test on description fields, not a raw grep count."
S2V2="$S2V1 Plan review: (note 4) the Periodical report gate never fires on Jira: add description (through the composed reader) and recent comments to Jira's issueWriteGuard, recommended; or file a ticket. (note 5) parentId is not reachable through the lanes as planned: refuse a non-UUID parentId (400), accept the provider's own id form, or leave parentId out and record a follow-up; don't advertise subtasks until resolved."
S3V2="$S3V1 Plan review: (note 1) make the live check able to fail: file at least one body with lossy constructs (* a bullets, *em*, trailing spaces, a list starting at 3.); assert byte equality of the read-back words against what was filed; record whether the reader took the rendered-match branch."
L revise plan-1 "$(P "$S1V2" "$S2V2" "$S3V2")" "Plan Review Verdict (61e84035): notes 1-6, corrections the builder can make without changing the plan's shape, folded into the pieces they bear on" --at $T_PREV --by plan-review   # plan-1 v2
L add verdict '{"in":"task-1","outcome":"pass","on":"plan-1@2"}' --at $T_PREV --by plan-review                        # verdict-1

# ---------------------------------------------------------------- LIN-4445: breakdown -> LIN-4450 (and its siblings as stubs)
L add task "$(cat <<'EOF'
{"in":"area-1","parent":"task-1","done-when":"All of the above pass on fake-client.js. Jira's descriptionRoundTrip holds sealed words byte-exact, D1's rich-content guard is unchanged, and the PR names what it retires (the 'Jira skipped/unsealed' seal claims in code headers). Once this lands, the first-dispatch seal begins sealing Jira-native tickets on live sites: expected, logged on failure, dispatch continues."}
EOF
)" --at $T_TASK2 --by breakdown                                                                                       # task-2 = LIN-4450
L link task-2 about plan-1#session-1 --at $T_TASK2 --by breakdown
L link task-2 about area-2 --at $T_TASK2 --by breakdown
L link task-2 on "commit:4b5001ddf" --at $T_TASK2 --by breakdown
L add decision "$(cat <<'EOF'
{"in":"task-2","answer":"Plan-review due: no. Session fit: fits one session.","basis":"verdict-1","why":"Covered by LIN-4445's approving plan-review (comment 61e84035, rev 1); grounding commit 4b5001ddf re-checked at breakdown with no commits on the plan's paths since."}
EOF
)" --at $T_TASK2 --by breakdown                                                                                       # decision-3
L add task "$(cat <<'EOF'
{"in":"area-1","parent":"task-1","done-when":"Jira createIssue opens the proxy, session and feedback filing lanes on the fake, and the deep-link create path is retired (plan session 2, items 7-11, plus review notes 4 and 5)."}
EOF
)" --at $T_BD --by breakdown                                                                                          # task-3 = LIN-4451 (stub)
L link task-3 about plan-1#session-2 --at $T_BD --by breakdown
L add task "$(cat <<'EOF'
{"in":"area-1","parent":"task-1","done-when":"On John's Jira: sealed filing, Periodical mint and last-step filing each re-read kept, a below-the-line write re-checked (lossy body, byte equality, digest-match branch recorded), and the leftovers filed; with no credential, an explicit handoff to John, not a cut (plan session 3, items 12-13, plus review note 1)."}
EOF
)" --at $T_BD --by breakdown                                                                                          # task-4 = LIN-4452 (stub)
L link task-4 about plan-1#session-3 --at $T_BD --by breakdown

# ---------------------------------------------------------------- LIN-4450: Survey open-0 (survey-task)
L add question "$(cat <<'EOF'
{"to":"implementation","in":"task-2","asks":"The node rule and the markdown rule disagree about what counts as an end line. hasMarkerLine and splitAsAsked match the end sentence only with its *...* exactly; the planned ADF reader matches a paragraph whose plain text is the end sentence, whatever its marks. Words holding that sentence as plain or _..._ text are sealed, then the node reader closes the region early, the digest misses, and the tail is served as if below the line. Nobody is told. Decide which up front.","options":["make hasMarkerLine catch the plain-text form too","have the node rule take the last matching paragraph before non-region content"],"if-unanswered":"Silent misread of the words' tail; the pure descriptionRoundTrip catches it only if it runs the same node reader."}
EOF
)" --at $T_ST --by survey-task                                                                                        # question-1
L link question-1 about plan-1#session-1 --at $T_ST --by survey-task
L add question "$(cat <<'EOF'
{"to":"scoping","in":"task-2","asks":"The codec's 'the D1 gate never flags what the writer emits' claim is false: an empty fence makes markdownToAdf emit an empty codeBlock that adfHasUnrenderableContent refuses, and rt(rt(x)) !== rt(x) for it. Once Harbour writes the block itself, that ticket's description can never be written again (every later description/below hits 422 on D1). The plan says 'D1 unchanged', but D1 sees the whole document, the block included. Pick one deliberately.","options":["fix the codec","exclude the input from the fixed-point test"],"if-unanswered":"The planned fixed-point test fails on this input."}
EOF
)" --at $T_ST --by survey-task                                                                                        # question-2
L link question-2 about plan-1#session-1 --at $T_ST --by survey-task
L add check "$(cat <<'EOF'
{"to":"John","in":"task-2","what":"Before writing any code, a 15-minute live probe on a real Jira site: does the edit endpoint accept properties, and does the region's adfToMarkdown rendering (so the SHA-256 digest) stay stable across Jira's ordinary saves below the line? Nothing shows the editor leaves alone trailing spaces before a hardBreak, how adjacent text nodes split, or empty paragraphs; if they shift, every sealed issue reads as human-edited and the words quietly turn into the rendering (*em* -> _em_, * a -> - a).","why-person":"Done-when only proves things on fake-client.js, and the real risk is live Jira; the fake merges fields and stores whatever it's given, so it can't show this.","how":"1. PUT a sealed description holding the witness inputs, with properties [{key:'harbour.asAsked', ...}] in the same body. 2. GET it with ?properties=harbour.asAsked. 3. Edit a line below the block in Jira's own editor and save. 4. GET again and diff adfToMarkdown(region). If the rendering holds, the plan stands as written. If not, the digest has to be taken over a normalised rendering: a design change, recorded on LIN-4445."}
EOF
)" --at $T_ST --by survey-task                                                                                        # check-1
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"The bulk search path stays display-only, so one issue reads differently through search than through getIssue: check that no cache or guard compares the two.","about":["lib/providers/jira/index.js"]}
EOF
)" --at $T_ST --by survey-task                                                                                        # finding-2
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"Atlassian's property limit is in bytes or characters depending on which page you read. JSON escaping inflates words, so measure the serialized string.","about":["plan-1#session-1","lib/providers/jira/"]}
EOF
)" --at $T_ST --by survey-task                                                                                        # finding-3

# ---------------------------------------------------------------- LIN-4450: Survey global (survey-place)
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"Two stores of the words (ADF region plus property, a digest deciding): safe only while the region module is the one place that knows both. A second ADF walker: adf.js already has plainText (~340), private; export it rather than retype it, and render the region with adfToMarkdown({type:'doc',content}), not a new renderer.","about":["plan-1#session-1","lib/providers/jira/adf.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-4
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"The reader accepts more than the writer refuses: 'whatever its marks' means a plain paragraph of the end sentence in the words ends the region early, and hasMarkerLine doesn't refuse that. Safe only if descriptionRoundTrip runs through the same reader, so the filing reads non-kept and goes in unsealed. Worth one witness.","about":["plan-1#session-1","lib/as-asked.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-5
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"Scatter: there are 8 getIssue sites. Four never read a description (703, 1018, 1076, the pre-read at 1099). fetchIssueFields (818) feeds _toCanonicalIssue but isn't in the plan's list. Write one read-with-words helper beside the reader, not properties threaded through each call.","about":["plan-1#session-1","lib/providers/jira/index.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-6
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"What has to learn, beyond the three headers named: dispatch-factory.js:1008; docs/proxy-integration.md:2070 (agent-facing, says Jira files unsealed); docs/architecture/source-map.md:216 and :82 (the new module needs a mention); as-asked-guard.test.js, whose Jira block (345, 351) will fail, so it notices. The docs won't.","about":["plan-1#session-1","lib/dispatch-factory.js","docs/proxy-integration.md","docs/architecture/source-map.md","tests/unit/as-asked-guard.test.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-7
L add finding "$(cat <<'EOF'
{"to":"task-2","in":"task-2","says":"A branch left without a witness: as-asked-create-seal.test.js:207-227 uses Jira's round trip as the provider that cannot hold the block. After the flip, sealForFiling's reason:'provider' branch has no subject in production or tests. Witness it with a synthetic lossy round trip, or retire it on purpose. as-asked.js's 'When the unsealed branches could go' drops 'Jira today' but stays permanent because of older tickets.","about":["lib/as-asked-seal.js","lib/as-asked.js","tests/unit/as-asked-create-seal.test.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-8
L add finding "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"Better still, not this task's: live Jira-native tickets. The first-dispatch seal writes back through updateIssue. D1 refuses any ticket that holds a mention, emoji or panel (common), and logs it once per first dispatch. Tickets that pass get their ADF normalised, and their words become the escaped rendering: the codec's lossiness showing, deeper than this task.","about":["lib/providers/jira/adf.js","lib/dispatch-factory.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-9
L add finding "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"Better still, not this task's: the bulk search path could ask for properties (search/jql accepts it), so the dashboard would show exact words.","about":["lib/providers/jira/index.js"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-10
L add finding "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"Better still, not this task's: comment weight. index.js's header and source-map's jira paragraph carry more history than guidance.","about":["lib/providers/jira/index.js","docs/architecture/source-map.md"]}
EOF
)" --at $T_SP --by survey-place                                                                                       # finding-11

# ---------------------------------------------------------------- LIN-4450: scoping (Size of the move, in the description)
L add decision "$(cat <<'EOF'
{"in":"task-2","answer":"Size: a small tidy. Cuts: none. The empty-fence fix is in: one tidy done first.","basis":["question-2","policy: the standing size policy"],"why":"Jira holds the person's words byte-exact, plus one tidy done first: an empty fenced code block in the words no longer files a description that refuses every later write below the line, which the seal exists to allow."}
EOF
)" --at $T_SC --by scoping                                                                                            # decision-4
L end question-2 answered "decision-4: fix the codec, as one tidy done first (Size of the move)" --at $T_SC --by scoping

# ---------------------------------------------------------------- LIN-4450: implementation
L link task-2 on "PR#2421" --at $T_PROPEN --by implementation
S1V3="Session 1: the seal (lands alone). Witnesses are unit tests against fake-client.js. (1) A pure region module beside the provider (lib/providers/jira/as-asked-region.js) reads and writes the block. It imports AS_ASKED_HEADING, AS_ASKED_END, splitAsAsked and sealAsAsked from lib/as-asked.js and never retypes their spellings; adf.js stays import-free. The reader finds the region by nodes: an h2 whose text is the heading's text, then a paragraph whose plain text is the end sentence, regardless of marks. End-line choice is by digest, not by position: the reader takes the end candidate whose region renders to the stored rendered; the writer takes the candidate whose interior renders to the words (hasMarkerLine and splitAsAsked unchanged, so Linear is unaffected). Digest matches: exact words; otherwise the region's rendering behind canonical markers. No end paragraph or heading: no block. A property with no region is ignored. rendered is a SHA-256 digest of the region's rendering. Witness: reader tests for kept, edited-in-Jira, edited-below-the-line, end line deleted, end line re-marked (_..._ or plain), localId added, stale property with no block. (2) Compare rendered content, never ADF hashes. (3) Every description read in index.js goes through the one reader; every provider-side getIssue asks for the property, including the epic and parent reads and the updateIssue/updateIssueLabels re-reads; the fake returns only requested keys, as real Jira does; the bulk path stays display-only. Witness: a test fails if adfToMarkdown is applied to a description field outside the reader (comment bodies keep direct conversion). (4) updateIssue writes the property in the same PUT whenever the new description holds a block, words from splitAsAsked; no block, no property. Witness: byte equality across filing, a later write, a description/below write and a human edit below the line. (5) descriptionRoundTrip is a pure write-then-read through the same reader, property included, and throws on a block it cannot hold (too large, or interior does not read back); providerHoldsAsAsked treats a throw as cannot hold, so the seal is skipped with the existing log line; no logic change to lib/as-asked-seal.js. Witness: Jira cases of the create-seal, dispatch-seal and guard tests flip to sealed and kept. (6) Size guard: one function; the 32,768 limit is enforced on UTF-8 bytes of the serialized property, JSON escaping included (Atlassian says bytes on some pages and characters on others; the stricter reading; source developer.atlassian.com/cloud/jira/platform/jira-entity-properties). Oversized filing goes in unsealed and verbatim with the log line; oversized updateIssue returns 422 naming the size and writes nothing. (7) Empty fenced code block fixed in the codec: it renders as the bare fence and the write gate accepts an empty fence (it rendered as a blank line between fences, which the writer tore apart, so the description refused every later below-the-line write)."
L revise plan-1 "$(P "$S1V3" "$S2V2" "$S3V2")" "Session 1 (LIN-4450): where the code moved the plan. Built as planned (shape B, items 1-6) with five departures, each reasoned in the code: end-line choice by digest; size limit in bytes; round trip throws; empty-fence fix in the codec; every provider-side getIssue asks for the property" --at $T_DEP --by implementation   # plan-1 v3
L add decision "$(cat <<'EOF'
{"in":"task-2","answer":"Neither option as posed: the end line is chosen by digest, not by position. The reader takes the end candidate whose region renders to the stored rendered; the writer takes the candidate whose interior renders to the words. hasMarkerLine and splitAsAsked are unchanged, so Linear is unaffected.","basis":"question-1","why":"The plan's 'first end paragraph after the heading' fails when the words hold the end sentence as plain or _..._ text: the reader closes early and the tail is served below the block."}
EOF
)" --at $T_DEP --by implementation                                                                                    # decision-5
L end question-1 answered "decision-5: end line chosen by digest" --at $T_DEP --by implementation
L end finding-3 done "Size limit in bytes: 32,768 on UTF-8 bytes of the serialized property, JSON escaping included (plan-1 v3)" --at $T_DEP --by implementation

L end finding-4 done "The reader and writer are in lib/providers/jira/as-asked-region.js, the only module that knows the ADF region and the property; adf.js exports plainText for it" --at $T_SUM --by implementation
L end finding-5 done "descriptionRoundTrip runs the same reader (holdAsAsked then readDescription); witnessed with the end sentence as plain and as _..._ text" --at $T_SUM --by implementation
L end finding-6 done "Every provider-side getIssue asks for the property through one read option (AS_ASKED_READ)" --at $T_SUM --by implementation
L end finding-7 done "Retired in the PR: the dispatch-factory 'Jira today' note and proxy-integration 'Jira files unsealed'; the region module added to source-map; the guard test's Jira block flipped" --at $T_SUM --by implementation
L end finding-8 done "The sealForFiling provider-skip branch is witnessed with a synthetic lossy round trip" --at $T_SUM --by implementation
L link task-2 on "PR#2421@a98d042c6" --at $T_SUM --by implementation

# ---------------------------------------------------------------- LIN-4450: leftover (follow-up of implementation)
L revise finding-10 "$(cat <<'EOF'
{"says":"`lib/providers/jira/index.js`: the bulk reads (`fetchProjects`, and `fetchIssueContext`'s children through `searchAllIssues`) do not ask for `harbour.asAsked`. A sealed block therefore shows its converted rendering on the dashboard and in a parent's children, while single-issue reads serve the exact words. `POST /rest/api/3/search/jql` accepts `properties`, so asking for it there would make the bulk path exact too. No guard or cache compares the two today. (LIN-4450 leftovers; Survey global, LIN-4450.)"}
EOF
)" "Leftovers: noted as the Waiting entry in docs/areas/providers.md (new)" --at $T_LO --by leftover
L add lesson "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"A Jira description has one reader and one writer: readDescription and holdAsAsked in lib/providers/jira/as-asked-region.js. They are the only code that knows the ADF region and the harbour.asAsked entity property, and every provider-side getIssue passes AS_ASKED_READ. Shape B keeps the words in two places, safe only while one module knows both. A new description read that calls adfToMarkdown directly serves converted words and breaks the seal without anyone being told; tests/unit/jira-as-asked-region.test.js fails on it.","about":["lib/providers/jira/as-asked-region.js","lib/providers/jira/index.js"],"checked-at":"f9fa4a80c"}
EOF
)" --at $T_LO --by leftover                                                                                           # lesson-3
L add lesson "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"Decide whether the words are kept by comparing renderings, never ADF. Jira stamps localId and similar attributes on ordinary saves, and adfToMarkdown ignores them. A hash of the ADF would read every human save as an edit.","about":["lib/providers/jira/as-asked-region.js"],"checked-at":"f9fa4a80c"}
EOF
)" --at $T_LO --by leftover                                                                                           # lesson-4
L add lesson "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"The region reader accepts an end line whatever its marks, which is looser than splitAsAsked. It stays safe because descriptionRoundTrip runs the same reader the reads do, so a block the reader would misplace is refused at filing. Keep the seal's check and the reads on one reader. (Survey open-0.)","about":["lib/providers/jira/as-asked-region.js","lib/as-asked.js"],"checked-at":"f9fa4a80c"}
EOF
)" --at $T_LO --by leftover                                                                                           # lesson-5
L add lesson "$(cat <<'EOF'
{"to":"area-1","in":"area-1","says":"The Jira fake proves only the provider's own logic. It stores whatever it is handed and never normalises ADF, so it cannot show whether live Jira keeps a region's rendering. A claim about live behaviour needs a live check (LIN-4452).","about":["lib/providers/jira/fake-client.js"],"checked-at":"f9fa4a80c"}
EOF
)" --at $T_LO --by leftover                                                                                           # lesson-6
L end finding-1 done "Retired: the identical inline test-token checks in routes/proxy-compute.js, routes/task-chat.js, routes/workspace-api-steps.js (isTestToken) and server.js now call isHermeticTestToken; behaviour unchanged" --at $T_LO --by leftover
L link task-2 on "PR#2421@f9fa4a80c" --at $T_LO --by leftover

# ---------------------------------------------------------------- LIN-4450: review
L add verdict '{"in":"task-2","outcome":"pass","on":"PR#2421@f9fa4a80c"}' --at $T_RV --by review                     # verdict-2
L add finding "$(cat <<'EOF'
{"to":"close-out","in":"task-2","says":"Fix for close-out: tests/unit/jira-as-asked-region.test.js, test 'an oversized body is not sealed...' (~line 262): capture console.log during the sealForFiling call; assert exactly one line equal to '[as-asked] seal skipped: provider jira cannot hold the block (test)'. This pins the 'with the log line' clause of the oversize witness.","about":["tests/unit/jira-as-asked-region.test.js"]}
EOF
)" --at $T_RV --by review                                                                                             # finding-12
L add check "$(cat <<'EOF'
{"to":"John","in":"task-2","what":"Inside (property semantics, item 6): live Jira accepts properties [{key:'harbour.asAsked', value}] on PUT /rest/api/3/issue/{key} and returns it as properties['harbour.asAsked'] on GET ?properties=harbour.asAsked.","why-person":"The fake is built to that shape, but no test reaches Atlassian; no credential for John's site exists in a build session.","how":"After the deploy: the LIN-4452 live check on John's site, as one sealed updateIssue. Right: the re-read's properties['harbour.asAsked'].words is byte-equal to the words written. An absent properties key means the PUT dropped it."}
EOF
)" --at $T_RV --by review                                                                                             # check-2
L add check "$(cat <<'EOF'
{"to":"John","in":"task-2","what":"Inside (the reader, item 1: compare rendered content): live Jira's editor keeps the region's adfToMarkdown rendering, and so the digest, when someone edits and saves a line below the block. If it does not, every sealed issue silently serves converted words (*em* -> _em_).","why-person":"The fake cannot normalise ADF (providers.md lesson, LIN-4450); needs John's site and its editor.","how":"After the deploy: the LIN-4452 live check, following plan-review note 1. File a lossy body (* a, *em*, trailing spaces, 3.). Edit one line below the block in Jira's own editor and save. Re-read. Right: the words are byte-equal to what was filed and the digest-match branch was taken (digest(region) === property.rendered). Wrong: the words equal adfToMarkdown(markdownToAdf(words))."}
EOF
)" --at $T_RV --by review                                                                                             # check-3
L add check "$(cat <<'EOF'
{"to":"John","in":"task-2","what":"Inside (the consequence named in Done-when): once this is live, the first dispatch of a Jira-native ticket writes the block through updateIssue.","why-person":"Needs a never-dispatched Jira-native ticket on John's site.","how":"After the deploy: dispatch one never-dispatched Jira-native ticket on John's site. Right is either of two outcomes, with the dispatch row enqueued in both: the ticket shows the formatted block with no 'seal skipped' line, or a ticket carrying mentions/emoji/panels logs the existing D1 refusal line."}
EOF
)" --at $T_RV --by review                                                                                             # check-4
L end finding-2 done "Checked the readFact/askedText/checkAsAsked callers: bulk reads go through readDescription without a property, so they still see a well-formed block; no guard compares bulk reads with single-issue reads" --at $T_RV --by review
L link check-2 same-as check-1 --at $T_RV --by review
L link check-3 same-as check-1 --at $T_RV --by review
L end check-1 declined "Not run before code: no credential for John's site in a build session. Restated as post-deploy checks check-2 (property semantics) and check-3 (digest survives an editor save), which LIN-4452 owns by the approved breakdown" --at $T_RV --by review

# ---------------------------------------------------------------- LIN-4450: blind read
L add verdict '{"in":"task-2","outcome":"pass","on":"PR#2421@f9fa4a80c"}' --at $T_BR --by blind-read                 # verdict-3
L add finding "$(cat <<'EOF'
{"to":"close-out","in":"task-2","says":"Inside the area, fix-sized (web-routes): routes/workspace-api-audit.js lines 35-36 still write process.env.NODE_ENV === 'test' && (workspace.accessToken === 'test-token' || ...) inline; the sweep moved every sibling copy onto isHermeticTestToken and missed this one. Fix: isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local'). It keeps its own predicate, as its comment asks.","about":["area-4","routes/workspace-api-audit.js"]}
EOF
)" --at $T_BR --by blind-read                                                                                         # finding-13
L add finding "$(cat <<'EOF'
{"to":"close-out","in":"task-2","says":"Inside the area, fix-sized (web-routes): routes/workspace-api-steps.js isTestToken is now a one-line second name for isHermeticTestToken(workspace.accessToken). Fix: have its callers (workspace-api-issue-read.js, workspace-api-issue-write.js, workspace-api-prompts.js) import the helper directly and drop the alias.","about":["area-4","routes/workspace-api-steps.js"]}
EOF
)" --at $T_BR --by blind-read                                                                                         # finding-14
L add finding "$(cat <<'EOF'
{"to":"close-out","in":"task-2","says":"Inside the area, fix-sized (other-features, for lib/as-asked-seal.js; llm-and-prompts, for lib/as-asked.js): tests/unit/jira-as-asked-region.test.js line 291, 'no longer claim that Jira is skipped', only checks that three phrases are missing from two comment headers; it says nothing about behaviour, and as-asked-create-seal.test.js already checks that Jira holds the block. Fix: delete it.","about":["area-3","area-2","tests/unit/jira-as-asked-region.test.js"]}
EOF
)" --at $T_BR --by blind-read                                                                                         # finding-15
L add question "$(cat <<'EOF'
{"to":"close-out","in":"task-2","asks":"Inside the area, larger (providers): client.searchIssues never asks for harbour.asAsked, so issues built through _toCanonicalIssue by fetchProjects/fetchIssues (~769) and fetchIssueContext's children (~897) come back with the ADF rendering behind canonical markers, while fetchIssueFields, fetchIssueContext().issue and issueDescription return the exact property words for the same issue (jira-as-asked-region.test.js:166 pins this split). Closing it is a decision.","options":["every dashboard batch asks /search/jql for properties (up to 32 KB per issue)","batch descriptions are documented as not carrying the exact words"]}
EOF
)" --at $T_BR --by blind-read                                                                                         # question-3
L link question-3 about area-1 --at $T_BR --by blind-read

# ---------------------------------------------------------------- LIN-4450: close-out
L end finding-12 done "Review's named fix: the oversize test captures console.log and asserts exactly one line; checked it bites (changing the wording turns it red); commit 26299c9b0" --at $T_MERGE --by close-out
L end finding-13 done "routes/workspace-api-audit.js now reads isHermeticTestToken(workspace.accessToken) || (NODE_ENV==='test' && workspace.provider==='local'); same predicate, local-provider alternative kept" --at $T_MERGE --by close-out
L end finding-14 done "Removed isTestToken from routes/workspace-api-steps.js; workspace-api.js, -prompts.js, -issue-read.js, -issue-write.js and the steps file call isHermeticTestToken(workspace.accessToken) directly" --at $T_MERGE --by close-out
L end finding-15 done "Deleted 'no longer claim that Jira is skipped' (behaviour is covered by as-asked-create-seal)" --at $T_MERGE --by close-out
L link task-2 on "PR#2421@26299c9b0" --at $T_MERGE --by close-out
L link task-2 on "commit:2bf788b6d" --at $T_MERGE --by close-out
L link question-3 same-as finding-10 --at $T_DONE --by close-out
L end question-3 shelved "Outside: its home is the Waiting entry in docs/areas/providers.md (finding-10), already on main from this PR, so no ticket" --at $T_DONE --by close-out
L revise check-2 '{"in":"task-4","to":"operator"}' "Close-out ledger: not run; needs a real Jira site and credentials a build session does not have; LIN-4452 owns it; per the close-out rules post-deploy checks do not hold the close; listed for the operator" --at $T_DONE --by close-out
L revise check-3 '{"in":"task-4","to":"operator"}' "Close-out ledger: not run, same reason; LIN-4452 owns it; listed for the operator" --at $T_DONE --by close-out
L revise check-4 '{"in":"task-4","to":"operator"}' "Close-out ledger: not run, same reason; LIN-4452 owns it; listed for the operator" --at $T_DONE --by close-out
L end task-2 done "Merged PR #2421 (squash 2bf788b6d, pinned to head 26299c9b0, CI green); deployed (harbour.cat footer shows 2bf788b6d). Review's gap analysis stands: every item of As asked met, one declared departure (the empty-fence codec shape)" --at $T_DONE --by close-out

# ---------------------------------------------------------------- LIN-4445, later: what became of LIN-4450's open checks
L revise check-2 "$(cat <<'EOF'
{"to":"John","how":"Runbook cf38cbf6 (LIN-4445), for John on his machine against his Jira, from main including PR #2437. Step 2, sealed filing with a body that changes under the codec (Ship the *button* change / * a / * b / *em* trailing spaces / 3. three): POST /api/proxy/issues, then GET /rest/api/3/issue/KEY?properties=harbour.asAsked&fields=description and GET .../properties/harbour.asAsked, then check-as-asked.mjs: propertyPresent, propertyWordsByteEqualToSent, readBackWordsByteEqualToSent, readerBranchDigestMatch, codecChangesTheWords; KEPT only if all are true. A PartialWriteError whose message says the property 'did not keep' is the drop case: record its text verbatim and continue. Step 3: write below the line once through Harbour (POST .../description/below) and re-check. Paste check-1.txt, check-2.txt, property-1.json back on LIN-4445."}
EOF
)" "LIN-4452 live check: runbook for John (the handoff); parked because the build session has no Jira credentials or dispatch-grant token" --at $T_RB1 --by implementation
L revise check-2 "$(cat <<'EOF'
{"how":"Runbook f495ca4b (LIN-4445, supersedes cf38cbf6), for John on his machine against his Jira, from main including PR #2437. Step 2, sealed filing with a body that changes under the codec: POST /api/proxy/issues, then GET /rest/api/3/issue/KEY?properties=harbour.asAsked&fields=description and GET .../properties/harbour.asAsked, then check-as-asked.mjs (propertyPresent, propertyWordsByteEqualToSent, readBackWordsByteEqualToSent, readerBranchDigestMatch, codecChangesTheWords; KEPT only if all true). A drop shows as 500 with code PARTIAL_WRITE, retryable false, context {applied:[created], failed:property}: read the drop from that envelope, not the message text; take the key from the message ('Jira created ENG-n but did not keep ...'); record the envelope verbatim; do not retry the create; the separate PUT fallback becomes the next change. Step 3: write below the line once through Harbour and re-check. Paste check-1.txt, check-2.txt, property-1.json and create-1.out.json (if the drop happened) back on LIN-4445."}
EOF
)" "Corrected runbook after review of PR #2437: step 2 reads a drop from the PARTIAL_WRITE envelope, not the message text" --at $T_RB2 --by implementation

echo "--- check"
node "$M" --store "$S" check
echo "--- hits"
node "$M" --store "$S" hits
