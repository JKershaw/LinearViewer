The LIN-998 plan is written. I made no code changes, and the clone at `code/` is unchanged (`git status` is clean).

**The change:** in `public/brief.js` and `public/recap.js`, opening a section now generates content whenever the cheap status check says there is nothing current to show (never generated, or out of date), instead of stopping on a button. A current result is shown as it is, and the server is unchanged. The dashboard tree and the swipe card both open these sections the same way, so both get the change.

**Where I went against the research comment:** it suggested leaving out-of-date sections behind the manual `↻ refresh` button. I included them. An out-of-date section shows no brief at all, so leaving it manual would keep the click the ticket asks to remove. It also costs the same single generation the user would trigger by clicking. With that, nothing from the ask is cut.

**Decision you may want to check:** research flagged free-tier spend as the one product question. I decided it rather than parking it: content generates on open for every tier, with no client-side gate. Sections only load when someone deliberately expands them, and the existing server limits (the "not configured" error, 20 free generations a day per workspace) still cap the cost. When generation can't run, the section shows the server's error and a `↻ retry` button.

**Main risk:** today `init()` always wires the button at the end. Keeping that after the hand-off to `refresh()` would attach a second click handler, so every refresh click would generate twice. The plan requires wiring once per path, and one of the tests counts POSTs per click.

**Tests the plan requires** (end-to-end, each failing before the change and passing after):
- Opening a never-generated or out-of-date section ends on content with no click.
- Opening a current section sends no generate request.
- Collapsing and re-expanding sends nothing.
- One refresh click sends one request.
- An error on open can be retried.
- The two swipe tests built around clicking the button first are rewritten.

The plan is marked `fits one session` and `plan-review due: yes`, because it removes the click that used to stand in front of a paid model call. No tracker status change was needed (already In Progress).

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r12/output:
- description.md
- comment.md
- tracker-actions.md

DONE: Plan for LIN-998 written: open-time generation for Brief/Recap when nothing current is cached (never generated or out of date), all tiers, server unchanged, six tests listed; fits one session, plan-review due: yes.
