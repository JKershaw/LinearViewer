# Stage descriptions (LIN-3290)

> **Superseded in part (LIN-3300, LIN-3745).** These notes were written on 3 October 2026 against the system that had two prompt paths and a meta-prompt (`lib/prompts/meta-prompt-template.js`, `buildMetaPrompt`, the brief writer). LIN-3300 deleted all three: one stage selector (`lib/stage-router.js`) now picks the stage and code assembles that stage's prompt from its template. Only about 16% of the line citations here still resolve; the rest, and every "meta path", "AI path", "two-path" and "meta-prompt rule" reference, describe code that no longer exists. Read them as a record of the reasoning at that date, not as a map of today's code. Current behaviour: `docs/architecture/prompt-system.md`. Citations below are left as written.

On 3 October 2026, for LIN-3289, each prompt template was read alongside its meta-prompt rules (since deleted, see the banner above). For each one, these notes describe:

- what the stage is for;
- its ideal version, written as a brief to a skilled colleague;
- the exact strings that code or later stages rely on;
- the rules that tie scope to the ticket;
- how today's version differs.

`plumbing.md` maps how prompts are built and dispatched end to end, and where a separate writing step would sit.

These are working notes for the prompt-pipeline split, read at commit `065e776f`. They are not a specification, and their line numbers will drift.

Two readings in them were not adopted:

- **What "large" means.** Several notes list product behaviour, a published contract, stored data and another repo's interface as what the team would need to hear about. That list was LIN-3288's candidate definition. John's definition is the clause alone: a change goes to him only if he would need to tell the team about it before it happens. Size, effort and category lists don't define it, so read each list as an example at most.
- **Every task as a defect.** Some ideals (research's "what the right fix is", design's and plan's "the problem and its cause") assume something is broken. Research, design and plan also serve features, evaluations and migrations, so the shapes the writer used (`lib/prompts/brief-writer.js`, deleted in LIN-3300) were stage-neutral, and aim at the cause only when the task fixes something.

The intent behind the work is in `docs/papers/harbour/like-a-skilled-developer.md`.
