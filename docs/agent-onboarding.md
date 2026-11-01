# Agent onboarding guide (design notes)

LIN-4085. The guide a coding agent reads when a person copies the prompt under
the sign-in buttons on `/`. Served at `GET /getting-started.md` (plain markdown)
and `GET /getting-started` (HTML), by `routes/getting-started.js`, built by
`lib/prompts/agent-onboarding.js`. Everything after the first `---` line is the
served text, the same cut as `docs/runner-prompt.md`; these notes above it are
not served.

Placeholders are filled per request from source, never typed by hand:
- `{{BASE_URL}}`: the validated origin (`publicOrigin(req, { safeHost: true })`),
  so a self-host points at itself and a forged Host cannot steer the guide.
- `{{SIGN_IN_DOORS}}`: the list from `signInDoors()` in
  `lib/components/landing-hero.js`, the same list the hero buttons read.
- `{{FREE_TIER_SENTENCE}}`: from `isFreeTierOffered()`.

Design decisions:
- Ask or look first. The guide must not pick a door for the person.
- The local workspace (path a) is created by the person in the browser. A
  workspace made with `curl` lives in the agent's cookie jar and the person
  cannot see it (LIN-3065), so the guide says so.
- No new agent endpoints for human-only steps (OAuth, OpenRouter key, owner
  runner key). The guide sequences them for the person.
- Links are full URLs, so an agent that fetched the `.md` from elsewhere still
  resolves them.

---

# Harbour: onboarding for coding agents

A person has asked you to set up Harbour for their work. Read this whole guide
before you act, and ask the person before you choose a path.

Harbour is a control plane for AI-assisted software work. It reads the person's
task tracker (Linear, GitHub Issues or Projects, Jira, or a local store), writes
a checked prompt for the next task, runs that prompt on a coding agent, and
checks the result against evidence such as CI results and merged diffs. This
deployment is at {{BASE_URL}}.

## Ask or look first

Before choosing a path, do one of these:
- Ask the person what they want from Harbour, and whether they already keep their
  work in a tracker.
- Or, if you can, read the repositories and tracker they point you to, to see
  what they already use.

Do not start a path the person has not agreed to.

## The paths

### (a) Just looking: a local workspace

Use this when the person wants to see Harbour without signing in anywhere.

The person creates the workspace in their own browser: they open
{{BASE_URL}}/swipe, choose "+ local workspace" in the navigation bar, and the
workspace opens for them. Do not create it for them with an HTTP request. A
workspace made that way belongs to your cookie jar, and the person will not see
it in their browser.

Once the person has a local workspace, ask them to open its Proxy page and copy
the Agent Prompt there, then follow that prompt for the workspace API.

### (b) A real tracker: use this when the person has one

1. The person signs in through one of the doors below. Sign-in is a browser step
   only the person can complete.
2. After sign-in, ask the person to open their workspace's Proxy page,
   `{{BASE_URL}}/workspace/<urlKey>/proxy` (the workspace key is in the address
   bar once they are signed in), and copy the Agent Prompt there. That prompt
   carries a token. Use the token only as the prompt tells you.

Sign-in doors on this deployment:

{{SIGN_IN_DOORS}}

### (c) Run work on their own machine

The person can turn their machine into a runner from
`{{BASE_URL}}/workspace/<urlKey>/runner`. Only the workspace owner can mint a
runner key. Ask the person to open that page and follow it. Do not mint keys
yourself.

## What only the person can do

- Sign in (OAuth) through any of the doors above.
- Add an OpenRouter key where prompts need one. {{FREE_TIER_SENTENCE}}
- Mint the owner runner key on the runner setup page.

No endpoint exists for these steps, so do not look for one or work around them.

## Where to read more

- {{BASE_URL}}/llms.txt: navigation and page structure
- {{BASE_URL}}/api/proxy/instructions: the workspace API catalog (needs a token)
- {{BASE_URL}}/library: the papers and essays behind Harbour
- Self-hosting: the README in the Harbour repository. This guide does not cover it.
