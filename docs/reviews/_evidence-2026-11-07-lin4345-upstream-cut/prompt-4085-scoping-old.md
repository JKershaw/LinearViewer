# Define scope for LIN-4085: Add an agent onboarding prompt to the homepage getting started section
## Workflow

1. **Start**: Set LIN-4085 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-4085 in Linear
3. **Analyze**: Complete the goal below
4. **Update Linear**: Update issue description with finalized scope
## Context
**Project:** Harbour
**Read before acting:** This prompt is an instruction, not a copy of the task. It does not restate LIN-4085's description or discussion — read the current description and comment thread in Linear first, since they are the source of truth and may have moved on since this prompt was written.
## Goal
The ticket is unclear about its goal: settle what it should deliver and what done means. What is in and out of scope is yours to decide; read the code first, and flag for the human only product or intent questions.

## Scope and Authority

- When this task fixes something, its cause is part of the work, wherever it lives. Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.

## Process
If the ticket is aimed at a symptom of something deeper, say so.
Document in a structured format suitable for the issue description:
- **In Scope**: What this task will deliver
- **Out of Scope**: Different problems excluded; the cause of this one is never out of scope
- **Assumptions**: What we're assuming to be true
- **Success Criteria**: How we'll know when it's done
- **Open Questions**: Unresolved items needing clarification

## Re-ground the Ticket (staleness check)

Treat this ticket, and any solution or limit it proposes, as a **hypothesis**, not ground truth — it may have been accurate when written but invalidated by later commits or by what the code shows. Before relying on what it says about the code:

1. List the files and symbols the ticket references.
2. Check whether any of them have changed since this ticket was created: run `git log --since=<ticket-createdAt> -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.