#!/usr/bin/env bash
# S6: a task with neither git nor a tracker. Recreates store.json from empty.
set -u
cd "$(dirname "$0")"
L() { node ../../model/layer.mjs --store store.json "$@"; echo; }
rm -f store.json newsletter/march.md
D=2026-11-13

echo '## seed (Harbour)'
L add area '{"name":"newsletter","paths":["newsletter/"]}' --by Harbour --at ${D}T09:00:00Z
L add lesson '{"in":"area-1","says":"members read on phones; keep it under 400 words","paths":["newsletter/"]}' --by Harbour --at ${D}T09:00:00Z
L add task '{"in":"area-1","asked":"Write the March newsletter: the AGM date, the new treasurer, and the spring fixtures","paths":["newsletter/"]}' --by Harbour --via John --at ${D}T09:01:00Z

echo '## 1. survey-task (10:00)'
T=${D}T10:00:00Z
L brief survey-task --task task-3 --as-of $T --text
L find --in area-1 --by survey-task --as-of $T
L add run '{"in":"task-3","stage":"survey-task","claims":[]}' --by survey-task --at $T
L revise task-3 '{"done-when":"newsletter/march.md, under 400 words, gives the AGM date, the new treasurer and the spring fixtures, and has been sent to members"}' --reason "survey: what done means for a newsletter" --by survey-task --at $T
L add question '{"in":"task-3","to":"John","asks":"The store holds none of the three facts. What is the AGM date (and venue/time), who is the new treasurer, and what are the spring fixtures (date, opponent, home/away)?","if-unanswered":"implementation writes visible [TBC] placeholders; it is not sent until filled","links":{"about":"task-3"}}' --by survey-task --at $T
L add question '{"in":"task-3","to":"John","asks":"How is the newsletter sent, and to whom?","options":["email to the members list","post in the club group chat","print for the clubhouse"],"recommended":"email to the members list","if-unanswered":"close-out holds the send","links":{"about":"task-3"}}' --by survey-task --at $T
L add finding '{"in":"task-3","to":"implementation","says":"Write newsletter/march.md, under 400 words, phone-first: short paragraphs, three headed items (lesson-2). No repo: save it as a file. The facts are not in the store; asked John (question-5). Until answered, put visible [TBC: ...] placeholders, never invented facts.","links":{"on":"lesson-2@1"}}' --by survey-task --at $T
L end run-4 done "survey written" --by survey-task --at $T

echo '## 2. implementation (11:00)'
T=${D}T11:00:00Z
L brief implementation --task task-3 --as-of $T --text
L get task-3 --by implementation --as-of $T      # done-when is not in the brief
L get question-5 --by implementation --as-of $T  # still open: no facts
mkdir -p newsletter
cat > newsletter/march.md <<'NL'
# Club News: March

Hello all, here is what is coming up this spring.

## AGM

Our Annual General Meeting is on **[TBC: AGM date]** at **[TBC: venue and time]**. Every member gets a vote, so please come. Agenda and proxy forms will follow by email.

## Meet our new treasurer

Please welcome **[TBC: new treasurer's name]**, who takes over the club's accounts. Questions about subs or expenses now go to them.

## Spring fixtures

- [TBC: date] v [TBC: opponent] (home/away TBC)
- [TBC: date] v [TBC: opponent] (home/away TBC)
- [TBC: date] v [TBC: opponent] (home/away TBC)

Volunteers for teas and lines are always welcome. Reply to this email to help.

See you at the club!
NL
HEAD=sha256:$(sha256sum newsletter/march.md | cut -c1-12)
echo "words: $(wc -w < newsletter/march.md)  head: $HEAD"
L add run '{"in":"task-3","stage":"implementation","claims":["newsletter/march.md"]}' --by implementation --at $T
L add change "{\"in\":\"task-3\",\"ref\":\"file:newsletter/march.md\",\"head\":\"$HEAD\",\"links\":{\"on\":\"task-3@2\"}}" --by implementation --at $T
L end finding-7 done "draft written, under 400 words, facts left as [TBC] per question-5" --by implementation --at $T
L end run-8 done "draft saved" --by implementation --at $T

echo '## 3. review (13:00)'
T=${D}T13:00:00Z
L brief review --task task-3 --as-of $T --text
L get change-9 --by review --as-of $T   # reached only through the brief's index line
L get task-3 --by review --as-of $T     # done-when
echo "file head now: sha256:$(sha256sum newsletter/march.md | cut -c1-12); words: $(wc -w < newsletter/march.md); TBCs: $(grep -o 'TBC' newsletter/march.md | wc -l)"
L add run '{"in":"task-3","stage":"review","claims":[]}' --by review --at $T
L add verdict '{"in":"task-3","of":"review","outcome":"request-changes","reasoning":"Head sha256:afcc54e0dee8 (118 words) is right for phones and under 400 words (lesson-2), and the three items are in place. But none of the three facts is filled: 12 [TBC] markers, waiting on question-5. Fails done-when; must not be sent as is. Only the [TBC] text should change.","links":{"on":"change-9@1"}}' --by review --at $T
L add finding '{"in":"task-3","to":"implementation","says":"When question-5 is answered, fill the [TBC] markers from the answer and save a new head; change nothing else. Review then judges the new head.","links":{"on":"change-9@1","about":"question-5"}}' --by review --at $T
L end run-10 done "verdict written" --by review --at $T
