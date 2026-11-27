# Sweep, pass 2: check each loose end against reality (27 Nov)

**Why.** Pass 1 read the whole working log (`/home/user/LinearViewer/docs/plans/survey/log.md`, 2–27 Nov 2026) and listed its loose ends, merged in `/home/user/LinearViewer/docs/plans/survey/spikes/sweep/merged.md`. The log is about Harbour, a control plane that dispatches AI agent sessions on tickets, and its runner, simple-dispatcher. John's aim, in his words: "after the work is done, we can sweep and ensure everything is tracked and either done, or handled some other way." The log is deleted afterwards, so each loose end has to be settled now, from evidence and not from memory.

**Your job.** For each item in your share, find out which of these is true, and show how you know:
- **done:** the code or docs on main do it, or a ticket for it is Done;
- **tracked:** an open ticket (Todo, Backlog, In Progress) or an open project finding covers it. Give its id and state;
- **gone:** it no longer applies, because the code it was about has changed or been removed, or a later decision overtook it. Say which;
- **open:** it still holds, and nothing tracks it;
- **can't tell:** say what you checked.

**Where to look:**
- **Harbour's tickets, already fetched:** every ticket named in `merged.md` was read on 27 Nov into `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/sweep/tix/LIN-<n>.json`, with a one-line summary per ticket in `…/scratchpad/sweep/ticket-states.tsv`. Use these first. A ticket's comments are in its JSON and often say what became of it.
- **Harbour's proxy,** for a search or a ticket not already fetched. Other checkers are running alongside you, so use it sparingly. On a 429, wait 60 s and try once more. The helper is `bash /tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/hget.sh <path> <outfile>`. It runs a GET only, never prints the token, and waits 2 s after each call; don't speed it up. It writes the response body to `<outfile>`; keep outfiles under `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/sweep/`.
  - `/api/proxy/issues/LIN-1234` reads a ticket. The JSON is top level: `.state.name`, `.title`, `.comments`.
  - `/api/proxy/search?q=<url-encoded words>` returns up to 50 matching tickets.
  - Records (project findings and others) are documented in `docs/proxy-integration.md` in the Harbour worktree below. Read it before using them.
  - Never print the token or read the token file.
- **Code and docs on main.** Harbour is checked out at `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/main`, and simple-dispatcher at `…/scratchpad/sd-main`. Both are at `origin/main`. Read the code itself; a search hit alone isn't evidence.
- **The log itself,** after the item's line, for a later answer or fix.

Read-only: don't edit, comment, file or dispatch anything. Never print secrets or environment variables. Don't guess. If you haven't seen it, the answer is "can't tell".

**Write** to `/home/user/LinearViewer/docs/plans/survey/spikes/sweep/check-<n>.md`, one line per item:

`- <item id> — **verdict** — evidence (ticket id and state, file:line, or log line)`

For **open** items only, add one plain sentence saying what it would mean for John or a user if left alone. End with counts per verdict. Return a summary of at most 4 lines.
