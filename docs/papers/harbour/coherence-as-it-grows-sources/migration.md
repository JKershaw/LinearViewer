# Literature review slice: incremental migration & retirement patterns — do they finish, and what "done" should include

Compiled 2026-10-08. Scope: migration/retirement patterns (strangler fig, branch-by-abstraction, expand/contract, feature toggles), dead-code/lava-flow evidence, empirical evidence on whether migrations and deprecations actually complete, definitions of done and refactoring practice, comprehension cost of parallel implementations, and 2024–2026 work on additive bias (human and LLM). Classical erosion/smell/clone/TD-metric literature and general AI-assisted-code empirical studies are left to the other two slices; a few 2025–26 LLM *migration-completeness* studies are included here because they measure completion, and are flagged as overlap.

**Verification legend.** Every entry says how it was checked:
- `[primary text read]` — I fetched the full text (HTML or PDF → text) and the numbers/quotes below are taken from it.
- `[abstract/metadata only]` — only the abstract or a repository record was readable.
- `[secondhand]` — numbers come from another source quoting the paper; primary not retrievable (bot-blocked or 503). Treat as unverified.
- `[from memory]` — a DOI or detail I could not confirm online in this session; verify before citing.

Quotes are ≤40 words and verbatim from the text I read unless marked otherwise.

---

## 0. One-paragraph synthesis (details and evidence in the entries below)

Every canonical incremental-migration pattern has an explicit *last step that deletes the old path* — Hammant's step 6 "Delete the first implementation" (2007), Fowler's "Once the flawed supplier isn't needed, we can delete it" (2014), Sato's *contract* phase (2014) with the warning "If the contract phase is not executed you might end up in a worse state than you started", Stripe's "final (and most satisfying) step is to remove code that writes to the old store" (2017), Azure's "You remove the façade… This step marks the completion of the migration" (2026). The empirical record says that step is the one most often skipped: in Chrome only 51 of ~255 release toggles tracked in a maintenance campaign were actually removed and 2 of 11 marked "Removed" were still present (Rahman et al. 2016); toggle removals lag additions by ~35% (Kubernetes) and ~13% (GitLab) over 5–8.5 years (Tërnava 2026); at Uber an automated pipeline was needed to delete 1,381 stale flags (17% of all flags) and still removed only ~1% of the codebase (Ramanathan et al. 2020); 81.5% of Java systems keep outdated dependencies (Kula et al. 2018); only a median 20% of affected Smalltalk projects reacted to a deprecation, with "parts of it remain[ing] in an inconsistent state for long periods" (Robbes et al. 2012); 95–100% of Java clients keep *adding* calls to already-deprecated APIs (Sawant et al. 2018); and in industry "the new API is added but the previous one cannot be removed", which Martini et al. (2015) classify as a distinct cause of architectural debt ("non-completed refactoring"). The practices with evidence of making retirement actually happen are organisational, not stylistic: a named owner and compulsory deadline (Google ch. 15: "Hope is not a strategy"), backsliding prevention that blocks new uses of the old path (Google ch. 22; absent in the Sawant data), automated generation of the deletion change routed to the responsible author plus reminders (Piranha: 88% of generated diffs acted on, 86% land within five days of the last reminder), toggle expiry dates/limits (Hodgson 2017; Mahdavi-Hezaveh et al. 2021 — but "the least used category of practices is Clean-up practices"), and an explicit definition of done that names removal (Google ch. 22: "Different LSCs have different definitions of 'done'"; LaunchDarkly: "A feature is done when the flag is archived"). The mechanism behind the gap now has a behavioural-science basis: humans "systematically default to searching for additive transformations" (Adams et al., Nature 2021), LLMs show the same bias more strongly (GPT-4o 96.2% additive vs humans 54.2%; Uhler et al. 2026), and in code editing LLMs leave 28–35% of required deletions in place and in 29% of passing patches keep the dead logic alive behind a new guard ("Guard-and-Go"; Ebrahimi et al. 2026) — a direct, measured instance of "adding a path without retiring the old one".

---

## 1. Migration patterns, feature toggles, and removal evidence

### 1.1 Fowler, M. "StranglerApplication" (original bliki post), 29 June 2004 `[primary text read]`
- URL: https://martinfowler.com/bliki/OriginalStranglerFigApplication.html (the page is marked superseded; the 2024 rewrite sits at the old URL).
- Type: practitioner essay / opinion.
- Argued: a rewrite should "gradually create a new system around the edges of the old", letting it grow over several years "until the old system is strangled"; the metaphor is the fig "strangling and killing the tree that was their host". Claims lower risk than cut-over rewrites because value is delivered steadily; doubts the common assumption that it costs more; suggests designing new systems so that they can be strangled later; says the approach "isn't tried enough". ~300 words, no cases, no data.
- Does NOT show: anything about whether stranglers finish; no evidence base.
- Relevance: (a) the pattern's *definition of success* is the death of the host — retirement is intrinsic to the metaphor; (c) the earliest statement that "done" = old system gone.

### 1.2 Fowler, M. "Strangler Fig", 22 August 2024 (full rewrite) and "Rewriting Strangler Fig" note (same date) `[primary text read]`
- URLs: https://martinfowler.com/bliki/StranglerFigApplication.html ; https://www.martinfowler.com/articles/2024-strangler-fig-rewrite.html
- Type: practitioner essay.
- Argued: cut-over replacement "simple-sounding plan go[es] down in flames most of the time"; "Replacing a serious IT system takes a long time, and the users can't wait for new features"; much legacy behaviour "isn't really wanted, so building it is a waste". Introduces the need for "transitional architecture to allow the new and legacy system to coexist, code that will go away once the modernization is complete" and notes people "balk" at paying for it. Rewritten because the metaphor "grew a life of its own" and the page should now cover "the core activities we need to do to make a success of such a venture".
- Does NOT show: failure modes where the strangler never finishes; no numbers.
- Quote: "its original host tree may die leaving the fig as an echo of its shape."
- Relevance: (a) names transitional code as *scaffolding that must be removed* — a retirement obligation inside the pattern; (b) practices: thin slices, transitional architecture, continuous delivery.

### 1.3 Hammant, P. "Branch by Abstraction", 26 April 2007 `[primary text read]`
- URL: https://paulhammant.com/blog/branch_by_abstraction.html
- Type: practitioner blog (origin of the term).
- Argued (seven steps; final three verbatim): "5. Deprecate the first implementation (or skip to 6 if you don't want a respectful grace period)." "6. Delete the first implementation (its proven there is no need for you to go back)." "7. Remove the abstraction (if it is inelegant)." Context: trunk-based development vs long-lived branches ("Those branches just end up running and running…").
- Does NOT show: evidence; no warning about step 6 being skipped.
- Relevance: (a)/(c) the pattern *is* a retirement protocol — deletion of the old implementation and (optionally) the scaffolding are enumerated steps.

### 1.4 Fowler, M. "Branch By Abstraction", 7 January 2014 `[primary text read]`
- URL: https://martinfowler.com/bliki/BranchByAbstraction.html
- Type: practitioner essay.
- Argued: create an abstraction, migrate clients, build the new supplier, "gradually swap out the flawed supplier until all the client code uses the new supplier." "Once the flawed supplier isn't needed, we can delete it." "We may also choose to delete the abstraction layer once we no longer need it for migration." Credits Hammant as the primary source.
- Does NOT show: evidence; no discussion of abstractions left behind.
- Relevance: (c) explicitly separates "migration complete" (all clients moved) from "cleanup complete" (old supplier and abstraction deleted) — useful vocabulary for a two-stage definition of done.

### 1.5 Sato, D. "ParallelChange", 13 May 2014 `[primary text read]`
- URL: https://martinfowler.com/bliki/ParallelChange.html
- Type: practitioner essay.
- Argued: expand ("augment the interface to support both the old and the new versions"), migrate ("update all clients using the old version to the new version"), contract ("Once all usages have been migrated to the new version, you perform the contract phase to remove the old version"). Recommends deprecation notes/TODOs to mark which version is being replaced.
- Does NOT show: evidence of how often contract is skipped.
- Quote (load-bearing): "If the contract phase is not executed you might end up in a worse state than you started."
- Relevance: (a) the only canonical pattern text that states outright that an unfinished migration is *worse than none* — two live paths are a regression in coherence; (c) contract = the retirement step.

### 1.6 Hodgson, P. "Feature Toggles (aka Feature Flags)", martinfowler.com, first published 19 Jan/8 Feb 2016, revised 9 Oct 2017 `[primary text read]`
- URL: https://martinfowler.com/articles/feature-toggles.html
- Type: practitioner article.
- Argued: four toggle categories with different longevity — release toggles "should generally not stick around much longer than a week or two"; experiment toggles live until significance; ops toggles mostly short-lived except long-lived kill switches; permissioning toggles can last years. Toggles "come with a carrying cost"; "Savvy teams view their Feature Toggles as inventory" and keep it low. Removal practices listed: add "a toggle removal task onto the team's backlog" when the toggle is created; "expiration dates"; "time bombs" that fail a test or stop the app when a flag outlives its expiry; a Lean cap on the number of toggles (adding one requires removing one). The article does not use the phrases "technical debt" or "toggle debt".
- Does NOT show: measurement of whether these practices are used or work (see 1.8 for that).
- Relevance: (b) the canonical list of retirement-forcing mechanisms (removal task at creation, expiry, time bomb, WIP limit); (c) a toggle's lifecycle definition of done = removed.

### 1.7 Rahman, M. T., Querel, L.-P., Rigby, P. C., Adams, B. "Feature Toggles: Practitioner Practices and a Case Study." MSR 2016, pp. 201–211. DOI 10.1145/2901739.2901745 `[primary text read]`
- PDF: https://users.encs.concordia.ca/~pcr/paper/Rahman2016MSR.pdf
- Type: peer-reviewed (MSR).
- Measured: toggle usage across 39 releases of Google Chrome (releases 5–43, 2010–2015); mined a Google developers' toggle-maintenance spreadsheet; thematic analysis of practitioner talks/blogs; member-checked with four Google developers. Numbers: toggles grew from 263 (release 5) to 1,040 (release 42); 2,409 distinct toggles over the period, "70% of which were removed at some point"; median per release 73 added, 43 removed (net +30); "On average 72% of the toggles survive 5 or more releases"; 12 releases (~1.5 years) before fewer than 50% survive; 73% of development toggles and 77% of long-term business toggles survive ≥10 releases vs 53% of release toggles — i.e. even the type that is supposed to be temporary mostly outlives 10 releases. Maintenance campaign: 160 release toggles active; 84 marked "To remove" and 11 "Removed", but "only 51 (20% of all release toggles) had actually been removed, while 44 (17%) still lingered in the source code as technical debt. Interestingly, 2 of the 11 toggles marked 'Removed' were not actually removed yet." 97% of toggle flips happen during development, 3% after stabilisation.
- Does NOT show: causes beyond developer statements; single project (Chrome) for the quantitative part; no cost measurement of lingering toggles.
- Quote: "Since, in theory, release toggles should be removed after the feature has been stabilized, their lingering existence is worrisome technical debt."
- Relevance: (a) direct measurement of a retirement step not being executed, including *false completion labels* (2/11 "Removed" still present); (b) a deliberate cleanup campaign reached only 20% removal; (c) authors classify unused-but-present release toggles as technical debt — a retirement-inclusive notion of done.

### 1.8 Mahdavi-Hezaveh, R., Dremann, J., Williams, L. "Software development with feature toggles: practices used by practitioners." Empirical Software Engineering 26(1), 2021. DOI 10.1007/s10664-020-09901-z (arXiv 1907.06157) `[primary text read, arXiv version]`
- URL: https://arxiv.org/abs/1907.06157
- Type: peer-reviewed (EMSE; journal-first at ESEC/FSE 2021).
- Measured: grey-literature review (99 artifacts + 10 papers per the journal abstract; the body analyses 69 company-specific artifacts from 38 companies) and a survey (sent to 45 companies, 20 responses = 44%). 17 practices in four categories: Management, Initialization, Implementation, Clean-up. Clean-up practices and adoption (artifacts / survey): C1 add expiration date 16% / 70% (time bombs 0% / 5%, reminders 3% / 20%, cards/tasks 13% / 45%); C2 track unused toggles 2% / 45%; C3 limit number of toggles 0% / 50%; C4 cleanup branch 0% / 20%; C5 convert toggle to configuration setting 0% / 10%. Category mean: 3% (artifacts) vs 39% (survey).
- Does NOT show: whether the practices reduce stale-toggle counts; survey n is small and self-selected.
- Quote: "The least used category of practices is Clean-up practices."
- Relevance: (b) the retirement mechanisms exist and are known but are the least adopted category — the gap is adoption, not invention; the paper also ties toggle non-removal to Knight Capital.

### 1.9 Ramanathan, M. K., Clapp, L., Barik, R., Sridharan, M. "Piranha: Reducing Feature Flag Debt at Uber." ICSE-SEIP 2020. DOI 10.1145/3377813.3381350 `[primary text read]`; plus Uber Engineering blog, 17 Mar 2020 `[primary text read]`
- PDF: https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf ; blog: https://www.uber.com/blog/piranha/
- Type: peer-reviewed industry report + engineering blog.
- Measured (Dec 2017–May 2019, Uber Android/iOS apps in Objective-C, Java, Swift): a tool that rewrites `isTreated(flag)` to a constant, simplifies, deletes dead branches/tests, and a weekly pipeline that queries the flag system for flags "unmodified… for more than a specific period (e.g., 8 weeks)", generates a diff, assigns it to the flag's author, and a reminder bot (PiranhaTidy). Results: diffs for 1,381 flags "(17% of total flags)"; "65% of the diffs landed without any changes"; ">85% of the generated diffs compile and pass tests"; "~80% of the diffs affect more than one file"; "developers process more than 88% of the generated diffs" (land or deliberately abandon); "75% of the generated diffs are processed within a week"; ~200 developers; 71 KLoC deleted; 6,601 flags remain; codebase reduced ≈1% (0.92% of 7.7 MLoC); per language: Objective-C 782 flags removed (38.2% of its flags; 93.73% needed no manual edits), Java 284 (10.2%), Swift 315 (10.0%); automation deleted 20,239 lines, humans a further 50,757 (71.5% manual overall, dominated by Java/Swift where cleanup is less "deep"); reminders: "adding reminders to diffs usually results in landing 86% of the diffs within five days of the last reminder". Stated causes of flag debt: "lack of developer incentives to cleanup source code related to stale flags"; "a key problem with flag cleanup is the lack of prioritization". Blog: "around two thousand stale feature flags" removed; "developers do not always perform this simple post-cleanup process, leaving in code related to obsolete flags, causing accumulation of technical debt."
- Does NOT show: how long flags had been stale before deletion (not reported); flag lifetimes; effect on defects or comprehension. The paper cites the Knight Capital loss as "465M USD in 30 minutes", which does not match the SEC order ($460M, ~45 minutes) — cite the SEC order (1.14).
- Relevance: (a) retirement happens at scale only when the deletion is *generated for* the owner and *chased*; even then the "stale" inventory was 17% of flags and the LoC effect ~1%; (b) the practices with evidence: ownership routing, automation, reminders, treating "not stale yet → abandon" as an explicit decision.

### 1.10 Tërnava, X. "Feature Toggle Dynamics in Large-Scale Systems: Prevalence, Growth, Lifespan, and Benchmarking." arXiv 2604.15872, 17 April 2026 `[abstract read]`
- URL: https://arxiv.org/abs/2604.15872
- Type: preprint (not peer-reviewed as of this writing).
- Measured: ">4,000 toggle events in Kubernetes (10 MLoC, 8.5 years) and GitLab (5 MLoC, 5 years)". "feature toggle removals lags behind additions in both systems (by roughly 35% and 13%, respectively)"; median lifespan "734 days versus 185 in GitLab"; "some feature toggles (1.33% and 0.73%, respectively) exceed all previously observed removal durations" and are de facto permanent. Proposes a 5-metric benchmarking framework.
- Does NOT show: causes; whether lingering toggles are harmful; it is a two-system study.
- Relevance: (a) longitudinal open-source confirmation that toggle inventories grow because removal trails addition — the add-without-retire dynamic measured over years.

### 1.11 Hoyos, J., Abdalkareem, R., Mujahid, S., Shihab, E., Espinosa Bedoya, A. "On the removal of feature toggles." Empirical Software Engineering 26, art. 15 (2021) `[secondhand; citation from memory — DOI 10.1007/s10664-020-09902-y unconfirmed; primary blocked by bot protection]`
- Secondhand sources: arXiv 2212.00505 (describes "12 Python projects" and "61 practitioners") and GrowthBook 2026 guide ("77% of developers say they intend to remove toggles once a system stabilizes"; audits found "75% of toggle components remained for up to 49 weeks after introduction"). The two secondhand paraphrases disagree on what the 49-week/75% figure means (removed-within vs still-present-up-to). Do not cite numbers without reading the paper.
- Relevance: (a) if confirmed, the intention–behaviour gap on toggle removal (intend 77%, mostly not done) is the cleanest survey+repository pairing on retirement.

### 1.12 Winters, T., Manshreck, T., Wright, H. (eds.) *Software Engineering at Google*, O'Reilly 2020 — Ch. 15 "Deprecation" (Hyrum Wright) `[primary text read]`
- URL: https://abseil.io/resources/swe-book/html/ch15.html
- Type: book (industry experience).
- Argued: "All systems age." "code is a liability, not an asset" — functionality is the asset; removing unneeded code is one of the easiest ways to raise functionality per unit of code. Two systems doing one job: "The old system will continue to require maintenance and other resources" and the new one must stay compatible with it. Why deprecation is hard: Hyrum's Law, emotional attachment, replacements never 1:1, costs of inaction invisible so hard to fund. Advisory deprecation "often lacks enforcement"; compulsory deprecation has a deadline and is "actively staffed by a specialized team through completion"; "Hope is not a strategy." Ownership: "without explicit owners, a deprecation process is unlikely to make meaningful progress". Milestones: "Deprecation project managers should resist the temptation to make this the only measurable milestone" (full removal) — celebrate deleting subcomponents. Tooling: discovery (code search, static analysis), migration (LSC tooling), and backsliding prevention — "Without backsliding prevention, deprecation can become a game of whack-a-mole." Mentions 20% time for important-but-not-urgent cleanup. "Unfortunately, software systems are rarely so thoughtfully designed" for deprecation.
- Does NOT show: numbers on deprecation success rates; it is experience, not measurement.
- Relevance: (b) the most complete practitioner statement of what makes retirement happen: owner, deadline, staffing to completion, backsliding prevention, intermediate milestones; (c) "code is a liability" is the economic basis for a retirement-inclusive definition of done.

### 1.13 Same book — Ch. 22 "Large-Scale Changes" (Hyrum Wright) `[primary text read]`
- URL: https://abseil.io/resources/swe-book/html/ch22.html
- Argued/reported: an LSC is "any set of changes that are logically related but cannot practically be submitted as a single atomic unit"; "the infrastructure teams that build and manage our systems are responsible for much of the work of performing LSCs" (centralised, not pushed to each consumer — "nobody likes unfunded mandates"); LSCs are "10% to 20%" of changes in a project; `scoped_ptr` migration "more than 700 independent changes, touching more than 15,000 files per day"; Rosie submits "thousands of changes per day"; the largest LSC series removed "more than one billion lines of code over three days" (footnote); rule of thumb: >500 edits → tooling. Completion: "Different LSCs have different definitions of 'done.'" — some remove the old system entirely, others migrate high-value references and let the rest age out; in almost all cases a mechanism (Tricorder warnings at review time) prevents *new* uses of the deprecated symbol; `scoped_ptr` was first aliased to `std::unique_ptr`, then substituted, then the alias deleted.
- Does NOT show: how many LSCs reach full removal.
- Relevance: (a)/(c) explicit acknowledgement that "done" must be *defined per migration* and that full removal is one of several legitimate end states; (b) backsliding prevention + centralised ownership + tooling that makes the human cost sublinear in codebase size.

### 1.14 Wright, H. "Hyrum's Law" (hyrumslaw.com; named by Titus Winters) `[primary text read]`
- URL: https://www.hyrumslaw.com/
- Type: practitioner aphorism/essay.
- Statement: "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody."
- Relevance: (a) the main *technical* reason old paths cannot be retired — unknown dependents; explains why retirement needs discovery tooling and compulsory deadlines (1.12).

### 1.15 U.S. SEC, *In the Matter of Knight Capital Americas LLC*, Release No. 34-70694, 16 Oct 2013 `[primary text read, PDF]`
- URL: https://www.sec.gov/litigation/admin/2013/34-70694.pdf
- Type: regulatory order (findings of fact; Knight consented without admitting or denying).
- Facts (paragraph numbers): ¶13 "the new RLP code in SMARS was intended to replace unused code… previously… used for functionality called 'Power Peg,' which Knight had discontinued using many years earlier. Despite the lack of use, the Power Peg functionality remained present and callable… The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code." ¶14 Knight ceased using Power Peg in 2003; in 2005 moved its cumulative-quantity check elsewhere and "did not retest the Power Peg code". ¶15 deployment to seven of eight servers; no second-technician review; "no one at Knight realized that the Power Peg code had not been removed from the eighth server". ¶16–17: the eighth server ran the defective Power Peg path; 212 parent orders → "4 million executions in 154 stocks for more than 397 million shares in approximately 45 minutes"; ~$3.5bn net long, ~$3.15bn net short; "a $460 million loss". ¶41: "in 2003, Knight elected to leave the Power Peg code on SMARS's production servers".
- Does NOT show: software-engineering process detail beyond deployment procedures; it is not a technical post-mortem.
- Relevance: (a) canonical consequence of a retired feature whose code and flag were not removed; the order attributes the failure chain partly to the 2003 decision to leave dead code in production.

---

## 2. Lava flow and dead-code studies

### 2.1 Brown, W. J., Malveau, R. C., McCormick, H. W. III, Mowbray, T. J. *AntiPatterns: Refactoring Software, Architectures, and Projects in Crisis*. Wiley, 1998 (ISBN 978-0-471-19713-3) — "Lava Flow"; text read via the authors' condensed Dr. Dobb's Journal article, June 1998 `[primary text read: DDJ condensation; book itself not read]`
- URL (DDJ reproduction): https://jacobfilipp.com/DrDobbs/articles/DDJ/1998/9806/9806d/9806d.htm
- Type: book / practitioner catalogue.
- Argued: Lava Flow is "the lava-like 'flows' of previous developmental versions strewn about the code landscape" that have "hardened into a basalt-like, immovable, generally useless mass of code that no one can remember much (if anything) about." Symptoms include "Unused (dead) code", "Whole blocks of commented-out code with no explanation or documentation", "Lots of 'in flux' or 'to be replaced' code areas". Causes: "R&D code placed into production without thought toward configuration management", lack of configuration management. Cure: system discovery to find what is really used, then delete what can be safely deleted; stable documented interfaces.
- Does NOT show: measurement; anecdotal.
- Relevance: (a) the 1998 name for the exact phenomenon the paper studies — "to be replaced" areas that never get replaced; (c) the stated remedy is explicit discovery-then-deletion.

### 2.2 Eder, S., Junker, M., Jürgens, E., Hauptmann, B., Vaas, R., Prommer, K.-H. "How Much Does Unused Code Matter for Maintenance?" ICSE 2012 (SEIP) `[primary text read]` (note: the author list the task gave — "Hummel, Deissenboeck" — is wrong for this paper)
- PDF: https://wwwbroy.in.tum.de/publ/papers/ICSE12Hauptmann.pdf
- Type: peer-reviewed industry case study.
- Measured: a Munich Re business information system (C#/.NET, 8 years old, 360 kLOC at start) instrumented in production for >2 years (19 program versions). 25% of method genealogies were never executed in the whole period ("25% of the implemented code has never been executed"). 40.7% of used method genealogies were modified vs 8.3% of unused ones; modifications to unused methods = 7.6% of all modifications (6,028 modified methods, 9,987 modifications in total). Developer inspection of 27 unused-but-modified cases: 9 (33%) unnecessary, 4 (15%) code no longer existed → ~48% of maintenance in unused code judged unnecessary → ~3.6% of all maintenance effort wasted on code nobody runs.
- Does NOT show: generalisation beyond one system; comprehension cost of unused code (only edit effort).
- Relevance: (a) quantifies the carrying cost of un-retired code: a quarter of the code is dead and still attracts edits; (b) argues for usage data surfaced to maintainers before they touch code.

### 2.3 Romano, S., Vendome, C., Scanniello, G., Poshyvanyk, D. "A Multi-Study Investigation into Dead Code." IEEE TSE 46(1):71–99, 2020. DOI 10.1109/TSE.2018.2842781 `[abstract/metadata only; full text hosts returned 503]`; companion: "Are unreachable methods harmful? Results from a controlled experiment." ICPC 2016, DOI 10.1109/ICPC.2016.7503723 `[secondhand]`
- Type: peer-reviewed.
- Measured: semi-structured interviews with practitioners plus four controlled experiments (Univ. of Basilicata, William & Mary) on why dead code is introduced, how developers perceive/handle it, and whether it is harmful. The abstract reports no numbers; it concludes dead code "is harmful" in maintenance and evolution and that "developers should avoid this smell". The ICPC 2016 experiment (47 undergraduates, per a secondhand summary) reportedly found a significant comprehension advantage without unreachable methods and no significant modifiability difference — unverified here.
- Does NOT show (as far as I could read): effect sizes; industrial prevalence beyond interviewees.
- Relevance: (b) the only controlled-experiment line on dead code's comprehension cost; cite cautiously until the full text is checked.

---

## 3. Do migrations and deprecations finish? Empirical evidence

### 3.1 Robbes, R., Lungu, M., Röthlisberger, D. "How Do Developers React to API Deprecation? The Case of a Smalltalk Ecosystem." FSE 2012, art. 56. DOI 10.1145/2393596.2393662 `[primary text read]`
- PDF: https://pure.rug.nl/ws/files/224311707/How_Do_Developers_React_to_API_Deprecation._The_Case_of_a_Smalltalk_Ecosystem.pdf
- Type: peer-reviewed.
- Measured: Squeak/Pharo ecosystem, "seven years of evolution, more than 3,000 contributors, and more than 2,600 distinct systems"; 577 deprecated methods and 186 deprecated classes analysed. 80 methods (14%) and 13 classes (7%) produced non-trivial ripple effects; 113 confirmed ripple effects. Median ripple effect: 5 reacting projects (mean 9.2), 12 individual changes; largest: ~80 developers / ~120 projects. Reaction time: first quartile 0 days, median two weeks, third quartile 84 days, 90th percentile 243 days. Reaction ratio: "a surprisingly low number of projects react, with the median at 20% (1st quartile: 13%; 3rd quartile: 31%)" of affected projects; 40% when dead/stagnant projects are excluded; 66% when projects that *counter-react* (keep using the deprecated entity) are also excluded. Deprecation messages: in "45 out of 94 cases (47.87%)" the recommendation was unclear or not followed.
- Does NOT show: Java/static-language behaviour (addressed by 3.2); only immediate, not transitive, propagation.
- Quote: "In some cases, adaptations are not done for entire project at once; parts of it remain in an inconsistent state for long periods of time."
- Relevance: (a) direct evidence that client-side migrations are partial and slow — within a single project, old and new usages coexist for months; (b) suggests that the replacement a majority of migrators chose is a better guide than the deprecation message.

### 3.2 Sawant, A. A., Robbes, R., Bacchelli, A. "On the reaction to deprecation of clients of 4 + 1 popular Java APIs and the JDK." Empirical Software Engineering 23(4):2158–2197, 2018. DOI 10.1007/s10664-017-9554-9 (conference version: "On the Reaction to Deprecation of 25,357 Clients of 4+1 Popular Java APIs", ICSME 2016, DOI 10.1109/ICSME.2016.64) `[primary text read]`
- PDF: https://d-nb.info/1148190511/34
- Type: peer-reviewed (open access).
- Measured: >25,000 GitHub clients of Easymock, Guava, Guice, Hibernate, Spring, plus 60 Maven Central clients of the JDK (from 56,410 projects). Clients ever affected by deprecation: ">20% for Easymock and Guava to less than 10% for Hibernate and almost 0% for Spring"; of those, "less than one third also change their API version". Among affected clients that do upgrade: 71% (Easymock) and 65% (Guava) react; 31% (Hibernate), 32% (Spring); clients that fix *all* calls: 16–22%. Dominant reaction is deletion of the call rather than replacement ("median of 50% to 67% for Easymock, Guava and Hibernate and 100% for Spring"). "a vast majority of projects (95 to 100%) add calls to deprecated API elements, despite the deprecation being already in place."
- Does NOT show: why; commit messages rarely mention deprecation, so motives are inferred.
- Quote: "Our results confirm that only a small fraction of clients react to deprecation."
- Relevance: (a) in a statically typed ecosystem with IDE warnings, deprecation still does not drive migration; worse, new uses of the old path keep being added — the "backsliding" Google ch. 22 says must be mechanically prevented; (c) "advisory" deprecation is not a completion mechanism.

### 3.3 Hora, A., Robbes, R., Valente, M. T., Anquetil, N., Etien, A., Ducasse, S. "How do developers react to API evolution? A large-scale empirical study." Software Quality Journal 26:161–191, 2018. DOI 10.1007/s11219-016-9344-4 (conference version ICSME 2015) `[abstract/metadata only; PDF hosts bot-blocked]`
- Scope verified: Pharo, "about 3600 distinct systems, and 6 years of evolution", 118 API changes (method replacement/suggestion), questions on "magnitude, duration, extension, and consistency". Result numbers not verified in this session — do not cite figures from memory.
- Relevance: (a) complements 3.1 with non-deprecation API changes; same ecosystem.

### 3.4 Kula, R. G., German, D. M., Ouni, A., Ishio, T., Inoue, K. "Do developers update their library dependencies? An empirical study on the impact of security advisories on library migration." Empirical Software Engineering 23(1):384–417, 2018 (online 2017). DOI 10.1007/s10664-017-9521-5 (arXiv 1709.04621) `[abstract read]`
- URL: https://arxiv.org/abs/1709.04621
- Type: peer-reviewed.
- Measured: "over 4,600 GitHub software projects and 2,700 library dependencies" (Java/Maven); "81.5% of the studied systems still keep their outdated dependencies"; vulnerable dependencies rarely trigger updates; survey: 69% of interviewees did not know they used vulnerable dependencies; updates seen as "extra effort and responsibility".
- Does NOT show: that the 81.5% is *caused* by unawareness (separate findings); not about internal code paths.
- Relevance: (a) baseline rate of non-migration for the easiest kind of migration (bump a version): about four in five stay put.

### 3.5 He, H., He, R., Gu, H., Zhou, M. "A Large-Scale Empirical Study on Java Library Migrations: Prevalence, Trends, and Rationales." ESEC/FSE 2021, pp. 478–490. DOI 10.1145/3468264.3468571 `[primary text read: abstract + body skimmed]`
- PDF: https://hehao98.github.io/files/2021-migration-empirical.pdf
- Type: peer-reviewed (open access).
- Measured: 19,652 Java GitHub projects; "1,194 migration rules, 3,163 migration commits"; "8,065 (41.04%) projects having at least one library removal, 1,564 (7.96%, lower-bound) to 5,004 (25.46%, upper-bound) projects have at least one migration"; median migrating project has 2–4 migrations; migrations concentrate in logging/JSON/testing/web-service libraries; "migrations are highly unidirectional"; 14 reasons (lack of maintenance, usability, integration…).
- Does NOT show: whether a migration, once started, is completed (migration is operationalised at commit level, not as end-to-end removal of the old library from all call sites).
- Relevance: (a) library-to-library migration is rare (≤25% of projects ever) and reason-driven; the dataset does not settle completion rates — a gap for the paper to name.

### 3.6 Teyton, C., Falleri, J.-R., Palyart, M., Blanc, X. "A Study of Library Migrations in Java." Journal of Software: Evolution and Process 26(11), 2014 (arXiv 1306.6262) `[abstract read; journal DOI from memory: 10.1002/smr.1660]`
- URL: https://arxiv.org/abs/1306.6262
- Type: peer-reviewed.
- Finding (abstract, qualitative): "The main result of our study is that library migration is not a frequent practice" and depends on the nature of software and libraries. No numbers in the abstract.
- Relevance: (a) earliest large-scale statement that migrations are rare events.

### 3.7 Ayas, H. M., Leitner, P., Hebig, R. "An empirical study of the systemic and technical migration towards microservices." Empirical Software Engineering 28(4):85, 2023. DOI 10.1007/s10664-023-10308-9 `[primary text read via PMC]`
- URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC10201508/
- Type: peer-reviewed (interview study; ≥18 interviewees across organisations — exact counts are in sections I did not fully read).
- Findings: migration is "more of an on-going and re-occurring project rather than a one-off execution of steps" and "a continuous endeavour" done in "migration sprints" with pauses; "many organizations will consider a migration completed" while parts remain in the old form; service cuts "can result in a hybrid architecture with a small monolith within the MSA"; engineers deliberately leave "functionality that is already working properly and for which there is no real benefit from migrating"; a "shell API" around the legacy system (strangler-style) is described.
- Does NOT show: durations; proportion of migrations that retire the monolith.
- Relevance: (a) qualitative confirmation that organisations *redefine* done to exclude the long tail; hybrid states are the normal end state, which is coherent only if the hybrid is deliberate and bounded.

### 3.8 Larson, W. "Migrations: the sole scalable fix to tech debt." lethain.com, 15 April 2018 `[primary text read]`
- URL: https://lethain.com/migrations/
- Type: practitioner essay (Uber/Stripe experience).
- Argued: "Migrations are the only mechanism to effectively manage technical debt as your company and code grow." Playbook: derisk, enable, finish. Finish: "The last phase of a migration is deprecating the legacy system you've replaced"; requires "getting to 100% adoption"; first "stopping the bleeding" — "ensuring that all newly written code uses the new approach"; migrate "the easy ninety-percent" programmatically; then the long tail of "weird or unstaffed" systems — "finish it yourself". Spending "an extra two days" on tooling/docs "can save years in large migrations".
- Does NOT show: data; the "80–90% stall" figure often attributed to this essay is not in it.
- Relevance: (b)/(c) practitioner codification that a migration is finished only at legacy deprecation, with the owning team responsible for the long tail; "stop the bleeding" = backsliding prevention.

### 3.9 Mironov, R. "When Will We Finish This Migration So R&D Teams Can Work On Innovation?" mironov.com, 14 Nov 2024 `[primary text read]`
- URL: https://www.mironov.com/migration-end/
- Type: practitioner/opinion (product management).
- Argued: organisations "confuse delivering a new (or re-architected) platform and pushing the very last customer off the old version"; "When the very first customer migrates… we celebrate… and declare done-done." Re-platforming efforts "tend to be 9-month R&D efforts that actually take 2.5 years"; illustrative segmentation: 15% migrate quickly, 30% need help, 10% "will never migrate"; illustrative carrying cost "$2M/year" for two teams on the old version. Recommends tracking percentage of accounts (not revenue-weighted), and "a fixed, final end-of-support date" with "no exceptions, no extensions, no special side deals" — otherwise plan to sustain the old system indefinitely.
- Does NOT show: data (numbers are illustrative).
- Relevance: (c) a 2024 practitioner argument that "done" must be defined as *old version shut down*, with a compulsory deadline — the same prescription as Google ch. 15.

### 3.10 Xu, J. "Online migrations at scale." Stripe Engineering blog, 2 Feb 2017 `[primary text read]`
- URL: https://stripe.com/blog/online-migrations
- Type: engineering blog.
- Argued: four-phase dual-write pattern — "Dual writing to the existing and new tables", "Changing all read paths… to read from the new table", "Changing all write paths… to only write to the new table", "Removing old data that relies on the outdated data model"; "Our final (and most satisfying) step is to remove code that writes to the old store and eventually delete it." Subscriptions table "hundreds of millions of objects"; no completion metrics given.
- Relevance: (a)/(c) a widely copied expand/contract instance whose last step is explicit deletion of the old write path and model.

### 3.11 Chandrasekaran, P. "Embracing the strangler fig pattern for legacy modernization, part one." Thoughtworks Insights, 25 Oct 2023 `[primary text read]`
- URL: https://www.thoughtworks.com/en-us/insights/articles/embracing-strangler-fig-pattern-legacy-modernization-part-one
- Type: practitioner article (consultancy case: grocery retailer coupon system with four RPC endpoints).
- Argued: risks — "the process stalls before the legacy system achieves complete replacement" leaving an incomplete migration; extended transition "could lead to prolonged costs"; managing "two systems simultaneously"; data may need to be kept current in both. End state: "After replacing all the components of the old system, the entire system is ready for decommissioning."
- Does NOT show: numbers.
- Relevance: (a) names stalling as the pattern's primary failure mode; (c) decommissioning as the terminal step.

### 3.12 Microsoft Azure Architecture Center, "Strangler Fig Pattern" (Khan & Khan), page dated 2026-05-29 `[primary text read]`
- URL: https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig
- Type: vendor architecture guidance.
- Argued: step 3 "After you migrate all of the functionality and there are no dependencies on the legacy system, you can decommission the legacy system"; step 4 "You remove the façade and reconfigure the client app… This step marks the completion of the migration." "Conceptualize this as transitional architecture, and balance this architecture's risk mitigation benefits against its temporary infrastructural costs." Database example: "Treat the removal of legacy objects as a deliberate final step for each domain. Remove legacy objects only after the new system is validated." Not suitable when "You need to fully decommission the original solution quickly."
- Relevance: (c) mainstream guidance now states completion = façade removed and legacy decommissioned, per domain.

### 3.13 Nikolov, S., Codecasa, D., Sjövall, A., Tabachnyk, M., Chandra, S., Taneja, S., Ziftci, C. "How is Google using AI for internal code migrations?" arXiv 2501.06972, 12 Jan 2025 `[primary text read]`; and Ziftci, C., Nikolov, S., Sjövall, A., Kim, B., Codecasa, D., Kim, M. "Migrating Code At Scale With LLMs At Google." arXiv 2504.09691, 13 Apr 2025 (accepted FSE 2025) `[primary text read]` — *overlap with the AI-code slice; included for completion evidence*
- Type: industry experience reports (one peer-reviewed at FSE 2025).
- Measured: JUnit3→JUnit4: "5,359 files modifying more than 149,000 lines of code in 3 months"; "~87% of the code generated by AI ended up committed without any change"; "The bottleneck in the process was the speed at which engineers could review the changes" (generation was throttled weekly). Joda→java.time: ~89% time saved in small clusters (lead estimates). int32→int64 IDs (Ads): 39 ID migrations, 3 developers, 12 months, 595 changes; 74.45% of changes LLM-generated; estimated 50% time reduction vs a prior manual ID migration that "took about two years"; the system "runs nightly until no locations remain". Historical framing: "some migrations that couldn't be fully automated tend to take quarters, even years"; LLMs helped "complete complex migrations that were stalled for several years". Experimental-flag cleanup is treated as removing "dead code and technical debt".
- Does NOT show: controlled comparison; time savings are estimates; neither paper discusses deleting the old system as a final step.
- Relevance: (a) first-hand that migrations at Google historically stall for years and that the binding constraint on finishing is *review bandwidth*, not edit generation; (b) nightly "migrate remaining locations until zero" is a mechanical completion loop.

### 3.14 Islam, M. M., Jha, A. K., Mahmoud, M., Akhmetov, I., Nadi, S. "An Empirical Study of Python Library Migration Using Large Language Models." arXiv 2504.13272 (v2 Oct 2025) `[abstract read]`; Almeida, A., Xavier, L., Valente, M. T. "Using Copilot Agent Mode to Automate Library Migration: A Quantitative Assessment." arXiv 2510.26699, 30 Oct 2025 `[primary text read]` — *overlap with the AI-code slice*
- Type: preprints.
- Measured: PyMigBench — 321 real migrations, 2,989 migration-related changes; Llama 3.1 / GPT-4o mini / GPT-4o "correctly migrate 89%, 89%, and 94% of the migration-related code changes" but only "36%, 52% and 64%" of whole migrations pass the developers' tests. Copilot Agent Mode (GPT-4o) on 10 SQLAlchemy 1→2 repositories: migration coverage median 100% but pooled 45.48%; the largest repo (124 usages) reached 9.67% before the agent looped on a dependency conflict and was aborted; post-migration test pass rate median 39.75% (text and table swap the median/aggregate labels); three of five low-passing repos had ≥80% coverage.
- Does NOT show: human baselines on the same tasks; whether the agent removed old-API usages vs leaving both.
- Relevance: (a) per-edit success is high but *whole-migration* completion is much lower — the gap between "touched" and "done" is exactly where old paths survive.

### 3.15 Tanner, M. "Legacy Code Modernization: A Practical Guide for Engineering Teams." Sourcegraph blog, 14 May 2026 `[primary text read]`
- URL: https://sourcegraph.com/blog/legacy-code-modernization
- Type: vendor/practitioner guide.
- Argued: "The hard part of modernization is rarely writing the new code. It is being confident enough about the old code to remove it." Failure mode: "a stream of refactors that look productive but leave the old system just as load-bearing as before." Suggested progress metrics are *retirement* metrics: old API endpoint references "from 430 to 120", 70% of traffic on the new service, a legacy batch job disabled "for three of five regions".
- Does NOT show: data beyond cited third-party figures.
- Relevance: (c) 2026 practitioner framing that completion must be measured by what has been removed/de-loaded, not by what has been built.

---

## 4. Definitions of done, refactoring practice, and whether cleanup work gets done

### 4.1 Schwaber, K., Sutherland, J. *The 2020 Scrum Guide* — "Definition of Done" `[primary text read]`
- URL: https://scrumguides.org/scrum-guide.html
- Type: process standard.
- Text: "The Definition of Done is a formal description of the state of the Increment when it meets the quality measures required for the product." "If a Product Backlog item does not meet the Definition of Done, it cannot be released or even presented at the Sprint Review." "Work cannot be considered part of an Increment unless it meets the Definition of Done." Organisational standards are a minimum; multiple teams on one product "must mutually define and comply with the same Definition of Done."
- Does NOT say: anything about removing superseded functionality; DoD content is left to the organisation.
- Relevance: (c) the hook: DoD is explicitly extensible and binding, so "retire what this makes obsolete" can be a product-level DoD clause without changing the framework.

### 4.2 Beck, K. "for each desired change, make the change easy (warning: this may be hard), then make the easy change." Tweet, @KentBeck, status 250733358307500032 (ID decodes to 25 Sep 2012) `[wording from secondary sources; tweet not fetched]`; restated in Beck's *Tidy First?* newsletter, 30 Jan 2025 ("For each hard change…") and named MCETMEC (June 2024 post) `[primary text read: newsletter excerpts]`
- URLs: https://tidyfirst.substack.com/p/tidy-first-example ; https://newsletter.kentbeck.com/p/hinge
- Type: practitioner aphorism.
- Relevance: (b) the preparatory-refactoring discipline implies the change *includes* restructuring, i.e. the state of the code after the feature is part of the deliverable.

### 4.3 Fowler, M. "Opportunistic Refactoring", 1 Nov 2011 `[primary text read]`
- URL: https://martinfowler.com/bliki/OpportunisticRefactoring.html
- Type: practitioner essay.
- Argued: the "camp site rule" — "always leave the code behind in a better state than you found it"; preparatory refactoring ("You first refactor it to how it ought to be and then start adding your functionality"); "I prefer to encourage refactoring as an opportunistic activity"; "a team that's using refactoring well should hardly ever need to plan refactoring"; "If you don't spend time on taking your opportunities to refactor, then the code base gradually degrades."
- Does NOT show: evidence; explicitly experience-based.
- Relevance: (b) the case for cleanup-as-part-of-every-change rather than as backlog items (contrast 4.10–4.12 on what happens to backlog cleanup).

### 4.4 Martin, R. C. "The Boy Scout Rule." In Henney, K. (ed.) *97 Things Every Programmer Should Know*, O'Reilly 2010, ch. 8 `[abstract-level read via O'Reilly preview/search]`; also in *Clean Code* (2008) `[from memory]`
- URL: https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html
- Rule: "Always leave the campground cleaner than you found it." Applied to modules checked in better than checked out, to stop the steady decay of systems.
- Relevance: (b) same prescription as 4.3; no evidence offered.

### 4.5 Kim, M., Zimmermann, T., Nagappan, N. "A Field Study of Refactoring Challenges and Benefits." FSE 2012 `[primary text read]`; extended as "An Empirical Study of Refactoring Challenges and Benefits at Microsoft." IEEE TSE 40(7):633–649, 2014, DOI 10.1109/TSE.2014.2318734 `[abstract read]` (FSE DOI from memory: 10.1145/2393596.2393655)
- PDF (FSE): https://kelloggm.github.io/martinjkellogg.com/teaching/cs490-au24/assets/refactoring.pdf
- Type: peer-reviewed (survey + interviews + Windows version-history analysis).
- Measured: survey of 328 Microsoft engineers (83% developers) whose check-ins mentioned "refactor*": 78% define refactoring as transformation improving maintainability/readability/performance; "46% of developers did not mention preserving behavior" in their definition; refactoring is 86% manual on average, 51% do it 100% manually; perceived risks: "77% of the participants consider that refactoring comes with a risk of introducing subtle bugs and functionality regression; 12% say that code merging is hard after refactoring; and 24% mention increased testing cost"; perceived benefits: improved readability 43%, maintainability 30%, fewer bugs 27%, extensibility 27%, modularity 19%, duplicate reduction 18%, code-size reduction 12%. Windows 7 (a multi-year centralised refactoring team): "the top 25% of refactored binaries have 12 percent more reduction in post-release defects compared to all modified binaries" (Spearman 0.368, p<0.0001); the top 20% most-refactored binaries account for 41.6% of post-release defects vs 55.0% for the top 20% most-modified; TSE version: the top 5% preferentially refactored modules show "higher reduction in the number of inter-module dependencies and several complexity measures but increase size more than the bottom 95%."
- Does NOT show: causality (observational); the effort was a dedicated team, not opportunistic refactoring.
- Relevance: (b) best quantitative evidence that *organised* refactoring reduces coupling and defects — note it also *grew* module size, i.e. structure improved while code was added, not removed; (c) nearly half of practitioners' "refactorings" are not behaviour-preserving, so "refactor" tickets are not a reliable proxy for retirement work.

### 4.6 Murphy-Hill, E., Parnin, C., Black, A. P. "How We Refactor, and How We Know It." ICSE 2009 (DOI 10.1109/ICSE.2009.5070529) `[primary text read]`; extended in IEEE TSE 38(1):5–18, 2012, DOI 10.1109/TSE.2011.41 `[metadata only]`
- PDF (ICSE 2009): https://people.scs.carleton.ca/~jeanpier/Fall2021/Topic%204-%20About%20Smells%20and%20Refactoring/5-%20HowWeRefactor-icse09.pdf
- Type: peer-reviewed.
- Measured (four data sets: >13,000 developers, 240,000 tool-assisted refactorings, 2,500 developer-hours, 3,400 commits): "almost 90% of refactorings are performed manually"; "messages written by programmers in commit logs do not reliably indicate the presence of refactoring"; "programmers frequently floss refactor" — in Eclipse CVS, commits with "Some Refactoring" (floss) were 28% vs "Pure Refactoring" (root-canal) 15%, normalised to ~30% vs ~3% of all commits, and "98% of individual refactorings would occur as part of a Some Refactoring (floss) commit"; about half of refactorings are below the level high-level detectors see (they "will miss 40 to 60 percent of refactorings"). TSE version: tool support in 11% (Eclipse devs) / 9% (Mylyn devs) of refactorings.
- Does NOT show: whether floss refactoring includes deletion of superseded code; it measures structure changes, not retirement.
- Relevance: (b) cleanup in practice is interleaved and unlabelled, so "was the old path retired?" cannot be audited from commit messages or refactoring-detection tools alone — a methodological warning for the paper.

### 4.7 Bavota, G., De Carluccio, B., De Lucia, A., Di Penta, M., Oliveto, R., Strollo, O. "When Does a Refactoring Induce Bugs? An Empirical Study." SCAM 2012, pp. 104–113 (Best Paper) `[primary text read]` (DOI from memory: 10.1109/SCAM.2012.20)
- PDF: https://people.lu.usi.ch/bavotg/papers/scam2012.pdf
- Type: peer-reviewed (the task's "2015" date appears to conflate this with the authors' later JSS work).
- Measured: Apache Ant, Xerces, ArgoUML; 15,008 refactoring operations of 52 kinds detected with Ref-Finder and manually validated; SZZ to link to bug-fixes. "1,616 refactored classes out of the 10,969 identified (15%)" were likely bug-inducing; highest rates for hierarchy refactorings — Pull Up Method 40% overall (55% in ArgoUML), Extract Subclass 40%; also Inline Temp 26%, Replace Method with Method Object 25%, Extract Method 21%; Extract Interface 4%. A 2020 differentiated replication (Di Penta, Bavota, Zampetti, ESEC/FSE 2020, arXiv 2009.11685) found on manual inspection that in ~62% of cases the refactoring did not actually contribute to the bug `[secondhand]`.
- Does NOT show: that refactoring is net harmful (SZZ-based likelihoods).
- Relevance: (b) the real risk that makes teams avoid retirement work — removing/merging hierarchies is the riskiest refactoring class; argues for retirement being planned and tested, not opportunistic.

### 4.8 Silva, D., Tsantalis, N., Valente, M. T. "Why We Refactor? Confessions of GitHub Contributors." FSE 2016, pp. 858–870. DOI 10.1145/2950290.2950305 `[abstract read]`
- URL: https://arxiv.org/abs/1607.02459
- Type: peer-reviewed.
- Measured: monitored 124 Java GitHub projects (June–Aug 2015), detected refactorings with RefactoringMiner and e-mailed the authors (per the authors' talk: 465 e-mails, 195 replies ≈42% `[secondhand]`); thematic analysis → "a catalogue of 44 distinct motivations for 12 well-known refactoring types"; "refactoring activity is mainly driven by changes in the requirements and much less by code smells"; Extract Method serves 11 purposes; IDE affects tool adoption.
- Does NOT show: whether any motivation is "retire a superseded implementation" (the catalogue is on the companion site, not read here).
- Relevance: (b) refactoring is requirement-driven (preparatory), supporting Beck/Fowler; a retirement-motivated refactoring category is worth checking in the public catalogue.

### 4.9 Tsantalis, N., Mansouri, M., Eshkevari, L., Mazinanian, D., Dig, D. "Accurate and Efficient Refactoring Detection in Commit History." ICSE 2018, DOI 10.1145/3180155.3180206; Tsantalis, N., Ketkar, A., Dig, D. "RefactoringMiner 2.0." IEEE TSE 48(3):930–950, DOI 10.1109/TSE.2020.3007722 `[citation page read]`
- URL: https://github.com/tsantalis/RefactoringMiner
- Type: peer-reviewed tooling; currently 106 refactoring types (40 from Fowler, 53 API changes, 8 migrations, 5 test-specific).
- Relevance: (b) the standard instrument for mining whether removals (Inline, Remove Parameter, Remove Class…) occur; note its catalogue is structural, so "old path deleted" must be operationalised separately.

### 4.10 Kruchten, P., Nord, R. L., Ozkaya, I. "Technical Debt: From Metaphor to Theory and Practice." IEEE Software 29(6):18–21, Nov/Dec 2012 `[abstract read via SEI library page]` (DOI from memory: 10.1109/MS.2012.167)
- URL: https://www.sei.cmu.edu/library/technical-debt-from-metaphor-to-theory-and-practice/
- Type: peer-reviewed editorial.
- Argued: debt requires "an awareness of its causes as well as explicit management", including "a common backlog that lists debt-related tasks along with actions for improvement". The visible/invisible × positive/negative "landscape" (features / architecture / defects / debt) comes from Kruchten's 2009 talk "What colour is your backlog?" and recurs in SEI slides `[secondhand]`.
- Does NOT show: evidence that backlog debt items get scheduled.
- Relevance: (c) the "technical debt backlog" practice: make retirement work a visible backlog item — with 4.11/4.12 showing it then loses prioritisation contests.

### 4.11 Codabux, Z., Williams, B. "Managing technical debt: An industrial case study." MTD 2013 (4th Int'l Workshop on Managing Technical Debt, ICSE 2013) `[abstract read; full text 404]` (DOI from memory: 10.1109/MTD.2013.6608672)
- Type: peer-reviewed workshop paper (ethnography + interviews during an Agile adoption in a large division).
- Findings (abstract): developers used their own TD taxonomy (design, testing, defect debt) rather than management's; "assigning dedicated teams for technical debt reduction and allowing other teams about 20% of time per sprint for debt reduction are good initiatives towards lowering technical debt."
- Does NOT show: completion rates of debt items; outcome measures.
- Relevance: (b) early industrial support for *dedicated* capacity (team or 20%) rather than relying on backlog prioritisation.

### 4.12 Martini, A., Bosch, J. "The Danger of Architectural Technical Debt: Contagious Debt and Vicious Circles." WICSA 2015, pp. 1–10. DOI 10.1109/WICSA.2015.31 `[abstract read]`; extended: Martini & Bosch, "On the interest of architectural technical debt: Uncovering the contagious debt phenomenon." J. Software: Evolution and Process 29(10):e1877, 2017. DOI 10.1002/smr.1877 `[abstract read]`
- URLs: https://research.chalmers.se/en/publication/224827 ; https://research.chalmers.se/en/publication/252953
- Type: peer-reviewed multiple-case studies (7 sites/5 companies; then 9 sites/6 companies).
- Argued/found: "some Technical Debt items are contagious, causing other parts of the system to be contaminated with the same problem", so interest can grow non-linearly; a socio-technical "vicious circle" of low debt awareness, time pressure and refactoring; 2017: interest is "not only fixed but potentially compound, which leads to the hidden growth of interest (possibly exponential)."
- Does NOT show: quantitative interest curves; qualitative models.
- Relevance: (a)/(b) the feedback loop the paper hypothesises: an un-retired path is a contagious debt item — each new feature that touches it must handle both paths, spreading the duplication.

### 4.13 Martini, A., Bosch, J., Chaudron, M. "Investigating Architectural Technical Debt accumulation and refactoring over time: A multiple-case study." Information and Software Technology 67:237–253, 2015. DOI 10.1016/j.infsof.2015.07.005 `[primary text read]`
- PDF: https://mn.uio.no/ifi/english/people/aca/antonima/papers/InvestigatingATD.pdf
- Type: peer-reviewed (7 sites, 5 large companies; cross-company interviews; one in-depth case).
- Findings: "Several factors cause constant and unavoidable accumulation of Architecture Technical Debt, which leads to development crises. Refactorings are often overlooked in prioritization and they are often triggered by development crises, in a reactive fashion." Taxonomy includes factor 4.1.6 "Non-completed refactoring": "if the refactoring goal is not completed, this not only will leave part of the ATD, but it will actually create new ATD… the new API is added but the previous one cannot be removed, for example because of unforeseen backward compatibility". In the in-depth case, a duplicated component "was not considered as such (but only temporary duplication) until it became clear that the substitution of CompA with CompA0 was not possible due to the low-prioritization." Also: split project/maintenance budgets push debt to maintenance; the authors recommend making ATD visible and conclude the best strategy is "partial refactoring" aimed at delaying crisis points.
- Does NOT show: quantities; qualitative models from interviews.
- Quote: "the new API is added but the previous one cannot be removed, for example because of unforeseen backward compatibility with another version of the product."
- Relevance: (a) the strongest industrial evidence for the paper's thesis: incomplete migrations are a *named cause* of architectural debt, "temporary duplication" becomes permanent through prioritisation, and refactoring happens reactively at crises; (c) supports a definition of done that counts a refactoring as incomplete until the previous API is removed.

---

## 5. Program-comprehension cost of multiple implementations / hidden knowledge

### 5.1 Xia, X., Bao, L., Lo, D., Xing, Z., Hassan, A. E., Li, S. "Measuring Program Comprehension: A Large-Scale Field Study with Professionals." IEEE TSE 44(10):951–976, 2018 (DOI from memory: 10.1109/TSE.2017.2734091; ICSE'18 companion DOI 10.1145/3180155.3182538) `[abstract read]`
- URL: https://research.monash.edu/en/publications/measuring-program-comprehension-a-large-scale-field-study-with-pr/
- Type: peer-reviewed field study.
- Measured: 78 professional developers, 7 projects, 3,148 working hours of cross-application interaction logs; developers "spend ~58% of their time on program comprehension activities"; "senior developers spend significantly less percentages of time on program comprehension than junior developers"; comprehension frequently happens in browsers and document editors, outside the IDE.
- Does NOT show: the marginal comprehension cost of duplicated paths specifically.
- Relevance: (b) sizes the budget that duplicate paths tax — more than half of developer time is reading, so every redundant implementation is paid for repeatedly.

### 5.2 LaToza, T. D., Venolia, G., DeLine, R. "Maintaining Mental Models: A Study of Developer Work Habits." ICSE 2006, pp. 492–501. DOI 10.1145/1134285.1134355 `[abstract read; body not retrievable (503)]`; detailed numbers in MSR-TR-2005-140 "Software Development at Microsoft Observed" `[secondhand]`
- URL: https://www.microsoft.com/en-us/research/?p=154508
- Type: peer-reviewed (two surveys + eleven interviews at Microsoft).
- Findings (abstract): "many problems arose because developers were forced to invest great effort recovering implicit knowledge by exploring code and interrupting teammates and this knowledge was only saved in their memory"; "current design documents are inadequate" for design rationale; "developers reported several types of duplication" beyond copy-paste. The technical report puts "understanding the rationale behind a piece of code" as the most-cited serious problem (66%) `[secondhand]`.
- Does NOT show: the comprehension cost of parallel implementations per se.
- Relevance: (b) when two paths exist, the knowledge of *which is canonical* is exactly the implicit, memory-only knowledge this study finds most costly; the duplication-types finding is directly on point.

### 5.3 Ko, A. J., DeLine, R., Venolia, G. "Information Needs in Collocated Software Development Teams." ICSE 2007, pp. 344–353 (DOI from memory: 10.1109/ICSE.2007.45) `[abstract read]`
- URL: https://www.microsoft.com/en-us/research/publication/information-needs-in-collocated-software-development-teams/
- Type: peer-reviewed observation (17 developers, 90-minute sessions, 21 information types).
- Findings: "The most often deferred searches included knowledge about design and program behavior, such as why code was written a particular way, what a program was supposed to do, and the cause of a program state." "Developers often had to defer tasks because the only source of knowledge was unavailable coworkers."
- Relevance: (b) "why is there a second implementation of this?" is a design-rationale question — the category most often *deferred*, which is how a lingering old path becomes permanent (nobody can safely answer whether it is still needed; cf. Hyrum's Law).

### 5.4 Sillito, J., Murphy, G. C., De Volder, K. "Questions Programmers Ask During Software Evolution Tasks." FSE 2006, pp. 23–34. DOI 10.1145/1181775.1181779 `[primary text read]`
- PDF: http://www.cs.ubc.ca/~murphy/papers/other/asking-answering-fse06.pdf
- Type: peer-reviewed qualitative study (study 1: nine graduate students in pairs, 12 sessions on an assigned task; study 2: 16 industrial programmers, 15 sessions on their own code).
- Findings: 44 question types in four categories — "questions about finding initial focus points, questions about building on such points, questions aimed at understanding a subgraph, and questions over multiple subgraphs." Participants "at times leaving questions only partially answered, sometimes forgetting what they had learned".
- Does NOT show: frequencies per question in the wild; no specific question about duplicate implementations in the parts I read.
- Relevance: (b) multiple implementations of one decision multiply the "which subgraph is relevant?" and "over multiple subgraphs" questions — the categories the authors found tooling supports worst.

---

## 6. Conway's law — skipped (not directly relevant to retirement; the ownership findings above (Google ch. 15, Piranha author-routing) are the socio-technical hooks).

---

## 7. Additive bias (human and LLM) and 2024–2026 writing on retirement-inclusive "done"

### 7.1 Adams, G. S., Converse, B. A., Hales, A. H., Klotz, L. E. "People systematically overlook subtractive changes." Nature 592:258–261, 7 April 2021. DOI 10.1038/s41586-021-03380-y `[primary text read]`
- Type: peer-reviewed (eight experiments; meta-analysis k = 8, n = 1,585; plus observational studies).
- Findings: "people systematically default to searching for additive transformations, and consequently overlook subtractive transformations." Observational: in a grid/structure task only "18 (20%) favoured subtraction"; across coded ideas "only 70 (11%) were subtractive"; subtraction rates of 12%, 2%, 5% (block structures), 17%, 32% (essays), 28% (itineraries), all significantly below 50%. Experiment 1 (n = 197, Lego): 41% subtracted in control vs 61% with a cue mentioning subtraction; experiment 4 (n = 369): 21% vs 48% (improve) and 28% vs 50% (make-worse); experiment 5 (n = 299): 49% vs 63% with repeated search; cognitive load reduced subtraction (experiments 6–8, n = 1,153).
- Does NOT show: software or professional engineers; lab tasks.
- Quote: "participants were less likely to identify advantageous subtractive changes when the task did not (versus did) cue them to consider subtraction".
- Relevance: (a) a general cognitive mechanism for add-without-retire; (b) the manipulations that increased subtraction — an explicit cue, repeated search, lower load — map onto DoD checklists ("what does this make obsolete?"), review prompts, and reduced time pressure.

### 7.2 Santagata, L., De Nobili, C. "More is More: Addition Bias in Large Language Models." arXiv 2409.02569, 4 Sep 2024 (a 2025 journal version appears at ScienceDirect S2949882125000131, venue not verified) `[primary text read, arXiv]`
- Type: preprint (journal status unverified).
- Measured: GPT-3.5 Turbo, Claude 3.5 Sonnet, Mistral 7B, Mathstral, Llama 3.1 70B/405B on palindrome, Lego-tower, operation-choice, recipe and summarisation tasks. Examples: palindrome "abb"→"abba" 97.85% (Llama 405B), Claude 100% additive; Lego: GPT-3.5 76.38% additive, Claude and Mathstral 100%, Llama 70B 1.90% (the one subtractive case); summaries longer than the original in 59.4%/75.1% of cases (Mistral 7B). Conclusion: "a significant preference for additive changes across all tested models", task- and model-dependent.
- Does NOT show: code tasks; GPT-4o not tested.
- Relevance: (a) first evidence that the Adams bias transfers to LLMs.

### 7.3 Uhler, L., Jordan, V., Buder, J., Huff, M., Papenmeier, F. "Influence of solution efficiency and valence of instruction on additive and subtractive solution strategies in humans, GPT-4, and GPT-4o." Communications Psychology 4:41, 2026. DOI 10.1038/s44271-026-00403-0 `[primary text read via PMC]`
- Type: peer-reviewed.
- Measured: two pre-registered studies (N = 1,268 and 1,831 trials) with a spatial symmetry task and a linguistic summary task. "a general addition bias emerged, more pronounced in the LLMs than in humans": Study 1 humans 56.97% additive vs GPT-4 70.74%; Study 2 humans 54.19% vs GPT-4o 96.20%. Humans became less additive when subtraction was more efficient (symmetry: 69.11% → 40.32%, p < .001) whereas GPT-4o did not (95.56% vs 96.30%, n.s.) and GPT-4 moved the opposite way; positive instruction valence increased additive outputs in both GPT models (summary task GPT-4o 93.33% → 99.63%, p < .001).
- Does NOT show: code; agentic settings; current frontier models beyond GPT-4o.
- Relevance: (a)/(b) LLMs are not only more additive than humans but *insensitive to the efficiency of subtraction* and more additive under positively-framed instructions — a warning for prompts that praise "adding support for X".

### 7.4 Ebrahimi, A. M., Hasan, M. M., Bhatia, A., Rajbahadur, G. K., Hassan, A. E. "To Add Is Machine, To Delete Is Human: Measuring and Mitigating Deletion Avoidance in LLM Code Editing." arXiv 2607.28887, 30 July 2026 (Queen's University) `[primary text read]`
- Type: preprint.
- Measured: defines deletion avoidance as "the systematic tendency to retain code that an intended edit requires removing." In the wild (SWE-bench Verified tasks solved by all five studied models) deletion recall tops out at 71.7% — roughly 28–35% of developer deletions are left in place; models reach the right file for >92% of required deletions but remove the exact line in <52%. "Guard-and-Go" — keeping the removed logic and routing around it with a new condition — appears in 29.0% of passing patches; its commonest subtype is "Retained Path as Live Fallback" (40.2% of typed pairs); passing Guard-and-Go patches are larger than the developer patch 61.1% of the time (median 1.67×). Retrofitting deletion-sensitive checks drops resolution from 63.2% to 41.9%. New benchmark CanItDelete (200 tasks, 35 repos, 12 models): success 18.0%–79.0%; incomplete deletion = 69.8% of failures. Mitigation: adding 12,821 deletion examples (~0.7% of a 15.9B-token post-training mix) to a 7B model raised CanItDelete success 6.5% → 13.7% and cut incomplete deletion 80.4% → 66.5% while improving SWE-bench Verified by 5.3 points; the authors call the behaviour "undertrained rather than beyond reach" and link it to human additive preference (Adams), LLM addition bias and coding-agent action bias.
- Does NOT show: multi-session, long-horizon codebase evolution; single-scale mitigation.
- Relevance: (a) the most direct measurement available of agents *adding a path through the system without retiring the old one* — the retained path survives as a live fallback behind a guard, and tests still pass; (b) test suites that are deletion-insensitive will not catch it, so a retirement check must be an explicit acceptance criterion.

### 7.5 Nayebi, M., Kuznetsov, K., Zeller, A., Ruhe, G. "Recommending and Release Planning of User-Driven Functionality Deletion for Mobile Apps." arXiv 2410.07370, 9 Oct 2024 (preprint of a Requirements Engineering Journal article) `[abstract read]`
- Type: preprint of a journal article.
- Measured: survey of 141 developers — 77.3% "often or always" plan for feature deletions; "Traditional software release planning has predominantly focused on orchestrating the addition of features"; the "Radiation" method recommends deletions from 190,062 reviews of 115 apps (average F-score 74%).
- Does NOT show: whether planned deletions are executed in code.
- Relevance: (c) release planning that treats deletion as first-class work; developers say they plan it — pair with the toggle evidence that intentions do not translate into removal.

### 7.6 Ottenhof, L., Penner, D., Hindle, A., Lutellier, T. "How do Agents Refactor: An Empirical Study." MSR 2026 Mining Challenge, arXiv 2601.20160, 28 Jan 2026 `[primary text read]` — *overlap with the AI-code slice*
- Finding relevant here: agent refactorings "are dominated by annotation changes" (>91% of Claude Code's); removal-type refactorings are a small share (Remove Parameter 4.01%, Remove Method Annotation 4.42% overall); no lines-added/removed analysis. Only Cursor showed a statistically significant smell increase.
- Relevance: (a) weak/indirect; included so the paper does not over-claim from it.

### 7.7 2024–2026 practitioner writing on a retirement-inclusive definition of done `[primary text read unless noted]`
- Stirrup, A. "The Engineer's Guide To Feature Flag Technical Debt." GrowthBook, 9 Jun 2026 — "add flag removal as a part of your definition of 'Done.'"; "you need to change how you define 'shipped' or 'completed rollout.'"; assign an owner at creation; expiry tags; ~90-day review. (Vendor; cites Hoyos et al. secondhand.)
- LaunchDarkly docs, "Reducing technical debt from feature flags" (undated) — "Done means different things for different teams." "A feature is done when the flag is archived."; "Before you do this, remove the flag from your codebase."; "If you don't remove and archive flags that no one is using, they can become a form of technical debt"; plan removal at creation by opening a second PR; healthy time-to-archive 90–120 days. (Vendor.)
- "The Rule of Delete: A Simple Test for Code Organization." Ministry of Programming, 6 May 2025 — "After implementing a new feature or a module, imagine you need to remove all of its related code."; "If you can do this in three or fewer delete actions, your code is likely well-structured." (Opinion; design-for-deletion heuristic.)
- Mironov 2024 (3.9) and Tanner 2026 (3.15) above.
- Not fetched, seen only in search snippets `[secondhand]`: DEV Community posts "The feature flag we forgot to delete" (2026; flag left after launch → incident; team now files a removal ticket two weeks after full rollout) and "Feature Flags That Forgot to Leave"; Statsig "Managing feature flag technical debt" (2025; a feature without a flag-retirement plan "isn't ready to ship").
- No peer-reviewed 2024–2026 source was found that proposes "no feature without deletion" or a retirement clause in the Scrum DoD in those words; the nearest peer-reviewed statements are Google ch. 22 ("different definitions of 'done'") and Martini et al. 2015 ("non-completed refactoring").
- Relevance: (c) the practitioner consensus has converged on "done = removed" for toggles specifically; the generalisation to features/paths is argued by Mironov and Tanner but not measured anywhere I found.

---

## 8. Cross-cutting notes for the paper

1. **Every pattern ends in a delete; the delete is what gets skipped.** Hammant step 6, Fowler BBA, Sato contract, Stripe phase 4, Azure step 4 are explicit. Measured non-execution: Chrome 20% removal in a cleanup campaign and 2/11 false "Removed" labels (1.7); K8s/GitLab removals trail additions 35%/13% (1.10); Uber needed automation to clear 17% of flags (1.9); clients mostly do not migrate off deprecated APIs and keep adding uses (3.1, 3.2); industry names "non-completed refactoring… the new API is added but the previous one cannot be removed" as a debt source (4.13).
2. **What correlates with finishing (evidence strength in brackets):** compulsory deadline + named owner + staffed to completion [Google experience, Mironov argument]; backsliding prevention that blocks new uses of the old path [Google experience; Sawant shows the absence]; deletion changes generated for the owner and chased with reminders [Piranha: 88% processed, 86% land within 5 days of a reminder — measured]; expiry/time-bomb/WIP limits [Hodgson; adoption measured low by Mahdavi-Hezaveh]; review bandwidth treated as the constraint [Google 2025]; dedicated capacity rather than backlog competition [Codabux & Williams; Martini et al. find backlog refactorings "overlooked in prioritization"]; progress metrics defined on removal (references to the old API, traffic share, regions disabled) [Tanner].
3. **Evidence for a retirement-inclusive definition of done:** (i) Sato: not contracting leaves you "worse… than you started"; (ii) Martini et al.: the unfinished migration *creates* new debt and "temporary duplication" becomes permanent; (iii) Rahman: lingering release toggles = technical debt; (iv) Google ch. 15: code is a liability, so an increment that adds code without removing superseded code lowers functionality-per-code; (v) Google ch. 22: "done" must be defined per migration and includes a mechanism against new uses; (vi) LaunchDarkly/GrowthBook: "done when the flag is archived"; (vii) Scrum Guide: DoD is organisation-defined and binding, so the clause is admissible. Direct outcome evidence that adding such a clause improves coherence does not exist in what I found — the closest are Piranha (process → removals) and Kim et al. (organised refactoring → fewer dependencies/defects).
4. **Mechanism for agents specifically:** humans default to addition (Adams 2021); LLMs do so more strongly and are insensitive to subtraction's efficiency (Uhler 2026); in code editing the retained path survives as a guarded fallback in 29% of passing patches and tests do not catch it (Ebrahimi 2026). Combined with Murphy-Hill (refactoring is unlabelled) and Ko/LaToza (rationale is the most-deferred knowledge), an agent-built codebase has both a stronger additive bias and weaker signals about which path is canonical.
5. **Gaps to state as such:** no study measures the fraction of started migrations that reach removal of the old path in a codebase (He et al. 2021 measures migration events, not completion; Ayas et al. 2023 is qualitative); no controlled evidence that DoD clauses change retirement rates; Hora et al. 2018 and Hoyos et al. 2021 results are unverified here; Romano et al. 2020 effect sizes unverified.
