# Dependency & Supply-Chain Review — 2026-06-25

**Task:** LIN-670 (periodical, Stage 2 — run the review)
**Altitude:** supply-chain / provenance (lockfile trust, name-proximity, tree growth, unjustified runtime additions). CVE counts are the cheap baseline that *frames* this work, not the headline — the broad Security Review owns generic CVE scope.
**Repo HEAD:** `8de7da5` (2026-06-25) — "LIN-666: Recent Headwinds review"
**Baseline status:** **This is the baseline run.** No prior `dependency-supply-chain-review-*.md` exists under `docs/reviews/`. The prior instance LIN-660 was canceled and produced no report, so there is nothing to inherit. All findings below are point-in-zero state; the next run measures deltas against this report.

---

## Instruments run (review-only — no manifest/lockfile edits)

- `npm audit` — baseline CVE check. **No** `npm audit fix` / `npm update` / unpinned install run.
- `npm ci --dry-run` — lockfile integrity check (exit 0, "up to date", did not rewrite the lockfile).
- Lockfile static analysis (`jq` over `package-lock.json`) — resolved URLs, integrity hashes, tree shape.
- Source scan (`grep`) — actual import reachability of flagged packages.
- `git log` over `package.json` / `package-lock.json` — newly-introduced packages and churn.
- `git status` confirmed clean before and after; no files were modified by this review.

## Re-grounding (snapshot in the task description was NOT trusted)

The minting snapshot was re-verified against the live repo at HEAD and matches:

| Metric | Minting snapshot | Live at HEAD | Match |
|---|---|---|---|
| Direct runtime `dependencies` | 11 | 11 | ✓ |
| Direct `devDependencies` (pinned exact) | 2 (@playwright/test 1.57.0, playwright 1.57.0) | 2, same pins | ✓ |
| `lockfileVersion` | 3 | 3 | ✓ |
| Lockfile `packages` entries (incl. root) | ~108 | 108 | ✓ |
| Resolved packages (excl. root) | ~107 | 107 | ✓ |
| Vendored client libs in `public/` (not npm-tree) | chart.umd.min.js, marked.min.js, purify.min.js | unchanged | ✓ |

Dependency surface is **stable** — `package-lock.json` last changed at `386e330` / `8f5020d` (Playwright pin + move to devDependencies), with no dependency *additions* since. The minimal-runtime posture is intact.

---

## Findings (severity-ranked)

### F1 — `undici` advisory cluster on a declared-but-unimported direct dependency  ·  Severity: **High (advisories)** / effective reachability **Low**

`npm audit` reports **all 7 of its vulnerabilities in a single package, `undici@7.18.2`** (advisory range `7.0.0 – 7.27.2`):

| npm package-level rollup | count |
|---|---|
| critical | 0 |
| high | 3 |
| moderate | 4 |
| low | 0 |
| **total** | **7** |

Per-advisory breakdown (11 individual advisories fold into the package rollup): WebSocket 64-bit length parser crash (high), HTTP request/response smuggling (moderate), WebSocket permessage-deflate unbounded memory (high), WebSocket `server_max_window_bits` unhandled exception (high), CRLF injection via `upgrade` (moderate), DeduplicationHandler unbounded memory DoS (moderate), Set-Cookie percent-decode header injection (moderate), WebSocket fragment-count DoS (high), keep-alive response-queue poisoning (low), Set-Cookie SameSite downgrade (low), shared-cache whitespace info disclosure (moderate).

**Reachability triage — this is the part that matters and it changes the picture:**

`undici` is declared as a **direct runtime dependency** in `package.json` (`"undici": "^7.18.2"`), but **no source or test file imports the npm package**. Every reference to "undici" in the codebase is a *comment* describing Node's **built-in global `fetch`** (which is implemented by an undici copy bundled inside the Node binary — a different artifact from `node_modules/undici`):

- `lib/linear-fetch.js`, `lib/errors.js` — comments only, about global `fetch` error shapes.
- `tests/unit/linear-fetch.test.js`, `tests/unit/error-pages.test.js` — comments only.
- No `import … from 'undici'` / `require('undici')` anywhere. `npm ls undici` shows the root is its *only* dependent (nothing pulls it transitively).
- HTTP proxying uses `https-proxy-agent`, **not** undici's `ProxyAgent`.
- **No WebSocket client usage** anywhere in the app — and the WebSocket client is where the majority (and the most severe) of these advisories live.

So `node_modules/undici@7.18.2` is **effectively unused by application code**, and the application's actual `fetch` traffic runs on Node's *bundled* undici (versioned with the Node runtime, not this npm pin). The advisory cluster is therefore **not reachable through the npm dependency**, and the dependency is a strong candidate for removal.

This is simultaneously two findings of this review's own altitude:
1. **Unjustified / vestigial runtime dependency** (defends §3 minimal-runtime posture): a direct runtime dep that nothing imports is exactly the silent erosion this review exists to catch.
2. **High-severity advisory cluster** that, on triage, is unreachable — recorded so it is not over-escalated, but tracked because the npm pin could become reachable the moment any code does `import { WebSocket } from 'undici'`.

**Remediation (a finding for follow-up, NOT done here):** confirm the dependency is genuinely unneeded and **remove `undici` from `package.json`** (preferred — the app uses Node's built-in fetch); OR, if it is intentionally pinned to control the global-fetch implementation, **bump to a patched `undici ≥ 7.28.x`** and document the intent. Either path clears all 7 advisories. Separately, ensure the deployed **Node version** is current, since the *bundled* undici (the one actually used) tracks the Node runtime — that is a platform/runtime concern, not an npm-tree supply-chain item, and is out of scope here beyond this note.

→ Promoted to follow-up (the only finding that clears the bar). See "Follow-ups minted".

### F2 — `@jkershaw/mangodb@0.1.2`: trust-by-identity, not by popularity  ·  Severity: **Info**

The one direct runtime dependency whose trust model is first-party authorship rather than ecosystem popularity. It is the maintainer's own scoped package (low download volume by nature), resolves cleanly from `registry.npmjs.org` with a valid `sha512` integrity hash, and its scope (`@jkershaw/`) makes typosquatting/name-proximity a non-issue (a unique namespace cannot be confused with a popular unscoped package). **No action.** Recorded for the trend ledger so any future *version* bump of this first-party dep is reviewed deliberately (a compromised maintainer account is the relevant — if low-probability — threat for a low-popularity scoped package).

### F3 — Lockfile integrity: clean baseline  ·  Severity: **Info (positive)**

No drift, no anomalies a normal clean install would not produce:
- `npm ci --dry-run` → exit 0, "up to date" (lockfile matches `package.json`; not rewritten).
- **All 107** resolved packages have an `integrity` hash and resolve from `https://registry.npmjs.org` — **zero** git/http/file/tarball URLs.
- Tree is essentially flat: only 7 nested `node_modules/*/node_modules/*` dedup entries (`debug`/`ms` under https-proxy-agent, `tr46`/`webidl-conversions`/`whatwg-url` under mongodb-connection-string-url, `bson` under mongodb, `ms` under send) — all benign version-range dedups, no suspicious duplication.
- No hand-edited or drifted entries detected.

### F4 — No newly-introduced packages this cycle  ·  Severity: **N/A (baseline)**

Baseline run, so every package is "new" relative to no prior report — there is no meaningful new-package delta to flag. Mechanically, the dependency surface has not grown recently: the last `package-lock.json` change was the Playwright pin/move (`386e330`, `8f5020d`), with no dependency additions since. The next run should treat THIS report's totals as the comparison point.

---

## Trend Ledger (stable finding names — for mechanical comparison next run)

| Finding (stable name) | Severity | This run | Delta vs prior |
|---|---|---|---|
| `undici-advisory-cluster` | High (advisories) / Low reachability | 7 advisories, pkg unused & removable | — (baseline) |
| `mangodb-first-party-trust` | Info | present, v0.1.2, integrity OK | — (baseline) |
| `lockfile-integrity` | Info (clean) | clean, `npm ci` OK, all registry+integrity | — (baseline) |
| `new-packages-this-cycle` | N/A | 0 (baseline; surface stable since Playwright pin) | — (baseline) |

### Running totals (the numbers the next run compares against)

| Metric | Value at 2026-06-25 |
|---|---|
| Total resolved packages (excl. root) | **107** |
| Lockfile `packages` entries (incl. root) | 108 |
| Direct runtime dependencies | 11 |
| Direct dev dependencies | 2 |
| New packages this cycle | 0 (baseline) |
| Open CVEs — critical | 0 |
| Open CVEs — high | 3 |
| Open CVEs — moderate | 4 |
| Open CVEs — low | 0 |
| Open CVEs — total | **7** (all in `undici`) |
| Non-registry / missing-integrity packages | 0 |
| Vendored client libs (out-of-tree, unchanged) | 3 (chart.umd.min.js, marked.min.js, purify.min.js) |

---

## Verdict

**Clean baseline with one actionable item.** The minimal-runtime posture holds, the lockfile is trustworthy (clean `npm ci`, all-registry, all-integrity, flat), provenance is sound (no typosquat/slopsquat candidates; the single first-party dep is integrity-verified), and the tree is not growing. The only finding that rises to action is `undici`: a high-severity advisory cluster that triages to **low effective reachability** *and* simultaneously flags a vestigial direct dependency nothing imports — both pointing at the same remediation (remove, or bump to ≥ 7.28.x and document intent). One follow-up minted; F2/F3/F4 recorded but deliberately not promoted (under-creating is correct here).
