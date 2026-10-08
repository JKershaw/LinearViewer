# Classical software-engineering literature: does duplicated/eroded design make later change costlier?

Literature-review slice for a paper on whether a codebase built incrementally by AI agents loses coherence as it grows (one decision implemented in several places; new work adds a path without retiring the old one) and whether that loss makes later changes harder. This file covers the **classical SE literature only** (erosion/drift, conceptual integrity, code smells, clones, co-change, technical debt, complexity feedback loops). AI-assisted-development studies and migration/retirement patterns are covered by other reviewers.

Compiled 2026-10-08.

## How to read this file

- **Type** tags: `[PR-empirical]` peer-reviewed with data; `[PR-conceptual]` peer-reviewed/foundational argument without data; `[Survey]`; `[Book]`; `[Essay/opinion]`; `[Industry]` (vendor/consultancy authors or industry report); `[Thesis]`; `[Consensus report]`.
- **Access** tags say what I actually read: `primary: full text` (PDF read and quoted), `primary: abstract` (publisher/registry abstract only, body not read), `secondary` (relied on another source's description; flagged as such). Where a number comes from a source I could not read, it is marked **unverified**.
- Quotes are verbatim from the text I read, ≤40 words, with page/section where the PDF showed it.
- "Relevance" states which of the paper's claims the source **supports (FOR)**, **undercuts (AGAINST)** or **qualifies**. The paper's claims, as I understand them:
  - **C1** Incremental growth erodes coherence (one decision ends up implemented in several places; new paths added, old not retired).
  - **C2** That loss of coherence makes later changes costlier/riskier.
  - **C3** The process is self-reinforcing (complexity begets complexity).

## Scorecard (one line per source; details below)

| # | Source | Type | Verdict on C2 (cost of scattered/duplicated decisions) | Strength |
|---|---|---|---|---|
| 1 | Perry & Wolf 1992 | PR-conceptual | FOR (defines erosion/drift; posits brittleness) | definitional, no data |
| 2 | van Gurp & Bosch 2002 | PR-conceptual + small case | FOR (C1) | illustrative |
| 3 | de Silva & Balasubramaniam 2012 | Survey | FOR by consensus; notes cost rarely measured | survey |
| 4 | Parnas 1994 | Essay | FOR (C1, C2, C3 mechanism) | argument, no data |
| 5 | Lehman 1980 / 1996 | PR-empirical (laws) | FOR (C1, C3) | statistical regularities, few systems |
| 6 | Eick et al. 2001 | PR-empirical | FOR (C1, C2): span of changes rises; span predicts effort | strongest classical evidence for C1→C2 |
| 7 | Le et al. 2018 | PR-empirical | FOR (arch. smells → issues, effort) | abstract only |
| 8 | Xiao et al. 2016 | PR-empirical | FOR (few arch. debts consume 20–61% of effort) | strong |
| 9 | Mo et al. 2021 | PR-empirical | FOR (anti-pattern files far more bug/change-prone) | strong, 19 projects |
| 10 | Brooks 1975/1995 | Book | FOR (C1 as "conceptual integrity") | canonical, no data |
| 11 | Brooks 1987 | Essay | FOR (super-linear complexity) | argument |
| 12 | Ousterhout 2018 | Book | FOR (change amplification, incremental complexity) | argument |
| 13 | Parnas 1972 | PR-conceptual | FOR (information hiding = one decision, one place) | canonical |
| 14 | Parnas 1979 | PR-conceptual | FOR ("excessive information distribution") | canonical |
| 15 | Fowler & Beck 1999/2018 | Book | FOR (names the smells) | no evidence offered |
| 16 | Khomh et al. 2012 | PR-empirical | FOR (antipatterns → change/fault-prone) | correlational |
| 17 | Palomba et al. 2018 | PR-empirical | FOR | large, correlational |
| 18 | Sjøberg et al. 2013 | PR-empirical (controlled) | **AGAINST** (no smell effect after size/changes; incl. Shotgun Surgery) | strongest AGAINST |
| 19 | Olbrich et al. 2010 | PR-empirical | AGAINST/qualifies (size-normalised God classes are *less* change-prone) | |
| 20 | Tufano et al. 2017 | PR-empirical | Qualifies C1 (smells born, not grown); FOR "old never retired" (80% survive) | large |
| 21 | Kapser & Godfrey 2008 | PR-empirical (qualitative) | **AGAINST** (71% of clones judged beneficial) | judgement-based |
| 22 | Juergens et al. 2009 | PR-empirical | **FOR** (inconsistent clone changes → confirmed faults) | strong, developer-validated |
| 23 | Roy & Cordy 2007/2009 | Survey | Context: cost of clones asserted, not measured | |
| 24 | Krinke 2008 | PR-empirical | AGAINST (clones more stable) | abstract |
| 25 | Göde & Koschke 2011 | PR-empirical | AGAINST (most clones rarely change; few bad inconsistencies) | abstract |
| 26 | Kim et al. 2005 | PR-empirical | Qualifies (many clones transient; many unrefactorable) | |
| 27 | Rahman, Bird, Devanbu 2012 | PR-empirical | **AGAINST** (clones, incl. scattered ones, not more buggy) | strong |
| 28 | Lozano & Wermelinger 2008 | PR-empirical | Mixed/qualifies | abstract |
| 29 | Gall et al. 1998 | PR-empirical (method) | FOR (hidden co-change coupling exists) | method |
| 30 | Zimmermann et al. 2005 | PR-empirical | FOR (co-change pervasive; incomplete changes a real failure mode) | |
| 31 | D'Ambros et al. 2009 | PR-empirical | FOR (change coupling ↔ defects) | abstract; results unverified |
| 32 | Cataldo et al. 2009 | PR-empirical | **FOR** (logical dependencies explain most failure variance) | strong |
| 33 | Mockus & Weiss 2000 | PR-empirical | FOR (change diffusion predicts failure) | strong |
| 34 | Hassan 2009 | PR-empirical | FOR (scattered changes predict faults) | strong |
| 35 | Eaddy et al. 2008 | PR-empirical | **FOR** (concern scattering ↔ defects, ρ≈0.4–0.9) | strong |
| 36 | Tornhill & Borg 2022 | Industry/PR workshop | FOR (15× defects, 124% longer dev time in low-health code) | vendor metric |
| 37 | Tornhill 2015 | Industry book | FOR (hotspots, temporal coupling) | no controlled evidence |
| 38 | Cunningham 1992 | Experience report | FOR (C1, C2: "unconsolidated implementation") | origin of metaphor |
| 39 | Kruchten, Nord, Ozkaya 2012 | Position | Framing | |
| 40 | Avgeriou et al. 2016 | Consensus report | Definition: TD "can make future changes more costly or impossible" | |
| 41 | Ernst et al. 2015 | PR-empirical (survey) | FOR (architectural decisions = top TD source) | self-report |
| 42 | Besker, Martini, Bosch 2017/2018/2019 | PR-empirical (survey/longitudinal) | FOR (23–36% time wasted; existing TD forces new TD → C3) | self-report |
| 43 | Potdar & Shihab 2014 | PR-empirical | FOR C1 ("old not retired": only 26–64% of SATD removed) | |
| 44 | Bavota & Russo 2016 | PR-empirical | FOR C1 (SATD grows; survives >1,000 commits) | |
| 45 | Wehaibi et al. 2016 | PR-empirical | Qualifies (SATD changes harder, not buggier) | |
| 46 | Nugroho, Visser, Kuipers 2011 | Industry | Framing (debt vs interest model) | numbers unverified |
| 47 | Zazworka et al. 2011 | PR-empirical | FOR (god classes change more, more defects) | not size-normalised |
| 48 | Martini & Bosch 2017 (+2015) | PR-empirical (case) | FOR C3 ("contagious" ATD, compounding interest) | secondary |
| 49 | Banker et al. 1993 | PR-empirical | FOR (complexity → maintenance cost) | code-metric complexity |
| 50 | Banker, Davis, Slaughter 1998 | PR-empirical | FOR (complexity mediates practice → effort) | |
| 51 | Kemerer & Slaughter 1999 | PR-empirical (method) | Context | |
| 52 | MacCormack, Rusnak, Baldwin 2006 | PR-empirical | Qualifies (structure is a managerial choice; propagation cost) | structural only |
| 53 | Sturtevant 2013 | Thesis | **FOR** (50% productivity drop, 3× defects, 10× turnover in complex files) | one firm |
| 54 | MacCormack & Sturtevant 2016 | PR-empirical | FOR (core files → more defect activity) | secondary |

---

## 1. Architectural erosion and drift

### 1.1 Perry, D. E., & Wolf, A. L. (1992). Foundations for the study of software architecture. *ACM SIGSOFT Software Engineering Notes*, 17(4), 40–52. https://doi.org/10.1145/141874.141884
- **Type:** `[PR-conceptual]` (SEN newsletter; foundational, >2,000 citations). **Access:** primary: full text (author PDF, users.ece.utexas.edu/~perry).
- **What it argues:** Introduces the elements/form/rationale model of architecture and, in passing, the two canonical failure modes. Erosion = violations of the architecture; drift = insensitivity to it. Both are tied to "an increasing brittleness of the system — that is, an increasing resistance to change" (p. 43).
- **Does NOT show:** No data, no measurement of cost. The brittleness claim is asserted by analogy ("removing load-bearing walls often leads to disastrous results").
- **Quote (p. 43):** "Architectural erosion is due to violations of the architecture. These violations often lead to an increase in problems in the system and contribute to the increasing brittleness of a system."
- **Quote (p. 43):** "Architectural drift is due to insensitivity about the architecture … results in a lack of coherence and clarity of form, which in turn makes it much easier to violate the architecture that has now become more obscured."
- **Relevance:** Supplies the paper's vocabulary and, importantly, an explicit **feedback loop (C3)**: drift → obscured architecture → easier violation → erosion. "Lack of coherence" is their phrase. Purely conceptual, so it supports framing, not evidence.

### 1.2 van Gurp, J., & Bosch, J. (2002). Design erosion: problems and causes. *Journal of Systems and Software*, 61(2), 105–119. https://doi.org/10.1016/S0164-1212(01)00152-2
- **Type:** `[PR-conceptual]` with an illustrative case. **Access:** primary: abstract (RUG repository record; Elsevier page blocked); body not read.
- **What it argues (per abstract):** Designs erode over time to the point where redesign from scratch becomes more viable than maintaining the existing design, regardless of designers' ambitions. Illustrated with the design evolution of a small system: design decisions accumulate and become invalid as new requirements arrive; even a strategy with no cost-driven compromises fails to yield an optimal design because unforeseen requirement changes invalidate previously optimal decisions.
- **Does NOT show:** No quantitative cost data; one small system; the "causes" taxonomy in the body could not be verified here.
- **Quote:** none verbatim available (abstract could not be reproduced).
- **Relevance:** Supports **C1** with a mechanism the paper can borrow: decisions are taken under one set of requirements and silently invalidated by later increments; the invalidated decision stays in the code. No support for C2 beyond assertion.

### 1.3 de Silva, L., & Balasubramaniam, D. (2012). Controlling software architecture erosion: A survey. *Journal of Systems and Software*, 85(1), 132–151. https://doi.org/10.1016/j.jss.2011.07.036
- **Type:** `[Survey]`. **Access:** primary: abstract (St Andrews portal); body not read.
- **What it does:** Surveys techniques/tools against erosion in three families (minimise, prevent, repair), each subdivided (conformance processes, self-adaptation, restoration, …). Concludes no single strategy suffices and calls for an integrated framework. Later mapping studies (Li et al. 2021, arXiv 2112.10934) describe it as finding little industrial uptake of academic approaches; a 2025 review (arXiv 2507.14547) lists "absence of empirical validation" as its limitation.
- **Does NOT show:** Does not measure erosion cost; the premise that erosion "can degrade performance and shorten a system's useful life" is taken from the field rather than demonstrated.
- **Quote (abstract):** "Software architectures capture the most significant properties and design constraints of software systems."
- **Relevance:** Establishes that the erosion→cost link is **field consensus** but that the control literature mostly assumes it. Useful to show the paper is testing something the architecture community treats as given.

### 1.4 Parnas, D. L. (1994). Software aging. *Proceedings of the 16th International Conference on Software Engineering (ICSE '94)*, 279–287. https://doi.org/10.1109/ICSE.1994.296790
- **Type:** `[Essay/opinion]` (invited plenary at a peer-reviewed venue). **Access:** primary: full text (York course-archive PDF).
- **What it argues:** Two causes of aging: "lack of movement" (failure to adapt) and "ignorant surgery" (changes made without understanding the design concept). Each such change introduces exceptions to the design rules; after many, "nobody understands the modified product" (p. 280). Costs: inability to keep up, reduced performance, decreasing reliability. Remedies: design for change, documentation, reviews, "amputation", retroactive restructuring.
- **Does NOT show:** No data; the only number is an anecdote ("list of known, but not yet repaired, bugs, exceeded 2000 entries", p. 281).
- **Quote (p. 280, §4.1):** "a change that might have been made in one or two parts of the original program, now requires altering many sections of the code. Second, it is more difficult to find the routines that must be changed."
- **Quote (p. 280, §2.2):** "After many such changes, the original designers no longer understand the product. Those who made the changes, never did. In other words, nobody understands the modified product."
- **Relevance:** The single clearest classical statement of the paper's full causal chain: incremental changes by people (or agents) who do not hold the design concept → exceptions accumulate → **later changes touch more places and are harder to locate (C1→C2)**. "Ignorant surgery" is an apt label for context-free agent edits. Argument only.

### 1.5 Lehman, M. M. (1980). Programs, life cycles, and laws of software evolution. *Proceedings of the IEEE*, 68(9), 1060–1076. https://doi.org/10.1109/PROC.1980.11805 — and Lehman, M. M. (1996). Laws of software evolution revisited. *EWSPT '96*, LNCS 1149, 108–124. https://doi.org/10.1007/BFb0017737
- **Type:** `[PR-empirical]` in origin (OS/360 release data) but the laws themselves are stated as generalisations. **Access:** primary: full text for both (gwern.net scan; Kent course PDF).
- **What it measured/argued:** Laws derived from release-by-release data on OS/360 and a few other systems (module counts, modules handled per release, release intervals). Lehman calls the laws "abstractions of observed behavior based on statistical models" (1980, p. 1068). 1996 restates eight laws, including VII (Declining Quality) and VIII (Feedback System).
- **Does NOT show:** Does not quantify the cost of any single change; evidence base is a handful of 1970s–90s systems; the laws apply to "E-type" systems only; the 1996 formulation of Law VII is about *perceived* quality.
- **Quote (1980, Table I, p. 1068, Law II):** "As an evolving program is continually changed, its complexity, reflecting deteriorating structure, increases unless work is done to maintain or reduce it."
- **Quote (1980, Table I, p. 1068, Law I):** "A program that is used … undergoes continual change or becomes progressively less useful. The change or decay process continues until it is judged more cost effective to replace the system with a recreated version."
- **Quote (1996, §2.2):** "It results from the imposition of change upon change upon change as the system is adapted"; and, on the consequence: "less effort is available for system growth … the rate of system growth declines as the system ages."
- **Relevance:** Canonical support for **C1 and C3** ("complexity begets complexity" is Law II plus the 1996 feedback-system framing). Weak on C2 as a per-change cost claim: the laws predict declining growth rate and perceived quality, not the cost of a specific change.

### 1.6 Eick, S. G., Graves, T. L., Karr, A. F., Marron, J. S., & Mockus, A. (2001). Does code decay? Assessing the evidence from change management data. *IEEE Transactions on Software Engineering*, 27(1), 1–12. https://doi.org/10.1109/32.895984
- **Type:** `[PR-empirical]`. **Access:** primary: full text (Kent course PDF of the accepted manuscript).
- **What it measured:** 15+ years of change-management data for a multi-million-LOC telephone switching system (~50 subsystems, ~5,000 modules; a 100-MLOC-class Lucent/5ESS context). Defines code decay operationally — "harder to change than it should be" in cost, interval and quality — and proposes code-decay indices. Findings: (1) the **span of changes** (files touched per change) increases over time: the local probability that a change touches more than one file "more than double[s] from a low of less than 2% in 1989 to more than 5% in 1996" (§V-A); (2) modularity breaks down (changes increasingly cross module boundaries, shown with network visualisations, §V-B); (3) fault potential is driven by recent changes, not size/complexity; (4) an effort model in which span (FILES) is a significant (quadratic) predictor of effort, multiple R² = .38 (§V-D).
- **Does NOT show:** One system/organisation; authors call the evidence "mixed, but on the whole persuasive"; they concede "some of the increase in span … can be attributed merely to growth of the subsystem"; absolute multi-file probabilities are small (2%→5%); the effort model is modest (R² .38) and "may be over-fit".
- **Quote (§III):** "Code is decayed if it is more difficult to change than it should be, as reflected by three key responses: (1) COST of the change … (2) INTERVAL … and (3) QUALITY of the changed software."
- **Quote (§IV-B.2):** "Well-engineered code is modular and changes are localized. Changes spanning multiple files are more likely to modify an interface."
- **Relevance:** The strongest classical empirical support for the exact shape of **C1→C2**: over time a change touches more places (C1), and span predicts effort (C2). It also gives the paper a ready-made, defensible metric (span of changes / decay indices) and an honest boundary (growth confound).

### 1.7 Le, D. M., Link, D., Shahbazian, A., & Medvidovic, N. (2018). An empirical study of architectural decay in open-source software. *IEEE International Conference on Software Architecture (ICSA 2018)*. https://doi.org/10.1109/ICSA.2018.00027
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** Automatically detected multiple architectural-smell types in 421 versions of 8 open-source systems and related them to issue-tracker records and commits. Reports that "architectural smells have tangible negative consequences in the form of implementation issues as well as code commits requiring increased maintenance effort throughout a system's lifetime."
- **Does NOT show:** Correlational; detector-defined smells; effect sizes not available to me.
- **Relevance:** FOR C2 at the architectural level; a modern complement to Eick et al. with more systems but weaker effort measurement.

### 1.8 Xiao, L., Cai, Y., Kazman, R., Mo, R., & Feng, Q. (2016). Identifying and quantifying architectural debt. *Proceedings of the 38th International Conference on Software Engineering (ICSE '16)*, 488–498. https://doi.org/10.1145/2884781.2884822
- **Type:** `[PR-empirical]`. **Access:** primary: full text (author PDF, personal.stevens.edu/~lxiao6). Note: the camera-ready footer prints DOI …2884825, which Crossref assigns to the neighbouring paper "Decoupling Level" (pp. 499–510); the correct DOI for this paper is …2884822.
- **What it measured:** Defines an *architectural debt* as a group of architecturally connected files (via four flawed-relation patterns: unstable interface, modularity violation, unhealthy inheritance, cyclic dependency) plus a regression model of its maintenance-cost growth. Applied to 7 Apache open-source projects. "a significant portion (from 51% to 85%) of the maintenance effort in each project is consumed by paying interest on these debts"; "The top 5 architectural debts, covering a small portion (8% to 25%) of each project's error-prone files, capture a significant portion (20% to 61%) of each project's maintenance effort." About a third of debts show polynomial (accelerating) cost growth.
- **Does NOT show:** "Maintenance effort" is proxied by bug-fixing commits/churn, not person-hours; the debts are defined by the authors' detectors; retrospective (penalty must already have accumulated).
- **Quote (abstract):** "Flawed architectural relations propagate defects among these files and accumulate high maintenance costs over time, just like debts accumulate interest."
- **Relevance:** Strong FOR **C2 and C3**: a handful of scattered, co-changing file groups dominate maintenance cost, and their cost grows super-linearly in a third of cases. Directly operationalises "one decision implemented in several places" as a history-coupled file group.

### 1.9 Mo, R., Cai, Y., Kazman, R., Xiao, L., & Feng, Q. (2021; online 2019). Architecture anti-patterns: Automatically detectable violations of design principles. *IEEE Transactions on Software Engineering*, 47(5), 1008–1028. https://doi.org/10.1109/TSE.2019.2910856
- **Type:** `[PR-empirical]`. **Access:** primary: full text (NSF PAR accepted manuscript).
- **What it measured:** Six architecture anti-patterns (Unstable Interface, Modularity Violation Group, Unhealthy Inheritance, Crossing, Clique, Package Cycle) detected from structure + revision history in 19 projects (15 OSS, 4 commercial). Files involved are more error- and change-prone; the more anti-patterns a file is in, the worse; Unstable Interface and Crossing "contribute the most by far." Illustrative magnitudes: Camel's infected files were changed >6× as much as non-infected files; Cassandra's bug-fix frequency for infected files was ~120× that of non-infected (an extreme outlier: 3.54 vs 0.03 fixes/file).
- **Does NOT show:** Correlational; anti-pattern definitions are the authors' (DV8 tool lineage); the largest ratios are driven by very low baselines.
- **Quote (abstract):** "error-prone or change-prone files rarely stand alone. They are typically architecturally connected and their connections usually exhibit architecture problems causing the propagation of error-proneness or change-proneness."
- **Relevance:** FOR **C2** with breadth (19 projects) and a mechanism the paper can cite: *propagation* of change-proneness along flawed relations — i.e., a decision implemented across an unstable interface and its many dependents.

---

## 2. Conceptual integrity and design

### 2.1 Brooks, F. P., Jr. (1975; Anniversary ed. 1995). *The Mythical Man-Month: Essays on Software Engineering*. Addison-Wesley. ISBN 0-201-83595-9. Ch. 4 "Aristocracy, Democracy, and System Design."
- **Type:** `[Book]` (experience-based essay; OS/360 project manager). **Access:** primary: full text of Ch. 4 (archive.org OCR); page numbers from secondary sources (p. 42, p. 44).
- **What it argues:** Conceptual integrity is the paramount design quality; it comes from one mind or a few "resonant minds"; it is better to omit features than to admit uncoordinated good ideas; "ratio of function to conceptual complexity is the ultimate test of system design."
- **Does NOT show:** No measurement; the argument is from OS/360 and Reims cathedral by analogy.
- **Quote (Ch. 4, p. 42):** "I will contend that conceptual integrity is the most important consideration in system design."
- **Quote (Ch. 4, p. 42):** "It is better to have a system omit certain anomalous features and improvements, but to reflect one set of design ideas, than to have one that contains many good but independent and uncoordinated ideas."
- **Relevance:** The paper's "coherence" *is* Brooks's conceptual integrity, and his failure case — "many good but independent and uncoordinated ideas" — is a precise description of a codebase assembled from many context-free increments (**C1**). He asserts, without data, that this costs ease of use and design quality; he does not claim it raises later change cost per se.

### 2.2 Brooks, F. P., Jr. (1987). No silver bullet: Essence and accidents of software engineering. *IEEE Computer*, 20(4), 10–19. https://doi.org/10.1109/MC.1987.1663532
- **Type:** `[Essay/opinion]`. **Access:** primary: full text (worrydream.com PDF).
- **What it argues:** Essential difficulties are complexity, conformity, changeability, invisibility. Complexity is super-linear in size because the elements interact non-linearly; from complexity come communication failures, "product flaws, cost overruns, schedule delays" and the "understanding burden that makes personnel turnover a disaster."
- **Does NOT show:** No data.
- **Quote (p. 11):** "Software entities are more complex for their size than perhaps any other human construct, because no two parts are alike (at least above the statement level). If they are, we make the two similar parts into one, a subroutine."
- **Quote (p. 11):** "a scaling-up of a software entity is not merely a repetition of the same elements in larger size; it is necessarily an increase in the number of different elements … the complexity of the whole increases much more than linearly."
- **Relevance:** Two uses. (a) FOR **C3**: complexity grows faster than size. (b) A subtle point for the paper: Brooks treats *removal of duplication* as definitional of software ("if they are [alike], we make the two similar parts into one"). A codebase that keeps duplicated decisions therefore carries *accidental* complexity on top of the essential kind — a framing the paper can use against the "clones are fine" literature in §4.

### 2.3 Ousterhout, J. (2018; 2nd ed. 2021). *A Philosophy of Software Design*. Yaknyam Press. ISBN 978-1-7321022-0-0.
- **Type:** `[Book]` / `[Essay/opinion]` (distilled from Stanford CS190). **Access:** **secondary** — quotations taken from Will Larson's published reading notes (lethain.com/notes-philosophy-software-design); wording not checked against the book, and the notes carry no page numbers.
- **What it argues:** Complexity is "anything that makes software hard to understand or to modify"; its causes are **dependencies** and **obscurity**; its symptoms are **change amplification** (one decision requires many code modifications), cognitive load, and unknown unknowns. "Complexity is incremental, the result of thousands of choices," hence hard to prevent and harder to fix. Contrasts **tactical programming** (get the feature working) with **strategic programming** (invest in design; "working code isn't enough"), and recommends deep modules (simple interface, rich implementation). A later Google-Groups thread (July 2026) debates whether the tactical/strategic distinction survives AI coding tools.
- **Does NOT show:** No empirical measurement; author's design experience and teaching.
- **Quote (as recorded by Larson):** "Complexity is incremental, the result of thousands of choices."
- **Quote (as recorded by Larson):** "Complexity is caused by obscurity and dependencies."
- **Relevance:** Gives the paper its most precise modern vocabulary: the paper's "one decision in several places" is Ousterhout's **change amplification**; "incremental" is his thesis verbatim (**C1, C3**); "tactical programming" describes agent increments optimised for the immediate task. Treat as argument, not evidence.

### 2.4 Parnas, D. L. (1972). On the criteria to be used in decomposing systems into modules. *Communications of the ACM*, 15(12), 1053–1058. https://doi.org/10.1145/361598.361623
- **Type:** `[PR-conceptual]`. **Access:** primary: full text (U. South Carolina course PDF with CACM pagination).
- **What it argues:** Compares a flowchart-based decomposition with an information-hiding decomposition of a KWIC index. Benefits of the latter: changeability, independent development, comprehensibility. Each module hides one "difficult design decision or design decision which is likely to change."
- **Does NOT show:** Single worked example; no measurement.
- **Quote (p. 1056):** "Every module in the second decomposition is characterized by its knowledge of a design decision which it hides from all others."
- **Quote (p. 1058):** "one begins with a list of difficult design decisions or design decisions which are likely to change. Each module is then designed to hide such a decision from the others."
- **Relevance:** The theoretical root of **C1→C2**: a decision that is *not* hidden must be re-implemented wherever it is known, so changing it means editing every place. "One decision implemented in several places" is, by this paper's criteria, a decision that was never encapsulated.

### 2.5 Parnas, D. L. (1979). Designing software for ease of extension and contraction. *IEEE Transactions on Software Engineering*, SE-5(2), 128–138. https://doi.org/10.1109/TSE.1979.234169 (conference version: ICSE 1978, 264–277)
- **Type:** `[PR-conceptual]`. **Access:** primary: full text (Vanderbilt-hosted IEEE scan; OCR noisy).
- **What it argues:** Systems are hard to extend or contract for four reasons, the first being **excessive information distribution**: "too many programs were written assuming that a given feature is present or not present." Worked example: an OS decision to support three conversational languages leaked into many places (error tables sized for exactly three), so adding a fourth language "would have required that a great deal of code be rewritten" — and, notably, *removing* one would have required rewriting the same code. Proposes designing the "uses" relation so that useful subsets exist.
- **Does NOT show:** Experience-based; no measurement.
- **Quote (p. 129, §III-A):** "A system may be hard to extend or contract if too many programs were written assuming that a given feature is present or not present."
- **Relevance:** The earliest explicit statement that what raises change cost is the *distribution of knowledge of a decision*, not merely textual duplication (**C1→C2**). The "contraction" half is the paper's "old path never retired": Parnas shows retirement is as costly as extension when a decision is scattered. Strong conceptual support; no data.

---

## 3. Code smells: one change touching many places

### 3.1 Fowler, M., with Beck, K. (1999). *Refactoring: Improving the Design of Existing Code*. Addison-Wesley (Ch. 3, "Bad Smells in Code"). 2nd ed. 2018, Addison-Wesley, ISBN 978-0-13-475759-9.
- **Type:** `[Book]` / practitioner catalogue. **Access:** **secondary** — definitions checked only against course slides and refactoring.guru/sourcemaking paraphrases; I could not verify the exact book wording, so no verbatim quote is given. Page numbers vary by edition (1999 ed. places both smells around pp. 79–80).
- **What it argues:** Names the smells the paper is about. *Duplicated Code* (the first smell listed). *Divergent Change*: one class is commonly changed in different ways for different reasons. *Shotgun Surgery*: every time you make one kind of change you must make many small edits in many classes (the inverse of divergent change). Prescribed refactorings: Move Method/Field, Inline Class, Extract Class.
- **Does NOT show:** Fowler and Beck offer no evidence; the chapter explicitly presents smells as heuristics ("no precise criteria").
- **Relevance:** Canonical naming only. "Shotgun Surgery" is the paper's **C2** symptom by definition, which is why the empirical smell studies below (especially Sjøberg et al.) matter: they test whether the named smell actually costs anything.

### 3.2 Khomh, F., Di Penta, M., Guéhéneuc, Y.-G., & Antoniol, G. (2012). An exploratory study of the impact of antipatterns on class change- and fault-proneness. *Empirical Software Engineering*, 17(3), 243–275. https://doi.org/10.1007/s10664-011-9171-y
- **Type:** `[PR-empirical]`. **Access:** **secondary** for findings (Springer page blocked; description from the Polytechnique Montréal record and citing papers). The 2009 technical-report precursor is open at publications.polymtl.ca/2642/.
- **What it measured:** 13 antipatterns (DECOR detector) in 54 releases of ArgoUML, Eclipse, Mylyn and Rhino, related to subsequent changes and fault-fixes. In almost all releases, classes participating in antipatterns were more change- and fault-prone than other classes; size alone did not explain the higher odds of change.
- **Does NOT show:** Automatic detection (false positives); correlational; Java OSS only; effect sizes not available to me.
- **Relevance:** FOR **C2** (antipattern-laden classes attract more change and faults). Later replicated at scale by Palomba et al. 2018, which cites this as the baseline.

### 3.3 Palomba, F., Bavota, G., Di Penta, M., Fasano, F., Oliveto, R., & De Lucia, A. (2018). On the diffuseness and the impact on maintainability of code smells: a large scale empirical investigation. *Empirical Software Engineering*, 23(3), 1188–1221. https://doi.org/10.1007/s10664-017-9535-z (open access)
- **Type:** `[PR-empirical]`. **Access:** primary: full text (Springer OA PDF).
- **What it measured:** 395 releases of 30 open-source systems; 17,350 manually validated instances of 13 smell kinds. Smells "characterized by long and/or complex code (e.g., Complex Class) are highly diffused"; smelly classes have higher change- and fault-proneness than smell-free classes. The design explicitly addresses earlier confounds: manual validation, within-artifact analysis over time (what happens when a smell is removed), and SZZ to check whether the class was already smelly when the fault was introduced.
- **Does NOT show:** Correlational; the authors themselves note a class may be intrinsically change-prone "because it plays a core role in the system"; no effort measurement.
- **Quote (abstract):** "smelly classes have a higher change- and fault-proneness than smell-free classes."
- **Relevance:** Strongest *large-scale* FOR on the smell→change-proneness link (**C2**), but note that the smells that dominate are size/complexity smells, which keeps the size confound alive (see Sjøberg, Olbrich).

### 3.4 Sjøberg, D. I. K., Yamashita, A., Anda, B. C. D., Mockus, A., & Dybå, T. (2013). Quantifying the effect of code smells on maintenance effort. *IEEE Transactions on Software Engineering*, 39(8), 1144–1156. https://doi.org/10.1109/TSE.2012.89
- **Type:** `[PR-empirical]` — the only controlled, professional-developer, effort-measured study in this set. **Access:** primary: full text (Simula PDF).
- **What it measured:** Six hired professional developers each performed three adaptive maintenance tasks on four functionally equivalent Java systems built by different companies (development cost €18k–€61k); 3–4 weeks each; 298 files modified; an Eclipse plug-in logged time per file. Regression of effort on 12 tool-detected smells (including **Shotgun Surgery**, Feature Envy, God Class, Data Clump, Refused Bequest …) with controls for system, developer, round, file size (LOC) and number of changes. Result: no smell was significantly associated with increased effort after adjusting for size and number of changes; Refused Bequest was associated with *less* effort; size and number of changes "explained almost all of the modeled variation." Files with smells were on average twice as long as smell-free files; Spearman correlation between size and smell count 0.53.
- **Does NOT show:** Small systems and sample (6 developers); unit of analysis is the file, so a cross-file smell like Shotgun Surgery is measured by time spent *in* the smelly file rather than by the number of files a task had to touch — the design can under-detect exactly the cost the paper hypothesises; tasks were adaptive, not feature-adding.
- **Quote (abstract):** "None of the 12 investigated smells was significantly associated with increased effort after we adjusted for file size and the number of changes."
- **Quote (abstract):** "To reduce maintenance effort, a focus on reducing code size and the work practices that limit the number of changes may be more beneficial than refactoring code smells."
- **Relevance:** The strongest **AGAINST** source for C2 as usually tested: named smells, including Shotgun Surgery, did not cost measurable effort beyond size and churn. For the paper, the lesson is methodological: if the cost of scattering is real, it will show up in *task-level* measures (files/decisions a task touches, Eick's "span"), not file-level time; a file-level design finds nothing.

### 3.5 Olbrich, S. M., Cruzes, D. S., & Sjøberg, D. I. K. (2010). Are all code smells harmful? A study of God Classes and Brain Classes in the evolution of three open source systems. *IEEE International Conference on Software Maintenance (ICSM 2010)*. https://doi.org/10.1109/ICSM.2010.5609564
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** 7–10 years of history of three OSS systems. God and Brain classes were changed more often and had more defects in absolute terms, but "when we normalized the measured effects with respect to size, then God and Brain Classes were less subject to change and had fewer defects than other classes."
- **Does NOT show:** Two smells, three systems; assumes equal functionality per LOC.
- **Quote (abstract):** "the presence of God and Brain Classes is not necessarily harmful; in fact, such classes may be an efficient way of organizing code."
- **Relevance:** **AGAINST/qualifies** C2 and a direct counter to Zazworka et al. 2011 (§6.10): the raw "smelly classes change more" finding can invert once normalised by size. Any metric the paper uses must be size-adjusted.

### 3.6 Tufano, M., Palomba, F., Bavota, G., Oliveto, R., Di Penta, M., De Lucia, A., & Poshyvanyk, D. (2017). When and why your code starts to smell bad (and whether the smells go away). *IEEE Transactions on Software Engineering*, 43(11), 1063–1088. https://doi.org/10.1109/TSE.2017.2653105
- **Type:** `[PR-empirical]`. **Access:** primary: full text (Salerno IRIS author copy).
- **What it measured:** Change history of 200 open-source projects (Android, Apache, Eclipse ecosystems); >500,000 commits mined; >10,000 smell-introducing commits manually classified. "most of the smell instances are introduced when an artifact is created and not as a result of its evolution"; 80% of smells survive; of the 20% removed, only 9% are removed by refactoring (the rest mostly by deleting the artifact).
- **Does NOT show:** Class-level, metric-based smell detection (a class can be "born" Complex because the detector thresholds fire at creation); does not measure cost.
- **Quote (abstract):** "most of the smell instances are introduced when an artifact is created and not as a result of its evolution. At the same time, 80 percent of smells survive in the system."
- **Relevance:** **Qualifies C1** in an important way: at the class level, badness is mostly *born* with the increment rather than accreted by later increments — so an AI-built codebase's incoherence may be set at the moment each piece is generated. At the same time it is strong FOR the paper's "new path added, old not retired" clause: once present, smells are almost never refactored away (**C1**, retirement half).

---

## 4. Code clones

### 4.1 Kapser, C. J., & Godfrey, M. W. (2008). "Cloning considered harmful" considered harmful: patterns of cloning in software. *Empirical Software Engineering*, 13(6), 645–692. https://doi.org/10.1007/s10664-008-9076-6
- **Type:** `[PR-empirical]` (qualitative case study + pattern catalogue). **Access:** primary: full text (author PDF, cormack.uwaterloo.ca/~migod).
- **What it measured/argued:** Catalogue of cloning patterns (forking, templating, customization, …) with motivations, advantages, disadvantages. Case study of Apache httpd and Gnumeric: "as many as 71% of the clones could be considered to have a positive impact on the maintainability of the software system." Argues clones can be a deliberate design choice: "Clones of this type may be used for change decoupling to limit the scope of the impact of changes"; abstraction has its own costs ("aggressive refactoring can sometimes create abstractions that are complex, overly subtle, and unintuitive").
- **Does NOT show:** "Positive impact" is the authors' judgement per pattern, not a measured maintenance outcome; two C systems; no cost data.
- **Quote (abstract):** "we found that as many as 71% of the clones could be considered to have a positive impact on the maintainability of the software system."
- **Relevance:** The canonical **AGAINST**: duplication can be intentional *change decoupling* when two paths are expected to diverge. For the paper, this sharpens C1: duplication is only a loss of coherence when the two copies still implement *the same* decision and must change together (cf. Juergens).

### 4.2 Juergens, E., Deissenboeck, F., Hummel, B., & Wagner, S. (2009). Do code clones matter? *Proceedings of the 31st International Conference on Software Engineering (ICSE '09)*, 485–495. https://doi.org/10.1109/ICSE.2009.5070547 (preprint arXiv:1701.05472)
- **Type:** `[PR-empirical]`. **Access:** primary: full text (arXiv preprint).
- **What it measured:** Five systems — three C# industrial systems from Munich Re (different developers/organisations), one Java open-source system, and one industrial COBOL system — analysed with a new inconsistent-clone detector; ~900 clone groups manually inspected (~1,800 assessments); developers of each system rated whether inconsistencies were intentional and faulty. Results: 52% of clones contain inconsistencies (RQ1); 28% of inconsistencies were introduced unintentionally (RQ2; only 10% for the COBOL system); 3–23% of inconsistencies were confirmed faults (18% excluding COBOL), 107 developer-confirmed faults in total; fault density of inconsistent clones 3.4–91.4 faults/kLOC against literature ranges of 0.1–50.
- **Does NOT show:** Non-random sample; the fault share "is thus a lower bound, as potential faults in intentionally inconsistent clones are not considered"; clones that are consistently maintained are not shown to be costly; no effort data.
- **Quote (§7.3):** "Our results suggest that nearly every second unintentionally inconsistent change to a clone leads to a fault."
- **Quote (§1):** "clones do not directly cause faults but inconsistent changes to clones can lead to unexpected program behavior."
- **Relevance:** The strongest **FOR** on duplication, and it supports the paper's mechanism precisely: duplication is harmless until the duplicated decision changes; then one copy is updated and the other is not (**C1→C2**, realised as faults rather than effort). Developer-validated, industrial, cross-language.

### 4.3 Roy, C. K., & Cordy, J. R. (2007). A survey on software clone detection research. Queen's University Technical Report 2007-541. https://research.cs.queensu.ca/TechReports/Reports/2007-541.pdf — and Roy, C. K., Cordy, J. R., & Koschke, R. (2009). Comparison and evaluation of code clone detection techniques and tools: A qualitative approach. *Science of Computer Programming*, 74(7), 470–495. https://doi.org/10.1016/j.scico.2009.02.007
- **Type:** `[Survey]`. **Access:** primary: full text (2007 TR); 2009 SCP paper not read.
- **What it says:** Surveys detection techniques; §5 "Harmfulness of cloning: a justification" collects the standard harms (bug propagation, update anomalies, size growth, hidden design problems) and prevalence figures (Baker 13–20%, Baxter 12.7%, Mayrand 5–20%, Kapser & Godfrey 10–15%, one COBOL system ~50%).
- **Does NOT show:** Admits the cost has not been measured.
- **Quote (TR §2):** "Although the cost of maintaining clones over a system's lifetime has not been estimated yet, it is at least agreed that the financial impact on maintenance is very high."
- **Relevance:** Context for the FOR/AGAINST debate: as of 2007 the clone-cost claim was consensus without measurement; the studies below (Krinke, Göde & Koschke, Rahman) are the field's subsequent attempt to measure it, and they largely failed to find harm.

### 4.4 Krinke, J. (2008). Is cloned code more stable than non-cloned code? *Eighth IEEE International Working Conference on Source Code Analysis and Manipulation (SCAM 2008)*, 57–66. https://doi.org/10.1109/SCAM.2008.14
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** 200 weeks of evolution of five open-source systems; changes (additions/deletions/modifications) to cloned vs non-cloned code. Stability "is dominated by the deletion of code clones"; additions go more often to non-cloned code; net: cloned code is more stable.
- **Does NOT show:** Stability ≠ cost; token-based clones; later replications (Mondal et al.) report no consensus across systems.
- **Quote (abstract):** "If the dominating factor of deletions is eliminated, it can generally be concluded that cloned code is more stable than non-cloned code."
- **Relevance:** **AGAINST** C2 for clones specifically: cloned code is not a churn hotspot.

### 4.5 Göde, N., & Koschke, R. (2011). Frequency and risks of changes to clones. *Proceedings of the 33rd International Conference on Software Engineering (ICSE '11)*, 311–320. https://doi.org/10.1145/1985793.1985836
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** Clone evolution in mature projects with an incremental clone detector; most clones are rarely changed and unintentional inconsistent changes are few.
- **Does NOT show:** Mature projects only; number of systems not verified here.
- **Quote (abstract):** "most clones are rarely changed and the number of unintentional inconsistent changes to clones is small. We thus have to carefully select the clones to be managed."
- **Relevance:** **AGAINST**, tempering Juergens: the *rate* at which duplicated decisions actually change may be low, so the expected cost of a given duplicate is small even if the per-change risk is high. The paper should measure change rate of duplicated decisions, not just their count.

### 4.6 Kim, M., Sazawal, V., Notkin, D., & Murphy, G. (2005). An empirical study of code clone genealogies. *ESEC/FSE-13*, 187–196. https://doi.org/10.1145/1081706.1081737 (expanded TR UW-CSE-05-04-01 read)
- **Type:** `[PR-empirical]`. **Access:** primary: full text of the UW technical-report version.
- **What it measured:** Clone genealogies extracted check-in by check-in from two Java OSS projects (carol, dnsjava). Among genealogies that disappeared, 54–72% disappeared within an average of eight check-ins (of >160); 64–69% of genealogies consisted of clones that could not be easily refactored (long-lived, changed consistently with their group).
- **Does NOT show:** Two small systems; no cost data.
- **Quote (abstract):** "many code clones exist in the system for only a short time; extensive refactoring of such short-lived clones may not be worthwhile if they are likely diverge from one another very soon."
- **Relevance:** **Qualifies**: many duplicates are transient scaffolding, and the long-lived ones that co-change consistently are exactly the ones languages cannot easily unify — but *consistent co-change* is itself the paper's C2 burden (each change must be replicated). Also an AGAINST for naïve "de-duplicate everything" interventions.

### 4.7 Rahman, F., Bird, C., & Devanbu, P. (2012). Clones: what is that smell? *Empirical Software Engineering*, 17(4–5), 503–530. https://doi.org/10.1007/s10664-011-9195-3 (conference version MSR 2010, best paper)
- **Type:** `[PR-empirical]`. **Access:** primary: full text (third-party copy of the journal version; MSR 2010 version from Microsoft Research).
- **What it measured:** Four C open-source systems (Apache httpd, Nautilus, Evolution, GIMP), Deckard clone detection, bug-fix commits mapped to cloned lines. Findings: the great majority of bugs are not associated with clones; clones may be *less* defect-prone than non-cloned code; no evidence that clone groups with more copies are more error-prone; no evidence that clone groups spanning more than one file or directory are more defect-prone than collocated clones; developers do not need disproportionate effort (lines changed) to fix clone-dense bugs.
- **Does NOT show:** Defects ≠ change effort; bug mapping via commit messages; C systems; the "effort" proxy is lines in the fix.
- **Quote (abstract):** "Our findings do not support the claim that clones are really a 'bad smell' (Fowler et al. 1999)."
- **Quote (§1):** "rather surprisingly, one might conclude that bug-prediction tools could use cloned content as a negative indicator of defect-proneness!"
- **Relevance:** The strongest **AGAINST** on duplication — and it tests the paper's hypothesis directly (RQ4: *scattered* clones across files/directories are not more buggy). The paper must either measure effort rather than defects, or argue (with Juergens) that the harm is confined to the subset of duplicates whose decision later changes.

### 4.8 Lozano, A., & Wermelinger, M. (2008). Assessing the effect of clones on changeability. *IEEE International Conference on Software Maintenance (ICSM 2008)*. https://doi.org/10.1109/ICSM.2008.4658071
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** Maintenance effort measures on methods with vs without clones. "having a clone may increase the maintenance effort of changing a method"; the increase grows with the percentage of the system affected when clone-sharing methods are modified; but no systematic relation between method characteristics and the increase. Sjøberg et al.'s related-work table summarises it as "at least 50 percent of the methods with duplicated code required more change effort (partly significant)."
- **Does NOT show:** Mixed significance; four OSS systems (GanttProject, jEdit, Freecol, JBoss per Sjøberg's table).
- **Relevance:** Weak-to-moderate **FOR** on effort (rather than defects), partially offsetting Rahman; note that the effect scales with how much of the system co-changes, which is the paper's scattering variable.

---

## 5. Co-change / logical coupling

### 5.1 Gall, H., Hajek, K., & Jazayeri, M. (1998). Detection of logical coupling based on product release history. *Proceedings of the International Conference on Software Maintenance (ICSM '98)*, 190–198. https://doi.org/10.1109/ICSM.1998.738508
- **Type:** `[PR-empirical]` (method with industrial case). **Access:** primary: full text (Waterloo course PDF).
- **What it measured:** 20 releases over ~2 years of a large telecommunications switching system (~10 MLOC per release); uses only version numbers of programs/modules/subsystems plus change reports to find modules that repeatedly change together ("logical coupling") without any source-level dependency.
- **Does NOT show:** No cost or defect outcome; validation is qualitative (candidates "for restructuring").
- **Quote (§1):** "Our technique reveals hidden dependencies not evident in the source code and identifies modules that are candidates for restructuring."
- **Relevance:** Origin of the measurement the paper needs for **C1**: a decision implemented in several places shows up as modules that co-change although nothing in the code links them. Establishes existence, not cost.

### 5.2 Zimmermann, T., Weißgerber, P., Diehl, S., & Zeller, A. (2005). Mining version histories to guide software changes. *IEEE Transactions on Software Engineering*, 31(6), 429–445. https://doi.org/10.1109/TSE.2005.72 (ICSE 2004 version: 563–572)
- **Type:** `[PR-empirical]`. **Access:** primary: full text (Saarland PDF of the TSE version; ICSE 2004 PDF also read).
- **What it measured:** ROSE mines association rules from CVS histories of eight open-source projects (Eclipse, GCC, KOffice, Postgres, …). When ROSE makes a recommendation after an initial change, a correct further location is in its top three suggestions in >70% of cases; average precision >66%; in cases where ROSE warns about missing items, it predicts 75% of the items actually missing. Rules capture "coupling between items that cannot be detected by program analysis" (including non-code artefacts such as documentation).
- **Does NOT show:** Measures predictability of co-change, not its cost; the 70% figure applies only when ROSE issues a recommendation; 2004 version reported 64%.
- **Quote (abstract):** "the mined association rules 1) suggest and predict likely further changes, 2) show up item coupling that is undetectable by program analysis, and 3) can prevent errors due to incomplete changes."
- **Relevance:** FOR **C1** (co-change structure is pervasive and partly invisible to static analysis) and evidence that *incomplete changes* are a recognised failure mode (**C2**). Also a caution for the paper: tooling can partly compensate, so scattering's cost is contingent on tool support.

### 5.3 D'Ambros, M., Lanza, M., & Robbes, R. (2009). On the relationship between change coupling and software defects. *16th Working Conference on Reverse Engineering (WCRE 2009)*, 135–144. https://doi.org/10.1109/WCRE.2009.19
- **Type:** `[PR-empirical]`. **Access:** primary: abstract only (OpenAlex); the author PDF URL (inf.usi.ch/lanza/Downloads/DAmb2009e.pdf) returned 404. The result statement below is **secondary/unverified**.
- **What it measured:** Three large systems; tests whether change-coupling measures correlate with defects and improve metric-based bug-prediction models. Widely cited (e.g., by Palomba et al. 2018) as finding a positive correlation and improved prediction — I could not verify the coefficients.
- **Does NOT show:** Correlational; number and identity of systems unverified here.
- **Quote (abstract):** "Researchers have studied this dependency and have observed that it points to design issues such as architectural decay. It is still unknown whether change coupling correlates with a tangible effect of design issues, i.e., software defects."
- **Relevance:** FOR **C2** (co-change ↔ defects) if the reported result holds; cite with care.

### 5.4 Cataldo, M., Mockus, A., Roberts, J. A., & Herbsleb, J. D. (2009). Software dependencies, work dependencies, and their impact on failures. *IEEE Transactions on Software Engineering*, 35(6), 864–878. https://doi.org/10.1109/TSE.2009.42
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex; IEEE page rendered empty); body not read.
- **What it measured:** Two projects from two independent companies; eight years of development, 154 developers; compares syntactic, logical (co-change) and work (coordination) dependencies as predictors of customer-reported defects. "While all dependencies increase the fault proneness, the logical dependencies explained most of the variance in fault proneness, while workflow dependencies had more impact than syntactic dependencies."
- **Does NOT show:** Two systems; coefficients not available to me; defects not effort.
- **Quote (abstract):** "the logical dependencies explained most of the variance in fault proneness, while workflow dependencies had more impact than syntactic dependencies."
- **Relevance:** Strong **FOR C2**: the *hidden* dependencies created by decisions implemented in several places (visible only as co-change) matter more for failures than the dependencies the code declares. Also supports the socio-technical reading: failures arise where coordination needs (who must know about the decision) are not met — directly analogous to multiple agents editing without shared context.

### 5.5 Mockus, A., & Weiss, D. M. (2000). Predicting risk of software changes. *Bell Labs Technical Journal*, 5(2), 169–180. https://doi.org/10.1002/bltj.2229
- **Type:** `[PR-empirical]` (industrial journal). **Access:** primary: full text (mockus.org PDF).
- **What it measured:** Models the probability that a change to 5ESS switching software causes a failure, using properties of the change: size (LOC added/deleted), interval, **diffusion** (number of files, modules and subsystems touched), developer experience, change type. "we … find that change diffusion and developer experience are essential to predicting failures." Deployed as a web tool on the 5ESS project.
- **Does NOT show:** One system; coefficients not reproduced here; failure, not effort.
- **Quote (abstract):** "Such predictors include … diffusion of the change and its component subchanges, as reflected in the number of files, modules, and subsystems touched, or changed."
- **Relevance:** Strong **FOR C2** in exactly the paper's terms: the more places a single change must touch, the likelier it fails. Combined with Eick et al. (span rises over time) this closes the C1→C2 chain on one of the best-instrumented industrial systems in the literature.

### 5.6 Hassan, A. E. (2009). Predicting faults using the complexity of code changes. *Proceedings of the 31st International Conference on Software Engineering (ICSE '09)*, 78–88. https://doi.org/10.1109/ICSE.2009.5070510
- **Type:** `[PR-empirical]`. **Access:** primary: full text (SAIL lab PDF).
- **What it measured:** Shannon entropy of how modifications are scattered across files over time (Basic/Extended/File Code Change models) for six large open-source projects; change-entropy metrics predict faults better than prior modifications or prior faults.
- **Does NOT show:** Scattering is measured at the project/file level over periods, not per decision; correlational.
- **Quote (§2):** "A software system which has to endure highly scattered modifications as it implements requirements, will have a complex code change process."
- **Quote (abstract):** "our change complexity metrics are better predictors of fault potential in comparison to other well-known historical predictors of faults, i.e., prior modifications and prior faults."
- **Relevance:** FOR **C2**: scattered change — the signature of decisions spread across files — predicts faults better than churn itself. Offers the paper a ready metric (change entropy) with a published baseline.

### 5.7 Eaddy, M., Zimmermann, T., Sherwood, K. D., Garg, V., Murphy, G. C., Nagappan, N., & Aho, A. V. (2008). Do crosscutting concerns cause defects? *IEEE Transactions on Software Engineering*, 34(4), 497–515. https://doi.org/10.1109/TSE.2008.36
- **Type:** `[PR-empirical]`. **Access:** primary: full text (author copy, thomas-zimmermann.com).
- **What it measured:** Three case studies (Mylyn-Bugzilla, Rhino, iBATIS) mapping requirements/concerns to code and measuring degree of scattering (DOSC/DOSM, CDC/CDO) against bug counts. All three show moderate-to-strong, statistically significant Spearman correlations between scattering and defects (reported values range roughly 0.39–0.90 depending on metric and system; e.g., 0.57–0.61 for CDC/CDO in one study, 0.65–0.74 in another, 0.77/0.90 in Rhino). Stepwise regression and partial correlations are used to argue the effect is not purely size.
- **Does NOT show:** Correlation, not causation (the authors say so); scattering correlates with size (0.38–0.68); concern-to-code mapping is manual.
- **Quote (abstract):** "All three studies revealed a moderate to strong statistically significant correlation between the degree of scattering and the number of defects."
- **Quote (§2, quoting Robillard):** "Unsuccessful subjects made all of their code modifications in one [place]"; and the authors' own gloss: "maintainers may make changes incorrectly or neglect to make changes in all the right places."
- **Relevance:** The closest classical analogue of the paper's **C1→C2** claim, stated as "one concern implemented in several modules → more defects," with an explicit theory (maintainers miss places). Strong FOR, defect-side.

### 5.8 Tornhill, A., & Borg, M. (2022). Code Red: The business impact of code quality — a quantitative study of 39 proprietary production codebases. *Proceedings of the International Conference on Technical Debt (TechDebt '22)*, 11–20. https://doi.org/10.1145/3524843.3528091 (arXiv:2203.04374)
- **Type:** `[Industry]` authors (CodeScene founder; RISE researcher) at a peer-reviewed venue. **Access:** primary: full text (arXiv).
- **What it measured:** 39 proprietary codebases, 30,737 files, Jira issue transitions mapped to files; CodeScene's proprietary "Code Health" score (10.0 healthy → 1.0) as the quality proxy, which bundles function size, nesting, duplication and other smells. Low-health files: 15× more defects than healthy files; 124% more Time-in-Development per issue (≈2× slower); 9× longer maximum cycle times (higher uncertainty). Also reports that raw LOC correlates only weakly (r = 0.13) with issue resolution time.
- **Does NOT show:** Correlational; vendor metric and vendor author; file-level attribution of Jira time; no control for task difficulty beyond "comparable complexity"; no public dataset.
- **Quote (abstract):** "low quality code contains 15 times more defects than high quality code. Furthermore, resolving issues in low quality code takes on average 124% more time in development."
- **Relevance:** FOR **C2** with the largest industrial sample and the only direct *time* measure besides Sjøberg's; but "Code Health" is a composite, so it does not isolate duplication/scattering from size or nesting. Cite as industry evidence, flagged.

### 5.9 Tornhill, A. (2015; 2nd ed. 2024). *Your Code as a Crime Scene*. Pragmatic Bookshelf. ISBN 978-1-68050-038-7 (1st ed.).
- **Type:** `[Industry]` / `[Book]`. **Access:** secondary (not re-read for this review).
- **What it argues:** Hotspots (complexity × change frequency) and "temporal coupling" (files that change together) locate maintenance risk; popularises change-coupling analysis for practitioners.
- **Does NOT show:** No controlled evidence; worked examples on open-source repositories.
- **Relevance:** Practitioner framing of Gall/Zimmermann co-change ideas; useful for terminology ("temporal coupling") rather than evidence.

---

## 6. Technical debt

### 6.1 Cunningham, W. (1992). The WyCash portfolio management system. *OOPSLA '92 Experience Report* (Addendum to the Proceedings; *OOPS Messenger*, 4(2), 29–30). https://doi.org/10.1145/157709.157715 — text at https://c2.com/doc/oopsla92.html
- **Type:** `[Industry]` experience report. **Access:** primary: full text (c2.com).
- **What it argues:** Reports a ~4 MB-of-source Smalltalk financial system grown incrementally from a working prototype, where mature sections "have been revised or rewritten many times." Introduces the debt metaphor to justify consolidation.
- **Does NOT show:** No data; one team, one system.
- **Quote:** "Shipping first time code is like going into debt. A little debt speeds development so long as it is paid back promptly with a rewrite."
- **Quote:** "Every minute spent on not-quite-right code counts as interest on that debt. Entire engineering organizations can be brought to a stand-still under the debt load of an unconsolidated implementation."
- **Relevance:** The original statement is about **consolidation** — Cunningham's debt is specifically "an unconsolidated implementation," i.e., multiple not-yet-reconciled ways of doing the same thing. That is the paper's "new path added, old not retired" (**C1**) and its cost claim (**C2**) in the metaphor's founding text.

### 6.2 Kruchten, P., Nord, R. L., & Ozkaya, I. (2012). Technical debt: From metaphor to theory and practice. *IEEE Software*, 29(6), 18–21. https://doi.org/10.1109/MS.2012.167
- **Type:** `[Essay/opinion]` (guest editors' introduction). **Access:** primary: abstract (OpenAlex); body not read.
- **What it argues:** Organises the "technical debt landscape" (visible vs invisible elements; evolvability vs maintainability) and argues the term is over-applied; reserves it for invisible, mostly architectural, quality compromises that affect future evolution.
- **Quote (abstract):** "As the term is being used to describe a wide range of phenomena, this paper proposes an organization of the technical debt landscape."
- **Relevance:** Framing only; its point that the important debt is *invisible* and *architectural* matches Ernst et al. and the Dagstuhl report below.

### 6.3 Avgeriou, P., Kruchten, P., Ozkaya, I., & Seaman, C. (Eds.) (2016). Managing technical debt in software engineering (Dagstuhl Seminar 16162). *Dagstuhl Reports*, 6(4), 110–138. https://doi.org/10.4230/DagRep.6.4.110
- **Type:** `[Consensus report]`. **Access:** primary: full text (DROPS PDF).
- **What it says:** The "16162 definition": "In software-intensive systems, technical debt is a collection of design or implementation constructs that are expedient in the short term, but set up a technical context that can make future changes more costly or impossible." Also: "empirical examples collected from industry all point out that the most significant technical debt is caused by design trade-offs, which are not detectable by measuring code quality."
- **Does NOT show:** Consensus, not evidence.
- **Relevance:** The community's definition *builds C2 in* ("make future changes more costly or impossible"), and its remark that the worst debt is undetectable by code-quality metrics supports the paper's focus on decision-level coherence rather than smell counts.

### 6.4 Ernst, N. A., Bellomo, S., Ozkaya, I., Nord, R. L., & Gorton, I. (2015). Measure it? Manage it? Ignore it? Software practitioners and technical debt. *ESEC/FSE 2015*, 50–60. https://doi.org/10.1145/2786805.2786848 (ACM SIGSOFT Distinguished Paper)
- **Type:** `[PR-empirical]` (survey). **Access:** primary: abstract (OpenAlex); body not read (author PDF returned 401).
- **What it measured:** 1,831 respondents, mainly engineers/architects on long-lived projects at three large organisations, plus seven interviews; non-parametric statistics and qualitative coding. "architectural decisions are the most important source of technical debt"; existing tools are not helpful for the details.
- **Does NOT show:** Self-reported perception, not measured cost; three organisations.
- **Quote (abstract):** "We found that architectural decisions are the most important source of technical debt."
- **Relevance:** FOR the paper's level of analysis: practitioners locate debt at the level of *decisions*, not code smells — consistent with C1 being about decisions implemented inconsistently.

### 6.5 Besker, T., Martini, A., & Bosch, J. (2017). The pricey bill of technical debt: When and by whom will it be paid? *ICSME 2017*. https://doi.org/10.1109/ICSME.2017.42 — Besker, Martini & Bosch (2018). Technical debt cripples software developer productivity. *TechDebt '18*. https://doi.org/10.1145/3194164.3194178 — Besker, Martini & Bosch (2019). Software developer productivity loss due to technical debt — a replication and extension study examining developers' development work. *Journal of Systems and Software*, 156, 41–61. https://doi.org/10.1016/j.jss.2019.06.004
- **Type:** `[PR-empirical]` (survey + longitudinal self-report). **Access:** primary: full text for 2019 (Chalmers OA PDF); abstracts for 2017/2018.
- **What it measured:** 2017: web survey of 258 practitioners + 32 interviews; respondents *estimate* 36% of development time wasted on TD; "Complex Architectural Design and Requirement Technical Debt generates most negative effect." 2018/2019: 43 developers at six companies reported weekly over seven weeks; 16 interviews; on average 23% of working time wasted due to TD; the most common extra activity is additional testing; and "developers are frequently forced to introduce new TD due to already existing TD."
- **Does NOT show:** Self-reported time; Scandinavian industry; "TD" is whatever developers label as such; no code measurement.
- **Quote (2019 abstract):** "developers waste, on average, 23% of their time due to TD and that developers are frequently forced to introduce new TD."
- **Relevance:** FOR **C2** (a quantified, if perceptual, cost) and the clearest field evidence for **C3**: existing debt *forces* new debt. The paper can cite this as the human-developer baseline for the feedback loop it hypothesises for agents.

### 6.6 Potdar, A., & Shihab, E. (2014). An exploratory study on self-admitted technical debt. *ICSME 2014*, 91–100. https://doi.org/10.1109/ICSME.2014.31 (ICSME 2024 Most Influential Paper)
- **Type:** `[PR-empirical]`. **Access:** primary: full text (Concordia author PDF).
- **What it measured:** Source-code comments in Eclipse, Chromium OS, Apache httpd and ArgoUML; 62 comment patterns identify self-admitted technical debt (SATD). SATD is present in 2.4%–31% of files; more experienced developers introduce most of it; time pressure and code complexity do not correlate with it; only 26.3%–63.5% of SATD is removed after introduction.
- **Does NOT show:** Only *admitted* debt; no cost measurement.
- **Quote (abstract):** "although self-admitted technical debt is meant to be addressed or removed in the future, only between 26.3%-63.5% of self-admitted technical debt gets removed from projects after introduction."
- **Relevance:** FOR **C1** (retirement half): known shortcuts are left in place at scale; the "we'll clean this up later" path is often never retired.

### 6.7 Bavota, G., & Russo, B. (2016). A large-scale empirical study on self-admitted technical debt. *Proceedings of the 13th International Conference on Mining Software Repositories (MSR 2016)*, 315–326. https://doi.org/10.1145/2901739.2901742
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (unibz repository record); body not read.
- **What it measured:** Differentiated replication of Potdar & Shihab on 159 projects, >600K commits, ~2 billion comments, with open coding. SATD averages 51 instances per system; code debt 30%, defect and requirement debt 20% each; SATD increases over time because new instances are added and not fixed; even when fixed, SATD survives on average more than 1,000 commits.
- **Does NOT show:** Admitted debt only; no cost.
- **Relevance:** FOR **C1** at scale: debt accumulates monotonically and lingers; consistent with Tufano's 80% smell survival.

### 6.8 Wehaibi, S., Shihab, E., & Guerrouj, L. (2016). Examining the impact of self-admitted technical debt on software quality. *IEEE 23rd International Conference on Software Analysis, Evolution, and Reengineering (SANER 2016)*, 179–188. https://doi.org/10.1109/SANER.2016.72
- **Type:** `[PR-empirical]`. **Access:** primary: full text (author copy via faculty.ksu.edu.sa).
- **What it measured:** Hadoop, Chromium, Cassandra, Spark, Tomcat. (i) No clear trend in defects between SATD and non-SATD files, though SATD files become more defect-prone after the debt is introduced; (ii) SATD-related changes induce *fewer* future defects than other changes; (iii) SATD-related changes are more difficult — more churn, more files and modules touched, higher entropy.
- **Does NOT show:** Admitted debt only; difficulty is proxied by change-shape metrics, not time.
- **Quote (abstract):** "self-admitted technical debt changes are more difficult to perform, i.e., they are more complex."
- **Relevance:** **Qualifies C2**: debt's cost may surface as *harder, more diffuse changes* rather than more bugs — exactly the outcome variable the paper should prefer over defect counts (and the reason Rahman-style defect studies can miss it).

### 6.9 Nugroho, A., Visser, J., & Kuipers, T. (2011). An empirical model of technical debt and interest. *Proceedings of the 2nd Workshop on Managing Technical Debt (MTD '11)*, 1–8. https://doi.org/10.1145/1985362.1985364
- **Type:** `[Industry]` (Software Improvement Group) at a workshop. **Access:** abstract fragment only (OpenAlex/Crossref); body not read.
- **What it argues:** Operationalises debt as the repair effort needed to raise a system to a target maintainability level on SIG's star-rating model, and interest as the extra maintenance effort incurred at the lower level; applied to an industrial case. Any specific figures (repair effort, interest growth) are **unverified** here.
- **Does NOT show:** Model-based estimates, not observed effort; single vendor model.
- **Relevance:** Framing for the paper's cost model (principal vs interest); not evidence.

### 6.10 Zazworka, N., Shaw, M. A., Shull, F., & Seaman, C. (2011). Investigating the impact of design debt on software quality. *MTD '11*, 17–23. https://doi.org/10.1145/1985362.1985366
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** Two applications of a small company; god classes "are changed more often and contain more defects than non-god classes."
- **Does NOT show:** Not size-normalised (see Olbrich et al. 2010, which inverts the result when it is); two small systems.
- **Quote (abstract):** "god classes are changed more often and contain more defects than non-god classes."
- **Relevance:** Weak FOR; mainly useful as the foil for Olbrich's normalisation critique.

### 6.11 Martini, A., Bosch, J., & Chaudron, M. (2015). Investigating architectural technical debt accumulation and refactoring over time: A multiple-case study. *Information and Software Technology*, 67, 237–253. https://doi.org/10.1016/j.infsof.2015.07.005 — and Martini, A., & Bosch, J. (2017). On the interest of architectural technical debt: Uncovering the contagious debt phenomenon. *Journal of Software: Evolution and Process*, 29(10), e1877. https://doi.org/10.1002/smr.1877
- **Type:** `[PR-empirical]` (multiple-case). **Access:** **secondary** (Chalmers record for 2017; 2015 abstract not retrievable).
- **What it argues (2017, per record):** Multi-phase embedded case study at 9 sites in 6 large international companies; identifies which ATD items generate the most interest; finds some ATD items are "contagious" — their interest compounds, possibly exponentially — and recommends refactoring before a "crisis" point. The 2015 paper reports the accumulation-then-crisis-refactoring pattern across cases.
- **Does NOT show:** Qualitative; perceptions of practitioners; no code metrics.
- **Relevance:** Direct field support for **C3** (debt spreads and compounds) and for the paper's expectation that incoherence is tolerated until a threshold.

---

## 7. Complexity feedback loops and architectural cost

### 7.1 Banker, R. D., Datar, S. M., Kemerer, C. F., & Zweig, D. (1993). Software complexity and maintenance costs. *Communications of the ACM*, 36(11), 81–94. https://doi.org/10.1145/163359.163375
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read. The 1990 MIT Sloan working-paper draft (WP 23-90) reports roughly 35% higher cost for maintaining more complex code; that figure is **unverified** for the published version.
- **What it measured:** COBOL maintenance projects at a large commercial bank, modelled with a previously developed economic model controlling for manager-controllable project factors. "software maintenance costs are affected significantly by software complexity in terms of module size, procedure size, and branching complexity"; dollar estimates "high enough to justify complexity control and monitoring."
- **Does NOT show:** Complexity here is code-metric complexity (size, branching), not duplication or scattering; one site.
- **Relevance:** FOR **C2** in the general form "complexity raises maintenance cost," with the oldest econometric evidence; not specific to coherence.

### 7.2 Banker, R. D., Davis, G. B., & Slaughter, S. A. (1998). Software development practices, software complexity, and software maintenance performance: A field study. *Management Science*, 44(4), 433–450. https://doi.org/10.1287/mnsc.44.4.433
- **Type:** `[PR-empirical]`. **Access:** primary: abstract (OpenAlex); body not read.
- **What it measured:** 29 enhancement projects and 23 applications at a national mass-merchandising retailer (IBM COBOL). Two-stage model with complexity as the mediator between development practices and enhancement effort: code-generator use is associated with higher complexity and higher enhancement effort; packaged software with lower.
- **Does NOT show:** Complexity again code-metric; one organisation.
- **Quote (abstract):** "Poor design choices can result in complex software that is costly to support and difficult to change."
- **Relevance:** FOR **C2/C3**: development practice → complexity → later effort, with a tool-generated-code finding that is suggestive for AI-generated code (generated code was *more* complex and costlier to enhance).

### 7.3 Kemerer, C. F., & Slaughter, S. (1999). An empirical approach to studying software evolution. *IEEE Transactions on Software Engineering*, 25(4), 493–509. https://doi.org/10.1109/32.799945
- **Type:** `[PR-empirical]` (methods). **Access:** primary: full text (flosshub copy).
- **What it measured:** >25,000 change events to 23 commercial systems over 20 years; demonstrates phase-mapping and gamma-sequence analysis on two systems; reviews Belady–Lehman and successors.
- **Does NOT show:** This paper does not test the complexity→cost link; it notes complexity "may be correlated with the higher frequency of changes" as a hypothesis.
- **Relevance:** Context and dataset provenance for the Lehman tradition; cite for method, not for C2.

### 7.4 MacCormack, A., Rusnak, J., & Baldwin, C. Y. (2006). Exploring the structure of complex software designs: An empirical study of open source and proprietary code. *Management Science*, 52(7), 1015–1030. https://doi.org/10.1287/mnsc.1060.0552
- **Type:** `[PR-empirical]`. **Access:** primary: full text of the HBS working-paper version (05-016); figures below are from that version and may differ slightly in the journal.
- **What it measured:** Design structure matrices of Linux and Mozilla; defines **propagation cost** (fraction of elements affected, directly or indirectly, by a change to a random element). First Mozilla: 17.35%; comparable Linux: 5.16% — "A change to a source file in Mozilla has the potential to impact three times as many source files, on average"; Mozilla's 1998 purposeful redesign cut propagation cost by over 80% and dependencies by ~50%, making it more modular than Linux.
- **Does NOT show:** Structural potential, not observed cost; two products.
- **Quote (abstract):** "purposeful managerial actions can have a significant impact in adapting a design's structure."
- **Relevance:** **Qualifies**: coherence is not destiny — a deliberate redesign can restore it — and supplies a metric (propagation cost) for the paper's C1. The 17% vs 5% contrast is a concrete illustration of what "one change touches many places" looks like structurally.

### 7.5 Sturtevant, D. J. (2013). *System design and the cost of architectural complexity*. PhD thesis, MIT (Engineering Systems Division). https://dspace.mit.edu/handle/1721.1/79551
- **Type:** `[Thesis]` (supervised by MacCormack; basis of the HBS/Silverthread work). **Access:** primary: full text (annotated copy via swizec.com; 166 pp.).
- **What it measured:** Eight releases of a successful commercial software product; each source file scored for architectural complexity by DSM visibility (periphery / utility / control / **core**); outcomes: defect density, developer productivity, staff turnover, with statistical models.
- **Does NOT show:** One firm; observational; turnover result is a logistic model of who leaves.
- **Quote (Abstract):** "differences in architectural complexity could account for 50% drops in productivity, three-fold increases in defect density, and order-of-magnitude increases in staff turnover."
- **Relevance:** The strongest classical *cost* evidence for **C2** at the level of system structure: engineers working in highly-coupled core files are markedly less productive, their files more defective, and they are far more likely to leave. The thesis also notes (Ch. 4) the systems-dynamics loop among quality, productivity, rework and turnover — the human analogue of **C3**.

### 7.6 MacCormack, A., & Sturtevant, D. J. (2016). Technical debt and system architecture: The impact of coupling on defect-related activity. *Journal of Systems and Software*, 120, 170–182. https://doi.org/10.1016/j.jss.2016.06.007
- **Type:** `[PR-empirical]`. **Access:** **secondary** (HBS Working Knowledge listing; Elsevier page blocked). Findings below are as summarised there and should be checked against the article.
- **What it measured (per listing):** Two systems of similar size (>20,000 components each) with different architectures — one hierarchical, one core-periphery; coupling measures as predictors of defect-related activity; in both, components in the densely coupled core require more defect-related activity than peripheral ones.
- **Does NOT show:** Two systems; effect sizes not available to me.
- **Relevance:** FOR **C2**; journal-published companion to the thesis.

---

## Synthesis for the paper

### Strongest FOR (decisions spread across places → costlier/riskier later change)
1. **Eick et al. 2001** — span of changes rises over 15 years and predicts effort (single, well-instrumented industrial system).
2. **Mockus & Weiss 2000** — change diffusion (files/modules/subsystems touched) is "essential" to predicting failure.
3. **Cataldo et al. 2009** — logical (co-change) dependencies explain most variance in field failures, more than syntactic ones.
4. **Eaddy et al. 2008** — concern scattering correlates moderately-to-strongly with defects in three systems, with an explicit "missed a place" theory.
5. **Hassan 2009** — scattered-change entropy out-predicts churn and prior faults.
6. **Juergens et al. 2009** — 18% of inconsistent clone changes are faults; ~every second *unintentional* inconsistency is a fault.
7. **Xiao et al. 2016; Mo et al. 2021** — a few architecturally coupled file groups absorb 20–61% of maintenance effort; anti-pattern files are far more change/bug-prone across 19 projects.
8. **Sturtevant 2013** — 50% productivity drop, 3× defect density, ~10× turnover in architecturally complex files.
9. **Besker et al. 2017–2019; Martini & Bosch 2017** — 23–36% of developer time lost to debt; existing debt forces new debt; some debt is "contagious."
Conceptual anchors: Parnas 1972/1979 (information distribution), Parnas 1994 (ignorant surgery), Brooks (conceptual integrity; super-linear complexity), Ousterhout (change amplification; "complexity is incremental"), Cunningham ("unconsolidated implementation"), Lehman Law II, Dagstuhl definition.

### Strongest AGAINST (or deflating)
1. **Sjøberg et al. 2013** — in a controlled study with professionals, none of 12 smells (including Shotgun Surgery) raised effort once file size and number of changes were controlled; size and churn explained nearly everything.
2. **Rahman, Bird & Devanbu 2012** — clones, including clone groups *scattered across files and directories*, are not more defect-prone; possibly less.
3. **Krinke 2008; Göde & Koschke 2011** — cloned code is more stable; most clones rarely change and unintentional inconsistencies are rare.
4. **Kapser & Godfrey 2008** — 71% of clones judged beneficial; duplication can be deliberate change-decoupling.
5. **Olbrich et al. 2010** — size-normalised God/Brain classes are *less* change- and defect-prone.
6. **Kim et al. 2005** — most duplicates are short-lived; long-lived ones are often unrefactorable.
7. **Tufano et al. 2017** — most class-level smells are present at creation, not accreted (undercuts a purely "erosion by increments" story).
8. **MacCormack et al. 2006** — structure is a managerial choice; a redesign cut propagation cost by >80%.

### How the two sides reconcile (what the paper should operationalise)
- The AGAINST results are almost all about **textual duplication** or **file-local smells** measured against **defects**. The FOR results are about **hidden co-change dependencies / scattering of a decision or concern** measured against **failures of changes, effort, and change difficulty** (Mockus, Cataldo, Eaddy, Hassan, Eick, Wehaibi, Xiao). Juergens shows the bridge: duplication is cheap until the duplicated decision changes, at which point the two copies become a scattered decision and the per-change fault rate is high.
- Therefore the paper's "one decision implemented in several places" should be measured as **logical coupling / span of a change / concern scattering**, not clone density, and its cost as **task-level effort, change diffusion and change difficulty**, not file-level defect counts. Sjøberg's null result on Shotgun Surgery is a warning that file-level designs cannot see this cost.
- "New path added, old not retired" has direct precedent in Cunningham's "unconsolidated implementation," Parnas 1979's contraction problem, and the SATD/smell-survival data (26–64% of admitted debt removed; 80% of smells survive; SATD lingers >1,000 commits).
- The feedback loop (C3) has field evidence in humans (Besker: existing TD forces new TD; Martini: contagious ATD; Lehman Law II/VIII; Perry & Wolf's drift→violation loop) but no controlled measurement; this is a genuine gap the paper can fill.

### Surprises
- Brooks's "No Silver Bullet" treats elimination of duplication as *definitional* of software ("if they are [alike], we make the two similar parts into one") — duplicated decisions are thus accidental complexity by Brooks's own taxonomy.
- Eick et al.'s headline effect is numerically small (multi-file-change probability 2%→5%) yet doubles; and the authors flag growth as a confound.
- Banker et al. 1998 found tool-*generated* COBOL was more complex and costlier to enhance — an early data point on machine-produced code.
- Wehaibi et al.: admitted debt makes changes *harder* but not *buggier*; the cost of incoherence may hide in change shape rather than defect counts.
- Tufano et al.: only 9% of smell removals come from refactoring; most "retirement" happens by deleting the artifact.

### Gaps / caveats for the reviewer
- Only one controlled, effort-measured study (Sjøberg) exists, and it is negative; everything else is correlational or self-reported.
- Almost no classical study measures the cost of *retiring* an old path; Parnas 1979 argues contraction is as hard as extension, but no data.
- Numbers I could not verify against the primary text are flagged "unverified" above: Banker 1993's ~35%, Nugroho's model figures, D'Ambros's coefficients, MacCormack & Sturtevant 2016's effect sizes, Khomh's effect sizes, the Fowler page/wording.

## Appendix: retrieval record
- Read in full (PDF/HTML on disk in the session's download directory and `txt`): Perry & Wolf 1992; Parnas 1972, 1979, 1994; Lehman 1980, 1996 (and 1997 "nineties view"); Eick 2001; Brooks MMM ch. 4 (OCR) and NSB 1987; Sjøberg 2013; Palomba 2018; Tufano 2017; Kapser & Godfrey 2008; Juergens 2009; Roy & Cordy 2007 TR; Kim 2005 (TR); Rahman 2012 (journal) and 2010 (MSR); Gall 1998; Zimmermann 2005 and 2004; Mockus & Weiss 2000; Hassan 2009; Eaddy 2008; Tornhill & Borg 2022; Cunningham 1992; Avgeriou 2016; Besker 2019; Potdar & Shihab 2014; Wehaibi 2016; Kemerer & Slaughter 1999; MacCormack et al. 2006 (WP); Sturtevant 2013; Xiao 2016; Mo 2021.
- Abstract only (OpenAlex/Crossref/publisher record): van Gurp & Bosch 2002; de Silva & Balasubramaniam 2012; Le 2018; Olbrich 2010; Krinke 2008; Göde & Koschke 2011; Lozano & Wermelinger 2008; D'Ambros 2009; Cataldo 2009; Kruchten 2012; Ernst 2015; Bavota & Russo 2016; Besker 2017/2018; Zazworka 2011; Banker 1993, 1998; Nugroho 2011 (fragment).
- Secondary only: Ousterhout 2018 (Larson's notes); Fowler 1999/2018 (course slides, refactoring.guru); Khomh 2012 (Polytechnique record, citing papers); MacCormack & Sturtevant 2016 (HBS listing); Martini & Bosch 2017 (Chalmers record); Tornhill 2015 (not re-read).
- Not retrieved and therefore omitted: Thummalapenta et al. 2010 (EMSE 15(1):1–34) and Guo, Spínola & Seaman 2016 (EMSE 21(1):159–182) — both relevant (clone co-evolution; measured cost of deferring a TD item) but no abstract or text was reachable, so no claims are made about them.
