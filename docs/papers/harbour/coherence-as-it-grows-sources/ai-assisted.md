# Literature review — Empirical studies of AI-assisted / agent-written code

Slice: duplication, churn, maintainability, productivity, and performance declining as a codebase or its context grows (brownfield vs greenfield; repository size; long-context degradation). Classical SE literature (erosion, smells, clones, debt) and migration patterns are covered by other reviewers and are only referenced where an AI-era study leans on them.

Compiled 2026-10-08. Every figure below was read from the primary source unless the entry says otherwise ("secondary" = read from press/summary coverage because the primary was gated or unreadable; such figures are marked **[unverified vs. primary]**). Verbatim quotes are ≤40 words and come from the text actually read.

Relevance codes used in each entry:
- **(a)** AI-assisted code accumulating duplication / churn / unretired paths
- **(b)** difficulty rising with codebase size / complexity / context rather than with the agent
- **(c)** alternative explanations (harder tasks, inadequate abstractions, misunderstanding/implicit context, model changes, selection effects)

---

## 0. Orientation: how the evidence splits

| Claim | Strongest support | Strongest counter-evidence |
|---|---|---|
| AI assistance speeds up isolated / greenfield tasks | Peng 2023 (+55.8%), Paradis 2024 (~21%), Cui 2025 (+26% tasks), GitHub 2024 RCT | — (no serious dispute at task level) |
| Gains shrink or vanish in large, mature, high-standard codebases | METR 2025 (−19% in 1.1M-LOC repos), Stanford/Denisov-Blanch (0–10% brownfield-complex), FeatBench, RepoMod-Bench, SWE-bench Pro, Xu 2025 | METR 2026 (point estimates now −4% to −18% time, CIs cross zero), He et al. 2026 (2.09× PR throughput sustained in an enterprise), Vilas Boas 2026 brownfield case |
| AI-assisted code carries more duplication, less refactoring, more short-term churn | GitClear 2024/2025/2026, Huang et al. 2026 (1.87× redundancy), He et al. Cursor DiD, Kashif 2026, Liu et al. 2026 "Debt", Apiiro, CodeRabbit | He et al. Cursor DiD found duplication +7% *not significant*; GitHub 2024 RCT found slightly better maintainability on a toy task; Sawada 2026 (agent files edited *less*) |
| Accumulated complexity, not the model, is what slows later work | He et al. Cursor DiD (panel GMM: +100% complexity → −64.5% next-period velocity), Xu 2025, Denisov-Blanch RAMP, Faros 2026 | Much of the slowdown evidence is observational; METR lists five co-factors; model-generation effects are real (METR 2026, Stanford "December 2025 inflection") |
| Long-context degradation is a plausible mechanism | Liu 2023 (Lost in the Middle), NoLiMa, Chroma Context Rot, LongCodeU, LongCodeBench | Cao et al. 2026 (agents + file systems beat long-context SOTA by 17.3%); AGENTS.md study (more context ≠ better) |

---

## 1. Productivity evidence: experiments and field studies

### 1.1 Peng, Kalliamvakou, Cihon & Demirer (2023) — *The Impact of AI on Developer Productivity: Evidence from GitHub Copilot*
- **Cite:** arXiv:2302.06590 (13 Feb 2023). https://arxiv.org/abs/2302.06590
- **Type:** preprint (industry authors: GitHub/Microsoft + MIT).
- **Measured:** 166 offers → 95 developers recruited; 45 treatment / 50 control; 35 per arm completed. Task: implement an HTTP server in JavaScript from a template repo (skeleton + 12-check test suite). Mean completion 71.17 min (Copilot) vs 160.89 min (control) → **55.8% faster**, p = 0.0017, 95% CI [21%, 89%]. Success rate +7 pp, not significant (CI −0.11 to 0.25). Larger gains for less experienced developers, heavier daily coders, ages 25–44.
- **Does not show:** anything about existing codebases or code quality — "this study does not examine the effects of AI on code quality"; a standardized task rather than "a task where developers collaborate on large projects". COI: GitHub authors evaluating GitHub's product.
- **Quote:** "Productivity benefits may vary across specific tasks and programming languages."
- **Relevance:** (b) the canonical *greenfield, isolated* benchmark against which brownfield results are contrasted; (c) shows the "harder task" explanation must be reckoned with — this task was small and self-contained.

### 1.2 Paradis et al. (2024) — *How much does AI impact development speed? An enterprise-based randomized controlled trial*
- **Cite:** arXiv:2410.12944 (v3, 11 Nov 2024). https://arxiv.org/abs/2410.12944
- **Type:** preprint; Google-internal RCT (vendor-adjacent: Google evaluating its own tools).
- **Measured:** 96 Google engineers randomized 48/48; 93 completed (47 AI, 46 control). Task: starting from an existing changelist (10 files, 474 LOC), add a logging service in Google's monorepo, update build/data/test files until tests pass; designed for 0.5–2.5 h. Raw means 96 min (AI) vs 114 min (control), t(83.6)=2.11, p=.038. Adjusted estimate **≈21% faster** (β=−0.24, 95% CI [−0.51, 0.03] on log scale, p=0.086). Features: code completion, Smart Paste, NL→code.
- **Does not show:** quality ("Code quality was not explored"); long tasks (capped at 3 h); heterogeneity underpowered. The authors write they "cannot assume that the effect size obtained in our lab study will necessarily apply more broadly."
- **Quote:** "our confidence interval is large."
- **Relevance:** (b) an *in-monorepo* but *small, pre-scoped* task still shows a speedup — i.e., size of surrounding codebase alone does not kill gains when the task is bounded and the context is handed to the developer; (c) supports "task scoping/implicit context" as the live variable rather than raw LOC.

### 1.3 Cui, Demirer, Jaffe, Musolff, Peng & Salz (2025) — *The Effects of Generative AI on High-Skilled Work: Evidence from Three Field Experiments with Software Developers*
- **Cite:** Management Science, DOI 10.1287/mnsc.2025.00535; SSRN 4945566 (first posted Sept 2024). https://papers.ssrn.com/abstract=4945566 ; Microsoft Research page: https://www.microsoft.com/en-us/research/?p=1148213
- **Type:** peer-reviewed (INFORMS) field RCTs run inside Microsoft, Accenture, and an anonymous Fortune 100 firm; authors include Microsoft employees.
- **Measured:** 4,867 developers; random assignment of Copilot access. Pooled: **26.08% increase in completed tasks (SE 10.3%)** — a rough 95% interval of ~6% to ~46%. Less experienced developers adopted more and gained more.
- **Does not show:** code quality, maintainability, or review load; the outcome is *count of completed tasks/PRs*, not value delivered; individual-site estimates are noisy. COI: Microsoft authors.
- **Quote:** "a 26.08% increase (SE: 10.3%) in completed tasks".
- **Relevance:** (c) the strongest *positive* field evidence; it measures output volume, which is exactly the quantity GitClear/Faros/Apiiro say rises while quality and review load worsen — the two literatures are measuring different ends of the pipeline.

### 1.4 Becker, Rush, Barnes & Rein / METR (2025) — *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity*
- **Cite:** arXiv:2507.09089 (v2, 25 Jul 2025); blog https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- **Type:** preprint; independent non-profit RCT.
- **Measured:** 16 experienced maintainers, 246 real issues (avg ~2 h), 14 repositories (11 named, 3 anonymised). Repos average 23,000 stars, **1,100,000 LOC**, 20,000 commits, 710 committers, ~10 years old; developers average ~5 years and ~1,500 commits on their repo. Tools: mainly Cursor Pro + Claude 3.5/3.7 Sonnet. Result: **AI-allowed issues took 19% longer** (95% CI +2% to +39%, per METR's Feb 2026 post). Developers forecast −24% beforehand and still believed −20% afterwards; economists forecast −39%, ML experts −38%. Developers accepted <44% of AI generations; 56% "often need to make major changes to clean up AI code"; ~9% of time spent reviewing/cleaning AI output; 75% read every line of AI code.
- **Factor analysis (21 factors):** *likely contribute* — over-optimism about AI usefulness; high developer familiarity with repositories; **large and complex repositories**; low AI reliability; **implicit repository context**. *Unclear* (10) — e.g., experimentally driven overuse, trading speed for ease, AI increasing issue scope, sampling bias. *Unlikely* (6) — non-frontier models, cheating, issue dropout, non-robust estimator, etc.
- **Does not show:** generalisation beyond this population ("We do not claim that our developers or repositories represent a majority or plurality of software development work"); the effect of post-mid-2025 models; learning effects beyond ~50 h of Cursor use.
- **Quotes:** "The repositories themselves are large and mature"; "the size and maturity of the included repositories increases the amount of tacit knowledge" (App. C.1.5); "because of the overall size and complexity of the repositories included" (App. C.1.3); factor table: "AI doesn't utilize important tacit knowledge or context."
- **Relevance:** (b) the single most-cited data point for "gains invert in large, mature codebases"; the authors explicitly list repo size/complexity and implicit context as likely drivers. (c) but they list five co-factors — including developer over-familiarity and low AI reliability — so it does not isolate size from the agent. Note the repos are human-written, so this is about *working in* a large system, not about a system agents built.

### 1.5 METR (24 Feb 2026) — *We are Changing our Developer Productivity Experiment Design*
- **Cite:** https://metr.substack.com/p/2026-02-24-uplift-update
- **Type:** blog update from the same team (preliminary, self-described weak evidence).
- **Measured:** Follow-up began Aug 2025 with late-2025 tools: 57 developers (10 returning, 47 new), 143 repositories, 800+ tasks. Returning developers: **−18% time (CI −38% to +9%)**; new developers: **−4% (CI −15% to +9%)**. Pay dropped from $150/h to $50/h. 30–50% of surveyed developers skipped submitting some tasks because they did not want to do them without AI; one developer completed none of their AI-disallowed tasks. Time tracking unreliable when developers run multiple agents concurrently.
- **Does not show:** a statistically established speedup — both CIs include zero; selection effects "likely bias the speedup estimate downward" so it may be a lower bound; METR calls the data "only very weak evidence" of the size of improvement.
- **Relevance:** (c) *model change* is a real alternative explanation for the 2025 result — the same team now believes developers are "likely more sped up" by early 2026. For a paper claiming system-side degradation, this is the key caveat: time-series comparisons across 2024–2026 confound tool generations with codebase growth.

### 1.6 GitHub / Bauer (2024, updated Feb 2025) — *Does GitHub Copilot improve code quality? Here's what the data says*
- **Cite:** https://github.blog/news-insights/research/does-github-copilot-improve-code-quality-heres-what-the-data-says/
- **Type:** vendor-run RCT (GitHub).
- **Measured:** 243 recruited, 202 valid submissions (104 Copilot / 98 none), all ≥5 years Python; task: API endpoints for a fictional restaurant-review server with 10 unit tests; 1,293 blind reviews. Copilot group: 53.2% greater *likelihood* of passing all tests (p<0.01); 18.2 vs 16.0 lines per code error (13.6%, p=0.002, computed only on the 25 who passed all tests); readability +3.62%, reliability +2.94%, maintainability +2.47%, conciseness +4.16%, approval +5%.
- **Does not show:** anything about existing codebases, duplication across modules, or long-run maintainability; small single-task design; dataset corrected post-publication. COI: vendor.
- **Quote:** "code authored with GitHub Copilot has increased functionality and improved readability".
- **Relevance:** (a)/(c) the best *against* evidence at snippet scale — per-function quality can be equal or better; the duplication problem documented elsewhere is a *system-level*, cross-module phenomenon that a one-file task cannot detect.

### 1.7 Ziegler et al. (2022/2024) — *Productivity Assessment of Neural Code Completion* / *Measuring GitHub Copilot's Impact on Productivity*
- **Cite:** arXiv:2205.06537 (MAPS '22); journal version CACM 67(3), 2024 (DOI 10.1145/3633453 — verify). https://arxiv.org/abs/2205.06537
- **Type:** peer-reviewed workshop + CACM; all authors GitHub, Inc.
- **Measured:** 17,420 users emailed; 2,047 survey responses matched to telemetry. Mean acceptance rate ≈ 27% (mean 0.26, median 0.24 accepted/shown). Acceptance rate correlates with perceived productivity at ρ = 0.24 (p<0.0001) — the authors note "a considerable amount of unexplained variance."
- **Does not show:** objective productivity or quality; perception only. COI: vendor.
- **Relevance:** (c) establishes that *perceived* productivity tracks acceptance rate, which (with METR's perception gap) warns that developer self-report is not evidence of system health.

### 1.8 Uplevel Data Labs (2024) — *Can Generative AI Improve Developer Productivity? Here's what the real-life data suggests*
- **Cite:** vendor PDF (mirror: https://static.simonwillison.net/static/2025/uplevel-genai-productivity.pdf); coverage CIO 26 Sep 2024.
- **Type:** vendor report (engineering-analytics company), observational.
- **Measured (read from the PDF):** ~800 developers at "several enterprise engineering customers": 351 with Copilot access (TEST), 434 without (CONTROL); Jan 9–Apr 9 2023 vs Jan 8–Apr 7 2024; t-tests/z-tests. PR cycle time, throughput, complexity, PRs-with-tests: "neither helped nor hurt"; cycle time decreased by 1.7 minutes. **Bug rate +41%** for the Copilot-access group while issue throughput was unchanged. "Sustained Always On" (burnout proxy) fell 17% (Copilot) vs almost 28% (control).
- **Does not show:** causation — the report itself says "Analysis is based on whether individuals had access to Copilot, not actual usage" and "All results are observational, limited to the developers included, and not causal." Small, single-vendor customer sample; no random assignment. COI: vendor.
- **Quote:** "This suggests that Copilot access may impact code quality."
- **Relevance:** (a) early field signal that volume held while defects rose; weak design.

### 1.9 Denisov-Blanch et al. / Stanford (2024–2026) — *Does AI actually boost developer productivity?* (100k–120k developers)
- **Cite:** talk, AI Engineer (YouTube JvosMkuNxF8), talk page https://www.ai.engineer/talks/JvosMkuNxF8-quantify-ai-roi-in-software-engineering-stanford ; lab page https://softwareengineeringproductivity.stanford.edu/ ; method paper "Predicting Expert Evaluations in Software Code Reviews" arXiv:2409.15152 ; author page https://yegordb.com/
- **Type:** industry-academic research programme (Stanford); the greenfield/brownfield matrix exists only as **talk slides**, not a peer-reviewed paper. Co-founder of a commercial measurement company (P10Y) — COI to note.
- **Measured:** Lab reports 600+ organisations and 120k+ engineers since 2022. Method: an ML model trained to reproduce panels of 10–15 expert reviewers rating each commit on implementation time, maintainability and complexity (r = 0.82 coding time, r = 0.86 implementation time vs humans). From the talk page (read directly): matched cohort of 46 AI-using vs 46 non-AI teams, **median net gain ≈10%**; token usage vs gain correlation ≈0.20; an "environment cleanliness index" explains R²=0.40 of lift; one 350-person enterprise case: PRs +14%, maintainability (0–10) **−9%** and more erratic, **rework 2.5–2.6×**, effective output ≈+1%.
- **Greenfield/brownfield matrix [secondary — from htek.dev and CAST summaries of the talk; unverified vs. primary slides]:** greenfield-low-complexity 30–40%; greenfield-high-complexity 10–15%; brownfield-low-complexity 15–20%; **brownfield-high-complexity 0–10%**, sometimes negative; roughly half of gross gains consumed by rework; gains "evaporate" in low-resource languages; top-quartile teams 20–30%, bottom quartile ≤0.
- **Does not show:** causal identification (matched teams, not randomised); the matrix figures are reported from slides and some write-ups tie them to a 136-team/27-company subset rather than 100k developers. Author's own page says that through 2025 gains were "modest" and that "December 2025 marked an inflection in the data" — i.e., newer models changed the picture.
- **Quote (CAST summary of the study):** "delivering diminishing returns as codebases grow in size and complexity."
- **Relevance:** (b) the most direct quantitative statement that gains fall with brownfield + complexity; (a) the explicit rework/maintainability decline; (c) the "December 2025 inflection" is again a model-change caveat.

### 1.10 Faros AI (Jul 2025) — *The AI Productivity Paradox Report 2025*; (Apr 2026) *AI Engineering Report 2026: The Acceleration Whiplash*
- **Cite:** https://www.faros.ai/blog/ai-software-engineering ; https://faros.ai/blog/ai-acceleration-whiplash-takeaways
- **Type:** vendor telemetry reports (engineering-analytics company); correlational.
- **Measured 2025:** >10,000 developers, 1,255 teams, multiple companies; per-team comparison of lowest- vs highest-AI-adoption quarters; Spearman correlations, only metrics with ≥6 companies and significance reported. High-adoption periods: tasks completed **+21%**, PRs merged **+98%**, PR review time **+91%**, average PR size **+154%**, bugs per developer **+9%**, PRs touched/day +47%. "we observed no significant correlation between AI adoption and improvements at the company level."
- **Measured 2026:** 22,000 developers, >4,000 teams: bugs per developer **+54%**; median time-to-first-review +156.6%; median time in review +441.5%; incidents-to-PR ratio +242.7%; PRs merged without review +31.3%; lines-deleted-to-lines-added **+861%** ("warrants investigation" — could be rework of AI code, refactoring, or clean-up).
- **Does not show:** causation; results "specific to organizations using the Faros platform". COI: vendor.
- **Quote (2026):** the bug relationship "is not flattening... it's steepening."
- **Relevance:** (a) churn and review burden rising with adoption; (b) individual gains failing to aggregate to the organisation; (c) review bottleneck is an alternative to "codebase incoherence" as the reason later work slows.

### 1.11 DORA / Google Cloud (Oct 2024) — *Accelerate State of DevOps 2024*
- **Cite:** https://dora.dev/research/2024/dora-report/ ; announcement https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report ; research.google listing (39,000+ respondents).
- **Type:** industry survey research (Google), cross-sectional structural modelling.
- **Measured:** >39,000 professionals; 76% rely on AI for at least one daily task. Per 25% increase in AI adoption: documentation quality **+7.5%**, code quality **+3.4%**, code-review speed **+3.1%**; delivery throughput **−1.5%**, delivery stability **−7.2%** [the "per 25%" basis is from DORA's infographic; the blog gives the −1.5/−7.2 figures without the basis]. 39% report little/no trust in AI-generated code.
- **Does not show:** causation; self-reported perceptions of quality; the throughput/stability constructs changed in 2024 (rework rate added to stability).
- **Quote:** "improving the development process does not automatically improve software delivery — at least not without proper adherence to the basics of successful software delivery, like small batch sizes and robust testing mechanisms."
- **Relevance:** (a)/(c) perceived code quality up while delivery stability down is consistent with "locally fine, globally incoherent"; DORA's own explanation is batch size/fundamentals, not codebase structure.

### 1.12 DORA / Google Cloud (Sep 2025) — *State of AI-assisted Software Development*
- **Cite:** https://dora.dev/research/2025/dora-report/ ; announcement https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report ; InfoQ coverage https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025
- **Type:** industry survey research (Google).
- **Measured:** ~5,000 respondents + 100 h qualitative; 90% use AI at work; >80% believe AI increased their productivity; 30% little/no trust (down slightly). AI adoption now **positively** associated with throughput (reversing 2024) but **still negatively associated with delivery stability**. "fail fast, fix fast" did not offset instability.
- **Does not show:** causation; no magnitudes in public summaries.
- **Quotes:** "AI doesn't fix a team; it amplifies what's already there."; Laura Weis: "faster doesn't always mean better."
- **Relevance:** (c) DORA attributes outcomes to organisational control systems (testing, version control, loosely coupled architecture, fast feedback), i.e., to properties of the *system around the agent*; it says teams with "tightly coupled systems and slow processes see little or no benefit" — close to the paper's thesis but at the socio-technical rather than code-structure level.

### 1.13 He, Agarwal, Denisov-Blanch, Azaletskiy, Koyejo & Vasilescu (Jul 2026) — *AI Writes Faster Than Humans Can Review: A Longitudinal Study of an Enterprise 2x Mandate*
- **Cite:** arXiv:2607.01904. https://arxiv.org/abs/2607.01904
- **Type:** preprint (CMU/Stanford), single-company panel.
- **Measured:** 802 developers, 196,212 PRs, Jan 2024–Apr 2026, at a mid-sized company mandating 2× merged PRs per engineer since mid-2025. Per-capita throughput reached **2.09×** baseline by Apr 2026; staggered DiD attributes the within-developer gain to AI adoption and accumulated use; gain "concentrated in newer code" and "not separable across model generations". **Per-reviewer load roughly doubled and automated review overtook human review.** Merge and revert rates stable.
- **Does not show:** quality beyond merge/revert; randomisation; what happens to the "newer code" later.
- **Quote:** "per-reviewer load roughly doubled and automated review overtook human review."
- **Relevance:** (a) gains concentrated in *new* code (consistent with "add rather than retire"); (b)/(c) *against*: a sustained 2× in a brownfield enterprise, with no measured quality collapse — though the quality measures are coarse; also shows agent-reviews-agent becoming the default.

### 1.14 Xu, Medappa, Tunc, Vroegindeweij & Fransoo (2025/26) — *AI-Assisted Programming Decreases the Productivity of Experienced Developers by Increasing the Technical Debt and Maintenance Burden*
- **Cite:** arXiv:2510.10165 (v3, 28 Jan 2026). https://arxiv.org/abs/2510.10165
- **Type:** preprint (economics, econ.GN), observational OSS panel around Copilot's introduction.
- **Measured:** Productivity rises after Copilot, driven by peripheral (less experienced) contributors; post-AI code needs more rework to meet repo standards; **core developers review 6.5% more code and show a 19% drop in their own original-code productivity**.
- **Does not show:** per-commit AI attribution; randomisation; sample size not in abstract (full text not read).
- **Quote:** "productivity gains of AI may mask the growing burden of maintenance on a shrinking pool of experts."
- **Relevance:** (b) the mechanism by which difficulty accrues to *the system's stewards* rather than to the tool; (a) rework-to-standards is the churn signature; (c) could equally be read as "newcomers submit more low-quality work", i.e., a people effect.

---

## 2. Quality, duplication and churn at scale (repository mining and vendor telemetry)

### 2.1 GitClear (Jan 2024; lead author B. Harding per the gwern mirror filename — no byline on the landing page) — *Coding on Copilot: 2023 Data Suggests Downward Pressure on Code Quality (incl. 2024 projections)*
- **Cite:** https://www.gitclear.com/coding_on_copilot_data_shows_ais_downward_pressure_on_code_quality (gated PDF; text mirror read at public.amplenote.com/BL6RLiQo6qqwoP7HNf6gqcRo; gwern mirror 2024-harding.pdf).
- **Type:** vendor report (code-analysis product); correlational time series.
- **Measured:** ~153M changed lines, 2020–2023 (2023 alone: 1,019,680 commits, 1,294 repos, 53.4M lines changed). Operation shares (2020 → 2023): Added 39.18% → 42.34%; Deleted 19.47% → 21.12%; Updated 5.19% → 5.50%; **Moved 24.99% → 16.92%**; **Copy/pasted 8.26% → 10.49%**; Find/replaced 2.92% → 3.63%. **Churn** (lines reverted/updated within 2 weeks of authorship): 3.32% (2020), 3.63% (2021), 3.97% (2022), **5.53% (2023)**, projected 7.09% (2024) — the 2024 projection "comes from a quadratic regression run by an OpenAI Assistant". Definitions: *Moved* = "A line of code that is cut and pasted to a new file, or a new function within the same file" (content unchanged); *Copy/pasted* = identical non-keyword content "committed to multiple files or functions within a day"; churn = "changes that were either incomplete or erroneous when the author initially accepted, committed, and pushed them."
- **Does not show:** which lines were AI-written (no per-line attribution — the whole inference is "observed to correlate with the proliferation of Copilot"); how repos were selected (GitClear customers + OSS); causation. COI: vendor selling the metrics it reports.
- **Relevance:** (a) the origin of the "moved code falls, copy/paste rises" claim; "moved" is a proxy for refactoring, so its decline is the paper's "old path not retired" signal at industry scale.

### 2.2 GitClear (Feb 2025) — *AI Copilot Code Quality: 2025 Look Back at 12 Months of Data* (v2025.2.5)
- **Cite:** https://www.gitclear.com/ai_assistant_code_quality_2025_research ; PDF https://gitclear-public.s3.us-west-2.amazonaws.com/GitClear-AI-Copilot-Code-Quality-2025.pdf (text extracted locally and read).
- **Type:** vendor report; correlational.
- **Measured (primary):** 211M changed lines, 2020–2024; "about two-thirds private corporations that have opted in to anonymized data sharing, and one-third open source projects (mostly those run by Google, Facebook, and Microsoft)"; a little under half of raw git "lines changed" survive GitClear's exclusions. Table (2020 → 2023 → **2024 actual**): Added 39.2 → 42.3 → **46.2%**; Deleted 19.1 → 21.1 → 21.9%; Updated 5.2 → 5.6 → 5.9%; **Moved 24.1 → 15.8 → 9.5%** (−39.9% YoY); **Copy/pasted 8.3 → 10.6 → 12.3%**; Find/replaced 2.9 → 3.6 → 4.2%; **Churn 3.1 → 4.5 → 5.7%** (+26% YoY). 2024 is "the first year that 'Copy/Pasted' frequency beat 'Moved' line frequency". **Duplicate blocks** (Type-1 clones of ≥5 lines, per commit): commits containing a dupe block 0.70% (2020), 0.48% (2021), 0.45% (2022), 1.80% (2023), **6.66% (2024)** — "approximately 10x higher than it had been two years prior" (press: "8x"). Note the small scan: 56,495 commits in 2024, and pre-2024 years were back-filled from the 1,000 *largest* commits per repo, which the report says should bias earlier years *upward*. **Age of revised code** (~8M changed lines, ~10,000 repos): share of modified lines touching code <1 month old 70.0% (2020) → **79.2% (2024)**; code >1 year old 5.3% → 3.9%. New lines revised within a month up 20–25% vs the 2021 baseline.
- **Does not show:** AI attribution per line; representativeness (opt-in customers + big-tech OSS); causation (the report hedges with "may"/"suggests" and uses DORA 2024 as corroboration). The press-release "4x more code cloning" is not supported by the table (≈1.5× for copy/paste; the 8–10× is for ≥5-line blocks in a small commit sample). COI: vendor.
- **Quotes:** "If every new feature is implemented via added code (without seeking out update, move, and delete opportunities), the repo grows crowded with cloned and near-cloned blocks."; "Adding new developers becomes increasingly expensive, as they struggle to determine which function, among a multitude of similar choices, should be considered the 'canonical' version".
- **Relevance:** (a) the clearest industry-scale description of exactly the paper's mechanism — added code without update/move/delete; (b) GitClear's stated mechanism is context-window limits ("the most popular code assistant of 2024 was limited to roughly 10 files that could fit in its context window"), i.e., the agent cannot see the existing path to reuse it; (c) it is correlational and the duplicate-block sample is small.

### 2.3 GitClear (2026) — *The Maintainability Gap: AI Code Quality in 2026*
- **Cite:** https://www.gitclear.com/the_ai_code_quality_maintainability_gap
- **Type:** vendor report.
- **Measured:** 623M analysed changes, 2023–2026 YTD. Moved/refactored share 21% (2022) → 13% (2023) → **3.8% (YTD 2026)**; copy/paste 9.4% (2022) → **15.7% (H1 2026)**; block duplication index 40.3 (2023) → 73.0 (+81%); **function connectivity (cross-file calls per changed unit) −35%**; **long-term update percent (changes touching code last modified >12 months ago) 1.7% → 0.46%, −74%**; two-week churn +15%; error-masking constructs +47%.
- **Does not show:** AI attribution; some internal inconsistencies (chart units, "~5x" vs ≈4.1× from own numbers).
- **Relevance:** (a) the "legacy maintenance −74%" and "connectivity −35%" metrics are the closest available operationalisation of "new paths added, old paths not retired, and new code not wired to existing abstractions"; treat as vendor signal to be triangulated, not as proof.

### 2.4 He, Miller, Agarwal, Kästner & Vasilescu (MSR 2026) — *Speed at the Cost of Quality: How Cursor AI Increases Short-Term Velocity and Long-Term Complexity in Open-Source Projects*
- **Cite:** arXiv:2511.04427 (v3, 26 Jan 2026); DOI 10.1145/3793302.3793349. https://arxiv.org/abs/2511.04427
- **Type:** peer-reviewed (MSR '26), quasi-experimental.
- **Measured:** 806 GitHub repos that adopted Cursor vs 1,380 propensity-matched (1:3) controls; staggered-adoption DiD with monthly SonarQube (Community) measurements. Velocity: lines added **+281.3% in month 1, +48.4% in month 2**, then no significant gain ("The only significant development velocity gain is in the first two months post Cursor adoption"); commits +55.4%/+14.5% then n.s. Quality: **static-analysis warnings +30.3%** and **code complexity +41.6%** on average, both *persistent*; **duplicate-line density +7.0%, not significant** (heavy adopters may show modest increases). Panel GMM: a 100% increase in complexity is associated with a **64.5% decrease in lines added next period**; +100% warnings → −50.3%; the velocity gain would be fully offset by ≈5× warnings or ≈3× complexity.
- **Does not show:** causation beyond DiD assumptions; which commits were AI-written; velocity does not fall *below* the pre-adoption baseline in the excerpts read — the "slowdown" is relative to the spike and is a modelled long-run interaction; SonarQube warnings are approximate.
- **Quotes:** "statistically significant, large, but transient increase in project-level development velocity"; "substantial and persistent increase in static analysis warnings and code complexity"; "increases in static analysis warnings and code complexity are major factors driving long-term velocity slowdown."
- **Relevance:** **(b) the single best piece of evidence that the accumulated state of the codebase, not the tool, predicts later slowdown** — the dynamic panel explicitly models complexity at t−1 driving velocity at t. (a) *caveat*: duplication specifically was not significant here; the persistent signal is complexity + warnings.

### 2.5 Liu, Widyasari, Zhao, Irsan, Chen & Lo (Mar 2026) — *Debt Behind the AI Boom: A Large-Scale Empirical Study of AI-Generated Code in the Wild*
- **Cite:** arXiv:2603.28592 (v2, 26 Apr 2026). https://arxiv.org/abs/2603.28592
- **Type:** preprint (SMU/HUST).
- **Measured:** 302.6k verified AI-authored commits from 6,299 repos, five assistants; static analysis before/after each commit → **484,366 distinct introduced issues; code smells 89.3%**; ">15% of commits from every AI coding assistant introduce at least one issue"; **22.7% of AI-introduced issues still present at the latest revision**.
- **Does not show:** a human baseline per change (not in abstract); which smells (duplication not broken out in the abstract).
- **Relevance:** (a) persistence of introduced issues is a direct measure of "not retired"; the dominance of smells over bugs matches Sonar/CodeRabbit.

### 2.6 Huang, Jaisri, Shimizu, Chen, Nakashima & Rodríguez-Pérez (MSR 2026) — *More Code, Less Reuse: Investigating Code Quality and Reviewer Sentiment towards AI-generated Pull Requests*
- **Cite:** arXiv:2601.21276 (29 Jan 2026), accepted MSR 2026. https://arxiv.org/abs/2601.21276
- **Type:** peer-reviewed (MSR 2026 Mining Challenge on AIDev).
- **Measured:** 3,858 PRs in Python repos (>500 stars) for metrics/sentiment; redundancy on 617 PRs in crewAI. New functions embedded with CodeSage-Large; Max Redundancy Score = highest cosine similarity to any existing function (Type-4 semantic clones; moves/renames filtered with PyRef). **Average Max Redundancy 0.2867 (agents) vs 0.1532 (humans), ≈1.87×, Mann-Whitney p<0.001**; the gap sits in the 0.3–0.8 similarity band. Cyclomatic complexity change: 85% of pairs zero, no meaningful difference. Reviewers show more neutral/joy toward agent PRs, more disgust/anger/fear toward human PRs.
- **Does not show:** generality (redundancy measured on one repository, Python only); whether redundant functions were later consolidated.
- **Quote:** LLM agents "frequently disregard code reuse opportunities".
- **Relevance:** **(a) the most direct peer-reviewed measurement of the paper's core claim — agents re-implement logic that already exists** — and the sentiment finding supplies a mechanism for why it goes unnoticed: plausible code draws less reviewer scrutiny, so redundancy "accumulates as silent technical debt."

### 2.7 Cynthia, Muttakin & Roy (Jan 2026) — *Beyond Bug Fixes: An Empirical Investigation of Post-Merge Code Quality Issues in Agent-Generated Pull Requests*
- **Cite:** arXiv:2601.20109. https://arxiv.org/abs/2601.20109
- **Type:** preprint (AIDev-based).
- **Measured:** 1,210 merged agentic bug-fix PRs (Python, five agents); SonarQube differential base→merged. Smells dominate at critical/major severity; **"apparent differences in raw issue counts across agents largely disappear after normalizing by code churn"** — issue counts track PR size; merge success does not reflect post-merge quality.
- **Relevance:** (c) *agent identity is not the variable* — size of change is; supports looking at system-level accumulation rather than model choice.

### 2.8 Kashif, Li, Liang, Tahir, Feng, Li & Shahin (Apr 2026) — *Beyond Functional Correctness: Design Issues in AI IDE-Generated Large-Scale Projects*
- **Cite:** arXiv:2604.06373. https://arxiv.org/abs/2604.06373
- **Type:** preprint (case-study generation).
- **Measured:** 10 projects generated with **Cursor** under an incremental Feature-Driven Human-In-The-Loop workflow (scaffold, then "we pick a feature from the tasklist.md file and iteratively complete all tasks for that feature"); avg 16,965 LOC / 114 files; functional correctness 91%. CodeScene: 1,305 design issues — **Code Duplication 383 (28.4%)**, Complex Method 377 (27.9%), Large Method 171 (12.6%), Complex Conditional 112, Primitive Obsession 60, etc.; SonarQube 3,193 valid issues (after removing 33.5% false positives) in 11 categories incl. "Dead, Duplicate or Redundant Code". Principles violated: SRP, SoC, DRY.
- **Does not show:** growth of issues with size (no correlation analysis), human baseline, or long-run evolution.
- **Quote:** the projects "nevertheless contain design issues that may pose long-term maintainability and evolvability risks."
- **Relevance:** **(a) direct evidence that incremental, feature-by-feature agent development produces duplication as the #1 design issue, even when every feature works** — closest experimental analogue to "a codebase built incrementally by agents".

### 2.9 Denisov-Blanch, …, Vasilescu, Schaeffer (Aug 2026) — *A Few Pages of Markdown: Committed AI Configuration and Lower Quality Cost after Coding-Agent Adoption*
- **Cite:** arXiv:2608.25241; ACM DOI 10.1145/3832783.3837546 (venue listed by author page as ASE 2026 — verify). https://arxiv.org/abs/2608.25241 **[figures from secondary summaries; unverified vs. primary]**
- **Type:** preprint/accepted paper; industry data.
- **Measured:** 441 private repos, 27 firms; Repository AI Maturity Profile (4 tiers of committed agent configuration). Commits rose 28–38% after agent adoption regardless of tier. Among agent-first teams, repos with *no* committed config saw **cognitive complexity +52.7%** vs **+26.7%** with basic rules/standards; warnings +24.1% vs +14.0%; duplicated-code measure barely separated the groups.
- **Does not show:** causation (self-described hypothesis-generating); content quality of the config.
- **Relevance:** (b)/(c) complexity accrues *after agent adoption* in every group — the system degrades even when speed is up — but explicit, committed conventions halve the rate, pointing to "inadequate abstractions/implicit context" as a manipulable cause rather than an agent limit.

### 2.10 Ji, Wang, Zhou, Chen & Yang (2026) — *An Exploratory Study on LLM-Generated Code and Comments in Code Repositories*
- **Cite:** arXiv:2607.01867; accepted J. Systems & Software (Jul 2026). https://arxiv.org/abs/2607.01867
- **Type:** peer-reviewed (JSS), detector-based proxy.
- **Measured:** Active company- and community-maintained repos 2021–2025; code flagged as likely LLM-generated shows "substantial intra-repository code clones" (secondary summary: file-level clone rates >70% in most repos, method-level 10–35% **[unverified]**); flagged code share decreased over time and concentrates in tests; company repos have more flagged code; few human-labelled bugs associated with it.
- **Does not show:** ground truth (detector-based); human clone baseline.
- **Relevance:** (a) repo-level clone evidence, weak on attribution.

### 2.11 Wu et al. (FSE 2025) — *An Empirical Study of Code Clones from Commercial AI Code Generators*
- **Cite:** Proc. ACM Softw. Eng. (FSE 2025), DOI 10.1145/3729397; https://conf.researchr.org/details/fse-2025/fse-2025-research-papers/111/… **[secondary; full text not read]**
- **Type:** peer-reviewed.
- **Measured:** three commercial generators; combined Type-1/Type-2 clone rate up to **≈7.5%** (per-language ≈7.5% Java, 4.7% Python, 3.3% C per a conference report); risks: copyright, propagation of vulnerable code.
- **Relevance:** (a) clones *of training data* — a different mechanism from intra-repo redundancy; include only to delimit the claim.

### 2.12 Sawada, Shirai, Kashiwa, Yamaguchi, Iwata & Iida (EASE 2026) — *To What Extent Does Agent-generated Code Require Maintenance?*
- **Cite:** arXiv:2605.06464. https://arxiv.org/abs/2605.06464
- **Type:** peer-reviewed short paper (EASE 2026), AIDev-based.
- **Measured:** >1,000 files, ~3,200 changes, 100 popular repos. "AI-generated files receive less frequent maintenance than human-authored code"; "the most frequent modifications to AI code are feature extensions" (humans' are bug fixes); "human developers perform the large majority of this maintenance" (secondary: ~83% **[unverified]**).
- **Does not show:** whether low churn means stability or neglect (the authors reportedly caution it could reflect code that is hard to understand or little used).
- **Relevance:** (a) *against* a naive churn story, and *for* the "unretired paths" story — agent files are extended, not fixed or removed.

### 2.13 Watanabe, Li, Kashiwa, Reid, Iida & Hassan (2025/26) — *On the Use of Agentic Coding: An Empirical Study of Pull Requests on GitHub*
- **Cite:** arXiv:2509.14745 (v3, 9 Feb 2026). https://arxiv.org/abs/2509.14745
- **Type:** preprint (Queen's/NAIST).
- **Measured:** 567 Claude Code PRs in 157 OSS projects vs same-repo, same-author human PRs. Merged **83.77% vs 91.01%** (χ², p<0.05); median time-to-merge 1.23 h vs 1.04 h. 45.1% of merged agent PRs modified before merge: bug fixes 47.7%, documentation 29.0%, **refactoring 27.1% ("including eliminating code duplication and aligning with architecture")**, style/conventions 23.4%, chores 21.0%, tests 16.4%. Of 92 rejected: 64.1% no stated reason; 12.0% "implemented by another PR"; too large 3.3%; non-optimal design 2.2%; increased complexity 1.1%; "no confidence in AI-generated code" 1.1%. "agent-generated code frequently implements optimistic error handling strategies".
- **Does not show:** post-merge quality; the rejection-reason shares rest on the 36% with stated reasons.
- **Quote:** rejections "primarily driven by project context".
- **Relevance:** (a) the human pre-merge fix-list is literally "remove duplication, align with architecture, follow conventions"; (c) rejections are about *fit to the project*, not code defects — supports "implicit context" over "agent can't code".

### 2.14 Ehsani, Pathak, Rawal, Al Mujahid, Imran & Chatterjee (MSR 2026) — *Where Do AI Coding Agents Fail? An Empirical Study of Failed Agentic Pull Requests in GitHub*
- **Cite:** arXiv:2601.15195. https://arxiv.org/abs/2601.15195
- **Type:** peer-reviewed (MSR 2026), AIDev-based.
- **Measured:** 33k agent PRs; overall merge 71.48%: **Codex 82.59%, Cursor 65.22%, Claude Code 59.04% (n=459), Devin 53.76%, Copilot 43.04%**. Not-merged PRs larger (Cliff's δ 0.17 lines, 0.10 files); each additional failed CI check cuts merge odds ≈15% (OR 0.85). Of 600 sampled rejections: reviewer abandonment 38%; **duplicate PR 23%**; CI/test failure 17%; unwanted feature 4%; incorrect implementation 3%; incomplete 2%; misalignment with reviewer instructions 1%. Documentation/CI/build tasks merge most; performance and bug-fix least.
- **Does not show:** post-merge quality; agent comparison is confounded by repo mix (the merge rates are raw).
- **Quote:** "difficulties of agents in task selection, coordination, and alignment with repository context."
- **Relevance:** (a) 23% of rejected agent PRs duplicate work already in flight — redundancy at the *PR* level; (c) the dominant failure is socio-technical (abandonment, coordination), not capability.

### 2.15 Li, Zhang & Hassan (Jul 2025) — *The Rise of AI Teammates in Software Engineering 3.0* (AIDev dataset)
- **Cite:** arXiv:2507.15003. https://arxiv.org/abs/2507.15003
- **Type:** preprint + dataset (basis for most 2026 MSR-challenge papers above — they are **not independent samples**).
- **Measured:** 456,000+ agent-authored PRs (Codex, Devin, Copilot, Cursor, Claude Code), 61,000 repos, 47,000 developers. Agents faster but "their PRs are accepted less frequently"; agent PRs structurally simpler by complexity metrics; one developer "submitted as many PRs in three days as they had in three years."
- **Relevance:** (a)/(c) volume shock + lower acceptance; context for interpreting all AIDev-derived figures.

### 2.16 CodeRabbit / Loker (17 Dec 2025) — *State of AI vs Human Code Generation*
- **Cite:** https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
- **Type:** vendor report (AI code-review product).
- **Measured:** 470 OSS PRs (320 AI-co-authored by signal detection, 150 "human"); issues per PR **10.83 vs 6.45 (≈1.7×)**; critical/major ≈1.4–1.7×; logic/correctness +75%; readability >3×; error-handling gaps ~2×; naming inconsistencies ~2×; formatting 2.66×; security up to 2.74×; excessive I/O ≈8×. "no issue category was unique to AI."
- **Does not show:** maintainability or duplication as categories; authorship is heuristic ("cannot guarantee all the PRs we labelled as human authored were actually authored only by humans"); tiny sample. COI: vendor whose product finds issues.
- **Relevance:** (a) AI code "violates local patterns around naming, clarity, and structure" — the convention-drift side of incoherence.

### 2.17 Sonar / Sarkar (13 Aug 2025) — *The Coding Personalities of Leading LLMs*; Sabra, Schmitt & Tyler (Aug 2025) — *Assessing the Quality and Security of AI-Generated Code: A Quantitative Analysis*
- **Cite:** https://www.sonarsource.com/blog/the-coding-personalities-of-leading-llms/ ; arXiv:2508.14727 (Sonar authors). https://arxiv.org/abs/2508.14727
- **Type:** vendor report + vendor-authored preprint (SonarQube).
- **Measured:** 4,400+ Java assignments; GPT-5 (minimal), Claude Sonnet 4, Claude 3.7 Sonnet, GPT-4o, Llama 3.2 90B, OpenCoder-8B. **Code smells >90% of issues for every model**; blocker-severity vulnerabilities 62.5% (GPT-4o), >70% (Llama); Claude 3.7 → Sonnet 4: pass rate +6.3% but bug severity "+93%"; Claude Sonnet 4 writes >3× the LOC of OpenCoder-8B for the same problems; "no direct correlation between functional performance (Pass@1) and code quality or security." Secondary (arXiv-derived): Claude Sonnet 4 1.14 bugs / 0.38 vulns / 17.96 smells per KLOC **[unverified]**.
- **Does not show:** repository context; Java only; vendor tool is the judge.
- **Quote:** "Every model showed a deep tendency to write code that is hard to maintain."
- **Relevance:** (c) *better benchmark scores do not buy maintainability* — argues against "wait for a better model" as the remedy; verbosity (more LOC per problem) is a plausible driver of later reconstruction cost.

### 2.18 Veracode (30 Jul 2025) — *2025 GenAI Code Security Report*
- **Cite:** https://www.veracode.com/blog/genai-code-security-report/
- **Type:** vendor report (SAST).
- **Measured:** >100 LLMs, 80 tasks, Java/Python/C#/JavaScript; **45% of samples failed security tests** (Java 72%, C# 45%, JS 43%, Python 38%); XSS undefended in 86% of relevant samples; "Security performance remained flat, regardless of model size or training sophistication."
- **Does not show:** maintainability; tasks target known CWEs; vendor tool judges.
- **Relevance:** (c) another "capability up, quality flat" datapoint.

### 2.19 Apiiro (Sep 2025) — *4x Velocity, 10x Vulnerabilities* [read via The Register, 5 Sep 2025 — primary blog returned 403]
- **Cite:** https://apiiro.com/blog/4x-velocity-10x-vulnerabilities-ai-coding-assistants-are-shipping-more-risks/ ; https://www.theregister.com/2025/09/05/ai_code_assistants_security_problems
- **Type:** vendor report (AppSec).
- **Measured:** tens of thousands of repos, several thousand developers at Fortune 50 firms. AI-assisted developers: 3–4× more code; **10× more security findings** (broad "risk" category; also >10,000 new findings/month by Jun 2025, 10× Dec 2024); syntax errors −76%, logic bugs −60%, **privilege-escalation paths +322%, architectural design flaws +153%**; secrets exposed ~2×; "more code into fewer pull requests", touching more files/services.
- **Does not show:** controls for who uses AI; exploitability; definitions. COI: vendor.
- **Quote:** "AI is fixing the typos but creating the timebombs."
- **Relevance:** (a)/(b) local errors down, *architectural/cross-service* errors up — the signature of incoherence being structural rather than line-level.

### 2.20 Aribe & Labastida (Sep 2026) — *The Vibe Shift in Software Engineering*
- **Cite:** arXiv:2609.09560; IJASEIT 16(4), 2026. https://arxiv.org/abs/2609.09560
- **Type:** journal (lower-tier), 30-participant within-subject study.
- **Measured:** vibe coding **27% faster** than traditional, 12% faster than AI-assisted; lower maintainability index and more security issues (secondary: MI ≈60 vs ≈70 vs ≈75, more duplication/complexity **[unverified]**); SUS 71.4; NASA-TLX 55.5.
- **Relevance:** (a) small, controlled confirmation of the speed-vs-maintainability trade.

### 2.21 Ehsani, Rawal, Cai & Chatterjee (Jun 2026) — *Faster Code, Deeper Debt? A Multivocal Literature Review on Technical Debt and Its Early Signs in LLM-Assisted Software Development*
- **Cite:** arXiv:2606.14796; accepted ACM TOSEM 2026. https://arxiv.org/abs/2606.14796
- **Type:** peer-reviewed review (104 sources: 31 formal, 73 grey).
- **Findings:** "LLMs often amplify traditional forms of technical debt, particularly code, design, and documentation debts"; a "fast-integration debt" pattern where "rapidly generated code prioritizes speed over quality, triggering a domino effect that leads to governance debt"; "no standardized benchmarks or LLM-specific metrics yet exist, leaving an important gap."
- **Relevance:** useful as the bridge to the classical-SE reviewer; confirms the measurement gap the paper could fill.

---

## 3. Snippet-level quality studies (2022–2025, mostly peer-reviewed)

These establish that generated *units* are of mixed quality; none measures system-level coherence, which is exactly the boundary the paper should name.

### 3.1 Nguyen & Nadi (MSR 2022) — *An Empirical Evaluation of GitHub Copilot's Code Suggestions*
- **Cite:** DOI 10.1145/3524842.3528470. https://conf.researchr.org/details/msr-2022/msr-2022-technical-papers/11/…
- **Measured:** 33 LeetCode problems × 4 languages = 132 solutions; correctness Java 57%, JavaScript 27% (Python ≈42% per secondary); "Overall, Copilot's suggestions have low complexity with no notable differences between the programming languages"; some solutions call undefined helpers.
- **Boundary:** early model, toy problems, possible training contamination.

### 3.2 Siddiq, Majumder, Mim, Jajodia & Santos (SCAM 2022) — *An Empirical Study of Code Smells in Transformer-Based Code Generation Techniques*
- **Cite:** DOI 10.1109/SCAM55253.2022.00014; artifact https://zenodo.org/records/7049118
- **Measured:** smells in training datasets (APPS, Code Clippy, CodeXGLUE) and in generated code incl. Copilot; slide figures: 69.15% / 39.12% / 97.03% of dataset samples carry non-security smells **[from author slides; unverified vs. paper]**; Copilot output shown to carry smells.
- **Relevance:** (c) smells are inherited from training data — a model-side origin for duplication/smell propensity.

### 3.3 Al Madi (ASE 2022) — *How Readable is Model-generated Code? Examining Readability and Visual Inspection of GitHub Copilot*
- **Cite:** arXiv:2208.14613; DOI 10.1145/3551349.3560438.
- **Measured:** 21 participants, eye tracking; generated code "comparable in complexity and readability" to human pair-programmer code, but programmers pay *significantly less visual attention* to it.
- **Relevance:** (a) a mechanism for unnoticed drift: reviewers under-inspect generated code (echoed by Huang et al.'s sentiment result and METR's 9% cleanup time).

### 3.4 Asare, Nagappan & Asokan (EMSE 2023) — *Is GitHub's Copilot as Bad as Humans at Introducing Vulnerabilities in Code?*
- **Cite:** arXiv:2204.04741 (v5, Jan 2024); Empirical Software Engineering (DOI 10.1007/s10664-023-10380-1 — verify).
- **Measured:** C/C++ scenarios from real CVEs; Copilot reproduced the original vulnerability ~33% of the time, the fix ~25%; more likely to be vulnerable on older CVEs; conclusion: "not as bad as human developers at introducing vulnerabilities in code".
- **Relevance:** (c) *against* a blanket "AI code is worse" story.

### 3.5 Yetiştiren, Özsoy, Ayerdem & Tüzün (2023) — *Evaluating the Code Quality of AI-Assisted Code Generation Tools: … GitHub Copilot, Amazon CodeWhisperer, and ChatGPT*
- **Cite:** arXiv:2304.10778 (v2, Oct 2023).
- **Measured:** HumanEval; correct 65.2% (ChatGPT), 46.3% (Copilot), 31.1% (CodeWhisperer); technical-debt (smell remediation) per solution 8.9 / 9.1 / 5.6 minutes.
- **Relevance:** (c) correctness and debt move independently across tools.

### 3.6 Liu, Le-Cong, Widyasari, Tantithamthavorn, Li, Le & Lo (2023/24) — *Refining ChatGPT-Generated Code: Characterizing and Mitigating Code Quality Issues*
- **Cite:** arXiv:2307.12596; ACM TOSEM 33(5) 2024 (DOI 10.1145/3643674 — verify).
- **Measured:** 4,066 ChatGPT programs (2,033 tasks, Java+Python): 67.8% correct, 26.6% wrong output, 4.4% compile/runtime errors; **1,930 (47.5%) have maintainability issues** by static analysis; self-repair with feedback improves quality ">20%".
- **Relevance:** (a) nearly half of correct-looking generated code carries maintainability issues; (c) feedback loops partially fix it — relevant to "agent-reviewed-by-agent" designs.

### 3.7 Velasco, Rodriguez-Cardenas, Alif, Palacio & Poshyvanyk (ICSE 2025 NIER) — *How Propense Are Large Language Models at Producing Code Smells? A Benchmarking Study*
- **Cite:** arXiv:2412.18989 (v2, Jan 2025).
- **Measured:** CodeSmellEval / Propensity Smelly Score on method-level smells; CodeLlama and Mistral "both models tend to generate code smells" (simplifiable-condition, consider-merging-isinstance).
- **Relevance:** a benchmark the paper can cite as the nascent measurement standard (also cited by Ehsani et al.'s review).

### 3.8 Santa Molison, Moraes, Melo, Santos & Assunção (ESEM 2025) — *Is LLM-Generated Code More Maintainable & Reliable than Human-Written Code?*
- **Cite:** arXiv:2508.00700.
- **Measured:** Python tasks (introductory/interview/competition), SonarQube; LLM code has *fewer bugs and less fix effort overall*, but at competition level "LLM solutions sometimes introduce structural issues absent from human-written code"; fine-tuning shifted severity downward at a cost to correctness.
- **Relevance:** (c) *against* at low complexity, *for* at high complexity — a within-study version of the complexity gradient.

---

## 4. Mechanism: long-context degradation and repository-scale benchmarks

### 4.1 Liu, Lin, Hewitt, Paranjape, Bevilacqua, Petroni & Liang (2023/24) — *Lost in the Middle: How Language Models Use Long Contexts*
- **Cite:** arXiv:2307.03172; TACL 12 (2024), DOI 10.1162/tacl_a_00638 (verify).
- **Type:** peer-reviewed.
- **Measured:** multi-document QA with 10/20/30 documents; GPT-3.5-Turbo accuracy with the answer first/middle/last: 10 docs 76.8/61.2/62.4%; 20 docs 75.8/53.8/63.2%; 30 docs 73.4/50.5/63.7%. Closed-book baseline 56.1% — middle-position accuracy at 20–30 docs falls *below* having no documents. "extended-context models are not necessarily better than their non-extended counterparts at using their input context."
- **Boundary:** 2023 models; retrieval-style tasks, not code.
- **Relevance:** (b) the canonical mechanism paper: more relevant material in context does not mean it is used; positional loss grows with context size.

### 4.2 Modarressi et al. (ICML 2025) — *NoLiMa: Long-Context Evaluation Beyond Literal Matching*
- **Cite:** arXiv:2502.05167 (v3, Jul 2025).
- **Measured:** 13 models claiming ≥128K; at **32K tokens 11 of 13 drop below 50% of their short-context baseline**; GPT-4o 99.3% → 69.7%; failure attributed to "increased difficulty the attention mechanism faces in longer contexts when literal matches are absent"; CoT/reasoning models do not fix it.
- **Relevance:** (b) code reuse requires recognising *semantic* equivalence without lexical overlap — exactly the regime NoLiMa shows collapsing with context length; this is the mechanism behind "agent re-implements instead of reusing".

### 4.3 Hong, Troynikov & Huber / Chroma (14 Jul 2025) — *Context Rot: How Increasing Input Tokens Impacts LLM Performance*
- **Cite:** https://www.trychroma.com/research/context-rot (vendor technical report; Chroma sells a vector DB).
- **Measured:** 18 models; 194,480 calls. Performance "increasingly unreliable as input length grows"; lower needle–question similarity degrades faster; distractors compound; **shuffled haystacks outperform coherent ones** across all 18 models ("structural coherence consistently hurts model performance"); LongMemEval focused (~300 tokens) ≫ full (~113k tokens) for every model.
- **Relevance:** (b) degradation is gradual and present in frontier models; the coherent-haystack result is suggestive for codebases (coherent surrounding text can be *harder* to search than noise). Not tested on code.

### 4.4 Li et al. (ACL 2025) — *LongCodeU: Benchmarking Long-Context Language Models on Long Code Understanding*
- **Cite:** arXiv:2503.04359; ACL 2025 long paper (2025.acl-long.1324).
- **Measured:** 9 LCLMs (6 general, 3 code); 8 tasks; "the performance of LCLMs drops dramatically when the long code length is greater than 32K" despite 128K–1M windows; "inter-code unit relation understanding is the most challenging for LCLMs".
- **Relevance:** **(b) code-specific long-context collapse, and the hardest sub-skill is relating code units to each other — i.e., seeing that a new function duplicates or should call an existing one.**

### 4.5 Rando et al. (2025) — *LongCodeBench: Evaluating Coding LLMs at 1M Context Windows*
- **Cite:** arXiv:2505.07897 (v3, Oct 2025).
- **Measured:** LongCodeQA + LongSWE-Bench built from real GitHub issues; Claude 3.5 Sonnet **29% → 3%**, Qwen2.5 70.2% → 40% as context grows to 1M; "long-context remains a weakness for all models".
- **Relevance:** (b) same point for issue-fixing in large repos.

### 4.6 Anthropic (29 Sep 2025) — *Effective context engineering for AI agents*
- **Cite:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (vendor engineering post).
- **Content:** names "context rot": "as the number of tokens in the context window increases, the model's ability to accurately recall information" decreases; models have an "attention budget"; "This results in n² pairwise relationships for n tokens"; recommends compaction, note-taking, sub-agents for "large codebase migrations".
- **Relevance:** (b) a frontier vendor's own statement that recall degrades with context, and that large-codebase work needs architectural workarounds — i.e., the difficulty is acknowledged as context-scale-driven.

### 4.7 Deng, Da et al. / Scale AI (2025) — *SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?*
- **Cite:** arXiv:2509.16941 (v2, Nov 2025).
- **Measured:** 1,865 problems, 41 repos (public 11, held-out 12, commercial 18); reference patches avg 107.4 LOC across 4.1 files. v1 conclusion: top models "a 23% success rate on SWE-Bench Pro compared to over 70% on benchmarks like SWE-Bench Verified"; v2 public set: Claude Sonnet 4.5 43.6%, Sonnet 4 42.7%, GPT-5 41.8%; **commercial (proprietary enterprise) set: Opus 4.1 17.8%, GPT-5 15.7%**. Failure modes: Opus 4.1 wrong solution 35.9%; **Claude Sonnet 4 "context overflow from listing" 35.6%, "endless file reading" 17.0%**; per-repo resolve rates vary widely, some repos <10% for every model.
- **Relevance:** (b) the gap between curated OSS and enterprise codebases ("the difficulty of navigating enterprise codebases"), and context overflow as a named failure mode; (c) note v1→v2 jumps show rapid model change.

### 4.8 Chen, Li & Li (2025/26) — *FeatBench: Towards More Realistic Evaluation of Feature-level Code Generation*
- **Cite:** arXiv:2509.22237 (v2, Feb 2026).
- **Measured:** 157 tasks, 27 repos; best (Trae-agent + GPT-5) **29.94%**. Agents "perform well on smaller repositories (fewer than 200 files or 50,000 LOC), with resolved rates reaching up to 60-70% for GPT-5," but "their success degrades sharply with complexity"; for repos ">800 files or 300,000 LOC", "performance for all models converges to a low of 10-30%." Patches: top model 36% for single-file / 1–30 LOC; "success rates falling to nearly zero for patches exceeding 50 LOC or those distributed across five or more files." Also documents "aggressive implementation" → scope creep and regressions.
- **Relevance:** **(b) explicit success-vs-repository-size curve** on the *same* models; (a) scope creep is the "adds a path" behaviour observed in the benchmark.

### 4.9 Li, Ben-Israel, Raz, Ahmed, Serebro & Raux (Feb 2026) — *RepoMod-Bench: A Benchmark for Code Repository Modernization via Implementation-Agnostic Testing*
- **Cite:** arXiv:2602.22518.
- **Measured:** 21 repos, 8 languages, 1.6M LOC, 11,616 tests, 14–211K LOC per repo; four agent configurations; "average pass rates drop from 91.3% on projects under 10K LOC to 15.3% on projects exceeding 50K LOC" — a "sharp scaling collapse".
- **Relevance:** (b) the steepest published size gradient; modernisation is itself a "retire the old path" task.

### 4.10 Gloaguen, Mündler-Sasahara, Müller, Raychev & Vechev (2026) — *Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?*
- **Cite:** arXiv:2602.11988 (v3, Sep 2026); listed at ICLR 2026 virtual site.
- **Measured:** context files "does not generally improve task success rates, while increasing inference cost by over 20% on average," across LLMs, agents, LLM-generated and developer-committed files; agents follow instructions well but repository *overviews* are not helpful; useful only for non-standard practices.
- **Relevance:** (b)/(c) *more context is not the fix*; contrasts with the RAMP finding that committed conventions reduce *quality* decay — success rate and quality decay are different outcomes.

### 4.11 Cao, Yin, Dhingra & Zhou (Mar 2026) — *Coding Agents are Effective Long-Context Processors*
- **Cite:** arXiv:2603.20432.
- **Measured:** "LLMs fail to effective process long context, exhibiting significant performance degradation as context length increases"; agents operating over corpora via file systems/tools beat long-context SOTA by 17.3% on long-context reasoning, RAG and open-domain QA — not repository coding.
- **Relevance:** (c) *against*: tool-mediated retrieval can route around context rot; the question becomes whether the codebase is *structured so retrieval finds the canonical path* — which is a property of the system.

### 4.12 Kwa, West et al. / METR (2025) — *Measuring AI Ability to Complete Long Software Tasks*
- **Cite:** arXiv:2503.14499 (v4, Jul 2026); NeurIPS 2025.
- **Measured:** 50%-task-completion time horizon; Claude 3.7 Sonnet ≈50 min; horizon doubling ≈ every 7 months since 2019 (faster in 2024); tasks from RE-Bench, HCAST, +66 new. Caveats: "real-world meaning of benchmark performance remains unclear"; forecasts hold only "If these results generalize to real-world software tasks."
- **Relevance:** (c) benchmark capability is rising fast while field results (METR 2025, Stanford, Faros) lag — the gap itself is evidence that something other than model capability governs real-repo throughput.

---

## 5. Review loops and trust

### 5.1 Stack Overflow Developer Survey 2024 / 2025 (AI sections)
- **Cite:** https://survey.stackoverflow.co/2024/ai ; https://survey.stackoverflow.co/2025/ai
- **Type:** industry survey (self-selected; ~65k responses 2024, ~49k 2025).
- **Measured 2024:** 76% use/plan to use AI (61.8% use); trust accuracy 43% (2.7% highly + 40.3% somewhat); distrust 31%; 43.2% say AI is bad/very poor at complex tasks (45% of professionals); 66.2% cite "Don't trust the output or answers" as a team challenge.
- **Measured 2025:** 84% use/plan; **trust 33% (3.1% highly), distrust 46%**; **66% top frustration "AI solutions that are almost right, but not quite"**; **45.2% "Debugging AI-generated code is more time-consuming"**; favourability ~60% (down from >70%); 30.9% use agents at work.
- **Relevance:** (c) "almost right" is the developer-facing description of code that works locally but does not fit — and trust is falling as adoption rises.

### 5.2 Duma, Wróblewski, Bobińska, Winiarska & Przymus (EASE 2026) — *These Aren't the Reviews You're Looking For: How Humans Review AI-Generated Pull Requests*
- **Cite:** arXiv:2605.02273.
- **Measured (abstract):** AIDev-based; "most AI-generated PRs receive no review"; when reviewed, review is "largely dominated by AI agents rather than humans"; human involvement often expressed as agent steering; review metrics may be unreliable indicators of human oversight. (Secondary: ~61% of ~33.6k agent PRs no review activity; ~72% of review comments by agents **[unverified]**.)
- **Relevance:** (a) the review gate that would catch duplication is increasingly agent-on-agent; combined with Al Madi and Huang, explains how incoherence passes.

### 5.3 Jin & Chen (Feb 2026) — *Are LLMs Reliable Code Reviewers? Systematic Overcorrection in Requirement Conformance Judgement*
- **Cite:** arXiv:2603.00539.
- **Measured (abstract):** LLM reviewers "frequently misclassify correct code implementation as non-compliant or defective"; more detailed prompts (explanations + proposed fixes) "leads to higher misjudgment rates"; proposes fix-guided verification against tests.
- **Relevance:** (c) agent-review loops add noise as well as fixes; see also Liu et al. 2024 (feedback improves quality >20%) for the other direction. No field study yet shows that repeated agent review–revise cycles raise *system-level* coherence.

### 5.4 Vilas Boas, Pinto, Monteiro, Carida & Ribeiro (May 2026) — *One Developer Is All You Need: A Case Study of an AI-Augmented One-Person Squad in a Brownfield Enterprise*
- **Cite:** arXiv:2605.18461.
- **Measured (abstract):** one staff engineer + four agents under spec-driven development delivered a four-person-squad initiative in half the planned time; 90% first-review acceptance; full integration-test pass; >85% staffing-cost reduction. Binding constraints: "specification quality and institutional knowledge, rather than model capability".
- **Relevance:** (b)/(c) *against* the size thesis in a brownfield setting, but n=1, self-reported, and it attributes the limiting factor to *knowledge of the system*, not to the agent — which is compatible with the paper's framing.

---

## 6. Synthesis for the paper

### 6.1 FOR: AI-assisted code accumulates duplication / churn / unretired paths
1. **Industry-scale operation mix shifted from refactor to add/copy.** GitClear: moved lines 24.1% (2020) → 9.5% (2024) → 3.8% (2026 YTD); copy/paste 8.3% → 12.3% → 15.7%; churn 3.1% → 5.7%; share of edits touching code >1 year old collapsing (long-term update 1.7% → 0.46%). Vendor, correlational, no per-line AI attribution — but the only multi-year, 100M+-line series that exists.
2. **Agents re-implement rather than reuse.** Huang et al. (MSR 2026): semantic redundancy of new functions 1.87× human (p<0.001). Kashif et al.: duplication is the #1 design issue (28.4%) in incrementally agent-built projects that are 91% functionally correct. Watanabe et al.: 27% of human pre-merge fixes to Claude Code PRs are refactors "including eliminating code duplication and aligning with architecture." Ehsani et al.: 23% of rejected agent PRs duplicate in-flight work.
3. **Introduced debt persists.** Liu et al. 2026: 22.7% of 484k AI-introduced issues still present at HEAD; 89% are smells. Sawada et al.: agent-written files are *extended* rather than fixed or removed.
4. **Volume up, review down.** Faros: PR size +154%, review time +91% (2025), bugs/dev +54% and deleted/added +861% (2026); He et al. 2026: reviewer load doubled, automated review overtook human review; Duma et al.: most agent PRs get no human review. Al Madi: humans look less at generated code.

### 6.2 AGAINST (or complicating)
1. **Per-unit quality is not clearly worse.** GitHub RCT: slightly better readability/maintainability on a toy task; Asare: fewer CVE reproductions than humans; Santa Molison: fewer bugs at low complexity; Cynthia et al.: agent differences vanish after size normalisation.
2. **Duplication specifically is the weakest-measured signal.** He et al.'s rigorous DiD found duplicate-line density +7% *n.s.*; RAMP found the duplication measure barely moved; the robust persistent signals are *complexity* and *warnings*. The paper should frame "one decision in several places" as a complexity/connectivity problem, not rely solely on clone metrics.
3. **Throughput gains are real and, in at least one enterprise, sustained.** Cui et al. +26% tasks; He et al. 2026 2.09× PRs over ~10 months with stable revert rates; DORA 2025 now finds throughput positively associated with AI.
4. **Model generations move the baseline.** METR 2026 (−18%/−4% time, CIs cross zero), Stanford's "December 2025 inflection", SWE-bench Pro v1→v2 (23% → 43.6%). Any longitudinal "it got harder" claim must control for the tool generation.

### 6.3 Best evidence that difficulty rises with the system, not the agent
- **Dynamic panel evidence (He et al., Cursor DiD):** the same adopting repos speed up, then accumulate +30% warnings / +42% complexity, and a 100% complexity increase predicts a 64.5% fall in next-period output. The slowdown is modelled as a function of the codebase's state at t−1, with the tool held constant.
- **Same model, different repo size (FeatBench, RepoMod-Bench, SWE-bench Pro):** GPT-5 60–70% on <50K-LOC repos vs 10–30% on >300K; 91.3% → 15.3% under/over 10K/50K LOC; curated OSS 43.6% vs proprietary enterprise 17.8%. Capability is fixed; the size of the system is the variable.
- **Experienced maintainers in 1.1M-LOC repos were slowed (METR 2025)**, with "large and complex repositories" and "implicit repository context" among the five likely drivers — while the same tools sped up developers on small bounded tasks (Peng, Paradis).
- **Stanford matrix:** 30–40% greenfield-simple → 0–10% brownfield-complex, with ~half of gross gains lost to rework; RAMP: complexity rises after agent adoption in every group, halved by committed conventions.
- **Mechanism papers:** LongCodeU (collapse >32K tokens; relating code units is the hardest skill), NoLiMa (semantic retrieval without lexical match fails first), Lost-in-the-Middle (middle content worse than none). These predict exactly "reconstruction per task grows with the amount of system that must be held in context."
- **Burden lands on system stewards:** Xu et al. — core developers' own output −19% while reviewing +6.5% more; DORA 2025 — "tightly coupled systems and slow processes see little or no benefit."

### 6.4 Alternative explanations the paper must address
- **Harder tasks / selection:** brownfield tasks are harder for humans too; METR 2026 shows developers now refuse to work without AI, biasing field samples; Cynthia/Ehsani show PR size, not agent, drives issue counts and rejections.
- **Inadequate abstractions / implicit context (closest to the thesis):** Watanabe — rejections "primarily driven by project context"; Vilas Boas — "specification quality and institutional knowledge, rather than model capability"; AGENTS.md — repository overviews don't help, non-standard conventions do; RAMP — committed rules halve complexity growth.
- **Review-capacity bottleneck rather than code structure:** Faros, He et al. 2026, DORA — later changes may be slower because review queues, not the code, saturate.
- **Model changes:** METR 2026; Stanford Dec-2025 inflection; Sonar/Veracode show capability gains do *not* translate into maintainability/security gains — so "better models" may raise throughput without curing incoherence.
- **Vendor incentives:** GitClear, Faros, Uplevel, CodeRabbit, Sonar, Veracode, Apiiro, GitHub, Chroma all sell something adjacent to their finding; weight the peer-reviewed DiD/RCT work (He et al., METR, Cui, Paradis, Huang, Kashif, Liu 2026) accordingly.

### 6.5 Gaps this paper could fill
- No published study tracks *coherence* (one decision → N implementations; retired vs live paths) over the life of a repository that agents mostly wrote; the closest are Kashif (10 synthetic projects, one snapshot), He et al. (SonarQube complexity on OSS), and GitClear's connectivity/long-term-update metrics (vendor).
- No field study tests whether agent-review-of-agent loops raise system-level coherence (Jin & Chen and SWE-Review are benchmark-only; Duma et al. show the loop is already the default).
- Ehsani et al.'s TOSEM review: "no standardized benchmarks or LLM-specific metrics yet exist" for LLM-induced debt.

---

## Appendix: items checked and set aside
- *Long Code Arena* (Bogomolov et al., arXiv:2406.11612) — six repository-level benchmarks; abstract carries no size-gradient result; not used.
- *Wu et al. FSE 2025*, *Ji et al. JSS 2026*, *Siddiq 2022* figures partly from secondary — flagged above.
- GitClear press "4x cloning" and "8x" headlines — reconciled against the primary table (≈1.5× copy/paste lines; 0.45% → 6.66% of scanned commits with a ≥5-line duplicate block).
- Uplevel: primary PDF read; it self-describes as observational and access-based.
- Peng et al. PDF unreadable via fetch; figures taken from the ar5iv HTML rendering of the same paper.
