# todo.md: diff from 7d29890 (parent of 0538d1c) to 72395ae

```diff
diff --git a/todo.md b/todo.md
index 905cb3e..547d19b 100644
--- a/todo.md
+++ b/todo.md
@@ -28,36 +28,93 @@ Ordered. Each item unblocks the next. Don't skip ahead.
 
 11. **Use it for real.** A week or two. Notice what's missing, what's annoying, what you reach for that isn't there. Do not add features during this phase — just note them.
 
-12. **Re-read `PHILOSOPHY.md`.** Cut any noted features that don't survive the re-read.
+12. **Re-read `PHILOSOPHY.md`.** Cut any noted features that don't survive the re-read. This gate repeats between every minor release.
 
 ### v0.1.0 housekeeping carried over
 
 - Split `src/http/server.ts` (310 lines) into `server.ts` + `auth.ts` once another feature bumps it.
 - Add structured logging (pino) once the hosted instance has a reason to need it; until then, `console.error` is enough. Dep is intentionally not shipped in v0.1.0.
 
-## v0.5.0 — profiles
+## v0.2.0 — agent integration, documented
 
-13. **Add `/src/profiles`.** `whois(nick)` and `set_profile(description)` as defined in `DESIGN.md`. Description lives on the nick and is evicted with it. Wire into HTTP and MCP handlers alongside the existing tools.
+The biggest philosophy-validator: proves agents are clients by making the integration route explicit and pointing at a sibling repo where agents actually live. No runtime ships in yap — that would bias toward one agent shape and invite the framework drift PHILOSOPHY.md warns about. See `rejected-ideas.md` → "Bundled agent runtime" for the reasoning.
 
-14. **Tests.** Unit coverage for the module; integration coverage for `set_profile` then `whois` across channels; MCP conformance for both tools.
+13. **Write `AGENTS.md`.** Canonical dev guide: HTTP-first minimal reactive loop, MCP as the equal-footed second option, patterns beyond the reactive loop (deterministic, CLI wrappers, read-only mirrors, schedulers, bridges), state to track, edge cases. One runnable example in ≤40 lines.
 
-15. **Release v0.5.0.** Bump version, publish, update the hosted instance. Add the two tools to the README tool list.
+14. **Add an "Agents" section to `README.md`.** Short, links `AGENTS.md` and the `yap-agents` repo.
 
-## v1.0.0 — fill out the vision
+15. **Add a pointer from `/llms.txt`.** Agents discovering the server at runtime should be able to find `AGENTS.md` without guessing.
 
-16. **Reactive agent runtime.** `yap agent --config agent.json` as a new bin entry. Implements the listen-loop → LLM → say cycle. OpenRouter only to start. Test with a hand-rolled `planner.json`.
+16. **Seed the `yap-agents` repo.** Separate repo with its own README. At least three diverse examples at launch so the directory proves the shape supports more than reactive LLM agents:
+    - `planner` — reactive, OpenRouter-backed (the original v0.2.0 example).
+    - A deterministic one — `dice` or `echo`, no LLM, ~30 lines.
+    - `claude-code` — spawns `claude` CLI on mention, streams output back via `say`.
 
-17. **CLI client.** `yap cli` as another bin entry. Terminal chat client against any server URL. Nice-to-have, not critical — skip if time-constrained.
+17. **Release v0.2.0.** Bump version, publish, update the hosted instance, link `yap-agents` prominently. No new code in yap itself beyond docs.
 
-18. **Web-based agent creator.** Form in the web UI: name, description, channels, system prompt, model. On submit, if `OPENROUTER_KEY` is set, spin up an in-process agent using the same runtime. If not, generate a downloadable `agent.json` the user can run locally with `yap agent`.
+## v0.3.0 — CLI client
 
-19. **BYOK OAuth flow.** OpenRouter OAuth integration for users who want to run server-hosted agents on their own credits. Optional — only enabled if `OPENROUTER_OAUTH_CLIENT_ID` is set.
+Small, independent, good dogfooding for anyone who doesn't want a browser tab open.
 
-20. **Abuse guards beyond per-nick rate limits.** Per-IP channel creation caps, hosted-instance defaults, and any further protections the live deployment turns out to need.
+18. **CLI client.** `yap cli` as another bin entry. Terminal chat client against any server URL. Reads from stdin, renders incoming messages with the same presence/mention conventions as the web UI. Uses the HTTP API, not MCP — it's a human client.
 
-21. **Observability polish.** Read-only channel views (shareable spectate links), better rendering of system events, maybe a small "who's here" sidebar.
+19. **Tests.** Integration coverage against the real server; snapshot the rendered output for a scripted conversation.
 
-22. **Release v1.0.0.** Update the README. Tag the release. Write a short blog post if the mood strikes.
+20. **Release v0.3.0.**
+
+## v0.4.0 — profiles
+
+Small and additive. Lands here rather than earlier because `set_profile` is most useful when agents exist to call it on boot; `whois` is most interesting when there's a mix of humans and agents in a channel.
+
+21. **Add `/src/profiles`.** `whois(nick)` and `set_profile(description)` as defined in `DESIGN.md`. Description lives on the nick and is evicted with it. Wire into HTTP and MCP handlers alongside the existing tools.
+
+22. **Tests.** Unit coverage for the module; integration coverage for `set_profile` then `whois` across channels; MCP conformance for both tools.
+
+23. **Document the startup pattern.** `AGENTS.md` picks up a "call `set_profile` on start" recommendation. `yap-agents` examples are updated to follow it. No code change in yap beyond the tool itself.
+
+24. **Release v0.4.0.** Add the two tools to the README tool list.
+
+## v0.5.0 — web-based agent creator
+
+Depends on the `yap-agents` ecosystem: the creator is a frontend for producing agent configs that a chosen downstream agent can consume.
+
+25. **Web agent creator UI.** Form in the web UI: name, description, channels, system prompt, model. Outputs a JSON blob matching the schema of a chosen `yap-agents` agent (`planner` to start).
+
+26. **Downloadable output.** The form returns the blob as a download. Running it is the user's job — `npx @jkershaw/yap-agent-planner --config downloaded.json` or equivalent.
+
+27. **Server-hosted execution — deferred by default.** Running agents in-process on the broker re-introduces the "yap is a runtime" drift this release cycle is trying to avoid. Revisit only if the hosted instance clearly needs it and a sandboxed path exists.
+
+28. **Tests.** E2e coverage: fill the form, download the config, assert the blob matches the consuming agent's schema.
+
+29. **Release v0.5.0.**
+
+## v0.6.0 — BYOK OAuth
+
+Only meaningful if v0.5 ships server-hosted execution (item 27). Skip this release entirely if it didn't.
+
+30. **OpenRouter OAuth integration.** Standard OAuth flow, tokens stored in-memory per nick, evicted with the nick. Only relevant if the server runs agents on the user's behalf.
+
+31. **Tests.** Integration coverage with a stub OAuth provider. Assert tokens never leak across nicks and never appear in logs.
+
+32. **Release v0.6.0** — or fold the release number into v0.7 if this one is skipped.
+
+## v0.7.0 — abuse guards and observability
+
+Everything the live deployment has taught us by now. Scope is deliberately soft because the right list is whatever the hosted instance actually needs.
+
+33. **Abuse guards beyond per-nick rate limits.** Per-IP channel creation caps, hosted-instance defaults, and any further protections the live deployment turns out to need.
+
+34. **Observability polish.** Read-only channel views (shareable spectate links), better rendering of system events, maybe a small "who's here" sidebar.
+
+35. **Admin endpoints.** `POST /admin/purge` and `POST /admin/block` behind `YAP_ADMIN_TOKEN`, per the rejected-ideas doc. Curl-only, no UI.
+
+36. **Release v0.7.0.**
+
+## v1.0.0 — we've lived with all of it
+
+No new features. The bar is: the hosted instance has been running for long enough, with enough real use, that the maintainer can call it done without flinching.
+
+37. **Release v1.0.0.** Update the README. Tag the release. Write a short blog post if the mood strikes.
 
 ## Never
 
```
