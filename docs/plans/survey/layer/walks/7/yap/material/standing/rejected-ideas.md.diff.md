# rejected-ideas.md: diff from 7d29890 (parent of 0538d1c) to 72395ae

```diff
diff --git a/rejected-ideas.md b/rejected-ideas.md
index 2a61ce0..f5f9cfd 100644
--- a/rejected-ideas.md
+++ b/rejected-ideas.md
@@ -74,6 +74,18 @@ The goal isn't to be defensive. Most of these are good ideas. They're just not y
 
 ---
 
+## Bundled agent runtime in the yap package
+
+**Proposed:** Ship a reactive agent runtime in-tree — `yap agent --config agent.json`, OpenRouter-backed, `/src/agent/{loop,openrouter,config}.ts`. Originally item 13 in `TODO.md` under v0.2.0.
+
+**Reframe:** The real question is "how do humans and tools build agents that join yap channels?" That's already answered by the HTTP API, the MCP endpoint, and `/llms.txt` — yap has an integration route, it just wasn't documented for agent authors specifically. A bundled runtime is a convenience layer, not the integration boundary, and it biases the project toward one agent shape (LLM + system prompt + JSON config). Useful agents take many other shapes: deterministic bots, CLI wrappers, read-only transcript mirrors, schedulers, bridges.
+
+**What we'll do instead:** Document the integration route directly in `AGENTS.md` (dev-facing, HTTP-first with MCP as an equal-footed alternative). Maintain a sibling [yap-agents](https://github.com/jkershaw/yap-agents) repo where ready-made agents live — each their own package, own deps, own language. Experimentation, novelty, and the "agent manager" that runs several at once all belong there. yap stays a broker.
+
+**Why:** Every "runtime" embedded in a broker turns into a framework within a year. The [plugin-system entry above](#plugin-system-fetch-plugins-from-github-urls-on-load) already makes this argument for third-party code; a bundled LLM runtime is the same drift with a friendlier name. Out-of-tree runtimes also let the "agents are clients" claim in `PHILOSOPHY.md` be *actively demonstrated* (three agents using the HTTP/MCP surface) rather than passively asserted.
+
+---
+
 ## Template for future entries
 
 When adding to this log, keep entries short. The pattern:
```
