Verdict: **Needs Discussion.** The build is sound, but the plan cut part of what was asked and nobody has agreed to that cut yet.

**It's already merged.** The review is of head `4f247b68`, the squash of PR #2221, and that commit is already on `main`: John merged it at 18:33, though the 18:18 comment said it "waits on review". So any fixes go in as a follow-up commit on this ticket. Reverting `4f247b68` would undo it cleanly.

**Tests:**
- **CI:** I can't read the GitHub checks from here, so I ran the suites myself on both branches.
  - Unit tests: 22135/22135 pass on head and 22092/22092 on base, with no failing names on either.
  - Browser tests: the landing, agent-prompt and library specs pass on head, 39/39.
- **Mutations:** the tests that matter go red when I remove the code they cover, 15 mutations in all and each one reverted. The two `server.js` changes are only caught by the browser tests.

**What I checked by hand:**
- **Hero:** byte-identical to base across all 16 sign-in and free-tier flag combinations.
- **Guide links:** on a running server, every link in the served guide resolves. Neither guide page sets a cookie.
- **Path (a) in a browser** at 390px and 1280px: `/swipe` → "+ local workspace" → Proxy works.
- **Screenshots** at 320px and 1280px, light and dark: no sideways scroll.
- **Sign-in skip:** the planned check that the guide pages never trigger the automatic sign-in passes when I run it, but it isn't in the repo.

**What was asked:**
- Sentences 1 and 2 are met.
- Sentence 3 ("…without the user needing to follow those steps") is only partly met. The person still signs in, connects an OpenRouter key and mints the runner key. The plan called this a cut that "needs a ruling". The only ruling on the thread is the prominence one, and a plan can't agree to a cut on the person's behalf.

**Gaps against the plan.** I listed seven fixes in the comment, precise enough for close-out to make:
1. The plan wanted one function for the sign-in flags. Instead there are now three copies (`server.js:1959`, `server.js:2333` and the new `deploymentFlags()`).
2. The README "For AI Agents" bullet is missing.
3. The landing's agent HTML comment still points only at `/llms.txt`.
4. The landing prompt never says to use only the addresses the guide gives.
5. The guide is missing three planned points:
   - a local workspace doesn't follow the person to another device;
   - the runner is Claude Code only;
   - self-hosting needs the person to create a Linear OAuth app or token.
6. Labels the guide quotes ("+ local workspace", "Agent Prompt") have no test checking them.
7. Three planned tests are missing: the sign-in skip check, a check with fake secrets set in the environment, and a browser test that fetches `/getting-started.md` from the running server.

**What the green tests don't cover.** These are in the comment's list for close-out:
- a fresh run with a new agent after the four fixes, given only the copied prompt;
- after deploy, that the prompt and guide on harbour.cat use the right `https://` address and list the live sign-in options;
- the GitHub CI result for `4f247b68`.

The navbar's separate list of sign-in options on `/swipe` predates this ticket, so I marked it outside scope; close-out files a ticket for it.

Everything I wrote is in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r16/output/`: the review comment in `comment.md`, the status, comment and ruling actions in `tracker-actions.md`, and this message in `final.md`. I didn't write a description file because this prompt doesn't change the description. `code/` is unchanged; I ran everything in copies under `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/r16-work/`.

DECISION: {"decision_id": "lin4085-human-steps-cut", "question": "LIN-4085 is merged (4f247b68). Its plan cuts part of what was asked: the person still signs in (OAuth), connects their OpenRouter key and mints the owner runner key, because no agent-callable endpoint exists for these and adding one would widen what a token can do with credentials. Accept that cut?", "options": [{"id": "accept", "label": "Accept the cut: the guide sequences those clicks; review becomes Approve, conditional on close-out making the 7 named fixes and running the post-deploy checks"}, {"id": "do-here", "label": "Reject: agent-callable versions of those steps are this ticket's work; send back to plan for that design (the 7 fixes still due)"}], "recommended": "accept"}
BLOCKED: need the person's ruling on the plan's cut (the person still does OAuth, the OpenRouter key and the runner key), which nobody has agreed to; the review verdict is Needs Discussion until then.
