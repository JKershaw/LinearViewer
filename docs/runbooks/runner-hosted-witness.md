# Witness: the runner on harbour.cat

For John. LIN-3098, and LIN-3059's hosted
criterion. About 45 minutes.

Read this on any phone. Do the steps on a
laptop. Open this page on the laptop too,
so you can copy the lines in step 2.

In the links below, URLKEY is the part
after `/workspace/` in the address bar
when you're in the workspace.

## Before you start

- **The runner is a laptop.** A Mac or
  Linux machine with Claude Code and
  Node 18+. A phone can't be the runner,
  and nor can a claude.ai/code session
  (see "Why a laptop" below).
- **A fresh workspace** that Simple
  Dispatcher doesn't poll. To make one,
  signed in, open
  https://harbour.cat/workspace/witness/
  It says "Workspace Not Found". Type
  `Runner witness` and tap **Create a local
  workspace**. You land in it, and the
  address bar shows its urlKey. (Already
  made one this morning? Use it.)
- **Two toggles.** In that workspace's
  Settings, turn on **Linear API proxy**
  and **Dispatch queue** (they may already
  be on):
  https://harbour.cat/workspace/URLKEY/settings
- **One tiny task.** On the workspace page,
  tap **+ Add task**. Title: `Say hello`.
  Description: `Reply with one sentence.
  Change no files.`

## 1. Get the prompt

1. On the laptop's browser, open the
   workspace and tap your **Say hello**
   task to open it.
2. Tap **run on my machine ›**. It shows
   as soon as the task opens, and opens
   the runner page.
3. Tap **create runner prompt**, then
   **copy**. It shows `copied ✓`.
4. Use this same browser for steps 3–4.
   Paste the copy within 1 hour.

No link? Open
https://harbour.cat/workspace/URLKEY/runner

## 2. Start the runner

1. In a laptop terminal, start Claude Code
   in an empty folder, so no task can touch
   your code:

```sh
mkdir -p ~/witness
cd ~/witness
claude
```

2. Paste the whole copy and send it. It
   fetches the kit, prints `kit ok`, logs
   in, and starts waiting for work.
3. Then send this line, unchanged:

```text
This is the LIN-3098 hosted witness.
Keep notes for a final report.
For each item: dispatch id, subagent id,
handoff (new or continued), the [usage]
harness and model, and the outcome.
Also check and note:
1. my credential block's baseUrl is https;
2. the grants login printed, and that its
   expiresAt is about 24h from now;
3. running login again with the same block
   now fails with HTTP 401;
4. while the first item runs: curl through
   its socket to /api/proxy/instructions
   gives 200; to /api/proxy/runner/poll
   gives 403; a bare curl (no socket) to
   http://harbour-runner.invalid/api/proxy/instructions
   fails (note the exit code, and whether
   http_proxy or HTTPS_PROXY is set);
5. each time wait exits: its reason, and
   that you re-armed it.
```

## 3. Run one step

1. In the same browser, open Swipe:
   https://harbour.cat/workspace/URLKEY/swipe
2. Swipe to the **Say hello** card.
3. Tap **Prompts** on the card to open it.
4. Under **other prompts**, tap
   **look into**. (Or tap **✦**: either
   gives a prompt.)
5. Scroll down. Tap **run this step**.
6. Watch the runner. It takes the item and
   runs it in a subagent. Wait until it
   says the item is done.

## 4. Run one tiny task

1. On the same card, tap **run the whole
   task**.
2. Leave the runner working. Autopilot
   sends follow-ups, and the runner
   continues the same subagent for each.
   Wait until it says the task is done
   (or blocked).

## 5. Done: paste this back

1. Send this line to the runner:

```text
Stop the runner now. Give me one
plain-text block for LIN-3098:
1. your end summary: every dispatch id
   with its subagent, handoff, [usage]
   model and outcome; anything left
   queued or taken;
2. each check I asked for, and what
   you saw;
3. the output of runner status and
   runner ledger.
No tokens.
```

2. Copy its reply. Post it as a comment on
   **LIN-3098**. That's the witness.

The runner can't post to LIN-3098 itself.
Its credential only reaches the witness
workspace, and LIN-3098 lives in another
one.

## If you have 5 more minutes (optional)

Each is optional. Skip any. Say which you
did in the comment.

- **Revoke.** After step 5, tap **Revoke**
  in Runner credentials:
  https://harbour.cat/workspace/URLKEY/proxy
  Then tell the runner: `run runner poll`.
  Expect a 401 (credential rejected).
- **Phone copy.** On your phone (any
  browser), open **Say hello** and tap
  **run on my machine ›**. Tap
  **create runner prompt**, then **copy**.
  Note whether it shows `copied ✓`. Don't
  paste it; it expires unused in 1h.
- **Copy fallback.** On the laptop, open
  the runner page (step 1) and the
  browser's developer console. Run:

```js
navigator.clipboard.writeText =
  () => Promise.reject()
```

  Then tap **create runner prompt** and
  **copy**. Expect "Copying didn't work
  here", with the text selected.
- **Another OS user.** In a laptop terminal,
  while an item runs, with a second OS user:

```sh
ls ~/.harbour-runner/s/
```

```sh
sudo -u OTHERUSER curl --unix-socket \
  ~/.harbour-runner/s/ID8.sock \
  http://harbour-runner.invalid/api/proxy/instructions
```

  Expect "Permission denied".
- **Laptop sleep.** During step 4, sleep the
  laptop (don't close Claude Code) for 5
  minutes. On waking, ask the runner for
  `runner status`. Expect
  `heartbeat.stale: false`, and the runner
  carrying on.
- **Idle re-arm.** Leave the runner idle
  25 minutes. Expect a `wait` exit with
  reason `cap`, and the runner re-arming.
- **A plain read-write token.** On the
  Proxy page, make a read-write token.
  Then, on the laptop:

```sh
curl -H "Authorization: Bearer TOKEN" \
  https://harbour.cat/api/proxy/runner/poll
```

  Expect 403. Revoke the token after.

## Why a laptop

The runner keeps a Claude Code session open.
It runs a background `wait` loop, starts a
subagent per item, and gives each one a
local Unix socket. The kit needs Node 18+
and macOS or Linux. Windows isn't supported.

A claude.ai/code session from a phone isn't
a supported runner. Nothing in the kit or
its tests covers one, its sandbox may not
reach harbour.cat, and it isn't a machine
you keep open.

## If the runner dies

If the laptop closes or the session ends,
the runner is gone. Rows it took stay
`taken`, and an Autopilot waiting on one
hangs. Re-dispatch the task, and paste a
fresh copy into a new session. Its
`recover` closes out the old rows it can.
