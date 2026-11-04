# Run 6 beat 2 comparison (scratch, from evidence JSON)

## Scope and tool limits (seams.scope)
| combo | files | parseFailures | nonLiteralDynamicImports | unmappedFiles | unresolvedRelativeImports |
|---|---|---|---|---|---|
| 5334c81a×old | 536 | 0 | 0 | 0 | 4 |
| 5334c81a×head | 536 | 0 | 0 | 0 | 4 |
| d7ceb373×old | 540 | 0 | 0 | 0 | 4 |
| d7ceb373×head | 540 | 0 | 0 | 0 | 4 |

## Headline per combination
| combo | links (sum) | link rows | knot pairs | groups (sizes) | Other files | F1 LLM→Runs / Runs→LLM |
|---|---|---|---|---|---|---|
| 5334c81a×old | 1262 | 70 | 12 | 9 | 17 | 26/35 |
| 5334c81a×head | 1249 | 69 | 12 | 9 | 14 | 29/36 |
| d7ceb373×old | 1275 | 70 | 12 | 9 | 17 | 27/36 |
| d7ceb373×head | 1259 | 68 | 12 | 9 | 14 | 30/37 |

## Knot pairs per combination (a→b / b→a)
| pair | 5334c81a×old | 5334c81a×head | d7ceb373×old | d7ceb373×head |
|---|---|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 | 37/4 | 37/4 |
| Agent API ↔ Providers | 20/3 | 20/3 | 20/3 | 20/3 |
| Agent API ↔ Runs | 42/10 | 44/10 | 43/10 | 45/10 |
| Auth ↔ server-rendered pages | 14/11 | 14/11 | 14/11 | 14/11 |
| Auth ↔ LLM | 4/3 | 4/3 | 4/3 | 4/3 |
| Auth ↔ Providers | 12/1 | 12/1 | 12/1 | 12/1 |
| server-rendered pages ↔ Other features | 8/6 | 8/6 | 8/6 | 8/6 |
| server-rendered pages ↔ Runs | 13/8 | 13/8 | 13/8 | 13/8 |
| LLM ↔ Other features | 4/2 | 1/1 | 4/2 | 1/1 |
| LLM ↔ Providers | 11/4 | 11/4 | 11/4 | 11/4 |
| LLM ↔ Runs | 26/35 | 29/36 | 27/36 | 30/37 |
| Other features ↔ Runs | 9/15 | 7/4 | 10/17 | 6/5 |

Knot groups (members):
- 5334c81a×old: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]
- 5334c81a×head: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]
- d7ceb373×old: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]
- d7ceb373×head: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]

## Catch-all ("Other features") members, by the tool's compileGuide first-match over readCommit(inScope)
- 5334c81a×old (17; seams says 17): cost-format.js, cost-read.js, dashboard-refresh.js, founder-lookup.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, lineage-membership.js, live-anchor.js, row-usage.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js
- 5334c81a×head (14; seams says 14): cost-format.js, dashboard-refresh.js, founder-lookup.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js
- d7ceb373×old (17; seams says 17): cost-format.js, cost-read.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, lineage-membership.js, live-anchor.js, row-usage.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js
- d7ceb373×head (14; seams says 14): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js
- code, old guide (5334c81a→d7ceb373): −[lib/founder-lookup.js] +[lib/usage-snapshot-intake.js]
- code, HEAD guide (5334c81a→d7ceb373): −[lib/founder-lookup.js] +[lib/usage-snapshot-intake.js]
- placement at 5334c81a (old→head): −[lib/cost-read.js, lib/lineage-membership.js, lib/row-usage.js] +[]
- placement at d7ceb373 (old→head): −[lib/cost-read.js, lib/lineage-membership.js, lib/row-usage.js] +[]
- headline (5334c81a×old = run 5 → d7ceb373×head): −[lib/cost-read.js, lib/founder-lookup.js, lib/lineage-membership.js, lib/row-usage.js] +[lib/usage-snapshot-intake.js]

## Area file counts per combination
| area | 5334c81a×old | 5334c81a×head | d7ceb373×old | d7ceb373×head |
|---|---|---|---|---|
| Agent API | 32 | 32 | 32 | 32 |
| Auth | 64 | 64 | 65 | 64 |
| browser code | 43 | 43 | 43 | 43 |
| server-rendered pages | 91 | 91 | 91 | 91 |
| LLM | 78 | 78 | 78 | 78 |
| Other features | 17 | 14 | 17 | 14 |
| Platform | 25 | 25 | 25 | 25 |
| Providers | 36 | 36 | 36 | 36 |
| Reports | 7 | 7 | 7 | 8 |
| Runs | 102 | 105 | 105 | 108 |
| Task model | 2 | 2 | 2 | 2 |
| Web routes | 38 | 38 | 38 | 38 |
| Wiring | 1 | 1 | 1 | 1 |

## Entry files per area (seams.areas[].entryFiles), d7ceb373 × HEAD guide; changes vs other combos noted
- **Agent API (proxy)** (32 files, 45 internal imports, 13 entry files): lib/dispatch-tokens.js(1:Wiring); lib/harbour-feedback-tokens.js(1:Wiring); lib/proxy-dedupe.js(1:Web routes); lib/proxy-events.js(1:Wiring); lib/proxy-graphql-errors.js(2:Runs+Web routes); lib/proxy-preamble.js(10:LLM+Runs+Web routes); lib/proxy-ref-resolver.js(4:Providers+Web routes); lib/proxy-scopes.js(5:server-rendered pages+LLM+Runs+Web routes); lib/proxy-tokens.js(2:Runs+Wiring); lib/proxy-wire.js(1:Providers); lib/settings-keys.js(2:Runs+Web routes); lib/settings-proxy-default.js(1:Wiring); routes/proxy.js(2:Web routes+Wiring)
- **Auth, accounts & workspaces** (64 files, 115 internal imports, 57 entry files): lib/account-conflict.js(1:Web routes); lib/account-group.js(6:LLM+Reports+Runs+Web routes); lib/account-merge-log.js(1:Wiring); lib/account-session.js(2:Web routes); lib/account-store.js(2:Reports+Wiring); lib/account-workspace-store.js(1:Wiring); lib/connection-binding.js(2:Web routes+Wiring); lib/connection-credential.js(2:Web routes+Wiring); lib/connection-lifecycle.js(2:Web routes+Wiring); lib/connection-secondary-remint.js(1:Wiring); lib/connection-store.js(1:Wiring); lib/credential-diagnostics.js(6:Agent API+Runs+Web routes+Wiring); lib/credential-invariant-sweep.js(3:Runs+Wiring); lib/credential-lifecycle-events.js(1:Wiring); lib/credential-state.js(6:server-rendered pages+Runs+Web routes); lib/email-auth.js(2:Reports+Wiring); lib/email-availability.js(4:server-rendered pages+Web routes+Wiring); lib/email-transport.js(1:Wiring); lib/guest-task-path.js(2:Web routes+Wiring); lib/held-connection-entry.js(3:server-rendered pages+Wiring); lib/openrouter-key-resolver.js(1:Wiring); lib/owner-backfill.js(1:Wiring); lib/owner-credential-store.js(1:Wiring); lib/ownerless-token-policy.js(4:Agent API+Runs); lib/pat-session.js(1:Wiring); lib/public-origin.js(18:Agent API+Runs+Web routes+Wiring); lib/refresh-strategy.js(1:Wiring); lib/rejected-credentials.js(2:Agent API+Wiring); lib/session-options.js(2:server-rendered pages+Wiring); lib/session-row-live.js(1:Runs); lib/session-store.js(1:Wiring); lib/suspect-credential-refresh.js(2:Web routes+Wiring); lib/task-share-access.js(1:Wiring); lib/task-share-store.js(2:Web routes+Wiring); lib/token-refresh.js(2:Providers+Wiring); lib/urlkey-holders.js(2:Reports+Wiring); lib/user-preferences.js(2:server-rendered pages+Wiring); lib/workspace-api-mocks.js(6:Web routes); lib/workspace-change-log.js(4:server-rendered pages+Web routes+Wiring); lib/workspace-issues-memo.js(1:Wiring); lib/workspace-lookup.js(6:server-rendered pages+Runs+Web routes); lib/workspace-owner.js(8:Agent API+Runs+Web routes+Wiring); lib/workspace-preferences.js(16:Agent API+LLM+Runs+Web routes+Wiring); lib/workspace-registry.js(1:Web routes); lib/workspace-removal-revocation.js(1:Wiring); lib/workspace-store.js(1:Wiring); lib/workspace-title-resolver.js(1:Wiring); lib/workspace-token-cache.js(3:Reports+Web routes+Wiring); lib/workspace-token-refresh.js(1:Wiring); lib/workspace-token-resolver.js(2:Runs+Wiring); lib/workspace-urlkey.js(2:Web routes+Wiring); lib/workspace.js(36:Agent API+LLM+Other features+Runs+Web routes+Wiring); routes/account-merge.js(1:Wiring); routes/email-auth.js(1:Wiring); routes/held-connection.js(1:Wiring); routes/openrouter-auth.js(1:Wiring); routes/provider-auth-routers.js(1:Wiring)
  - vs d7ceb373×old: only there: lib/workspace-kpis-cache.js(1:Web routes) | only at d7ceb373×head: —
- **Front end: browser code** (43 files, 0 internal imports, 0 entry files): 
- **Front end: server-rendered pages** (91 files, 287 internal imports, 53 entry files): lib/components/decision-panel.js(1:Runs); lib/components/dispatch-no-job.js(1:Wiring); lib/components/footer.js(1:Web routes); lib/components/head-meta.js(1:Web routes); lib/components/landing-hero.js(1:Web routes); lib/components/page.js(2:Web routes); lib/mask-secrets-in-html.js(1:Web routes); lib/parse-landing.js(1:Wiring); lib/render-account-home.js(1:Auth); lib/render-audit.js(1:Wiring); lib/render-collective.js(1:Web routes); lib/render-custom-prompts.js(1:Wiring); lib/render-dispatch.js(1:Wiring); lib/render-effort-readout.js(1:Web routes); lib/render-email-auth.js(1:Auth); lib/render-escalation-kpis.js(1:Web routes); lib/render-flight-companion.js(1:Web routes); lib/render-kpis.js(1:Wiring); lib/render-landing.js(1:Wiring); lib/render-legal.js(1:Wiring); lib/render-library.js(1:Web routes); lib/render-live-console.js(1:Runs); lib/render-observation.js(1:Web routes); lib/render-pages.js(14:Auth+Web routes+Wiring); lib/render-passage-planner.js(1:Web routes); lib/render-prompt-opts.js(1:Web routes); lib/render-prompts.js(1:Wiring); lib/render-proxy.js(1:Wiring); lib/render-roadmap.js(1:Wiring); lib/render-run-steps.js(2:Other features+Runs); lib/render-runner-setup.js(1:Runs); lib/render-session.js(1:Web routes); lib/render-settings.js(2:Web routes+Wiring); lib/render-ship-biscuit.js(1:Web routes); lib/render-ship-journey.js(1:Web routes); lib/render-ship.js(1:Wiring); lib/render-styleguide.js(1:Wiring); lib/render-swim.js(1:Wiring); lib/render-swipe.js(1:Wiring); lib/render-task-chat.js(1:Web routes); lib/render-task-create.js(1:Web routes); lib/render-task-edit.js(1:Web routes); lib/render-task-page.js(2:Web routes); lib/render-templates.js(1:Wiring); lib/render-workspace-kpis.js(1:Web routes); lib/render.js(20:Auth+Runs+Web routes+Wiring); lib/security-headers.js(2:Auth+Wiring); lib/settings-areas.js(4:Auth+Web routes+Wiring); lib/settings-copy-first-card.js(1:Wiring); lib/ship-journey.js(1:Web routes); lib/task-board-view.js(3:Other features+Web routes+Wiring); lib/timeline-zoom.js(1:Runs); lib/tree.js(6:Other features+Runs+Wiring)
- **LLM & prompts** (78 files, 68 internal imports, 69 entry files): lib/agent-turn.js(3:Agent API+Web routes); lib/audit.js(3:server-rendered pages+Web routes); lib/brief-cache.js(2:Runs+Wiring); lib/brief.js(3:Agent API+Web routes); lib/chat-request.js(18:Agent API+Runs+Web routes+Wiring); lib/chat-tools.js(3:Agent API+Web routes); lib/chat-transcript.js(3:Agent API+Web routes); lib/collective-characters-store.js(1:Wiring); lib/collective-presets-store.js(1:Wiring); lib/context-graph.js(2:Web routes); lib/custom-prompts-store.js(1:Wiring); lib/feedback-title.js(1:Web routes); lib/file-pointer.js(1:Runs); lib/flight-companion-census-seed.js(2:Agent API+Web routes); lib/flight-companion-gate.js(1:Web routes); lib/harbour-comments-store.js(1:Wiring); lib/library-metadata.js(2:server-rendered pages+Reports); lib/library.js(2:server-rendered pages+Web routes); lib/llm-call-log.js(2:Runs+Wiring); lib/llm-jobs.js(6:Agent API+server-rendered pages+Runs); lib/model-pricing.js(4:Reports+Runs); lib/model-routing-edit.js(3:server-rendered pages+Web routes); lib/model-routing-harnesses.js(6:server-rendered pages); lib/model-routing-history.js(2:Runs+Web routes); lib/model-routing-spend.js(5:server-rendered pages+Runs+Web routes); lib/model-routing-store.js(1:Wiring); lib/model-routing-summary.js(1:Web routes); lib/model-routing-validate.js(1:Agent API); lib/model-routing.js(12:Agent API+Auth+server-rendered pages+Runs+Web routes+Wiring); lib/north-star-resolver.js(4:Agent API+Web routes+Wiring); lib/openrouter-catalog.js(9:server-rendered pages+Reports+Runs+Web routes+Wiring); lib/openrouter.js(22:Agent API+Auth+server-rendered pages+Providers+Runs+Web routes+Wiring); lib/periodicals.js(7:Agent API+Runs+Wiring); lib/prompt-formatters.js(2:Agent API+Web routes); lib/prompt-templates.js(17:Agent API+Auth+server-rendered pages+Runs+Web routes); lib/prompt-trace-store.js(2:Web routes+Wiring); lib/prompts/agent-onboarding.js(2:server-rendered pages+Web routes); lib/prompts/autopilot-kickoff.js(6:Agent API+Runs+Web routes); lib/prompts/autopilot-manual.js(2:Agent API); lib/prompts/collective-participant.js(1:Web routes); lib/prompts/flight-companion-brief.js(2:server-rendered pages+Web routes); lib/prompts/flight-companion-kickoff.js(1:Web routes); lib/prompts/passage-planner-kickoff.js(1:Web routes); lib/prompts/passage-runner-kickoff.js(2:Agent API); lib/prompts/roadmap-chat-template.js(1:Web routes); lib/prompts/roadmap-digest-template.js(1:Web routes); lib/prompts/roadmap-gap-template.js(1:Web routes); lib/prompts/roadmap-narrative-template.js(1:Web routes); lib/prompts/roadmap-north-star-template.js(1:Web routes); lib/prompts/roadmap-orientation-template.js(2:server-rendered pages+Web routes); lib/prompts/roadmap-product-template.js(1:Web routes); lib/prompts/roadmap-trajectory-template.js(1:Web routes); lib/prompts/runner-kickoff.js(3:Agent API+Runs); lib/prompts/ship-biscuit-editor.js(1:Web routes); lib/prompts/task-chat-template.js(1:Web routes); lib/recap-cache.js(6:Agent API+Runs+Web routes+Wiring); lib/recap.js(3:Agent API+Web routes); lib/recommend-recurse.js(4:Agent API+Runs+Web routes); lib/recommendation-facts.js(5:server-rendered pages+Other features+Providers); lib/recommendation-input.js(2:Agent API+Web routes); lib/report-history-store.js(3:Reports+Wiring); lib/roadmap.js(2:Web routes+Wiring); lib/saved-chat-store.js(1:Wiring); lib/scan-fingerprint.js(1:Web routes); lib/scan.js(1:Web routes); lib/ship-biscuit-history-store.js(1:Wiring); lib/ship-biscuit.js(1:Web routes); lib/should-mock-ai.js(9:Runs+Web routes+Wiring); lib/yap-client.js(2:Web routes+Wiring)
  - vs 5334c81a×old: only there: lib/llm-call-log.js(2:Other features+Wiring); lib/model-pricing.js(3:Reports+Runs) | only at d7ceb373×head: lib/llm-call-log.js(2:Runs+Wiring); lib/model-pricing.js(4:Reports+Runs)
  - vs 5334c81a×head: only there: lib/model-pricing.js(3:Reports+Runs) | only at d7ceb373×head: lib/model-pricing.js(4:Reports+Runs)
  - vs d7ceb373×old: only there: lib/llm-call-log.js(2:Other features+Wiring) | only at d7ceb373×head: lib/llm-call-log.js(2:Runs+Wiring)
- **Other features** (14 files, 6 internal imports, 13 entry files): lib/cost-format.js(7:server-rendered pages+LLM); lib/dashboard-refresh.js(1:Wiring); lib/home-pipeline.js(1:Wiring); lib/home-row-states.js(1:Wiring); lib/home-rows.js(1:Wiring); lib/key-state-holders.js(1:Wiring); lib/key-state.js(1:Wiring); lib/live-anchor.js(2:Runs+Web routes); lib/ruling-standing.js(1:Runs); lib/subtree-index.js(1:Runs); lib/task-facts-holder.js(1:Wiring); lib/task-state.js(5:server-rendered pages+Runs+Web routes); lib/usage-snapshot-intake.js(2:Runs+Wiring)
  - vs 5334c81a×old: only there: lib/cost-read.js(9:Agent API+LLM+Reports+Runs+Web routes); lib/founder-lookup.js(2:Reports+Wiring); lib/lineage-membership.js(7:Agent API+LLM+Runs+Web routes); lib/row-usage.js(4:LLM+Runs) | only at d7ceb373×head: lib/usage-snapshot-intake.js(2:Runs+Wiring)
  - vs 5334c81a×head: only there: lib/founder-lookup.js(2:Reports+Wiring) | only at d7ceb373×head: lib/usage-snapshot-intake.js(2:Runs+Wiring)
  - vs d7ceb373×old: only there: lib/cost-read.js(9:Agent API+LLM+Reports+Runs+Web routes); lib/lineage-membership.js(8:Agent API+LLM+Runs+Web routes); lib/row-usage.js(4:LLM+Runs) | only at d7ceb373×head: —
- **Platform & plumbing** (25 files, 2 internal imports, 23 entry files): lib/async-errors.js(1:Wiring); lib/db-indexes.js(2:Reports+Wiring); lib/deploy-info.js(1:Wiring); lib/errors.js(63:Agent API+Auth+server-rendered pages+Providers+Runs+Web routes+Wiring); lib/feature-defaults.js(17:Agent API+Auth+server-rendered pages+Runs+Web routes+Wiring); lib/free-tier-store.js(1:Wiring); lib/hourly-cleanup.js(1:Wiring); lib/http-keepalive.js(13:Agent API+Runs+Web routes); lib/kpi-page.js(2:Reports+Wiring); lib/loose-json.js(7:LLM+Runs); lib/partial-write-error.js(3:Agent API+Providers+Web routes); lib/plan-allowance.js(7:LLM+Runs+Web routes+Wiring); lib/proxy-fetch.js(6:Agent API+LLM+Providers); lib/read-horizon.js(19:Agent API+server-rendered pages+LLM+Other features+Reports+Runs+Web routes); lib/response-headers.js(1:Wiring); lib/scheduler.js(1:Wiring); lib/secret-scan.js(4:server-rendered pages+Reports+Runs); lib/sse.js(5:Agent API+Web routes); lib/unpriced-models.js(3:Reports+Runs+Wiring); lib/utils/html.js(73:server-rendered pages+LLM+Web routes); lib/utils/time.js(46:Agent API+Auth+LLM+Reports+Runs+Web routes); lib/vendor-assets.js(1:Wiring); lib/workflow-config.js(4:Auth+LLM+Runs)
  - vs 5334c81a×old: only there: lib/kpi-page.js(1:Wiring); lib/utils/time.js(45:Agent API+Auth+LLM+Other features+Reports+Runs+Web routes) | only at d7ceb373×head: lib/kpi-page.js(2:Reports+Wiring); lib/utils/time.js(46:Agent API+Auth+LLM+Reports+Runs+Web routes)
  - vs 5334c81a×head: only there: lib/kpi-page.js(1:Wiring); lib/utils/time.js(45:Agent API+Auth+LLM+Reports+Runs+Web routes) | only at d7ceb373×head: lib/kpi-page.js(2:Reports+Wiring); lib/utils/time.js(46:Agent API+Auth+LLM+Reports+Runs+Web routes)
  - vs d7ceb373×old: only there: lib/kpi-page.js(2:Auth+Wiring); lib/utils/time.js(46:Agent API+Auth+LLM+Other features+Reports+Runs+Web routes) | only at d7ceb373×head: lib/kpi-page.js(2:Reports+Wiring); lib/utils/time.js(46:Agent API+Auth+LLM+Reports+Runs+Web routes)
- **Providers (Linear, GitHub, Jira, local)** (36 files, 40 internal imports, 31 entry files): lib/attachment-upload.js(3:Agent API+Web routes); lib/description-edit.js(1:Agent API); lib/github-pr-files.js(1:Runs); lib/github-pr-status.js(8:Auth+LLM+Runs+Web routes); lib/issue-write-validation.js(7:Agent API+Runs+Web routes); lib/linear-fetch.js(2:LLM+Web routes); lib/linear.js(1:Wiring); lib/local-store.js(1:Wiring); lib/pr-state-copy.js(2:server-rendered pages+Web routes); lib/pr-state-store.js(2:Web routes+Wiring); lib/providers/github-projects/fake-client.js(1:Web routes); lib/providers/github-projects/index.js(1:Web routes); lib/providers/github/app-auth.js(2:Auth); lib/providers/github/fake-client.js(1:Web routes); lib/providers/github/index.js(1:Web routes); lib/providers/index.js(10:Agent API+Auth+server-rendered pages+Web routes+Wiring); lib/providers/interface.js(1:Auth); lib/providers/jira/fake-client.js(1:Web routes); lib/providers/jira/index.js(1:Web routes); lib/providers/jira/oauth.js(3:Auth+server-rendered pages+Wiring); lib/providers/linear/index.js(2:Agent API+Web routes); lib/providers/local/index.js(1:Agent API); lib/providers/models.js(11:Agent API+server-rendered pages+LLM+Runs+Task model); lib/providers/registry.js(18:Agent API+Auth+server-rendered pages+Runs+Web routes); lib/providers/state-map.js(26:Agent API+Auth+server-rendered pages+LLM+Other features+Runs+Task model+Web routes+Wiring); lib/sample-data/mock-data.js(8:Agent API+Auth+Web routes+Wiring); lib/sample-data/ship-dense-sample-data.js(1:Wiring); lib/sample-data/swim-sample-data.js(1:Wiring); lib/starter-seed.js(2:server-rendered pages+Web routes); lib/task-attachments.js(1:server-rendered pages); lib/trashed-signal.js(3:Agent API+Web routes)
- **Reports & operator tools** (8 files, 3 internal imports, 6 entry files): lib/kpi-daily-rollup.js(1:Wiring); lib/kpi-stats.js(3:server-rendered pages+Wiring); lib/milestone-funnel.js(1:Web routes); lib/pricing-conformance-sweep.js(1:Wiring); lib/workspace-kpi-stats.js(1:Web routes); lib/workspace-kpis-cache.js(1:Web routes)
  - vs 5334c81a×old: only there: — | only at d7ceb373×head: lib/workspace-kpis-cache.js(1:Web routes)
  - vs 5334c81a×head: only there: — | only at d7ceb373×head: lib/workspace-kpis-cache.js(1:Web routes)
  - vs d7ceb373×old: only there: — | only at d7ceb373×head: lib/workspace-kpis-cache.js(1:Web routes)
- **Runs & dispatch** (108 files, 187 internal imports, 93 entry files): lib/agent-status-store.js(1:Wiring); lib/ci-wake-sweep.js(1:Wiring); lib/close-out-events-store.js(1:Wiring); lib/close-out-merges.js(2:Web routes+Wiring); lib/close-out-readiness.js(1:Web routes); lib/completion-signals.js(2:LLM); lib/consumer-heartbeat-ingest.js(2:Agent API); lib/consumer-heartbeat-store.js(2:server-rendered pages+Wiring); lib/consumer-heartbeat.js(1:Agent API); lib/consumer-poll-warning.js(2:Agent API); lib/cost-read.js(5:Agent API+LLM+Reports+Web routes); lib/dismissal-suggestions-store.js(3:Agent API+Web routes+Wiring); lib/dispatch-entrance.js(2:Agent API); lib/dispatch-factory.js(5:Agent API+LLM+Web routes+Wiring); lib/dispatch-feedback-validation.js(1:Agent API); lib/dispatch-fields.js(1:Web routes); lib/dispatch-lineage-status.js(1:Agent API); lib/dispatch-lineage.js(3:Reports); lib/dispatch-presets-store.js(1:Wiring); lib/dispatch-referent-guard.js(1:Agent API); lib/dispatch-refusal.js(1:Agent API); lib/dispatch-session-read.js(3:LLM+Web routes); lib/dispatch-session-redaction.js(1:Agent API); lib/dispatch-store.js(7:Agent API+LLM+Reports+Wiring); lib/dispatch-targets.js(3:Agent API+Web routes); lib/dispatch-terminal.js(4:Agent API+Reports); lib/dispatch-validation.js(7:Agent API+server-rendered pages+LLM+Web routes); lib/dispatch-wake.js(1:Agent API); lib/effort-readout.js(1:Web routes); lib/escalation-kpis.js(1:Web routes); lib/follow-up-dispatch.js(4:LLM+Web routes); lib/lineage-membership.js(3:Agent API+LLM+Web routes); lib/live-console.js(2:LLM+Web routes); lib/liveness-alarm-store.js(1:Wiring); lib/liveness-alarm-sweep.js(1:Wiring); lib/loop-supersede.js(2:LLM+Web routes); lib/observation-sessions-materializer.js(1:Wiring); lib/observation-sessions-store.js(1:Wiring); lib/observer-pass.js(2:Web routes+Wiring); lib/observer-shadow-log.js(1:Wiring); lib/observer-state-store.js(1:Wiring); lib/observer-sweep.js(2:LLM+Wiring); lib/owner-mint-refusals.js(4:Agent API+Web routes); lib/periodical-report-gate.js(1:Agent API); lib/periodical-runs.js(2:Agent API); lib/pipeline-loops.js(8:Agent API+LLM+Web routes+Wiring); lib/plan-review-round-trips.js(1:LLM); lib/poll-halt.js(3:Agent API+Other features+Wiring); lib/queue-config.js(1:LLM); lib/recent-runs.js(2:LLM); lib/refresh-on-resolve-gate.js(1:Wiring); lib/request-usage-intake.js(2:Agent API+Wiring); lib/request-usage-loader.js(6:Agent API+LLM+Reports+Web routes+Wiring); lib/row-usage.js(1:LLM); lib/run-closeout-state.js(1:Web routes); lib/run-controls.js(19:Other features+Web routes+Wiring); lib/run-evidence.js(3:Web routes+Wiring); lib/run-ledger.js(2:LLM); lib/run-loop-state.js(9:Agent API+Other features+Web routes); lib/run-paragraph-hook.js(1:Wiring); lib/run-paragraph-store.js(1:Wiring); lib/run-proposals-store.js(1:Wiring); lib/run-summary-cache.js(2:Web routes+Wiring); lib/run-summary.js(1:Web routes); lib/run-view.js(11:server-rendered pages+Other features+Web routes); lib/runner-kit/broker.mjs(1:LLM); lib/runner-kit/runner.mjs(1:LLM); lib/runner-owner-gate.js(9:Agent API+Web routes); lib/session-materializer-precompute.js(1:Wiring); lib/session-summary-cache.js(2:Web routes+Wiring); lib/session-summary.js(5:LLM+Web routes); lib/session-telemetry.js(2:LLM+Reports); lib/sessions-feed-cache.js(2:Web routes+Wiring); lib/sessions-view.js(2:Web routes+Wiring); lib/shelved-rulings-store.js(1:Wiring); lib/superseded-selection.js(1:Wiring); lib/task-decisions-store.js(2:LLM+Wiring); lib/task-done-cache.js(2:Web routes+Wiring); lib/task-mode-store.js(4:Web routes+Wiring); lib/task-page-loader.js(7:server-rendered pages+Other features+Web routes+Wiring); lib/task-run-facts.js(1:Web routes); lib/task-snapshot-store.js(2:Agent API+Wiring); lib/task-stack.js(3:Agent API+LLM); lib/terminal-marked-task-cost.js(1:Reports); lib/ticket-close-closer.js(1:Wiring); lib/unanswered-decisions.js(7:Agent API+LLM+Other features+Web routes); lib/wake-credential.js(1:Agent API); lib/weekly-budget.js(1:Reports); lib/workspace-halt.js(6:Agent API+server-rendered pages+LLM+Web routes+Wiring); routes/dispatch.js(3:Web routes+Wiring); routes/live-console.js(1:Wiring); routes/runner-kit.js(1:Wiring); routes/runner-setup.js(1:Wiring)
  - vs 5334c81a×old: only there: lib/dispatch-store.js(7:Agent API+LLM+Other features+Reports+Wiring); lib/dispatch-terminal.js(5:Agent API+Other features+Reports); lib/session-telemetry.js(3:LLM+Other features+Reports) | only at d7ceb373×head: lib/cost-read.js(5:Agent API+LLM+Reports+Web routes); lib/dispatch-store.js(7:Agent API+LLM+Reports+Wiring); lib/dispatch-terminal.js(4:Agent API+Reports); lib/lineage-membership.js(3:Agent API+LLM+Web routes); lib/request-usage-loader.js(6:Agent API+LLM+Reports+Web routes+Wiring); lib/row-usage.js(1:LLM); lib/session-telemetry.js(2:LLM+Reports)
  - vs 5334c81a×head: only there: lib/dispatch-store.js(7:Agent API+LLM+Other features+Reports+Wiring) | only at d7ceb373×head: lib/dispatch-store.js(7:Agent API+LLM+Reports+Wiring); lib/request-usage-loader.js(6:Agent API+LLM+Reports+Web routes+Wiring)
  - vs d7ceb373×old: only there: lib/dispatch-terminal.js(5:Agent API+Other features+Reports); lib/request-usage-fold.js(1:Other features); lib/request-usage-vocabulary.js(1:Other features); lib/session-telemetry.js(3:LLM+Other features+Reports) | only at d7ceb373×head: lib/cost-read.js(5:Agent API+LLM+Reports+Web routes); lib/dispatch-terminal.js(4:Agent API+Reports); lib/lineage-membership.js(3:Agent API+LLM+Web routes); lib/row-usage.js(1:LLM); lib/session-telemetry.js(2:LLM+Reports)
- **Task model** (2 files, 1 internal imports, 2 entry files): lib/graph-features.js(6:server-rendered pages+LLM+Other features+Runs); lib/task-order.js(3:server-rendered pages+LLM+Runs)
- **Web routes (pages & workspace API)** (38 files, 31 internal imports, 22 entry files): routes/collective.js(1:Wiring); routes/dashboard.js(1:Wiring); routes/flight-companion.js(1:Wiring); routes/getting-started.js(1:Wiring); routes/legacy-redirects.js(1:Wiring); routes/library.js(1:Wiring); routes/milestone-funnel.js(1:Wiring); routes/passage-planner.js(1:Wiring); routes/settings-model.js(1:Wiring); routes/settings.js(1:Wiring); routes/ship-biscuit.js(1:Wiring); routes/ship-journey.js(1:Wiring); routes/task-chat.js(1:Wiring); routes/task-create.js(1:Wiring); routes/task-edit.js(1:Wiring); routes/task-mode.js(1:Wiring); routes/task-page.js(1:Wiring); routes/task-share.js(1:Wiring); routes/test.js(1:Wiring); routes/workspace-api.js(1:Wiring); routes/workspace-kpis.js(1:Wiring); routes/workspace.js(1:Wiring)
- **Wiring (server.js)** (1 files, 0 internal imports, 0 entry files): 

## Importers by area for named files (from edge dumps; "in" counts importer files)
- `lib/cost-read.js`
  - 5334c81a×old: area=Other features; in 9 (cross 9 from 5 areas) {Runs:4, LLM:1, Reports:1, Agent API:1, Web routes:2}; out 6 (cross 4: dispatch-terminal.js[Runs], llm-call-log.js[LLM], session-telemetry.js[Runs], utils/time.js[Platform])
  - 5334c81a×head: area=Runs; in 9 (cross 5 from 4 areas) {Runs:4, LLM:1, Reports:1, Agent API:1, Web routes:2}; out 6 (cross 2: llm-call-log.js[LLM], utils/time.js[Platform])
  - d7ceb373×old: area=Other features; in 9 (cross 9 from 5 areas) {Runs:4, LLM:1, Reports:1, Agent API:1, Web routes:2}; out 7 (cross 5: dispatch-terminal.js[Runs], llm-call-log.js[LLM], request-usage-fold.js[Runs], session-telemetry.js[Runs], utils/time.js[Platform])
  - d7ceb373×head: area=Runs; in 9 (cross 5 from 4 areas) {Runs:4, LLM:1, Reports:1, Agent API:1, Web routes:2}; out 7 (cross 2: llm-call-log.js[LLM], utils/time.js[Platform])
  - importers at d7ceb373: lib/effort-readout.js, lib/model-routing-spend.js, lib/run-view.js, lib/terminal-marked-task-cost.js, lib/weekly-budget.js, lib/workspace-kpi-stats.js, routes/proxy-compute.js, routes/settings.js, routes/ship-biscuit.js
- `lib/request-usage-loader.js`
  - 5334c81a×old: absent
  - 5334c81a×head: absent
  - d7ceb373×old: area=Runs; in 7 (cross 6 from 5 areas) {LLM:1, Runs:1, Reports:1, Web routes:2, Agent API:1, Wiring:1}; out 1 (cross 1: lineage-membership.js[Other features])
  - d7ceb373×head: area=Runs; in 7 (cross 6 from 5 areas) {LLM:1, Runs:1, Reports:1, Web routes:2, Agent API:1, Wiring:1}; out 1 (cross 0: —)
  - importers at d7ceb373: lib/model-routing-history.js, lib/run-paragraph-hook.js, lib/workspace-kpi-stats.js, routes/dashboard-effort.js, routes/dashboard.js, routes/proxy-compute.js, server.js
- `lib/request-usage-store.js`
  - 5334c81a×old: area=Runs; in 1 (cross 0 from 0 areas) {Runs:1}; out 0 (cross 0: —)
  - 5334c81a×head: area=Runs; in 1 (cross 0 from 0 areas) {Runs:1}; out 0 (cross 0: —)
  - d7ceb373×old: area=Runs; in 1 (cross 0 from 0 areas) {Runs:1}; out 1 (cross 0: —)
  - d7ceb373×head: area=Runs; in 1 (cross 0 from 0 areas) {Runs:1}; out 1 (cross 0: —)
  - importers at d7ceb373: lib/request-usage-intake.js
- `lib/usage-snapshot-intake.js`
  - 5334c81a×old: absent
  - 5334c81a×head: absent
  - d7ceb373×old: area=Other features; in 2 (cross 2 from 2 areas) {Runs:1, Wiring:1}; out 0 (cross 0: —)
  - d7ceb373×head: area=Other features; in 2 (cross 2 from 2 areas) {Runs:1, Wiring:1}; out 0 (cross 0: —)
  - importers at d7ceb373: lib/dispatch-store.js, server.js
- `lib/proxy-preamble.js`
  - 5334c81a×old: area=Agent API; in 11 (cross 10 from 3 areas) {LLM:3, Runs:5, Web routes:2, Agent API:1}; out 4 (cross 2: owner-mint-refusals.js[Runs], ownerless-token-policy.js[Auth])
  - 5334c81a×head: area=Agent API; in 11 (cross 10 from 3 areas) {LLM:3, Runs:5, Web routes:2, Agent API:1}; out 4 (cross 2: owner-mint-refusals.js[Runs], ownerless-token-policy.js[Auth])
  - d7ceb373×old: area=Agent API; in 11 (cross 10 from 3 areas) {LLM:3, Runs:5, Web routes:2, Agent API:1}; out 4 (cross 2: owner-mint-refusals.js[Runs], ownerless-token-policy.js[Auth])
  - d7ceb373×head: area=Agent API; in 11 (cross 10 from 3 areas) {LLM:3, Runs:5, Web routes:2, Agent API:1}; out 4 (cross 2: owner-mint-refusals.js[Runs], ownerless-token-policy.js[Auth])
  - importers at d7ceb373: lib/chat-tools.js, lib/dispatch-entrance.js, lib/dispatch-factory.js, lib/follow-up-dispatch.js, lib/model-routing-harnesses.js, lib/model-routing.js, lib/wake-credential.js, routes/collective.js, routes/dispatch.js, routes/proxy.js, routes/workspace-api-feedback.js
- `lib/tree.js`
  - 5334c81a×old: area=server-rendered pages; in 8 (cross 6 from 3 areas) {Other features:4, server-rendered pages:2, Runs:1, Wiring:1}; out 3 (cross 3: providers/models.js[Providers], providers/state-map.js[Providers], recommendation-facts.js[LLM])
  - 5334c81a×head: area=server-rendered pages; in 8 (cross 6 from 3 areas) {Other features:4, server-rendered pages:2, Runs:1, Wiring:1}; out 3 (cross 3: providers/models.js[Providers], providers/state-map.js[Providers], recommendation-facts.js[LLM])
  - d7ceb373×old: area=server-rendered pages; in 8 (cross 6 from 3 areas) {Other features:4, server-rendered pages:2, Runs:1, Wiring:1}; out 3 (cross 3: providers/models.js[Providers], providers/state-map.js[Providers], recommendation-facts.js[LLM])
  - d7ceb373×head: area=server-rendered pages; in 8 (cross 6 from 3 areas) {Other features:4, server-rendered pages:2, Runs:1, Wiring:1}; out 3 (cross 3: providers/models.js[Providers], providers/state-map.js[Providers], recommendation-facts.js[LLM])
  - importers at d7ceb373: lib/home-pipeline.js, lib/home-rows.js, lib/home-view.js, lib/render.js, lib/subtree-index.js, lib/task-board-view.js, lib/task-stack.js, server.js
- `lib/run-controls.js`
  - 5334c81a×old: area=Runs; in 21 (cross 19 from 3 areas) {Other features:1, Web routes:17, Runs:2, Wiring:1}; out 3 (cross 3: feature-defaults.js[Platform], settings-keys.js[Agent API], workspace-owner.js[Auth])
  - 5334c81a×head: area=Runs; in 21 (cross 19 from 3 areas) {Other features:1, Web routes:17, Runs:2, Wiring:1}; out 3 (cross 3: feature-defaults.js[Platform], settings-keys.js[Agent API], workspace-owner.js[Auth])
  - d7ceb373×old: area=Runs; in 21 (cross 19 from 3 areas) {Other features:1, Web routes:17, Runs:2, Wiring:1}; out 3 (cross 3: feature-defaults.js[Platform], settings-keys.js[Agent API], workspace-owner.js[Auth])
  - d7ceb373×head: area=Runs; in 21 (cross 19 from 3 areas) {Other features:1, Web routes:17, Runs:2, Wiring:1}; out 3 (cross 3: feature-defaults.js[Platform], settings-keys.js[Agent API], workspace-owner.js[Auth])
  - importers at d7ceb373: lib/dashboard-refresh.js, routes/collective.js, routes/dashboard-effort.js, routes/dashboard-feed.js, routes/dashboard-kpis.js, routes/dashboard.js, routes/flight-companion.js, routes/live-console.js, routes/passage-planner.js, routes/runner-setup.js, routes/settings.js, routes/ship-biscuit.js, routes/ship-journey.js, routes/task-chat.js, routes/task-create.js, routes/task-edit.js, routes/task-page.js, routes/workspace-api-issue-read.js, routes/workspace-api-run-evidence.js, routes/workspace-kpis.js, server.js
- `lib/task-page-loader.js`
  - 5334c81a×old: area=Runs; in 8 (cross 7 from 4 areas) {server-rendered pages:2, Other features:1, Runs:1, Web routes:3, Wiring:1}; out 20 (cross 9: brief-cache.js[LLM], prompt-templates.js[LLM], providers/state-map.js[Providers], read-horizon.js[Platform], render-run-steps.js[server-rendered pages], ruling-standing.js[Other features], subtree-index.js[Other features], task-state.js[Other features], utils/time.js[Platform])
  - 5334c81a×head: area=Runs; in 8 (cross 7 from 4 areas) {server-rendered pages:2, Other features:1, Runs:1, Web routes:3, Wiring:1}; out 20 (cross 9: brief-cache.js[LLM], prompt-templates.js[LLM], providers/state-map.js[Providers], read-horizon.js[Platform], render-run-steps.js[server-rendered pages], ruling-standing.js[Other features], subtree-index.js[Other features], task-state.js[Other features], utils/time.js[Platform])
  - d7ceb373×old: area=Runs; in 8 (cross 7 from 4 areas) {server-rendered pages:2, Other features:1, Runs:1, Web routes:3, Wiring:1}; out 20 (cross 9: brief-cache.js[LLM], prompt-templates.js[LLM], providers/state-map.js[Providers], read-horizon.js[Platform], render-run-steps.js[server-rendered pages], ruling-standing.js[Other features], subtree-index.js[Other features], task-state.js[Other features], utils/time.js[Platform])
  - d7ceb373×head: area=Runs; in 8 (cross 7 from 4 areas) {server-rendered pages:2, Other features:1, Runs:1, Web routes:3, Wiring:1}; out 20 (cross 9: brief-cache.js[LLM], prompt-templates.js[LLM], providers/state-map.js[Providers], read-horizon.js[Platform], render-run-steps.js[server-rendered pages], ruling-standing.js[Other features], subtree-index.js[Other features], task-state.js[Other features], utils/time.js[Platform])
  - importers at d7ceb373: lib/components/time.js, lib/home-row-states.js, lib/render-task-page.js, routes/dispatch.js, routes/task-mode.js, routes/task-page.js, routes/workspace-api-run-evidence.js, server.js
- `lib/request-usage-fold.js`
  - 5334c81a×old: absent
  - 5334c81a×head: absent
  - d7ceb373×old: area=Runs; in 1 (cross 1 from 1 areas) {Other features:1}; out 3 (cross 3: model-pricing.js[LLM], row-usage.js[Other features], utils/time.js[Platform])
  - d7ceb373×head: area=Runs; in 1 (cross 0 from 0 areas) {Runs:1}; out 3 (cross 2: model-pricing.js[LLM], utils/time.js[Platform])
  - importers at d7ceb373: lib/cost-read.js
- `lib/request-usage-vocabulary.js`
  - 5334c81a×old: absent
  - 5334c81a×head: absent
  - d7ceb373×old: area=Runs; in 3 (cross 1 from 1 areas) {Runs:2, Other features:1}; out 0 (cross 0: —)
  - d7ceb373×head: area=Runs; in 3 (cross 0 from 0 areas) {Runs:3}; out 0 (cross 0: —)
  - importers at d7ceb373: lib/request-usage-store.js, lib/row-usage.js, lib/session-telemetry.js
- `lib/request-usage-intake.js`
  - 5334c81a×old: area=Runs; in 3 (cross 2 from 2 areas) {Runs:1, Agent API:1, Wiring:1}; out 4 (cross 3: errors.js[Platform], lineage-membership.js[Other features], model-pricing.js[LLM])
  - 5334c81a×head: area=Runs; in 3 (cross 2 from 2 areas) {Runs:1, Agent API:1, Wiring:1}; out 4 (cross 2: errors.js[Platform], model-pricing.js[LLM])
  - d7ceb373×old: area=Runs; in 3 (cross 2 from 2 areas) {Runs:1, Agent API:1, Wiring:1}; out 4 (cross 3: errors.js[Platform], lineage-membership.js[Other features], model-pricing.js[LLM])
  - d7ceb373×head: area=Runs; in 3 (cross 2 from 2 areas) {Runs:1, Agent API:1, Wiring:1}; out 4 (cross 2: errors.js[Platform], model-pricing.js[LLM])
  - importers at d7ceb373: routes/dispatch.js, routes/proxy-runner.js, server.js
- `lib/workspace-kpis-cache.js`
  - 5334c81a×old: absent
  - 5334c81a×head: absent
  - d7ceb373×old: area=Auth; in 1 (cross 1 from 1 areas) {Web routes:1}; out 1 (cross 1: kpi-page.js[Platform])
  - d7ceb373×head: area=Reports; in 1 (cross 1 from 1 areas) {Web routes:1}; out 1 (cross 1: kpi-page.js[Platform])
  - importers at d7ceb373: routes/workspace-kpis.js
- `lib/cost-format.js`
  - 5334c81a×old: area=Other features; in 7 (cross 7 from 2 areas) {server-rendered pages:6, LLM:1}; out 0 (cross 0: —)
  - 5334c81a×head: area=Other features; in 7 (cross 7 from 2 areas) {server-rendered pages:6, LLM:1}; out 0 (cross 0: —)
  - d7ceb373×old: area=Other features; in 7 (cross 7 from 2 areas) {server-rendered pages:6, LLM:1}; out 0 (cross 0: —)
  - d7ceb373×head: area=Other features; in 7 (cross 7 from 2 areas) {server-rendered pages:6, LLM:1}; out 0 (cross 0: —)
  - importers at d7ceb373: lib/components/decision-panel.js, lib/render-effort-readout.js, lib/render-kpis.js, lib/render-run-steps.js, lib/render-settings.js, lib/render-workspace-kpis.js, lib/ship-biscuit.js

## Decomposition: placement (same code, guide old→head) vs code (same guide, 5334c81a→d7ceb373)
- **cross-area links**: 5334c81a×old 1262 · 5334c81a×head 1249 · d7ceb373×old 1275 · d7ceb373×head 1259
  - placement at 5334c81a: -13; placement at d7ceb373: -16
  - code under old guide: 13; code under HEAD guide (the series): 10
  - run 5 figure → run 6 HEAD (d7ceb373×head − 5334c81a×old): -3 = placement@5334c81a -13 + code@HEAD guide 10; interaction (code@head − code@old) = -3
- **F1 LLM→Runs/Runs→LLM**: 5334c81a×old 26,35 · 5334c81a×head 29,36 · d7ceb373×old 27,36 · d7ceb373×head 30,37
  - placement at 5334c81a: 3/1; placement at d7ceb373: 3/1
  - code under old guide: 1/1; code under HEAD guide (the series): 1/1
  - run 5 figure → run 6 HEAD (d7ceb373×head − 5334c81a×old): 4/2 = placement@5334c81a 3/1 + code@HEAD guide 1/1; interaction (code@head − code@old) = 0/0
- **Other features files**: 5334c81a×old 17 · 5334c81a×head 14 · d7ceb373×old 17 · d7ceb373×head 14
  - placement at 5334c81a: -3; placement at d7ceb373: -3
  - code under old guide: 0; code under HEAD guide (the series): 0
  - run 5 figure → run 6 HEAD (d7ceb373×head − 5334c81a×old): -3 = placement@5334c81a -3 + code@HEAD guide 0; interaction (code@head − code@old) = 0

## Directed area links that differ between any two combinations
| link | 5334c81a×old | 5334c81a×head | d7ceb373×old | d7ceb373×head | place@B | place@H | code@old | code@head |
|---|---|---|---|---|---|---|---|---|
| Agent API → Other features | 2 | 0 | 2 | 0 | -2 | -2 | 0 | 0 |
| Agent API → Runs | 42 | 44 | 43 | 45 | +2 | +2 | +1 | +1 |
| Auth → Platform | 6 | 6 | 7 | 6 | 0 | -1 | +1 | 0 |
| LLM → Other features | 4 | 1 | 4 | 1 | -3 | -3 | 0 | 0 |
| LLM → Runs | 26 | 29 | 27 | 30 | +3 | +3 | +1 | +1 |
| Other features → LLM | 2 | 1 | 2 | 1 | -1 | -1 | 0 | 0 |
| Other features → Platform | 3 | 1 | 3 | 1 | -2 | -2 | 0 | 0 |
| Other features → Runs | 9 | 7 | 10 | 6 | -2 | -4 | +1 | -1 |
| Reports → Other features | 2 | 1 | 1 | 0 | -1 | -1 | -1 | -1 |
| Reports → Platform | 9 | 9 | 9 | 10 | 0 | +1 | 0 | +1 |
| Reports → Runs | 10 | 11 | 12 | 13 | +1 | +1 | +2 | +2 |
| Runs → LLM | 35 | 36 | 36 | 37 | +1 | +1 | +1 | +1 |
| Runs → Other features | 15 | 4 | 17 | 5 | -11 | -12 | +2 | +1 |
| Runs → Platform | 58 | 60 | 59 | 61 | +2 | +2 | +1 | +1 |
| Web routes → Auth | 67 | 67 | 68 | 67 | 0 | -1 | +1 | 0 |
| Web routes → Other features | 6 | 3 | 6 | 3 | -3 | -3 | 0 | 0 |
| Web routes → Reports | 2 | 2 | 2 | 3 | 0 | +1 | 0 | +1 |
| Web routes → Runs | 85 | 88 | 87 | 90 | +3 | +3 | +2 | +2 |
| Wiring → Runs | 44 | 44 | 45 | 45 | 0 | 0 | +1 | +1 |

## File-level cross-area edges added/removed by code (HEAD guide, 5334c81a→d7ceb373)
Added:
- + lib/cost-read.js [Runs] → lib/request-usage-fold.js [Runs] (intra)
- + lib/dispatch-store.js [Runs] → lib/usage-snapshot-intake.js [Other features]
- + lib/model-routing-history.js [LLM] → lib/request-usage-loader.js [Runs]
- + lib/request-usage-fold.js [Runs] → lib/model-pricing.js [LLM]
- + lib/request-usage-fold.js [Runs] → lib/row-usage.js [Runs] (intra)
- + lib/request-usage-fold.js [Runs] → lib/utils/time.js [Platform]
- + lib/request-usage-loader.js [Runs] → lib/lineage-membership.js [Runs] (intra)
- + lib/request-usage-store.js [Runs] → lib/request-usage-vocabulary.js [Runs] (intra)
- + lib/row-usage.js [Runs] → lib/request-usage-vocabulary.js [Runs] (intra)
- + lib/run-paragraph-hook.js [Runs] → lib/request-usage-loader.js [Runs] (intra)
- + lib/session-telemetry.js [Runs] → lib/request-usage-vocabulary.js [Runs] (intra)
- + lib/workspace-kpi-stats.js [Reports] → lib/dispatch-store.js [Runs]
- + lib/workspace-kpi-stats.js [Reports] → lib/request-usage-loader.js [Runs]
- + lib/workspace-kpis-cache.js [Reports] → lib/kpi-page.js [Platform]
- + routes/dashboard-effort.js [Web routes] → lib/request-usage-loader.js [Runs]
- + routes/dashboard.js [Web routes] → lib/request-usage-loader.js [Runs]
- + routes/proxy-compute.js [Agent API] → lib/request-usage-loader.js [Runs]
- + routes/workspace-kpis.js [Web routes] → lib/workspace-kpis-cache.js [Reports]
- + server.js [Wiring] → lib/request-usage-loader.js [Runs]
- + server.js [Wiring] → lib/usage-snapshot-intake.js [Other features]
Removed:
- − lib/founder-lookup.js [Other features] → lib/dispatch-store.js [Runs]
- − lib/terminal-marked-task-cost.js [Runs] → lib/row-usage.js [Runs] (intra)
- − lib/workspace-kpi-stats.js [Reports] → lib/founder-lookup.js [Other features]
- − server.js [Wiring] → lib/founder-lookup.js [Other features]

Same for the old guide (labels differ; edge set is the same):
- added 20 (cross 17), removed 4 (cross 4)
- HEAD guide: added 20 (cross 13), removed 4 (cross 3)

## Placement: file-level edges whose cross/intra status changes with the guide, at d7ceb373
- lib/cost-read.js → lib/dispatch-terminal.js: old [Other features→Runs] head [Runs→Runs]
- lib/cost-read.js → lib/lineage-membership.js: old [Other features→Other features] head [Runs→Runs]
- lib/cost-read.js → lib/llm-call-log.js: old [Other features→LLM] head [Runs→LLM]
- lib/cost-read.js → lib/request-usage-fold.js: old [Other features→Runs] head [Runs→Runs]
- lib/cost-read.js → lib/row-usage.js: old [Other features→Other features] head [Runs→Runs]
- lib/cost-read.js → lib/session-telemetry.js: old [Other features→Runs] head [Runs→Runs]
- lib/cost-read.js → lib/utils/time.js: old [Other features→Platform] head [Runs→Platform]
- lib/dispatch-lineage.js → lib/lineage-membership.js: old [Runs→Other features] head [Runs→Runs]
- lib/dispatch-lineage.js → lib/row-usage.js: old [Runs→Other features] head [Runs→Runs]
- lib/effort-readout.js → lib/cost-read.js: old [Runs→Other features] head [Runs→Runs]
- lib/effort-readout.js → lib/lineage-membership.js: old [Runs→Other features] head [Runs→Runs]
- lib/lineage-membership.js → lib/utils/time.js: old [Other features→Platform] head [Runs→Platform]
- lib/model-pricing.js → lib/row-usage.js: old [LLM→Other features] head [LLM→Runs]
- lib/model-routing-history.js → lib/lineage-membership.js: old [LLM→Other features] head [LLM→Runs]
- lib/model-routing-spend.js → lib/cost-read.js: old [LLM→Other features] head [LLM→Runs]
- lib/request-usage-fold.js → lib/row-usage.js: old [Runs→Other features] head [Runs→Runs]
- lib/request-usage-intake.js → lib/lineage-membership.js: old [Runs→Other features] head [Runs→Runs]
- lib/request-usage-loader.js → lib/lineage-membership.js: old [Runs→Other features] head [Runs→Runs]
- lib/row-usage.js → lib/request-usage-vocabulary.js: old [Other features→Runs] head [Runs→Runs]
- lib/run-view.js → lib/cost-read.js: old [Runs→Other features] head [Runs→Runs]
- lib/session-telemetry.js → lib/row-usage.js: old [Runs→Other features] head [Runs→Runs]
- lib/terminal-marked-task-cost.js → lib/cost-read.js: old [Runs→Other features] head [Runs→Runs]
- lib/terminal-marked-task-cost.js → lib/lineage-membership.js: old [Runs→Other features] head [Runs→Runs]
- lib/weekly-budget.js → lib/cost-read.js: old [Runs→Other features] head [Runs→Runs]
- lib/workspace-kpi-stats.js → lib/cost-read.js: old [Reports→Other features] head [Reports→Runs]
- lib/workspace-kpis-cache.js → lib/kpi-page.js: old [Auth→Platform] head [Reports→Platform]
- routes/dashboard-effort.js → lib/lineage-membership.js: old [Web routes→Other features] head [Web routes→Runs]
- routes/proxy-compute.js → lib/cost-read.js: old [Agent API→Other features] head [Agent API→Runs]
- routes/proxy-compute.js → lib/lineage-membership.js: old [Agent API→Other features] head [Agent API→Runs]
- routes/settings.js → lib/cost-read.js: old [Web routes→Other features] head [Web routes→Runs]
- routes/ship-biscuit.js → lib/cost-read.js: old [Web routes→Other features] head [Web routes→Runs]
- routes/workspace-kpis.js → lib/workspace-kpis-cache.js: old [Web routes→Auth] head [Web routes→Reports]

## Change coupling (cochange --days 60)
| combo | windowStart | windowEnd | changes | 2+ areas | pairs | unmapped | shallow |
|---|---|---|---|---|---|---|---|
| 5334c81a×old | 2026-09-05T05:23:59.000Z | 2026-11-04T05:23:59.000Z | 874 | 400 | 76 | 5273 | false |
| 5334c81a×head | 2026-09-05T05:23:59.000Z | 2026-11-04T05:23:59.000Z | 874 | 400 | 76 | 5273 | false |
| d7ceb373×old | 2026-09-05T17:18:18.000Z | 2026-11-04T17:18:18.000Z | 854 | 392 | 76 | 5351 | false |
| d7ceb373×head | 2026-09-05T17:18:18.000Z | 2026-11-04T17:18:18.000Z | 854 | 392 | 76 | 5351 | false |

| pair | 5334c81a×old | 5334c81a×head | d7ceb373×old | d7ceb373×head | run 5 §6 | import link at d7ceb373×head? |
|---|---|---|---|---|---|---|
| browser code + server-rendered pages | 142 | 142 | 140 | 140 | 142 | no |
| Runs + Web routes | 111 | 111 | 110 | 110 | 111 | yes |
| Web routes + browser code | 107 | 107 | 105 | 105 | 107 | no |
| Agent API + Runs | 101 | 101 | 100 | 100 | 101 | yes |
| Web routes + server-rendered pages | 99 | 99 | 99 | 99 | 99 | yes |
| Web routes + Wiring | 95 | 95 | 93 | 93 | 95 | yes |
| Runs + server-rendered pages | 92 | 92 | 91 | 91 | 92 | yes |
| Runs + browser code | 87 | 87 | 85 | 85 | 87 | no |
| LLM + Runs | 85 | 85 | 84 | 84 | 85 | yes |
| Runs + Wiring | 81 | 81 | 81 | 81 | — | yes |
| Wiring + server-rendered pages | 79 | 79 | 79 | 79 | — | yes |
| LLM + Web routes | 82 | 82 | 77 | 77 | 82 | yes |
| Agent API + Web routes | 76 | 76 | 75 | 75 | — | yes |
| Wiring + browser code | 73 | 73 | 72 | 72 | — | no |

Pairs whose count differs between guides at the same commit:
- 5334c81a: Other features + server-rendered pages 30→29; Other features + Runs 30→27; Agent API + Other features 15→13; LLM + Other features 15→14; Other features + Reports 6→4
- d7ceb373: Auth + Wiring 59→58; Auth + Web routes 56→55; Auth + server-rendered pages 44→43; Auth + Runs 38→37; Agent API + Auth 32→31; Other features + Runs 32→29; Other features + server-rendered pages 31→30; Auth + LLM 22→21; Agent API + Other features 16→14; LLM + Other features 15→14; Auth + Reports 10→9; Auth + Other features 9→8; Other features + Reports 7→5

Biggest code movers (HEAD guide, 5334c81a→d7ceb373):
LLM + Web routes -5; browser code + server-rendered pages -2; Web routes + browser code -2; Web routes + Wiring -2; Runs + browser code -2; LLM + browser code -2; Platform + Web routes -2; Other features + Runs +2; Other features + Wiring +2; LLM + Platform -2; Runs + Web routes -1; Agent API + Runs -1; Runs + server-rendered pages -1; LLM + Runs -1; Agent API + Web routes -1

No-link pairs (cochange pair with no import link either way) per combo:
- 5334c81a×old: 18 of 76: browser code + server-rendered pages; Web routes + browser code; Runs + browser code; Wiring + browser code; LLM + browser code; Agent API + browser code; Auth + browser code; Platform + browser code; Other features + browser code; Providers + browser code; Reports + browser code; Agent API + Reports; Task model + browser code; Agent API + Task model; Auth + Task model; Providers + Reports; Task model + Web routes; Task model + Wiring
- 5334c81a×head: 19 of 76: browser code + server-rendered pages; Web routes + browser code; Runs + browser code; Wiring + browser code; LLM + browser code; Agent API + browser code; Auth + browser code; Platform + browser code; Other features + browser code; Agent API + Other features; Providers + browser code; Reports + browser code; Agent API + Reports; Task model + browser code; Agent API + Task model; Auth + Task model; Providers + Reports; Task model + Web routes; Task model + Wiring
- d7ceb373×old: 18 of 76: browser code + server-rendered pages; Web routes + browser code; Runs + browser code; Wiring + browser code; LLM + browser code; Agent API + browser code; Auth + browser code; Other features + browser code; Platform + browser code; Agent API + Reports; Providers + browser code; Reports + browser code; Task model + browser code; Agent API + Task model; Auth + Task model; Providers + Reports; Task model + Web routes; Task model + Wiring
- d7ceb373×head: 20 of 76: browser code + server-rendered pages; Web routes + browser code; Runs + browser code; Wiring + browser code; LLM + browser code; Agent API + browser code; Auth + browser code; Other features + browser code; Platform + browser code; Agent API + Other features; Agent API + Reports; Providers + browser code; Reports + browser code; Other features + Reports; Task model + browser code; Agent API + Task model; Auth + Task model; Providers + Reports; Task model + Web routes; Task model + Wiring
