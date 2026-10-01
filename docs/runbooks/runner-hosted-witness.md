# Runbook: witness the runner on harbour.cat

For John, on harbour.cat. Readable on a phone.
LIN-3098 S5. The same run also covers
LIN-3059's hosted criterion.

This proves the Claude Code runner works
for real: a phone mints it, a laptop runs it,
and Harbour sees every step.

**You do this run yourself.** No agent does
it for you. Post what you capture on LIN-3098.

Each **☐** below is a check to observe and
capture. Note what you saw, or take a
screenshot.

## Before you start

- **Claude Code only.** opencode has no
  subagents, so it can't be the runner.
- On the laptop you need Node 18+, and macOS
  or Linux.
- The copied prompt carries a bootstrap. It
  works **once**, and only for **1h**. Once
  pasted, it becomes a credential that lasts
  **24h**.
- **Sleep is fine; closing is not.** If the
  laptop sleeps, everything pauses and picks
  up again when it wakes. If the laptop
  closes, or the Claude Code session ends,
  the runner is gone. Rows it took stay
  `taken` until history expires them (30
  days), and a parent Autopilot waiting on
  one hangs. To recover, see step 7.
- Keep these to hand: your iPhone (Safari),
  the laptop with Claude Code, and a second
  OS user on the laptop for step 3.
- **Same-user boundary.** Subagents never
  get a token. But any process running as
  your OS user could read the credential
  file or use a live broker. Run only work
  you'd run yourself.

## 1. A fresh workspace

1. On harbour.cat, signed in as the owner,
   pick a **fresh** workspace that Simple
   Dispatcher does not poll.
2. Make **no** dispatch token for it.
3. In **Settings**, turn on **Linear API
   proxy** (workspace API access) and
   **Dispatch queue**.

## 2. Mint and copy, on the phone

Do this in **iOS Safari** on your iPhone.

1. Open any task. Tap **run on my machine ›**,
   beside the ladder. The Dispatch page links
   there too.
2. Tap **create runner prompt**, then
   **copy**.
3. ☐ **iOS Safari copy works.** The page
   shows `copied ✓`. Paste it into Claude
   Code on the laptop **within 1h**.
   Universal Clipboard works for this. If
   you don't have it, see the note below.
4. ☐ **The long-press fallback works.** Force
   it once. With the iPhone plugged in, open
   Mac Safari → **Develop** → your iPhone →
   this page. In its console, run:

```js
navigator.clipboard.writeText =
  () => Promise.reject()
```

   Then tap **copy** again. The page should
   say "Copying didn't work here", with the
   text selected. Long-press it, choose
   **Copy**, and check that it pastes.
5. ☐ **The block carries an `https`
   baseUrl.** In the pasted text, the
   `## Your runner credential` block has
   `- baseUrl: https://harbour.cat`.

Note: the browser that mints is the one
whose **run this step** forces API access
(step 3). If you can't paste from the phone
to the laptop, do the two checks above, then
mint again in the laptop's browser and run
step 3 from that browser.

Use only a copy from the `/runner` page.
Don't use the API route.

## 3. Start the runner (laptop)

Paste the whole copy into Claude Code. It
fetches the kit, checks it, and logs in.

1. ☐ **`kit ok`**: the verify step prints
   `kit ok` against harbour.cat.
2. ☐ **Exchange**: `login` prints grants
   `take` and `dispatch`, and no token.
3. ☐ **`wait` is running** in the
   background.

### Run 1: run this step

1. In the browser that minted, open a task
   and tap **run this step**.
2. ☐ **The forced dispatch reaches the
   runner.** The runner takes the item and
   posts `[handoff] … (new)`.
3. ☐ **The subagent has API access.** Its
   first Harbour call is a
   `curl --unix-socket …` and returns data.
4. While it runs, check the socket by hand
   in a laptop terminal:

```sh
ls ~/.harbour-runner/s/
```

```sh
S=~/.harbour-runner/s/<id8>.sock
B=http://harbour-runner.invalid
```

5. ☐ **The socket works.**

```sh
curl --unix-socket $S \
  $B/api/proxy/instructions
```

   Expect a 200.

6. ☐ **Bare curl fails closed.**

```sh
curl $B/api/proxy/instructions
echo $?
```

   Expect exit `6`, because `.invalid` never
   resolves.

7. ☐ **Another OS user is refused.**

```sh
sudo -u <other> curl \
  --unix-socket $S \
  $B/api/proxy/instructions
```

   Expect "Permission denied" (EACCES).

8. ☐ **`[usage]` is real.** When the item
   ends, its `[usage]` line has
   `"harness":"claude-code"` and a real
   `"model"`.

## 4. Run 2: run the whole task

Tap **run the whole task** on a tiny
throwaway task.

1. ☐ **Follow-ups continue the same
   subagent.** Each wake is a `followUpTo`
   item. Its `[handoff]` says
   `(continued from <root id>)`, with the
   **same** subagent id as the root.
2. ☐ **`wait` re-arms.** When the background
   `wait` exits, Claude Code is re-invoked
   and runs `wait` again. Leave it idle for
   25 min to see a `cap` exit and the
   re-arm.
3. ☐ **Laptop sleep.** Mid-run, put the
   laptop to sleep (don't quit, and don't
   shut down) for about 5 minutes. When it
   wakes, `wait` re-arms, and
   `runner status` shows `stale: false`.
   Note whether the subagent carried on, or
   had to retry a step.
4. ☐ **`[usage]` per item**, as in step 3.

## 5. Capture

On the **Proxy** page, make a **read-only**
token for these reads. Revoke it when
you're done.

```sh
T=<read-only token>
H=https://harbour.cat/api/proxy
A="Authorization: Bearer $T"
```

1. Every dispatch id: the root, each child,
   and each wake. The runner's end summary
   lists them.
2. `GET /api/proxy/dispatch/:id` for each.
   Note the status, `[handoff]`, `[usage]`,
   and the terminal marker.

```sh
curl -H "$A" $H/dispatch/<id>
```

3. `GET /api/proxy/issues/:id/cost` for both
   tasks.

```sh
curl -H "$A" $H/issues/<LIN-id>/cost
```

4. The runner's end summary. Ask the session
   to stop and report.

## 6. Optional probes

- A **read-write** token on
  `/api/proxy/runner/poll` → 403.
- A second exchange of the same bootstrap →
  401.
- Revoke the credential in **Runner
  credentials** → the next poll gets 401.
- An item from another account stays
  queued, and mints no wake.

## 7. If the runner dies

- Rows it took stay `taken`. Nothing can
  close them from outside.
- Re-dispatch the task.
- The next session's `recover` posts
  `[failed] runner restarted: subagent lost`
  on rows that credential took, and lists
  the rest as orphans.

Post the captures on **LIN-3098**: the ☐
results, the ids, the reads, the cost, and
the end summary.
