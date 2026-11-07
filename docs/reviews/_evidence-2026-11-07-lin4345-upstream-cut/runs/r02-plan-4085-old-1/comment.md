**Plan written.** It's in the description under `## Implementation Plan`. It fits one session, and plan-review isn't due.

It builds on the finalized Scope and the three decisions from the unblock comment: the block goes under the hero CTAs; the guide asks first and defaults to the real tracker; sign-off is the walk plus PR review.

**Re-grounded at `e1f75fe7`.** No commits since the ticket was created touch the files it names. Reading the code, though, showed four Scope statements that change how this gets built:

1. **The landing already loads JS** (`/common.js`, `/app.js`). A separate `public/landing.js` is still needed, for two reasons. The CSP is `script-src 'self'` plus pinned hashes, so an inline script would be blocked. And `app.js`'s `.prompt-copy` handler can append a proxy block and mint a token, so the block must use its own classes.
2. **In `runner-prompt.md`, the served body is *below* the first `---`**, not above it. The guide follows the real pattern.
3. **`/getting-started(.md)` must be added to `isAuthExemptPath`** (`lib/guest-task-path.js`, LIN-3346). Otherwise PAT auto-login or token refresh hands a signed-out visitor a session.
4. **`render-landing.test.js:112` asserts that the landing never contains "Getting started"**, so the new block's copy avoids that phrase, and the test is narrowed to the setup notice's markup.

The plan also covers places the Scope didn't list:
- the logout landing render (`server.js:1958`), which gets the origin too;
- the `landing-{…}` testid list in `/llms.txt` Limitations;
- the size guard's matcher count, `FROZEN_TOTAL_BYTES`, and the `steady-base-growth.mjs` GROUPS it mirrors;
- the source-map entries for the exemption and the sitemap.

To stop the guide drifting from the product, the plan adds:
- one shared `signInDoors()` list, used by both the hero buttons and the guide;
- one `readDeploymentDoors()` read of the deployment flags, replacing two copies in `server.js`;
- a link-check test that fails on any guide path no route serves.
