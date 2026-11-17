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
