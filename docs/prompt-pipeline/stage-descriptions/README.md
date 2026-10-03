# Stage descriptions (LIN-3290)

On 3 October 2026, for LIN-3289, each prompt template was read alongside its meta-prompt rules. For each one, these notes describe:

- what the stage is for;
- its ideal version, written as a brief to a skilled colleague;
- the exact strings that code or later stages rely on;
- the rules that tie scope to the ticket;
- how today's version differs.

`plumbing.md` maps how prompts are built and dispatched end to end, and where a separate writing step would sit.

These are working notes for the prompt-pipeline split, read at commit `065e776f`. They are not a specification, and their line numbers will drift.

Two readings in them were not adopted:

- **What "large" means.** Several notes list product behaviour, a published contract, stored data and another repo's interface as what the team would need to hear about. That list was LIN-3288's candidate definition. John's definition is the clause alone: a change goes to him only if he would need to tell the team about it before it happens. Size, effort and category lists don't define it, so read each list as an example at most.
- **Every task as a defect.** Some ideals (research's "what the right fix is", design's and plan's "the problem and its cause") assume something is broken. Research, design and plan also serve features, evaluations and migrations, so the shapes the writer uses (`lib/prompts/brief-writer.js`) are stage-neutral, and aim at the cause only when the task fixes something.

The intent behind the work is in `docs/papers/harbour/like-a-skilled-developer.md`.
