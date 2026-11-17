# TODO

Ordered. Each item unblocks the next. Don't skip ahead.

## v0.1.0 — prove the core loop ✅ shipped

1. ~~**Grab the namespace.** Register `@jkershaw/yap` on npm (empty package). Create the GitHub repo with just `README.v0.1.0.md` (renamed to `README.md`), `PHILOSOPHY.md`, `DESIGN.md`. No code yet.~~

2. ~~**Scaffold the package.** Node project, TypeScript (no build step, `--experimental-strip-types`), single `bin` entry (`yap`). One package, `/src/{channels,messages,presence,listen,ratelimit,store,http,mcp,web,bin}`.~~

3. ~~**Build the in-memory state layer.** Channels, buffers, members, monotonic IDs, parsed mentions, scrypt passwords, per-nick rate limiter, long-poll waiters with AbortController. Pure functions over a single `Store` value; unit tests cover the DESIGN.md invariants.~~

4. ~~**Wrap it in an HTTP API.** `POST /api/{join,leave,say,poll,listen,who,history}` with plain JSON in/out. Tiny `node:http` router. Integration tests spin the server on an ephemeral port and exercise every endpoint.~~

5. ~~**Build the minimal web UI.** Single HTML file, plain JS with `@ts-check` + JSDoc. Nick + channel + password landing form, message list, input box, who-panel. Polls the HTTP API every 2s. Cookie persists the nick across refresh.~~

6. ~~**Get two humans chatting.** Covered by the Playwright e2e: two browser contexts in the same channel exchanging messages, `@mentions` highlighted, `/me` rendered, refresh keeps the nick, password-gated channel rejects the wrong password.~~

7. ~~**Add the MCP endpoint.** Same seven tools wrapped via `@modelcontextprotocol/sdk` on a stateless `StreamableHTTPServerTransport`. `GET /mcp-config` returns a paste-ready blob (pre-filled `Authorization` header when `YAP_PASSWORD` is set).~~

8. ~~**Connect Claude Code.** MCP conformance tests drive every tool via the official client SDK, including password-gated flows and client-disconnect cancellation of `listen`.~~

9. ~~**Polish to shippable.** `@mentions` render, `/me` actions, readable on mobile, optional `YAP_PASSWORD` gate (Bearer / cookie / query-param-rewrites-to-cookie), per-nick `say` rate limit (`YAP_RATE_LIMIT`, default 30/min), graceful 400/401/403/404/413/429 errors, constant-time password comparisons, body-size cap.~~

10. **Release v0.1.0.** Publish to npm. Deploy to `yap.jkershaw.com`. ← **next step for the maintainer**

## Between releases — live with it

11. **Use it for real.** A week or two. Notice what's missing, what's annoying, what you reach for that isn't there. Do not add features during this phase — just note them.

12. **Re-read `PHILOSOPHY.md`.** Cut any noted features that don't survive the re-read.

### v0.1.0 housekeeping carried over

- Split `src/http/server.ts` (310 lines) into `server.ts` + `auth.ts` once another feature bumps it.
- Add structured logging (pino) once the hosted instance has a reason to need it; until then, `console.error` is enough. Dep is intentionally not shipped in v0.1.0.

## v0.5.0 — profiles

13. **Add `/src/profiles`.** `whois(nick)` and `set_profile(description)` as defined in `DESIGN.md`. Description lives on the nick and is evicted with it. Wire into HTTP and MCP handlers alongside the existing tools.

14. **Tests.** Unit coverage for the module; integration coverage for `set_profile` then `whois` across channels; MCP conformance for both tools.

15. **Release v0.5.0.** Bump version, publish, update the hosted instance. Add the two tools to the README tool list.

## v1.0.0 — fill out the vision

16. **Reactive agent runtime.** `yap agent --config agent.json` as a new bin entry. Implements the listen-loop → LLM → say cycle. OpenRouter only to start. Test with a hand-rolled `planner.json`.

17. **CLI client.** `yap cli` as another bin entry. Terminal chat client against any server URL. Nice-to-have, not critical — skip if time-constrained.

18. **Web-based agent creator.** Form in the web UI: name, description, channels, system prompt, model. On submit, if `OPENROUTER_KEY` is set, spin up an in-process agent using the same runtime. If not, generate a downloadable `agent.json` the user can run locally with `yap agent`.

19. **BYOK OAuth flow.** OpenRouter OAuth integration for users who want to run server-hosted agents on their own credits. Optional — only enabled if `OPENROUTER_OAUTH_CLIENT_ID` is set.

20. **Abuse guards beyond per-nick rate limits.** Per-IP channel creation caps, hosted-instance defaults, and any further protections the live deployment turns out to need.

21. **Observability polish.** Read-only channel views (shareable spectate links), better rendering of system events, maybe a small "who's here" sidebar.

22. **Release v1.0.0.** Update the README. Tag the release. Write a short blog post if the mood strikes.

## Never

- Anything in the "Things we will not add" list in `PHILOSOPHY.md`.
- Features added because they'd be easy, rather than because they'd be used.
- Abstractions introduced before the second concrete use case exists.
