# Experiment 2a: prediction (written 15 Oct, before launch)

Honest guesses, to be scored afterwards. The comparison points are experiment 1's arms: B (clean room, solo) and A (informed, Harbour).

## Mechanics

- **The worker sets up the room and launches an Opus sub-agent:** about 75% likely without a hitch. The likeliest snags are finding the sub-agent's transcript file, and the plan stage reshaping the steps.
- **The audit passes with 0 violations:** about 80% likely. The likeliest violation is a shell command that doesn't start by entering the room.
- **A `DECISION:` is raised at some point:** about 40% likely. The likeliest causes are an "unclear" replay group, such as B's empty-text-node question, or an audit snag.
- **It merges without John:** about 60% likely, lower than experiment 1 because of the extra judgement calls.
- **Sessions and time:** 6–12 sessions, 60–150 minutes. That's longer than A's 37 minutes, because the replay and classification add work.

## The raw clean-room output (a second sample of B)

- **Code lines:** 240–330. B had 275.
- **Codec tests:** passes all 133, about 85% likely. Full suite also passes, about 75%.
- **Replay:** 100–400 difference groups, in the same regions as B: links, mentions, code fences and malformed input.
- **The bracket-display regression:** recurs, about 50% likely. It depends on how the escape set is read.

## The merged result, after the pipeline's replay and fixes

- **Replay against today's code:** only "fix" and "harmless" groups remain, plus anything raised as a `DECISION:`.
- **Known regressions:** any regression it finds of the kind B had, such as bracket display or four-backtick fences, is fixed before merge, about 70% likely. The replay shows each one as a difference, but they must be classed correctly.
- **Code lines:** 260–340. Fixing regressions adds some back.
- **Complexity:** at or below A on nesting and decision points, about 70% likely.
- **Planted-fault score:** 84–89%.
- **Added tests:** 3–15, pinning fixed outputs.

## Overall

**Through Harbour, the clean room gets close to B's cleanliness and loses B's main regression.** The replay is what makes the difference: the pipeline helps when it is given a way to see behaviour.

**The main risk is classification.** The worker has to judge hundreds of groups, and could misclass a regression as a "fix".
