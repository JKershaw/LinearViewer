# Fast session run record (LIN-4085 A/B, 1 November 2026)

Written by the fast single session itself, straight after its run, and kept verbatim. It is that session's own account, not independently checked. Its commit is `2bebcc03` on branch `claude/cool-rubin-6acj5j` (`d37f269` in its original checkout). Context: `docs/reviews/lin-4085-ab-run-2026-11-01.md`.

---


Draft written straight after the run, held locally until the Harbour run of the same task finishes.
Covers the run up to the push (2026-11-01, commit `d37f269`, repo JKershaw/LinearViewer).

## The request (verbatim)

> Have an idea which I think might be interesting to explore which is on the homepage the getting started section normally for software has like an MPM installed command we can have a prompt that the person passes to their agent this can be a couple of paragraphs explaining the situation and linking to a harbour.cat slash getting started page which walks an agent through onboarding project and the user to Harbour. Because it's instruction for an agent the human naturally uses the agent interact with Harper which is a good first step then because the agent can then read the guide it can decide whether to have a conversation with the user or review The repositories and the settings and we can have essentially a full guide on how to properly configure Harper for whatever your situation is without the user needing to follow those steps as the use uses the agent having naturally would.

## Outcome

- Homepage "Get started" section, first in the showcase after the hero: a terminal-style box with a two-paragraph prompt and a progressive copy button (hidden without JS; selects text if the clipboard refuses). The prompt names the serving origin, so a self-host points at itself.
- `/getting-started`: HTML for browsers, Markdown for agent fetches (`*/*`, no Accept, `text/markdown` or `text/plain` first), `Vary: Accept`; `/getting-started.md` always Markdown. Public (auth-exempt), in the sitemap, Library CSP and headers.
- The guide (`content/getting-started.md`, ~3,000 words, `{{BASE_URL}}` filled per request): how to work with the person (ask before acting, keys are secrets, look first vs ask first); Step 1 situation table; Step 2 repo readiness (tests, CI, `gh`, default branch, branch protection, agent instructions, deploys); Step 3 sign-in doors; Step 4 sources and GitHub-for-evidence; Step 5 AI key / free tier; Step 6 backlog conventions; Step 7 how work runs (copy, runner, Simple Dispatcher); Step 8 agent API key; Step 9 first task end to end; settings; troubleshooting; done-when checklist; read more.
- `/llms.txt` gained a "Getting started" section; the landing's HTML comment points agents at the guide.

### The homepage prompt (as served by harbour.cat)

> I'd like to set up Harbour (https://harbour.cat). It reads my backlog, writes a prompt for the next task that is checked against the code as it is now, sends that prompt to a coding agent, and counts the work done only when there is real proof such as CI results and merged pull requests.
>
> Please read the setup guide at https://harbour.cat/getting-started. It is written for you, so read all of it as plain text (for example `curl -s https://harbour.cat/getting-started`), not a summary. Then help me set Harbour up for my situation: look at the repositories and tools you can see from here, ask me about anything you can't work out yourself, and tell me which steps I need to do in my browser. Ask me before you create, change or send anything.

## Timeline (in order)

1. Orientation: read `lib/render-landing.js`, `/llms.txt`, `source-map.md`, README, the 2026-10-23 onboarding cold-start review (found R3-6 "best cold path unadvertised" and R3-8 / `/llms.txt` "names no way in" — the gap this idea fills), the runner prompt builder and runner page.
2. Fan-out research: two read-only Explore agents in parallel, each told to cite file:line and say "not found" rather than guess.
   - A: sign-in doors, Settings areas, AI/free tier, GitHub-for-evidence, tracker conventions (~305k tokens, 160 tool calls, ~6.7 min).
   - B: agent API keys, ways to run work, first-run loop, what prompts assume about repos, public URLs (~249k tokens, 118 tool calls, ~4.6 min).
3. Built the plumbing while research ran: `lib/getting-started.js` (prompt builder, guide loader with uncached fallback, own safe marked renderer, content negotiation), `lib/render-getting-started.js`, `routes/getting-started.js`, server wiring, auth exemption, sitemap, landing section, `public/landing.js`, CSS, `/llms.txt`.
4. Wrote unit tests (`tests/unit/getting-started.test.js`), then the guide once both reports were in, then spot-verified remaining claims myself (free-tier applicability, Settings key is a direct 90-day token not a bootstrap, runner repo resolution, exact UI labels).
5. Ran: targeted unit tests → full unit suite (22,089 pass / 0 fail) → real server with curl (Markdown vs HTML) → Playwright screenshots (desktop light, phone dark) and clipboard check → landing e2e spec (22/22, 3 new) → doc guards and secret scan → hermetic suite (zero non-loopback sockets).
6. Polish from screenshots: phone padding, heading order (no h2 before the h1), brand-coloured copy button. Updated `docs/architecture/source-map.md`.
7. Committed, amended one guide line (branch-protection 403 caveat), pushed after a stop hook flagged the unpushed commit.

## Decisions and why

- **Markdown by content negotiation**, not only a `.md` URL: agents fetch with curl (`*/*`), and summarising fetch tools would drop most of a long guide — so the prompt also asks for a whole plain-text read.
- **One Markdown source, filled per request**: a self-hosted Harbour serves a guide that points at itself.
- **Guide claims under test**: every Settings area and label, stage names, runner/free-tier/email/key lifetimes and limits, quoted UI labels, every path named, every in-page anchor — checked against source, so the guide fails CI when the product moves (the repo's "checked against source at test time" pattern).
- **Safety framing in the prompt**: "Ask me before you create, change or send anything", so pasting it is safe; the guide repeats it with key-handling rules.
- **Script-free guide page** under the Library CSP; the copy button lives on the homepage only.
- **Reused the Library's reading styles** rather than new page chrome; left the footer alone to avoid churning goldens on every page.

## What the research corrected (where a confident guess would have been wrong)

- Home has no "Go" button: it is "Run <step>" / "Run to PR" (Go is the Swipe label).
- Six usual stages, not five, and the UI calls implementation "Build": research, plan, plan review, build, review, close-out.
- "+ local workspace" is not on the homepage (on /swipe, /swim, /ship and /account), and a local workspace can only be reopened from the browser that made it.
- "Merge PR #N" needs: readable PR, exactly one open PR, review approved, a runner set up, run stopped at the PR.
- Prompts hard-code PRs against `main` and branches `feat/<id>-…`; agents need `gh`.
- A Linear/Jira workspace needs the owner's GitHub connection (App covering the repo) to read PR status.
- A Settings › Agent access key is a direct 90-day token; a key inside a copied prompt is a single-use bootstrap.
- Free tier applies only without the account's own OpenRouter key (own key = no daily run limit).
- Simple Dispatcher's README says queue tokens come from "workspace settings"; they come from the Dispatch page (left unfixed, reported).
- README and `.env.example` disagree with the code on GitHub App permissions (guide doesn't state them).

## Verification

| Check | Result |
|---|---|
| New unit tests (`getting-started.test.js`) | 27/27 |
| Full unit suite (`npm run test:unit`) | 22,089 pass, 0 fail, 3 skipped |
| Hermetic suite (`npm run test:hermetic`) | pass, zero non-loopback sockets |
| Landing e2e spec | 22/22 (3 new: copy, guide link, negotiation) |
| Doc guards, secret scan | pass |
| Real server | curl → Markdown + sandbox CSP; browser Accept → HTML; prompt names the server |
| Screenshots | landing + guide, desktop light and phone dark; no console errors; no horizontal overflow |

## Missteps

- `pkill -f "PORT=3055"` matched my own shell command and killed it; recovered by stopping the server by port.
- Pushed after a stop hook flagged the unpushed commit, before your "Don't push" arrived. The remote delete then failed five times at the proxy; you deleted the branch by hand.
- First copy of the e2e/route test for a forged Host tested the helper rather than the route; rewrote it as a real request.

## Cost

- Research agents: ~554k tokens combined.
- Main session: not measured; an estimate only.
- Files: 17 changed, +1,200 / −7 (7 new).

## Files

`content/getting-started.md`, `lib/getting-started.js`, `lib/render-getting-started.js`, `routes/getting-started.js`, `public/landing.js`, `public/getting-started.css`, `tests/unit/getting-started.test.js` (new); `lib/render-landing.js`, `public/landing.css`, `public/llms.txt`, `lib/guest-task-path.js`, `routes/library.js`, `server.js`, `docs/architecture/source-map.md`, `tests/e2e/landing.spec.js`, `tests/unit/guest-task-path.test.js`, `tests/unit/library.test.js` (edited). Full diff: `getting-started.patch` beside this file.

## Checklist to score the Harbour run against

- [ ] Prompt on the homepage, near the top, with copy; names the serving origin.
- [ ] Guide readable whole by an agent (Markdown for curl), not only HTML.
- [ ] Prompt and guide tell the agent to ask before acting and to handle keys as secrets.
- [ ] Guide lets the agent choose: inspect repos first vs converse first.
- [ ] Facts right: no "Go", six stages / "Build", local-workspace location and limits, merge-button conditions, `main` assumption, GitHub-for-evidence.
- [ ] Guide's claims tied to source by tests, so they can't silently drift.
- [ ] Public and auth-exempt; in sitemap; `/llms.txt` updated.
- [ ] Safe rendering (raw HTML escaped, href allow-list), CSP and nosniff.
- [ ] Tests: unit + e2e; full suite and hermetic run green.
- [ ] Looked at in a real browser, light and dark, phone and desktop.
