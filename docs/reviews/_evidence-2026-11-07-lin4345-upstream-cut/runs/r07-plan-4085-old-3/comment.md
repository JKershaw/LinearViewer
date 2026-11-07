The implementation plan is in the description, under `## Implementation Plan`. It is ready for plan review: `plan-review due: yes`, because it adds two paths to `isAuthExemptPath` and serves public instructions that outside agents act on.

Re-grounded at HEAD `e1f75fe7`, with no drift since the ticket. The scope had seven things wrong that the plan corrects:
- the runner-prompt pattern serves the text below the `---`, not above it;
- the landing already loads JS, and the CSP rules out an inline script, so the copy button goes in a new `public/landing.js`;
- `/api/proxy/instructions` returns 401 without a token;
- the Local door is a POST form only the user's browser can use: if an agent POSTs `/workspace/new` itself, it creates a workspace the user can never open (LIN-3065);
- the new public paths must join the one auth exemption (LIN-3346);
- the landing's origin comes from the raw Host header and is null on the logout render, so the prompt uses the safe-host `publicOrigin` and is left out when there is no origin;
- the sitemap test counts its entries.

One refactor is folded in: a single sign-in door list (`signInDoors` / `deploymentDoors`) that the hero, the Try section and the guide all read, so the guide can't name a door the hero hides. The three product questions are taken as the 2026-11-01 unblock comment decided them.
