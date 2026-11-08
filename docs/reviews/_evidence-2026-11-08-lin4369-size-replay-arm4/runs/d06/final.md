Scoping for LIN-4253 is done. The size record is in `output/description.md` and the status change in `output/tracker-actions.md`. I posted no comment, as the prompt says.

**Recommended size: just the task.** No cuts. Decided by the standing policy: I applied it, but it can only weigh a finding that binds on this task, and none does.

**What I checked against the code (HEAD 29f14bf6e, the commit both Surveys used, so nothing is stale):**
- **Offered:** the list of excluded stages (`lib/prompt-templates.js:418`) is exactly the three templates with no `route`: retro, survey-task and survey-place. The selector already checks `route` and the list. The router (`lib/action-kind.js:18`) and the task page (`lib/task-page-loader.js:1022`) read only the list. Deriving it from the template is a deletion inside the task.
- **Read-only:** today `SURVEY_KINDS` (`lib/proxy-preamble.js:186`) is the only list that changes behaviour, and only for the preamble's mandate and closing sentence. Building the trait on the template, deriving that gate from it, and pointing the three LIN-4248 tests at it delivers the ask with prompts byte-identical.

**Findings I weighed and why none binds:**
- **"Read-only" has several meanings** in the prompt-body wording: the `READING` scope line, the read-only workflow formatter and the inform-only workflow formatter. Making them agree would change what stages are told, which belongs to LIN-4251, or fold the per-kind tables, which the ticket excludes. The ask names its readers (selector, router, task page, preamble) and works without this.
- **The follow-up/resume path never gets a kind** (`provisionResumeCredential`). Neither do the feedback-triage dispatch and collective dispatches. Fixing that is a behaviour change, which the ticket forbids. It matters to LIN-4251 (triage mostly enters through the feedback route), not here.
- **Layering:** `proxy-preamble.js` must not import the template registry. The latest seams-and-tangles periodical already flags that file as a knot with 11 importers. Either the caller resolves the trait or a small traits lookup sits between them. This is an engineering choice inside the task, not extra size.

**Notes for the implementing stage:**
- Settle and document what the read-only trait gates (the dispatch mandate, unlike the prompt-body formatters) before naming it. It should still answer "is this stage read-only", so the ask is delivered in full.
- Keep one pinned expected list in the tests, so a dropped trait can't empty a loop and leave the tests green.
- Capture before/after bytes for every kind, in both prose and mcp modes, and on each entry path.
- Update the docstrings in `action-kind.js` and the template defs.

Survey claims I didn't check myself: the follow-up and feedback dispatch line numbers, and the full list of other per-kind tables.

DONE: LIN-4253 sized as just the task (standing policy, no cuts); size record written, status set to In Progress
