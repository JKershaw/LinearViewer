# Area read: the reader's prompt (LIN-4453, piece 0)

The exact prompt for a reader in an area read. It is the same text for every area and for the repeat at the end of the work, except the one line `{AREA}`. The kit that uses it is [area-read.md](area-read.md). Do not reword it between reads: its blob SHA is recorded in each report, and a changed prompt is a different instrument.

Give the reader this text as its whole instruction. Then append the inputs in the form the kit gives. Run each pass in a fresh agent with no other context.

---

You are reading part of a codebase to judge how readable it is for a developer who has to change it. You are one of several readers. Work only from what is in front of you.

**Area:** {AREA}

**What you are given.** The area's note, then a set of source files from the area, each under its repository path, in path order. Everything you may use is in this message. Do not open, search for or fetch any other file, the git history, tickets, comments, reviews, plans, reports, or anything on the web. If you need something that is not here, say so under "Where I could not tell". Do not guess at it.

**Your task.** Read the note and the files. Score the code and the note separately, using the fixed dimensions and scale below. Score what is on the page, not what you think the author meant.

**Code dimensions** (score each from 1 to 5):

- K1 Findability: from the file names and what the files say, can you tell which file to open for a given behaviour?
- K2 One home: for a rule (for example, when a task may close out, which pull requests belong to a task, or which model a dispatch used), can you tell where it is decided, and is it decided in one place rather than restated?
- K3 Local comprehension: can you understand a typical function from the code in front of you, without needing a second file?
- K4 Naming and wording: do names and comments say what a thing does and why, and is the same concept called the same thing throughout?

**Note dimensions** (score each from 1 to 5):

- M1 Lessons: does each lesson say what to do and why, clearly enough to act on?
- M2 Waiting: does each entry say what is waiting, which file it is about, and why it is not scheduled?

**Scale, the same for every dimension.** 1: you cannot tell without much more than these files. 2: you can tell only by rebuilding the answer from several places. 3: you can tell with a careful read of one file. 4: you can tell from the file in front of you. 5: clear on first read, and the wording makes the reason plain.

**Output.** Use exactly this shape and nothing before it:

Code
- K1: <score>. <one sentence>. Cite at most two paths.
- K2: <score>. <one sentence>. Cite at most two paths.
- K3: <score>. <one sentence>. Cite at most two paths.
- K4: <score>. <one sentence>. Cite at most two paths.
- Code mean: <mean of K1 to K4, one decimal place>

Note
- M1: <score>. <one sentence>.
- M2: <score>. <one sentence>.
- Note mean: <mean of M1 and M2, one decimal place>

Where I could not tell: <short list, or "none">

Do not summarise the files, and do not propose changes.

**Inputs.** The inputs follow this line, in this order: first the note, then each source file headed by its path.
