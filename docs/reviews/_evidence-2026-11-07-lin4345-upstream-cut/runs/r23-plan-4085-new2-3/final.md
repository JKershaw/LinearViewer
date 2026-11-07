LIN-4085 plan stage is finished. This is the first pass: the comments hold no plan-review verdict. The plan was checked against HEAD `e1f75fe7`, and no commit since the ticket was created touches the files it relies on.

**What I wrote**
- The plan, under `## Implementation Plan`: `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r23/output/description.md`
- The summary comment: `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r23/output/comment.md`
- Tracker actions: none. The ticket is already In Progress. `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r23/output/tracker-actions.md`

**Cuts to As asked: none.** Two clauses come close, and the plan explains why each is delivered in full:
- *"without the user needing to follow those steps"*: the person still does the OAuth sign-in, enters their own OpenRouter key and mints the runner key. But they never read the guide. Their agent asks for each of those clicks when it is needed.
- *"a full guide … whatever your situation is"*: self-hosting is covered by sending the agent to the README, which already is the full self-host guide.

**Five things the scope gets wrong about the code at HEAD**
1. The landing does load JavaScript (`/common.js`, `/app.js`). The copy button still needs its own `public/landing.js`. The CSP only allows inline scripts that are registered by hash, and app.js's existing copy button adds workspace proxy text to what it copies.
2. In `docs/runner-prompt.md`, the design notes sit *above* the first `---` and the served body below it. The scope says the reverse.
3. `/getting-started` must be added to `isAuthExemptPath` (LIN-3346). Otherwise, on a self-host with `LINEAR_ACCESS_TOKEN` set, anyone who opens the guide gets logged in.
4. `/api/proxy/instructions` needs a token, so the guide must say to use the token that comes with the Agent Prompt.
5. Creating a local workspace (`POST /workspace/new`) only works if the person presses it in their own browser. If the agent did it, the workspace would land in the agent's session, not the person's.

**Main decisions**
- **Guide:** a guide filled in from code, at `docs/agent-onboarding.md`, built by `lib/prompts/agent-onboarding.js`. The sign-in buttons, the local-workspace button label, the free-tier sentence, the Settings areas and the README link all come from the code, so the guide can't drift from the product.
- **Shared button list:** the hero's sign-in buttons become a shared list, so the guide can only quote labels that exist.
- **`/getting-started` page:** it gives the person every button the guide names, with the same labels. A test ties the two together.
- **Homepage block:** it sits under the hero buttons and only appears when the site address is known. On the logout render the address isn't available, so the block is left out there.
- **Guide address:** `safeHost` rule and no public caching, so a forged Host header can't send an agent elsewhere.
- **Pointers:** an entry in `/llms.txt`, the sitemap and one README bullet.
- **Size limits:** three new prompt-size limits in `prompt-size-budget.test.js`, each with its LIN-4085 reason.

The plan names a witness test (W1–W10) for each promised behaviour and the three likeliest ways the change breaks.

**Session fit and review:** one session is enough. Plan review is due (yes) for three reasons: it adds a public page that agents will act on, it widens the auth-exemption check used by both auth middlewares, and it raises the frozen prompt budget.

DONE: LIN-4085 plan written (no cuts, 5 scope corrections at HEAD, one session, plan-review due: yes)
