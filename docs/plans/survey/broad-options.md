# The tally of broad options

Every step-back ends with options that are "the right direction for this area, but not this task's to carry". This file collects them by the thing they'd change, with the tickets that named them. **The rule we're testing:** when a second task trips on the same broad option, it stops being a someday ticket. It becomes a candidate to be pulled, either by riding along with the next task in that area, or as its own task with that evidence.

Sources: the 13 step-backs of round 2/3/QoL (07:38, 4 Nov) and the two forward-trial step-backs (LIN-4201, LIN-4203, 08:03). The global offshoot's "better still" lists count too, marked *(global)*. The same idea in different words is grouped as one, and the grouping is my judgement.

## Named by more than one task (pull candidates)

| Broad option | Named by | What it would leave |
|---|---|---|
| **Give the cost code its own home on the area map** | LIN-4176 (C), LIN-4195 *(global)*, LIN-4176 *(global)*, LIN-4201 *(global)* | The cost read out of the catch-all |
| ↳ **Pulled and landed** (LIN-4201, `2ee4e600`): `cost-read`, `row-usage` and `lineage-membership` are in Runs & dispatch. `cost-format` and LIN-4203's `usage-snapshot-intake` are still in the catch-all | | |
| **Retire the snapshot fold** (`foldLineageUsage`'s snapshot branch, `isRunningTotal`, `usageStateOf`, `missingCanChangeFigure`) | LIN-4195 *(global)*, LIN-4201 (step-back and *global*), LIN-4203 (step-back and *global*) | "The real payoff" of rebuild 2. Scheduled about 30 days after LIN-4203, when no snapshot-only lineage is left |
| **One Stop "tail" in `hook.js`**: one sequence every Stop case calls, instead of the seven hand-wired copies of post-at-Stop | LIN-4165 (C), LIN-4203 (step-back and *global*), LIN-4183 (E: split `main()` into decide/apply) | A new relay is one line; no exit path can be missed |
| ↳ **Priced, filed and landed** as LIN-4218 (`bf499a4`, 19:02 on 4 Nov): one outcome table and one executor. Its Survey found a latent ordering bug, filed as LIN-4233. The pricing follow-up found: one shipped miss and its fix ticket; about half a session of hand-checking per relay ticket, five times in four months; and one case of new work routed around the switch. Refactor cost: about a session, with a characterization golden first | | |
| **Settings as one described list** (name, type, default, bounds, what `0` means), read through one reader, re-readable instead of fixed at require time | LIN-4127 (C, D), LIN-4182 (B's numbers ticket, C), LIN-4183 (E: config at require time is "the real cost of this area") | Adding a setting is one entry; tests stop reloading `config.js` |
| **An acknowledged outbox for runner → Harbour posts** | LIN-4165 (D: feedback outbox), LIN-4195 (C: typed telemetry channel, an outbox) | Volume stops being a risk for any relay; no fire-and-forget under-reporting |
| **One shared transcript fold** across simple-dispatcher and runner-kit | LIN-4203 (step-back), LIN-4195 (area: "the per-message fold exists once in each repo") | One place that turns a transcript into requests |
| **A shared harness for the heavy test tier**: prerequisites declared and checked once, a private Harbour (and dispatcher) per run | LIN-4180 (C), LIN-4196 (C, and its builder's "if the area were how you'd want it": one "run this test command against a private copy of the trees" primitive), LIN-4181 (C: one `paths.js` owning every root). **Four namings. Priced, filed as LIN-4219 and landed (4 Nov): five pieces, all `+` in the place ledger. LIN-4187 then found its cause before work began, on the new harness** | "Won't start in my sandbox" closed; the next mutation or system task routine |
| **Instance-wide reads vs stores keyed by workspace** | LIN-4201 (step-back), LIN-4201 *(global)* | Settled once, before it comes up again |

| **Loading as part of the cost read** (callers pass a cost source once) | LIN-4201 step-back (4), my larger scope on LIN-4201 | The next input to the read touches no caller |
| ↳ **Pulled too early.** It didn't land in LIN-4201: "touching a caller to pass an array is not the same change as making the read async". Split off as LIN-4226, which then **landed as its own piece** the same evening (`c55f0fb3`). Lesson: price a pulled extra like any other piece | | |
| **A record of which outside contract each test pins** | LIN-4187 global ("what it lacks is any record of which Harbour contract each scenario relies on"), and three of LIN-4181's four "cause unknown" reds turning out to be contract drift | The next drift reads "Harbour changed X" |
| ↳ **Pulled and landed** in LIN-4187: 27 of 27 system scenarios carry a contract note, enforced by a census | | |

## Named once (watch)

- **A per-workspace state container in production.** LIN-4168 (D). A reset would drop the container.
- **Fold the ~40 `/test/clear-*` routes into the registry, split `routes/test.js`, one context object for `createTestRoutes`.** LIN-4168 *(global)*.
- **A cross-repo "how long a session stays resumable" contract.** LIN-4164 (D). LIN-4173 later made Harbour's copy one exported constant, half of this.
- **Name the "aside" follow-up** (work vs aside) for every lineage reader. LIN-4166 (B). Its own rule: "if a second 'aside' case appears".
- **Own merged → live in code** (`railway.toml`, a deploy job). LIN-4167 (e), against the "John holds Railway" stance. The no-secret "did it go live" check (d) is cheap and is a candidate on its own.
- **One wake policy** (promote the LIN-3257 classifier). LIN-4166 (D).
- **A flag registry with retirement** (flags always on get deleted). LIN-4127 (D). It might merge with "settings as one list".
- **Split `readCalls`/`callsSurfaceOf` out of `cost-read.js`.** LIN-4201 (step-back and *global*).
- **Check whether stored run paragraphs keep pre-cutover figures.** LIN-4201 (step-back).
- **Cut `opencode-runner.js`'s size** (1,966 lines). LIN-4203 *(global)*.
- **Mutant anchors checked by `npm test`.** LIN-4196 (C, "cheap and outside this ticket").
- **One process-group termination helper.** LIN-4196's builder: `groupAlive`/`stopGroup` in `run-mutations.js` is "another ad-hoc copy, beside `reapers.js` and several tests".

## How this is meant to be used (to test, not yet settled)

1. The global offshoot gets the rows for the area a task lands in, as evidence, and is asked whether this task can carry part of one.
2. A row named by three or more tasks with no carrier becomes its own task, filed with the evidence (which tickets paid for its absence).
3. The Costs meter, once records-first reading lands, puts a price on each row: the builders' "if this area were how you'd want it" estimate against what the ticket actually took.
