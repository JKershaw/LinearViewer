# Design & interface review — ninth run (LIN-3747)

> Working document. Beat 2 (LIN-3749) adds the cold-surface evidence log below; the severity-ranked report is written in beat 5 (LIN-3752). Evidence: `docs/reviews/_evidence-2026-10-21/`; the coverage limits come from `coverage-map.md`.

## Beat 2 — cold-surface evidence log (LIN-3749)

Evidence only, no verdicts. Measurements are in the per-capture JSON; image reads and the census are beat 4.

- **Landing**: 4 doors (Linear, GitHub, Jira, email) on live and local; two distinct door backgrounds (one filled teal, the rest transparent) at 1400.
- **Archives**: 1–9 and `/archive/999` captured light/dark (media-emulated); every archive serves `prefers-color-scheme: dark`.
- **Library**: index, three document cases and a 104-document sweep at 390. Sweep totals (`data/library-sweep.json`): 0 non-200, 0 images without alt, 0 broken images, 0 composited contrast groups under 4.5:1; **every document renders two `<h1>`** (the masthead wordmark plus the document title); **74 of 104 documents overflow at 390** (wide tables, e.g. `table.@574>390`).
- **Guest share** lifecycle (`data/guest-share-lifecycle.json`): mint 201, guest 200 with `no-referrer`/`no-store`/`noindex`, revoke 200, then 404 on the same URL, a never-issued token and `/s/…`.
- **KPIs**: rate and total toggle states, seeded; total draws a `line` chart, rate is the default.
- **Email**: 13 renderers (synthetic), real routes, the sent email (`/test/email-outbox`).
- **Held**: 404 / 400 / 409 / picker real; 503 synthetic.
- **Lighthouse** accessibility (28 routes): lowest `/styleguide` 0.89 (colour-contrast, heading-order), `/archive/999`, `/auth/email/confirm`, `/connect/github/held`, `/t/<unknown>` 0.89 (colour-contrast); `/swipe` 0.92 (`meta-viewport`).
- **Live harbour.cat**: all 28 routes reachable, status and title identical to local.
