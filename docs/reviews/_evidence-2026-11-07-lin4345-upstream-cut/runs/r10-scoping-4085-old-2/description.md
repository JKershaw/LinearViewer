## Scope (define-scope, grounded at `e1f75fe7`)

**What this ticket delivers.** A newcomer can get set up by handing Harbour to their own coding agent, the way other software hands you an `npm install` line. It has two parts:

1. **The handoff prompt, on the public landing page (`/`).** This is a short block you copy and paste into Claude Code, Codex or a similar agent.
2. **A public getting-started guide (`/getting-started`), written for the agent to read.** It walks the agent through getting the user set up. It also says which steps only the human can do.

**Where the code stands.** These points correct some assumptions in the ticket:

- `harbour.cat/getting-started` does not exist. Neither does `/docs`. Both return a bare 404 (onboarding review 2026-10-23, R3-15).
- The landing has no install-command section. Its nearest "getting started" area is the **"try it yourself"** section (`renderTrySection`, `lib/render-landing.js`), which holds the sign-in buttons. The `┌─ Getting started` notices in `lib/render-landing.js` and `lib/render.js` are self-host `.env` hints shown only for `setupNotice`. They are a different thing.
- The feedback was sent from `/workspace/linearviewer/`, the signed-in Home page. That is just where the feedback widget was opened. The "homepage" in the request is the public landing.
- **This treats a symptom of a gap that is already recorded.** The 2026-10-23 Onboarding & Cold-Start Review found that "the best cold path is unadvertised" (R3-6) and that `/llms.txt`, the file agents read, "names no way in" (R3-8, refines LIN-3058). Production's `/kpis` funnel showed 0 first Go presses in 30 days (R3-17). The guide is where that missing way in gets written down, so pointing `/llms.txt` at the guide is part of this ticket.
- **There is a hard limit on what an agent can do alone.** It can't complete OAuth consent or open the email sign-in link. It also can't do the steps that need the user's browser session: connecting a tracker, adding an OpenRouter key, minting a Workspace API token at `/workspace/:urlKey/proxy`, and minting a runner credential at `/workspace/:urlKey/runner`. The Workspace API (`/api/proxy/*`) reads and writes tasks, dispatches work and reads model routing, but it does not change most settings. An agent could create a local workspace headlessly with `POST /workspace/new`, but that workspace would belong to the agent's cookie, not the user's browser, and nobody can get back into it later (LIN-3065). So the guide must keep the user's own browser sign-in as the main path. The agent's job is to explain, recommend and check. It does not act for the user.

### In Scope

1. **The guide's source.** It is one markdown file in the repo (e.g. `content/getting-started.md`), and both URLs below are served from it:
   - **`/getting-started.md`**: the plain markdown, for agents (the same `.md` convention `/library` uses).
   - **`/getting-started`**: the same content as HTML in the shared page shell, for humans.
   - Both routes are public. They go into `isAuthExemptPath` (`lib/guest-task-path.js`), the sitemap (`sitemapEntries`, `routes/library.js`) and the public-pages secret scan list (`lib/scan-public-pages.js`).
2. **What the guide says.** It is written for an agent, in plain language with no internal product names (LIN-3995 rule) and no secrets. It covers:
   - what Harbour is, and the loop: read the backlog, write the next prompt, run it on an agent, check the result;
   - **how to have the conversation first**: ask the user where their work is tracked (Linear, GitHub Issues, GitHub Projects, Jira, or nowhere yet), which repo or repos are involved, and which agent they use. Where the agent has the repos open, it can also look at them, for example for a GitHub remote or for Linear/Jira keys in branch names and commits, and recommend a tracker;
   - **the human steps, in order, each with its real URL**:
     - sign in (email, GitHub, Linear or Jira, whichever the server offers);
     - connect the tracker;
     - AI: use the free tier where it is offered, otherwise add an OpenRouter key in Settings;
     - open a task and copy its prompt (copy-first);
   - **optional next steps**:
     - mint a Workspace API token at `/workspace/:urlKey/proxy` so the agent can read and write tasks, after which the agent's first call is `GET /api/proxy/instructions`;
     - set up a runner at `/workspace/:urlKey/runner` (Claude Code only, Node 18+, macOS or Linux);
   - **the try-without-a-tracker route**: a local workspace, which the user creates in their own browser. The guide says plainly that it stays tied to that browser;
   - **safety rules for the agent**:
     - never ask for or handle passwords or OAuth consent;
     - a pasted credential is a single-use bootstrap;
     - don't exchange a runner credential by hand before `runner login` (R3-13);
     - only the workspace owner can mint runner and dispatch credentials;
   - **self-hosting**: one paragraph pointing to the README.
3. **The landing handoff block** in the "try it yourself" section:
   - It holds a short prompt (about 150 words or fewer) in a `<pre>`, with a Copy button, a one-line caption ("Or hand this to your coding agent") and a `data-testid` (e.g. `landing-agent-prompt`, `landing-agent-prompt-copy`).
   - The prompt tells the agent what Harbour is, asks it to read `<origin>/getting-started.md`, and asks it to guide the user from there.
   - The URL comes from the request's origin, using `requestOriginOrNull` / `publicOrigin` and falling back to `https://harbour.cat`. That way a self-host points at itself. It is not a hard-coded host.
   - The prompt text is defined once, as a constant beside the guide (or exported from it), so the page, its test and any later surface share one string.
   - It works without JavaScript: the text can still be selected. Copying reuses the existing clipboard pattern (`public/templates.js`). It needs no new script, or at most a few lines in the landing's existing `app.js` path.
4. **`/llms.txt`**: a short "Getting started (for agents)" entry near the top that points at `/getting-started.md`. This closes R3-8's "names no way in" for this path.
5. **Tests**:
   - unit tests: the landing renders the block, and the URL inside it follows the origin;
   - both guide routes return 200 without a session, with the right content types (`text/markdown` for `.md`);
   - **a drift guard**: every same-site path the guide names (e.g. `/auth/email`, `/workspace/:urlKey/proxy`, `/workspace/:urlKey/runner`, `/api/proxy/instructions`) matches a route that is actually mounted, checked at test time like the source-map roster;
   - sitemap and auth-exempt coverage for `/getting-started`.
6. **Docs**: one line in `docs/architecture/source-map.md` for the new page and content file.

### Out of Scope

These are different problems, cross-referenced and not folded in:

- **Letting agents change settings through the API.** That would mean new token scopes for connecting trackers, adding OpenRouter keys and toggling features. It is a separate credential-boundary decision (LIN-3059 vocabulary). The guide works within today's boundary.
- **Getting back into local workspaces** from another session or device (LIN-3065, LIN-3141). The guide describes how they behave today.
- **Linking GitHub Projects** from cold surfaces (LIN-2387), and the 503 from the zero-credential Linear button on self-hosts (LIN-3108).
- **Making the signed-in Home's copy-first card (`lib/render.js`) or the guest share page (R3-7) use the handoff prompt.** That is a natural follow-up once the prompt has proved itself on the landing.
- **A landing redesign.** Hero, loop and glimpses stay as they are; the only change is one block added to an existing section.
- **Rewriting `/llms.txt`'s purpose line** (R3-11) or `README.md`.

### Assumptions

- The hosted product at `harbour.cat` is the main audience. Self-hosting gets one paragraph.
- The prompt is the same for every visitor. It is public, so it carries no user context and no credentials, and the only thing that varies is the origin.
- The served text of the landing and the guide is not stage-prompt text, so it does not count against `tests/unit/prompt-size-budget.test.js`. If a reviewer treats it as prompt text, the reason for its size goes beside the limit it raises, as the CLAUDE.md invariant requires.
- The routes the guide names are those at `e1f75fe7`. The drift guard keeps them true from then on.

### Success Criteria

- `/` shows the handoff block inside "try it yourself" on desktop and at phone width, in both light and dark themes. Copy puts exactly the prompt text on the clipboard, and the text names `<this origin>/getting-started.md`.
- `GET /getting-started` (HTML) and `GET /getting-started.md` (`text/markdown`) return 200 without a session, appear in `/sitemap.xml`, and pass the public-pages secret scan.
- **A fresh agent can act on the guide.** Given only the copied prompt, a session with no repo context can tell the user, without guessing:
  - the steps it can't do itself;
  - the sign-in and connect steps, in order, with working URLs;
  - how it can work with Harbour afterwards (copied prompts, a Workspace API token, or a runner).
  
  Every path it names resolves. This is checked once by hand and recorded on the PR, and the route-drift test enforces it in CI.
- `/llms.txt` points at `/getting-started.md`.
- `npm test` passes, `ci-success` is green, and CLAUDE.md stays within its limits.

### Open Questions

These are product questions only. None blocks implementation; each has a default.

1. **How prominent the block is.** It could be an alternative inside "try it yourself" (the default), sitting beside the sign-in buttons, or it could be promoted to the hero as the main way in. *Recommendation:* start inside "try it yourself", then judge it by the `/kpis` funnel before promoting it.
2. **Who signs off the wording.** The implementer drafts the landing prompt and the guide within the constraints above, and John reviews the wording on the PR. Say so if you want to write the prompt yourself.
