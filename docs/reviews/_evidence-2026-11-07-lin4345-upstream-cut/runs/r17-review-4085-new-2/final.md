I reviewed LIN-4085 at head `4f247b68` and wrote the review comment. The verdict is **Needs Discussion**, for one reason: the plan named a cut to what was asked, and no person has agreed to it.

**The work is already merged.** PR #2221 was squash-merged to `main` at 18:33, after the 18:18 comment that said it was waiting on review. So every fix below has to land as a follow-up commit, and every check runs against `main`. Some review happened on the PR (its last commit is titled "review findings 1-2"), but nothing about it reached the ticket.

**What I could and could not check:**
- I could not read CI, because there is no network here. The implementer reported green only on `6dacd78d`, and the merged head has one more commit after that.
- I could not run the unit or e2e tests, because the clone has no `node_modules`.
- I mutation-checked the exemption, placeholder and design-notes tests on scratch copies, and all four went red as they should.
- One check I could only work through by reading: if the route ignored the deployment's sign-in settings, every test would still pass. Fix 6 adds a test for this.

**The plan in the description is out of date.** It names a different origin helper, script file and button than the version plan-review approved and the code uses. I accepted those three differences because plan-review approved them.

**What the work delivers:**
- the guide and its builder;
- both routes;
- the two exact auth exemptions;
- the landing block with its copy script;
- the `/llms.txt` entry and the sitemap entry;
- the size ceilings;
- the source-map entry;
- e2e tests at 320px, desktop, without JavaScript, and with a hostile Host header.

**Plan items that are missing** (close-out fixes 1-13, each named with its file and line in the comment):
- the landing's HTML comment still doesn't point to `/getting-started.md`;
- the README bullet;
- a plain link to `/getting-started` in the block for people;
- a "use only the addresses the guide gives" line in the prompt (the "without inventing URLs" success criterion depends on it);
- one shared function for the sign-in settings, used by `/` and the sign-out page;
- three missing rules in the guide's content;
- tests pinning the labels the guide quotes;
- a link to the markdown version on the HTML page;
- the PAT-session test, the planted-secret test, the public-page scan entry and an e2e request for `/getting-started.md`.

**Checks still to settle** (8 items, all inside the ticket's scope):
- re-run the cold-agent walk on the fixed guide (the recorded walk ran before its four fixes);
- walk path (a) end to end as a person;
- CI on the merged head;
- the live origin and headers after deploy;
- the copy button on Android and iOS;
- whether the block reads as an equal second way in;
- record the reason for leaving the nav bar's separate door list (plan-review already gave one);
- the `/kpis` funnel as the monitor after it ships.

**The open question:** the request asked for setup "without the user needing to follow those steps". The person still has to sign in, connect an OpenRouter key and mint the runner key. The plan listed this as a cut needing a ruling, and nothing in the ticket answers it. I couldn't query the rulings endpoint from here, so if a ruling already exists, it settles this. My recommendation is to accept the cut: making those steps agent-callable would widen what a token can do with credentials, and needs its own security review.
- **If accepted:** the verdict becomes "Approve — conditional on close-out discharging the ledger".
- **If John wants those steps done here:** the ticket goes back to `plan`.

The tracker-action file records no status change; the ticket stays In Progress. I changed nothing in `code/`.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r17/output/`:
- comment.md
- tracker-actions.md
- final.md

DECISION: {"decision_id": "lin4085-review-human-steps-cut", "question": "LIN-4085 asked for setup 'without the user needing to follow those steps', but the person still signs in (OAuth), connects an OpenRouter key and mints the owner runner key; the guide puts those clicks in order instead of removing them. Accept this cut?", "options": [{"id": "accept", "label": "Accept: the guide orders the person's few clicks; review becomes Approve, conditional on close-out"}, {"id": "accept-follow-up", "label": "Accept here, and have close-out file a separate ticket (with security review) for agent-callable versions"}, {"id": "do-here", "label": "Reject: build agent-callable versions in this ticket; send it back to plan"}], "recommended": "accept"}
BLOCKED: LIN-4085's review is Needs Discussion until a person rules on the plan's cut (the person still does OAuth, the OpenRouter key and the runner-key mint); recommendation: accept.
