**Plan written to the description under `## Implementation Plan`.**

Opening Brief or Recap will now populate it, on both the dashboard tree card and the swipe accordion:
- **Fresh cache:** renders from cache, with no LLM call.
- **Missing or stale cache:** generates automatically behind the existing spinner.
- **Failure:** shows the existing inline error with retry, and does not retry by itself.

There are no cuts to the As-asked block. Where this plan differs from research, and why:
- **Stale auto-regenerates as well.** A stale section shows no body today, so leaving it manual would keep "open, then click to generate".
- **Free-tier spend is settled as an engineering call, not escalated.** The spend is one call per input change, only on a deliberate open. The proxy GET already auto-regenerates on missing or stale, and a used-up quota shows its 429 reason inline.
- **Adds an in-flight dedup.** The mount guard only holds within one mount. The swipe deck rebuilds the card on every swipe, so swiping away and back during generation would send a second metered POST.

The plan fits one session. Plan review is due, because a manual gate on a metered call becomes automatic. The witnesses check: no POST on fresh, exactly one POST on error, exactly one POST across a swipe re-mount, and open → fresh with no click on both surfaces.
