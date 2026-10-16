# Experiment 1: how the two arms are scored

This plan was written before either arm ran. It stays outside Harbour and is never shown to either arm.

**The arms.**

- **A (informed):** a regular Harbour ticket, which merges as normal.
- **B (clean room):** one agent working from `SPEC.md`, which is every comment in the original with the code removed, plus the codec tests. It never sees the code.

**Base.** Both arms are scored against the original `adf.js` at `2a07f3ea`. If `main` moves before A runs, A's `adf.js` is still replayed against `2a07f3ea`'s original.

## 1. Same utility (John: "matches the utility of what came before")

- **Every existing test passes unchanged in the full tree:** the unit suite, plus the Jira e2e spec. For B, its module is dropped into a copy of the tree at `2a07f3ea` and the same suites are run, because B only had the codec tests.
- **Side-by-side replay.** `kit/diff.mjs` runs old and new over:
  - the inputs the tests use;
  - 1,037 real ticket texts (private, never committed);
  - generated ADF and Markdown;
  - both round trips.

  Each difference group is sorted into one of two kinds:
  - **(a) pinned by tests or recorded decisions.** This should be impossible if the tests pass.
  - **(b) not pinned.** Each of these is classed as a bug in the old code (an improvement), a bug in the new code (a regression), or harmless. John decides on borderline cases.
- **Any new tests are run against the original;** they must pass there.

## 2. Cleaner (John: "cognitively simpler, less room for bugs, easy to maintain")

- **Cognitively simpler:** `kit/shape.mjs` on code only (comments are reported separately and never count towards size): code lines, longest function, maximum nesting, branch count per function and in total, regex count.
- **Less room for bugs:** `kit/mutate.mjs` plants faults on every applicable site, for each version. The tests are (1) the codec file alone and (2) the codec file plus the provider tests. A higher catch rate and fewer survivors mean fewer places for a bug to hide. Survivors are compared by kind.
- **Easy to maintain: a change probe.** A fresh agent gets the same small change request against each version (old, A, B) and reports what it had to read and change. The request is chosen before the arms run and is written in `change-probe.md`.
- **John's own side-by-side read** of old, A and B, with the measures alongside.

## 3. Process (recorded, not judged)

- **Per arm:** model and effort, sessions, wall time, cost where available, review rounds, rulings raised, and anything the pipeline added (tests, rules, follow-up tickets).
- **The comparison is "informed plus Harbour's pipeline" against "clean room, one session".** It is not a clean comparison of informed against clean room.

## 4. Reading it honestly

- There is one run per arm, so small differences are noise. Only large, consistent differences count.
- Comments are 457 of the original's 821 lines. Size is judged on code only.
- The prediction (`prediction.md`) is written and committed before A launches. It is scored afterwards.
