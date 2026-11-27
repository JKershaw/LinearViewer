# Sweep, pass 1: find the loose ends (27 Nov)

**Why this sweep exists.** `/home/user/LinearViewer/docs/plans/survey/log.md` is a working diary kept from 2 to 27 Nov 2026 (about 5,500 lines). It covers a project on Harbour, a control plane that dispatches AI agent sessions on tickets, and on its runner, simple-dispatcher. John owns both. In his words, the point of the log was "so after the work is done, we can sweep and ensure everything is tracked and either done, or handled some other way." Once the sweep is done, the log is deleted. It stays in git history.

An earlier sweep went wrong: it collected decisions, lessons and facts, and reported 184 "gaps". That isn't the question. The question is narrower.

**Your job.** Read your slice of the log, every line, in pieces with the Read tool. Don't skim, and don't rely on keyword search. List the **loose ends**: things the log shows as needing to happen for Harbour or simple-dispatcher (the product, its code, or running it) that it doesn't show as finished. They are:
- **defect:** a bug, broken behaviour, wrong doc or broken access that was found;
- **follow-up:** a residual, a "file this later", or something promised or agreed to be done;
- **call:** a question or decision left for John that the log doesn't show him answering;
- **parked:** work deferred, set aside or held "for later";
- **filed:** a ticket filed whose outcome the log doesn't show;
- **idea:** an idea John himself raised for future work. Ideas raised only by the assistant don't count.

**Leave out:**
- decisions already acted on;
- lessons, methods and research findings;
- how things work;
- history and status;
- the assistant's narration;
- anything that was only about the Survey research method, which is finished;
- anything your slice itself later shows as done, answered or dropped. Drop that item, and give the line that closes it in your closing count.

Don't check anything outside the log. Pass 2 checks every item against the tickets and code. If you aren't sure an item is a loose end, include it and add "unsure".

**Write** to `/home/user/LinearViewer/docs/plans/survey/spikes/sweep/<slice letter>.md`, one line per item:

`- **[kind]** what it is, in one plain line. Repo: Harbour / simple-dispatcher / ops. Tickets: LIN-… (if any). log.md:<line>`

End with one line: `Read lines X–Y in full; N loose ends; M dropped as closed within the slice.` Never copy a secret or a token. Don't edit any other file. Return a summary of at most 4 lines.
