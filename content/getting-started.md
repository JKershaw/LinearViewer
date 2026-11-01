# Getting started with Harbour: a guide for your agent

This page is written for you, a coding agent. A person pasted a prompt asking you to help them set up Harbour. Read all of it before you start. Then work out their situation, do the reading and checking yourself, and hand them only the steps that need their browser, their accounts or their say-so.

The person can read this page too, at {{BASE_URL}}/getting-started. Nothing here is hidden from them.

## What Harbour is

Harbour ({{BASE_URL}}) keeps a person in charge of the work AI agents do on their software. It:

1. **Reads the backlog** from Linear, GitHub Issues, GitHub Projects, Jira, or a local store Harbour keeps itself.
2. **Writes the prompt for a task's next step**, from a fixed set of templates (all public at {{BASE_URL}}/templates), checked against the code as it is now.
3. **Sends the prompt to a coding agent**: the person pastes it into one, or Harbour runs it on their machine.
4. **Counts the work done only on evidence**: CI results, pull requests and merges, not the agent's say-so.

A task usually moves through these stages: research, plan, plan review, build, review and close-out. "Run to PR" runs a task up to an open, reviewed pull request and stops there. Merging is the person's call.

## How to work with the person

- **You read, check and explain. They act in the browser.** Signing in, OAuth consent screens and anything that creates a key happen in their browser session. You can't complete them, and you shouldn't try.
- **Ask before you act.** Before you write to their tracker, edit files, commit, push or call an API that changes something, say what you're about to do and wait for a yes. Most of setup is reading and advising.
- **Treat keys as secrets.** Harbour shows each key once. If the person gives you one, use it only for the calls this guide describes. Don't repeat it back in full, don't commit it, and don't write it into a file inside a repository.
- **Choose how to open:**
  - If you're running inside their repositories, look first ([Step 2](#step-2-look-at-their-repositories)). Then come to them with what you found and a short plan.
  - If you can't see their code, start with the questions in [Step 1](#step-1-find-out-their-situation).
  - Either way, have a conversation: a few questions at a time, not a form.
- **Skip what doesn't apply.** Someone who only wants prompts to paste doesn't need a runner. Someone without GitHub doesn't need the GitHub notes.
- **Keep track.** Work through [Done when](#done-when) as you go, and show it to them at the end.

## Step 1: Find out their situation

Settle these. Find out what you can yourself first, then ask about the rest.

| Question | Why it matters | How you can find out |
|---|---|---|
| Where is their work tracked? (Linear, GitHub Issues, GitHub Projects, Jira, or nowhere yet) | It decides how they sign in and which source to connect. | Issue references in commit messages and branch names (`LIN-123`, `#123`, `PROJ-12`); tracker links in the README; `.github/ISSUE_TEMPLATE/`. |
| Which repositories does the work land in, and are they on GitHub? | Harbour reads pull requests and CI from GitHub only, and its prompts use `gh`. | `git remote -v` in each checkout. |
| Do they work through pull requests and CI? | That evidence is how Harbour decides work is done. | `.github/workflows/`; recent merge commits; `gh pr list --state merged --limit 5`. |
| What is the default branch called? | Harbour's prompts tell agents to open pull requests against `main`. | `git symbolic-ref refs/remotes/origin/HEAD`. |
| Which coding agent do they use? | Running steps on their own machine needs Claude Code. Any agent can take a pasted prompt. | You know which agent you are. Ask whether they use others. |
| How much should Harbour do? | It decides [Step 7](#step-7-choose-how-work-runs). | Ask. The choices are below. |
| Will they use {{BASE_URL}}, or run Harbour on their own server? | Self-hosting means running the Harbour server; see https://github.com/JKershaw/LinearViewer. | Ask. Most people use the hosted site. |

How much Harbour should do, from least to most setup:

1. **Write prompts only.** Harbour writes each step's prompt; the person copies it into an agent. Nothing to set up beyond signing in.
2. **Run steps on their own machine.** Their Claude Code session becomes the workspace's runner, and Harbour sends it work. Needs Claude Code, Node 18 or later, and macOS or Linux.
3. **Run steps from an always-on machine.** A separate program, Simple Dispatcher, polls Harbour and opens a Claude Code session for each item.

Most people should start with 1 or 2 and move up later.

## Step 2: Look at their repositories

If you can see their code, check each repository Harbour will work on. Report what you find as three lists: ready, worth fixing first, and optional. Don't change anything without asking.

- **Tests.** Is there one command that runs the tests, and does it pass now? Harbour's implementation prompts tell agents to write tests, watch a new test fail before the fix, and keep the suite passing. Review checks those tests. Without a working test command, every run is weaker.
- **CI.** Is there a workflow under `.github/workflows/` that runs on pull requests? With CI, agents read the checks with `gh pr checks`. Without it, they compare test runs on the branch and the base, which is slower and weaker evidence.
- **The `gh` command.** Agents that run Harbour's steps use `gh` to read checks and to merge. It must be installed and signed in (`gh auth status`) wherever those agents run.
- **The default branch.** The prompts name branches `feat/<task-id>-short-description` and open pull requests against `main`. If the default branch has another name, tell the person, so they can expect to correct agents on it.
- **Branch protection.** Harbour's merge box itself advises protecting the default branch on GitHub, so nothing lands without a pull request and green checks. Check with `gh api repos/<owner>/<repo>/branches/<default-branch>/protection`: a 404 means none, and a 403 means you lack the admin rights to read it, so ask.
- **Agent instructions.** Harbour's prompts don't require a `CLAUDE.md` or `AGENTS.md`, but the agents that run them read one. A short file saying how to install, build and test, and the conventions that matter, pays off on every run. Offer to draft one. Commit it only if they say yes.
- **Deploys.** Close-out waits for a deploy and checks it, if the change deploys. Note how and where this code deploys, so you can tell the person what close-out will look for.

## Step 3: Sign in

The person does this in their browser, at {{BASE_URL}}. The buttons there show which ways this server offers. Help them pick:

| Door | Pick it when | What happens |
|---|---|---|
| **Log in with Linear** | They track work in Linear. | Linear asks for consent, then they land on Home. The workspace is their Linear organisation; signing in again on another device reaches the same workspace. |
| **Continue with GitHub** | Their issues are GitHub Issues, or GitHub is their main home. | GitHub asks them to install and authorise Harbour's GitHub App, then they choose a repository. One repository per workspace. Then Home. |
| **Continue with Jira** | They track work in Jira Cloud. | Atlassian asks for consent, they pick a site if they have several, then Home. |
| **Continue with email** | They want an account first and will connect a tracker afterwards. | Harbour emails a one-time link (valid 15 minutes). For a new account it opens their account page, `/account`, with a "Connect" row for each tracker this server offers and a button to create a local workspace. |
| **A local workspace** | They have no tracker yet, or just want to try Harbour. | "+ local workspace" is in the top bar of the previews at {{BASE_URL}}/swipe and on `/account`. Harbour stores the tasks itself. |

Two things to tell them before they choose:

- **A local workspace stays in the browser that made it.** It can't be reopened from another browser or device yet, and an email sign-in doesn't bring it back. Good for trying Harbour, not for keeping work in.
- **A sign-in button that shows an "unavailable" page** means that door isn't set up on this server. Pick another.

After signing in they land on Home, `/workspace/<key>/`. `<key>` is the workspace's short name, and it is in every workspace URL. Ask them for the URL, so you can name pages exactly.

## Step 4: Connect their sources

Settings live at `/workspace/<key>/settings`, one page per area. Sources are in **Settings › Sources** (`/workspace/<key>/settings/sources`).

- **More than one tracker.** They can add GitHub Issues, GitHub Projects or Jira to the workspace they signed in with. Home then shows tasks from every source, each marked with where it came from. One GitHub, one GitHub Projects and one Jira source per workspace. Adding Linear makes a separate workspace instead.
- **Jira by API token.** If Jira's sign-in button isn't offered, they can still add Jira here with their Atlassian email, an API token (made at https://id.atlassian.com/manage-profile/security/api-tokens) and their site, such as `their-team.atlassian.net`. Harbour can edit Jira tasks but can't create new ones yet.
- **The active source.** "Make active" chooses which source new tasks are created in, and which organisation and teams Harbour shows.
- **GitHub for evidence.** If their code is on GitHub but their tracker is Linear or Jira, Harbour still needs a GitHub connection to read pull requests and checks. The workspace owner needs one in Harbour (a GitHub source on this or another of their workspaces) whose GitHub App installation covers the repositories where pull requests land. Without it, Harbour can't see pull request status, and the merge button described in [Step 9](#step-9-run-the-first-task) never appears. Adding GitHub Issues as a source also brings that repository's GitHub issues onto Home. Tell them so before they add it.

Harbour finds a task's pull request from a link like `https://github.com/<owner>/<repo>/pull/<number>` in the task's comments. Agents running Harbour's prompts post that link. Anyone working by hand should post it too.

## Step 5: Turn on AI

Some of Harbour works with no AI at all: every template prompt is filled in from the task, with no AI call. The rest needs an AI key:

- the tailored next-step prompt, marked ✦;
- task briefs and recaps;
- scans for questions that need the person;
- the narrative roadmap.

There are two ways to provide it:

- **Their own OpenRouter key.** In **Settings › Account**, "connect" takes them to OpenRouter to approve, then back. They need a workspace first; an email account with no workspace can't connect yet. With their own key there is no daily run limit, and Harbour charges nothing: OpenRouter bills them, usually a cent or two per prompt.
- **The free tier**, if this server offers one (Settings › Account says so, and the page footer reads "ai: ● free"). Harbour's AI calls then use a shared key and one model. Each account can start a limited number of new runs per day (10 unless the server sets otherwise), and Home shows how many are left. Prompts aren't limited per account.

The agents that do the actual work are separate. A run on their machine uses their own Claude Code, billed however their Claude Code is.

## Step 6: Tidy the backlog

Harbour picks the next step for each task from its state and its place in the backlog. A few habits make a large difference. If you have a key ([Step 8](#step-8-give-yourself-access-optional)), you can read the backlog and suggest changes. Make a change only when the person agrees.

- **States must be true.** Harbour reads each task as backlog (◌), to do (○), in progress (◐), done (✓) or cancelled (✕), and the state chooses the first prompt. Two trackers have fewer states: GitHub Issues has no "in progress" (open is to do, closed is done, closed as not planned is cancelled), and Jira has no backlog (its status categories map to to do, in progress and done).
- **Linear projects must be started.** Harbour shows only Linear projects whose status is "started", plus tasks in no project. If active work sits in a planned project, it won't appear.
- **Blockers are relations, not labels.** A task is blocked when another unfinished task blocks it ("blocks" / "blocked by"). Harbour carries these relations over from Linear and local workspaces only.
- **Big tasks get sub-tasks.** A task with sub-tasks is run as a whole: "Run to PR" works through its sub-tasks. Linear, Jira and local workspaces have sub-tasks. GitHub Issues and GitHub Projects tasks don't in Harbour.
- **Bugs get a priority.** A task labelled `bug` with Urgent, High or Medium priority, and not in Backlog, moves up the order.
- **A good first task** is small and has a clear description: what's wrong or wanted, what "done" means, and the files or area if known. Help them find or write one now. They'll need it in [Step 9](#step-9-run-the-first-task).

A new local workspace starts with a "Getting started" project holding two welcome tasks. They are only a starting point; add real tasks next to them.

## Step 7: Choose how work runs

Match this to the answer from [Step 1](#step-1-find-out-their-situation).

**1. Write prompts and paste them (no setup).** On Home, they open a task and press "✦ Write the prompt", then "Copy prompt", and paste it into you or any coding agent. "Let your agent post progress to this task", on by default in Settings › Features ("Add a task key to copied prompts"), adds a single-use key to the copied prompt. The agent that receives it can then post its progress back to the task. That key is exchanged once for a working key, as the copied text explains.

**2. Run steps on their own machine (the runner).** Only the workspace owner can set this up: the first person who connected the workspace. Anyone else sees a note saying so on the runner page.

- Requirements: Claude Code (it uses subagents, so other agents can't be the runner), Node 18 or later, and macOS or Linux. Windows isn't supported.
- They open "Run on my machine" at `/workspace/<key>/runner` (or follow "Set up a runner ›" under an opened task), press **create runner prompt**, then **copy**.
- Within 1 hour, they paste it into a Claude Code session started in the folder that holds their repository checkouts. When a run names a repository, the runner looks for a folder with that exact name there. The credential then lasts 24 hours; after that, they make a new one on the same page.
- The runner takes only work the owner sent, and runs each item in its own subagent. If the laptop sleeps, it pauses. If the session ends, the runner is gone; anything it had taken needs sending again.
- Once a runner key exists, Home shows run buttons on each task: "Run <step>" for one step, or "Run to PR".

**3. Run steps from an always-on machine (Simple Dispatcher).** Simple Dispatcher is a separate program (https://github.com/JKershaw/simple-dispatcher) that polls Harbour and opens a Claude Code terminal session for each item. It needs Node 22 or later and a queue token, which the owner makes in the "Tokens" section of the Dispatch page, `/workspace/<key>/dispatch`. Its README covers its setup. If they can't reach it, use the runner instead.

**Only one per workspace.** The runner stops (`abort`) if a Simple Dispatcher has polled the same workspace in the last 10 minutes. Use one or the other.

## Step 8: Give yourself access (optional)

With a key, you can read their workspace and check your own work: confirm that tasks are visible, review the backlog, and file a starter task once they agree.

- The person makes the key in **Settings › Agent access** (`/workspace/<key>/settings/agent-access`) under "New key": a name, then **Read** or **Read and update**. It lasts 90 days and is shown once. They can revoke it on the same page.
- Send it as `Authorization: Bearer <key>`. Start with the API's own guide, which lists every endpoint with examples:

  ```
  curl -s -H "Authorization: Bearer $HARBOUR_KEY" {{BASE_URL}}/api/proxy/instructions
  ```

- A key inside a copied prompt is different. It is a single-use bootstrap: exchange it first with `curl -s -X POST -H "Authorization: Bearer <bootstrap>" {{BASE_URL}}/api/proxy/token`, then use the working key that comes back.
- **Read** covers tasks, projects, comments and the workspace's open questions. **Read and update** adds creating and editing tasks, comments, relations and labels. Either way, you can only *suggest* an answer to one of Harbour's questions; the person answers it in Harbour.
- A key from this page can't make or revoke keys, and can't start runs: that needs a key only the owner can make. It can change which model a job runs on only if they switch on "Agents can change models" in Settings › Agent access, which is off by default.
- The API allows 60 requests a minute, and every call is logged for the workspace.

## Step 9: Run the first task

Walk through one task end to end with them, on the small task from [Step 6](#step-6-tidy-the-backlog).

1. **Open it on Home.** Home lists in-progress work first, ranked so anything waiting on them comes first.
2. **Start it.**
   - Prompts only: "✦ Write the prompt", "Copy prompt", and paste it into a fresh agent session (or into you, if they'd like you to do the work).
   - With a runner: "Run to PR", or "Run <step>" for one step at a time.
3. **Watch it** on the task page, `/workspace/<key>/task/<task-id>` (the "Task page ›" link under an opened task). The page shows each stage, its sessions, and the evidence so far.
4. **Answer questions.** When an agent needs a decision, the task shows "needs you" and comes first on Home, and the task page shows the question with an answer box. Answer it in Harbour, and the run carries on.
5. **Finish.** "Run to PR" stops once review approves and the pull request is open. The owner then merges it on GitHub, or presses **Merge PR #N** on the task page. That button appears only when Harbour can read the pull request, it is the task's only open pull request, review has approved it, a runner is set up, and the run stopped at the pull request. Pressing it sends the close-out step to the runner, which merges and finishes the task.
6. **Stopping.** A running task has Stop. For the whole workspace, the owner has Pause (new steps wait), Stop (running steps stop too) and Resume in **Settings › Running**.

After the first task, look back at it with them. What did the agents get wrong that a line in `CLAUDE.md`, a test, or a clearer task description would have prevented? Offer to make that change.

## Settings worth knowing

Each is at `/workspace/<key>/settings/<area>`. The first six are grouped under Workspace; Features and Account are grouped under You.

- **Settings › Sources**: where Harbour reads tasks from ([Step 4](#step-4-connect-their-sources)).
- **Settings › Models**: which model each job runs on: the harness (Claude Code or opencode), the model and the effort. Saving a change asks for a reason. The defaults are a sensible start, so leave this until they have a reason to change it.
- **Settings › Running**: Pause, Stop and Resume, the runner's status, and periodic reviews.
- **Settings › Agent access**: every key, what it can do, and Revoke.
- **Settings › Health**: credential problems, the runner's last poll, and Harbour's own AI calls. Look here first when something stops working.
- **Settings › Change log**: every change that affects everyone, with Undo.
- **Settings › Features**: optional views (some marked experimental), the feedback widget, and "Add a task key to copied prompts".
- **Settings › Account**: email, the OpenRouter key, light or dark theme, and sign out.

## When something goes wrong

- **A sign-in button shows an "unavailable" page.** That door isn't configured on this server. Use another.
- **Tasks are missing.** Is the right source active, and for Linear, is the project "started"? Check Settings › Sources and [Step 6](#step-6-tidy-the-backlog).
- **The ✦ prompt is disabled with "needs OpenRouter".** No AI key and no free tier. See [Step 5](#step-5-turn-on-ai).
- **No run buttons on Home.** Run buttons need the workspace owner and a runner key or queue token. A member, or an owner with neither, sees the copy view.
- **The runner prints `abort`.** A Simple Dispatcher polled this workspace in the last 10 minutes. Use one or the other.
- **The API answers 401.** The key expired or was revoked, or it is a bootstrap that hasn't been exchanged. Ask for a new one.
- **No pull request status, or no Merge button.** Is there a GitHub connection whose app covers that repository ([Step 4](#step-4-connect-their-sources))? Is the pull request linked in the task's comments?

## Done when

Check these off with the person:

- [ ] Signed in, and Home shows their real tasks.
- [ ] Every tracker they use is connected, and the right one is active.
- [ ] AI is on (their own OpenRouter key or the free tier), or they've chosen to work without it.
- [ ] Each repository has a passing test command, and ideally CI on pull requests and a short agent instructions file.
- [ ] Code on GitHub has a GitHub connection that covers its repositories.
- [ ] They've chosen how work runs (prompts, the runner, or Simple Dispatcher), and it's set up.
- [ ] One small task has gone through: started, watched, its questions answered, and merged or stopped at the pull request.
- [ ] They know where to pause everything (Settings › Running) and where to revoke keys (Settings › Agent access).

## Read more

- {{BASE_URL}}/llms.txt: how the site is laid out, for agents.
- {{BASE_URL}}/templates: every prompt template Harbour uses.
- {{BASE_URL}}/library: the papers and essays behind Harbour.
- {{BASE_URL}}/api/proxy/instructions: the full API, once you have a key ([Step 8](#step-8-give-yourself-access-optional)).
