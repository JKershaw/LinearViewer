# Web routes (pages & workspace API)

Area notes for `web-routes` in the registry. Format and rules: README.md.

## Lessons

- A read that can fail is never an empty success. In `routes/ship-biscuit.js` every store read
  degrades with `.catch(() => empty)`, which is safe only because those reads are local. The
  tracker read (`fetchWorkspaceIssues`) is a provider fetch: it reports `sourcesUnread`, so a
  Linear outage never reads as a quiet week. With nothing else to report the route answers a
  retryable 502 and saves nothing, since a saved error edition would replace the last good
  one (LIN-4500). Do not copy the neighbours' catch onto a new provider read.
- The test-token workspace's mock issues (`lib/sample-data/mock-data.js`) carry completions 2
  to 28 days old. Any read that counts finished work sees them: a spec that needs nothing
  landed picks a window shorter than two days, as `tests/e2e/ship-biscuit.spec.js` picks "day"
  (LIN-4500).
