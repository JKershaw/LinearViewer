# PR #1913 (LIN-3604) open questions, copied from the PR body by the main session

1. M3 — the P/R launch arms stay undeclared. No live ticket tracks it. The ticket and docs/worker-lane-prompt.md:69 cite LIN-3099 as M3's home, but LIN-3099 is "Passage: V1 end to end, maintenance first" (Done, unrelated). Needs a human to file one.
2. Field acceptance per verb. P ignores presetId, stopAt, variant, attachProxy, entryRung, surface, composedRunMarker; R and K take no terminal; no proxy verb type-checks appendProxyContext. Recommendation: keep, and in the design-first rebuild add the appendProxyContext type check to all three proxy verbs.
3. S and P only length-cap issueIdentifier; R and K require isValidIssueId. Recommendation: tighten S/P to isValidIssueId in the rebuild (a behaviour change).
4. S stamps issueSource on an issue-naming abort; P doesn't. Recommendation: stamp on neither; kept as the stampsOnAbort lane value until then.
5. P resolves a provider for a repo-only dispatch (a LIN-2886 leftover). Recommendation: drop the `|| repo` arm.
6. S's plan block reads through the active provider, not the issue's source. Recommendation: resolve the plan read the way the referent guard does.
7. K answers a transient OWNER_CHECK_UNAVAILABLE launch with the token-rate-limit 503; S and M4 give the owner text; tests/unit/lin-3136-m1-kickoff-declared.test.js:215-221 pins K's answer. Recommendation: give K the owner text.
8. R and K return different upstream-auth envelopes. Recommendation: K's for both.

The PR's recommendations are not applied in #4c: behaviour is held; these stay open for John.
