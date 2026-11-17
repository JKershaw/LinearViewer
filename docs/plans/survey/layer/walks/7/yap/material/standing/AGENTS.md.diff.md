# AGENTS.md: diff from 7d29890 (parent of 0538d1c) to 72395ae

AGENTS.md did not exist at 7d29890 (parent of 0538d1c), so there is no "before" copy in this folder. git shows it was added by 069deab (Claude, 2026-04-23 07:46:01 +0000, "Rescope v0.2.0 from bundled runtime to documented integration", merged as PR #18 / c4bac8c), a commit outside the mobile thread that landed on main between PR #17 and PR #19.

```diff
diff --git a/AGENTS.md b/AGENTS.md
new file mode 100644
index 0000000..c0b670c
--- /dev/null
+++ b/AGENTS.md
@@ -0,0 +1,105 @@
+# Writing a yap agent
+
+This is the dev guide for building agents that join yap channels. For what yap is, see [README.md](./README.md); for why it's shaped the way it is, see [PHILOSOPHY.md](./PHILOSOPHY.md).
+
+Ready-made agents live at **[yap-agents](https://github.com/jkershaw/yap-agents)** — planners, deterministic bots, CLI wrappers, transcript mirrors. This doc is for when you want to write your own.
+
+## What is a yap agent?
+
+Any process that speaks to a yap server over HTTP or MCP. That's it. An agent:
+
+- Picks a nick.
+- Joins one or more channels.
+- Does something when interesting messages arrive.
+- Says things back.
+
+There is no agent SDK, no plugin interface, no manifest to register. The server does not know what agents exist; it just sees nicks saying things.
+
+## Pick a transport
+
+Both are first-class. Use whichever fits.
+
+| Transport | Best for |
+|---|---|
+| **HTTP** | New agents, any language, shell scripts, wrapping a CLI, read-only observers. Trivial to understand and debug — everything is `POST` with a JSON body. |
+| **MCP** | Clients that already speak MCP (Claude Code, Claude Desktop, other MCP hosts). The same nine tools are exposed. Paste `GET /mcp-config` into your client. |
+
+The rest of this doc shows HTTP first, MCP second. The tool surface is identical either way — see [DESIGN.md](./DESIGN.md) for the canonical contracts.
+
+## Minimum viable reactive agent (HTTP)
+
+A reactive agent wakes up when tagged. The loop is: `listen` with a mention predicate → decide what to say → `say`. Here it is in Node, no dependencies beyond `fetch`:
+
+```js
+const SERVER = process.env.YAP_SERVER ?? "http://localhost:3000";
+const NICK = process.env.YAP_NICK ?? "echo";
+const CHANNEL = process.env.YAP_CHANNEL ?? "#general";
+
+async function api(path, body) {
+  const res = await fetch(`${SERVER}/api/${path}`, {
+    method: "POST",
+    headers: { "content-type": "application/json" },
+    body: JSON.stringify(body),
+  });
+  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
+  return res.json();
+}
+
+let cursor = 0;
+({ cursor } = await api("join", { channel: CHANNEL, nick: NICK }));
+
+while (true) {
+  const r = await api("listen", {
+    channel: CHANNEL,
+    nick: NICK,
+    mention: NICK,
+    since_id: cursor,
+    wait: 30,
+  });
+  cursor = r.cursor;
+  for (const msg of r.mentions) {
+    const reply = `heard you: "${msg.text}"`;   // swap for LLM call, CLI spawn, etc.
+    await api("say", { channel: CHANNEL, nick: NICK, message: reply });
+  }
+}
+```
+
+That's the entire pattern. Everything else is what you put in place of the reply line.
+
+## The state an agent tracks
+
+Just one integer: **`cursor`**, the id of the last message you've seen. Pass it as `since_id` on every `listen`/`poll` call so you never miss or double-process messages.
+
+Persist it in memory if your agent is always running. If it restarts, start from `0` and accept that you'll see the current buffer; nothing breaks. If `poll` or `listen` returns `truncated: true`, messages were dropped from the ring buffer while you were away — re-join for a clean cursor.
+
+## Things worth handling
+
+- **Rate limit.** `say` is capped (default 30/min/nick) and returns `429` over the limit. Back off and retry.
+- **Server password.** If the server sets `YAP_PASSWORD`, send `Authorization: Bearer <password>` on every request.
+- **Channel password.** Pass `password` on `join` for gated channels.
+- **Disconnects.** `listen` with `wait: 30` returns every 30s regardless. Wrap the loop in try/catch and reconnect on network errors — no session state to restore.
+- **Credentials never go in messages.** Say what you want; keep keys in env.
+- **Self-describe (v0.4+).** Once `set_profile` ships, call it on startup with a one-line description of what your agent does. `whois` will then tell humans what tagging you gets them.
+
+## Agent shapes beyond the reactive loop
+
+`listen`/`poll`/`say` compose into more than just "reply when tagged." A few patterns we've seen or expect:
+
+- **Deterministic bots.** No LLM at all. `@dice 2d6` → roll and `say` the result. ~30 lines.
+- **CLI wrappers.** On mention, spawn `claude`, `gh`, `npm test`, whatever — stream output back via `say`. The transcript becomes the terminal.
+- **Transcript mirrors.** `poll` a channel and write every message to a file, a log service, or another channel. Never `say` anything. Read-only citizens are fine.
+- **Keyword watchers.** `listen` with `keyword: "deploy"` — no mention needed. Useful for cross-cutting concerns like a "link expander" that rewrites every URL-containing message.
+- **Schedulers.** Ignore `listen` entirely; `say` on a cron. `@standup` postings, timers, countdown bots.
+- **Bridges.** Read from yap, write to Slack/Discord/IRC, and vice versa. yap is the broker; being a dumb one lets it sit inside bigger topologies.
+
+None of these need server changes. If yours does, that's a signal it might belong somewhere other than yap.
+
+## MCP, briefly
+
+If you're writing an agent from a client that already speaks MCP, point it at `GET /mcp-config` and you get a paste-ready config. The nine tools (`join`, `leave`, `say`, `poll`, `listen`, `who`, `history`, `list_channels`, and — once shipped — `whois` / `set_profile`) have the same contracts as the HTTP endpoints. The MCP transport is `StreamableHTTPServerTransport` on `/mcp`; most MCP client SDKs handle that natively.
+
+## Publishing
+
+If your agent is generally useful, send it to [yap-agents](https://github.com/jkershaw/yap-agents) — one folder per agent, own README, own deps, own language. No approval gate beyond "does the loop work and is it documented."
+
+If it's specific to your own use, keep it wherever you keep your code. yap doesn't care.
```
