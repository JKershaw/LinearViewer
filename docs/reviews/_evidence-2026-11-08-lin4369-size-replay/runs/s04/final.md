I wrote the survey comment for LIN-4253 at `29f14bf6e` to /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/s04/output/comment.md (about 490 words). I made no changes in `code/`.

What the comment says:
- **Offered:** `EXCLUDED_FROM_AI_RECOMMENDATION` holds exactly the templates with no `route` (retro and the two surveys), in template order. So the "offered" trait is already declared once, as `route`. A separate `offered` flag would be a second copy that can disagree with it. The cheaper fix is to make `route` required on every template, with `route: null` meaning hand-only, and derive the list from that. The selector prompt, the router fixtures and the task page's excluded list would stay byte-identical.
- **Read-only:** this is the deeper problem. The code already has four different meanings of "read-only":
  - `SURVEY_KINDS`, which picks the dispatch preamble's mandate.
  - The `READING` line in `STAGE_INTENT`.
  - `formatReadOnlyWorkflow`, which is also used by review and plan-review, stages that comment and approve.
  - A comment in `GROUNDING_BY_KIND`.
  
  LIN-4251's four stages are nearly the `READING` set. A new trait should be named for what it gates, the preamble mandate, and kept from drifting against the `READING` line.
- **Module boundary:** `proxy-preamble.js` deliberately doesn't import the template registry. Instead, `dispatch-entrance.js`, which already imports it, should look up the trait and pass a boolean.
- **Gap on follow-ups:** the follow-up and resume path (`provisionResumeCredential`) never receives a kind. A follow-up to a survey session that re-appends the block gets the normal edit-and-open-PRs mandate. That is out of scope here, but LIN-4251 inherits it for four more stages.
- **Tests and comments:** the kind names copied into three test files should come from the trait, checked against one pinned list. Two code comments are stale: the `action-kind.js` header and the template-defs docstring.
- **Folding the other per-kind tables (not this ticket):** the prompt tables (stage leads, scope lines, grounding, completion signals) could move into the template definitions. The run-view labels, wall-clock buckets and job registry are read by modules that shouldn't load the templates, so they would need a small traits-only module that both sides import.

DONE: Survey-place comment for LIN-4253 written to output/comment.md
