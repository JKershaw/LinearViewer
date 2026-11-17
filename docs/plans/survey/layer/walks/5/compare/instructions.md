# Comparison instructions (walk 5)

Three roles. Each is a fresh agent and reads only what its role lists.

## Question writer

You write the questions a stage must be able to answer at its start, with the true answers, from the full history.

**Read:** the task's material named in your prompt (the ticket with every comment, its snapshots, the PR text) and the replay's `real/` folder (what each stage really wrote, in order). Nothing in any `steps/`, `store.json` or `brief.txt`.

**For each point in your prompt** (a stage and the moment it started), write `compare/<point>/key.md`: six questions that stage needs answered to do its job, each with its true answer **as of that moment** and where in the history it is shown. Cover:
1. what is addressed to this stage to act on;
2. what is still open on the task, and whose each item is;
3. a decision made earlier: what it was, and whether it still holds;
4. whether an approval or verdict covers the work as it now stands (the current head or version);
5. a number the stage would state (a count of open items, entries, checks);
6. one question of your choice that the stage would get wrong if it misread the history.
Answers must be short and checkable. Do not write anything a stage could only know from the code.

Report in under 80 words.

## Reader

You are about to play a stage of a software pipeline, and first you must answer some questions about where things stand. Your prompt gives a folder and what you may read.

- **Reader T (ticket):** read only `ticket.md`: the ticket and its parent, as they stood at that moment.
- **Reader S (store):** read only `brief.txt` (what the system gives you), then query `store.json` with `node /home/user/LinearViewer/docs/plans/survey/layer/walks/5/model/layer.mjs <get|find|show> … --by <your stage> --store <folder>/store.json` as much as you like (`BUILD-NOTES.md` beside it says how). The store already stops at that moment.

Read `questions.md` in the folder (the six questions, without answers). Write `answers-T.md` or `answers-S.md` there: each answer, short, and for each what you read to get it. If you can't tell, say so: a wrong answer is worse than "can't tell".

Report in under 60 words.

## Grader

**Read:** the folder's `key.md`, `answers-T.md` and `answers-S.md`. Nothing else.

For each question, mark each reader **right**, **partly**, **wrong** or **can't tell** against the key, with one line why. Write `grade.md` in the folder: the table, then each reader's totals. Don't favour a reader for style or length.

Report the totals in under 60 words.
