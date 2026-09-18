Scope: the Collective experimental feature (LIN-450). Moved verbatim from CLAUDE.md (LIN-2896).

## Collective (experimental, LIN-450)

A rough-draft experiment, **gated behind a per-user `collective` feature flag and surfaced only via a link in Settings**. It automates the manual cross-project discussion written up in `docs/collective-session-2026-06-12.md`: choose a roster of characters (personas, each bound to a connected repo), name a [Yap](https://github.com/jkershaw/yap) channel, and start — the page fans `buildCollectiveParticipantPrompt(...)` out to each character's bound workspace's **unchanged** dispatch route (`dispatchQueueStore.addItem`), then renders the live channel and lets you inject input via a thin server-side Yap proxy.

- **Character selection (LIN-1048):** the picker lists saved `custom` + auto-recorded `recent` characters and offers a define-new affordance (pick a connected repo + fill the five persona fields `role/lens/objective/value/disposition` + name, optionally save). `POST /start` accepts a `characters` list (superseding `workspaceUrlKeys`); each character's `workspaceUrlKey` repo binding is re-validated against `session.workspaces` (stale bindings dropped, empty-set → 400) and every dispatched character is recorded as `recent`. Persistence is `lib/collective-characters-store.js`; a character with no persona fields collapses to the byte-identical default Implementer. `POST /preview` threads the selected `character` so preview matches dispatch.
- **Substrate:** dispatch `target` is `cli`/`web` only (full Claude Code sessions); `dash`/`local` are rejected. Each character's bound workspace must have a live consumer draining its queue.
- **Channel name** is the single shared contract across the participant prompt, the fan-out, and the `state`/`say` endpoints — normalized once via `normalizeYapChannel`. The page seeds a fresh friendly default per load via `randomChannelName()` (`#word-word-YYYY-MM-DD`).
- **Side-effect policy is prompt-only:** participants may carry a `readWrite` proxy token (best-effort minted per fan-out), but the participant prompt requires asking John in-channel before any Linear write / ticket / mutation. There is no deterministic write-lock — a named, accepted V1 gap.
- **Yap** is ephemeral (200-msg ring buffer, unauthenticated nicks); poll/history return the body in a `text` field, normalized by the `state` endpoint. `YAP_BASE_URL` defaults to `https://yap.jkershaw.com` (override per env; optional `YAP_PASSWORD`), so the live view works out of the box. `lib/yap-client.js` uses the proxy-aware fetch (`createProxyFetch`), so Yap calls route through the same egress proxy as Linear calls when one is configured.
- **Prompt preview:** `POST .../collective/preview` builds the participant prompt for the chosen channel/topic (sample nick + placeholder token) so the page can show & copy exactly what each participant receives.
- **Deferred past V1:** chat/per-agent recaps, a durable transcript store, auto-cadence, and the within-a-project variant.

Endpoints (session auth, workspace-anchored but operating over `session.workspaces`):
- `GET  /workspace/:urlKey/collective` — page (redirects to settings when the flag is off)
- `POST /workspace/:urlKey/collective/start` — character-roster dispatch fan-out (`characters` list; records recents)
- `POST /workspace/:urlKey/collective/preview` — build the participant prompt for the selected `character` (view & copy, no dispatch)
- `GET  /workspace/:urlKey/api/collective/state` — JSON poll fronting `yap.poll`
- `POST /workspace/:urlKey/api/collective/say` — inject human input via `yap.say`

