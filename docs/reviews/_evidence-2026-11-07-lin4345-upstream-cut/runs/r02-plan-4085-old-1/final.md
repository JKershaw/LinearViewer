I've written the LIN-4085 plan. It goes in the ticket's description under `## Implementation Plan`. It fits one session, and plan-review isn't due. The status was already In Progress, so there are no tracker changes. I made no code changes, and the clone is clean.

The plan builds on the finalized Scope and on the three answers in the unblock comment:
- The prompt block goes directly under the homepage sign-in buttons.
- The guide asks the user first, then steers to their real tracker. The local workspace is the "just looking" path.
- The cold-agent walk plus PR review counts as sign-off on the wording.

Nothing has changed in the named files since the ticket was written. But four things the Scope says don't match the code, and each changes how the work gets built:
1. **The homepage already loads scripts.** It still needs its own new `public/landing.js`. The site's security policy blocks inline scripts. The existing copy-button handler in `app.js` can also mint an access token, so the new block must not reuse its classes.
2. **The guide file is laid out the other way round.** In `docs/runner-prompt.md`, the design notes come first and the served text is everything after the first `---`. The new guide follows that.
3. **The guide's address must be added to `isAuthExemptPath`.** Without it, a signed-out visitor who opens the guide can be signed in automatically (on token-login deployments) or have a session created.
4. **An existing test conflicts with the obvious heading.** `tests/unit/render-landing.test.js:112` checks that the homepage never contains "Getting started". The new block's heading avoids that phrase, and the test is narrowed to the setup notice it was meant to check.

The plan also covers places the Scope didn't list:
- the homepage drawn after logging out of the last workspace (`server.js:1958`);
- the list of homepage section IDs in `/llms.txt`;
- the bookkeeping that comes with raising the frozen prompt-size limits;
- the source-map entries for the auth exemption and the sitemap.

To keep the guide from drifting out of date, the plan adds:
- one shared list of sign-in options, used by both the homepage buttons and the guide;
- one helper that reads which sign-in options a deployment has enabled, replacing two copies in `server.js`;
- a test that fails if the guide links to a path no route serves.

Everything is in `scratchpad/runs/r02/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md`
- `final.md`

DONE: Wrote the one-session LIN-4085 plan (no plan-review needed), with four corrections to the Scope found at HEAD e1f75fe7.
