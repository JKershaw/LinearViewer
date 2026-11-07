I reviewed LIN-4085 at head `4f247b68` and the verdict is **Needs Discussion**. One of the requested features (sentence 5 of the request) is only partly delivered and no human has signed off on that. Everything else meets the request, with seven small fixes for close-out.

**The PR is already merged.** PR #2221 was squash-merged to `main` as `4f247b68` on 2026-11-01 18:33, before this review ran. That squash matches `change.diff` byte for byte. The ticket still says In Progress. Close-out will have to land the fixes as a follow-up commit on `main`. If the work needs undoing, `git revert 4f247b68` is clean: no migration and no stored data.

**What is missing or done differently from the plan:**
- **Sign-in options are still checked in more than one place.** The plan asked for one shared function. Instead `deploymentFlags()` is a third copy, and `server.js:1959` and `:2333` still repeat the checks inline.
- **The "try it locally" path changed.** The guide sends the person to the "+ local workspace" button on `/swipe` instead of a button on `/getting-started`. That route works, but no test checks the two button labels the guide quotes ("+ local workspace", "Agent Prompt").
- **The homepage block is missing two planned pieces:** a plain link to `/getting-started` for people, and the line telling the agent to use only URLs the guide gives. The "no invented URLs" goal depends on that line.
- **Two pointers to the guide are missing:** the note for AI agents hidden in the homepage HTML, and the README bullet.
- **The copy button is hand-styled** instead of using the shared button style.
- **Two tests are missing:** a signed-out fetch of `/getting-started.md` against the real server, and a personal-access-token login case for that path.
- **The page shown after signing out has no agent block.** The plan left it out because there was "no request origin" there, but the request is available, so that reason no longer holds.

The comment names each fix precisely enough for close-out to make it.

**Open checks for close-out:**
- Re-run the test with a fresh agent given only the copied prompt. The only run so far was before the four guide fixes.
- John should confirm the block looks like an equal second way in, not the start of the showcase below it.
- After deploy, check that harbour.cat serves the prompt and guide with `https://harbour.cat` links.
- Watch the `/kpis` "How people get started" funnel. This is not a condition for closing.

**Not verified:** I couldn't confirm CI. I had no network to read the checks, and nothing on the ticket shows CI on the final head. I also couldn't run the test suite or the mutation checks, because the clone has no `node_modules`. Close-out has to run both.

**The open question:** the plan recorded one cut to the request that is still not agreed. The person still has to sign in, add the OpenRouter key, mint the runner key and change Settings themselves; the agent cannot do these. No ruling or comment from the person accepts that. I couldn't check the rulings list offline, and the earlier comments only rule on where the block goes. I recommend accepting the cut. If it is accepted, the verdict becomes "Approve — conditional on close-out discharging the ledger", with the seven fixes.

I didn't write a description section, because review only posts a comment. Status, labels and relations are unchanged, and the clone is clean.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r18/output`:
- comment.md
- tracker-actions.md
- final.md

DECISION: {"decision_id":"lin4085-human-only-steps-cut","question":"LIN-4085 asked for setup 'without the user needing to follow those steps'. As built, the agent cannot do OAuth sign-in, connect the OpenRouter key, mint the owner runner key or change Settings; the guide tells the person which button to press. Accept that narrowing?","options":[{"id":"accept","label":"Accept: the guide puts the human-only clicks in order; agent-callable versions stay out of LIN-4085 (verdict becomes conditional Approve, close-out makes fixes 1-7)"},{"id":"do-here","label":"Reject: build agent-callable versions of those steps on LIN-4085 (new endpoints with their own security review; back to plan)"}],"recommended":"accept"}
BLOCKED: need John's ruling on whether LIN-4085 may leave OAuth sign-in, the OpenRouter key, the runner key and Settings changes to the person (the plan's cut, still unagreed)
