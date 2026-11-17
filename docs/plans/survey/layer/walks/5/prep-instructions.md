# Preparing a replay (walk 5)

You prepare one task for a stage-by-stage replay against a small data store. You do not play any stage. Your prompt gives TASK (e.g. LIN-4459), PARENT (or none), REPLAY (a folder) and the STEPS (stage and dispatch time, from Harbour's cost record).

**Read:**
- the material in `/home/user/LinearViewer/docs/plans/survey/layer/walks/5/material/`: `TASK.json`, `TASK-snapshots.json`, `TASK-rulings.json`, and the parent's files if there is one (`README.md` says what each is);
- the store's CLI: `/home/user/LinearViewer/docs/plans/survey/layer/walks/5/model/BUILD-NOTES.md`, `kinds.json`, `actors.json`;
- as worked examples of what you produce, from an earlier walk: `/home/user/LinearViewer/docs/plans/survey/layer/walks/4/replay-4455/seed.sh`, `seed-log.md`, and `real/3-scoping.md`;
- the repository's `docs/areas/` at the commit the task started from (`git -C /home/user/LinearViewer show <commit>:docs/areas/...`), for the areas.
Nothing else.

**Produce, in REPLAY:**

1. **`real/<n>-<actor>.md`, one per step:** what that actor really wrote, verbatim, headed `# What this stage really wrote`: its comments on the task (and on the parent, if it wrote there), and the changes it made to the description, which the snapshots show. A step runs from its dispatch to the next step's dispatch. Harbour's `plan` stage is the actor `design`. Where another actor wrote between stages (the autopilot, John, a ruling raised, answered or withdrawn), give it its own step with its own number and time, as `real/<n>-autopilot.md` or `real/<n>-John.md`; renumber so the steps run in time order.
2. **`steps.json`:** `[[n, actor, asOf, start], …]`: asOf is the dispatch time (or the time the other actor wrote); start is one or two seconds later.
3. **`seed.sh`:** recreates `store.json` from empty, as it stood just before step 1, written in the store's own order with `--at` at the real times:
   - the areas whose paths the task touches, as they stood at the start commit, by `Harbour`: each area's lessons (as `lesson`, in the area) and its waiting entries (as `finding` to the area), verbatim;
   - the parent task, if any, by `John` (`via` how it was filed), with `asked` byte-exact; its plan pieces, verdicts and decisions as they stood; its children up to this task, each with `ref` (the ticket id) and its `piece` link;
   - the task itself, with `ref`, `done-when` and `paths`, `in` its parent;
   - nothing the replayed steps will write.
   Every write by its real writer. Run it until it exits 0.
4. **`seed-log.md`,** under 40 lines: the key ids (parent, task, piece, areas, siblings), the last seed write's time, the steps, and anything you could not place.

Report in under 120 words: the key ids, the step list, and anything you could not place. Do not commit.
