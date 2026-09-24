---
title: Learning While the Tools Change
kind: essay
argument: Engineering experience, AI experience and tool capability run on separate clocks, and better tools can take away the mistakes that used to teach — so what a team most needs to grow is calibrated distrust, knowing which output to check and which needs no check, and no snapshot of speed or seniority can see it.
version: 5
date: 2026-09-23
authors: [Astra 6, Opus 5.5]
model: "Version 1 by Astra 6, per John Kershaw's attribution on filing; harness and effort not recorded, and the source .docx carries no author or model metadata. Version 2 by Claude Opus 5.5 (claude-opus-5-5, Claude Code CLI web session, effort high), at John's invitation, revising from the findings in learning-while-the-tools-change-check.md. Version 3 by the same model and harness, correcting a survey figure after reading it at source and adding the further-reading list, typeset as Harbour Archive #7. Version 4 by the same model and harness from Astra 6's review of version 3: sections 6 to 8 simplified, three overstatements corrected, and the closing paragraphs replaced with Astra 6's own. Version 5 by the same model and harness from Astra 6's rereading of version 4: three small cuts and one distinction carried into section 6. No Harbour dispatch lineage for any version."
sources:
  - "Cui et al., The Effects of Generative AI on High-Skilled Work, Management Science, 2026 — https://doi.org/10.1287/mnsc.2025.00535"
  - "docs/ladder.md@0d652fbc0f2fef12bf063f047d855c346b337595"
  - "docs/papers/harbour/developer-adoption-ladder.md@0d652fbc0f2fef12bf063f047d855c346b337595"
  - "docs/papers/harbour/developer-adoption-ladder-earlier-dates.md@0d652fbc0f2fef12bf063f047d855c346b337595"
  - "docs/papers/harbour/where-harbour-joins.md@0d652fbc0f2fef12bf063f047d855c346b337595"
  - "Lee and Lim, Research Policy 30, 459–483, 2001 — https://doi.org/10.1016/S0048-7333(00)00088-3"
  - "David, American Economic Review 80, 355–361, 1990 — https://gwern.net/doc/economics/automation/1990-david.pdf"
  - "Tripsas, Strategic Management Journal 18, 119–142, 1997 — https://www.edegan.com/pdfs/Tripsas%20%281997%29%20-%20Unraveling%20the%20process%20of%20creative%20destruction.pdf"
  - "Bilalić, McLeod and Gobet, Cognitive Psychology 56, 73–102, 2008 — https://pubmed.ncbi.nlm.nih.gov/17418112/"
  - "Barley, Administrative Science Quarterly 31, 78–108, 1986 — https://cerf.radiologie.fr/sites/cerf.radiologie.fr/files/Enseignement/DES/Modules-Base/Barley%2C%201986.pdf"
  - "Bainbridge, Automatica 19, 775–779, 1983 — https://doi.org/10.1016/0005-1098(83)90046-8"
  - "Shen and Tamkin, How AI Impacts Skill Formation, arXiv 2601.20245, 2026 — https://www.anthropic.com/research/AI-assistance-coding-skills"
  - "Anthropic, Measuring AI agent autonomy in practice, 2026-02-18 — https://www.anthropic.com/research/measuring-agent-autonomy"
  - "Dhanorkar, Passi and Vorvoreanu, arXiv 2606.05391, 2026 — https://arxiv.org/abs/2606.05391"
  - "Murphy-Hill, Butler and Savelieva, arXiv 2607.01418, 2026 — https://arxiv.org/abs/2607.01418 (figures read at https://arxiv.org/html/2607.01418, 2026-09-22)"
  - "Stack Overflow, Agents on a leash, 2026-05-27 — https://stackoverflow.blog/2026/05/27/agents-on-a-leash-agentic-ai-remains-mostly-monitored-at-work/ (read 2026-09-22)"
---

# Learning While the Tools Change

*How AI reshapes developer expertise and what history teaches us*

Prepared for John Kershaw | September 2026

AI changes the conditions under which developers learn. Someone beginning today inherits
tools and working practices that an earlier adopter had to discover, assemble or do
without. They may reach useful capability through a much shorter route. At the same time,
experienced engineers carry knowledge whose value changes unevenly: some methods become
unnecessary, while an understanding of systems and consequences can remain highly useful.

This essay brings together research on technological change, professional work and learning
to explain that uneven movement. Its central argument is that engineering experience,
experience using AI and the capabilities of the available tools must be considered
separately. A developer's path reflects their interaction, within a particular team and kind
of work. History supplies useful mechanisms for understanding those paths, although it does
not establish a universal sequence or determine who will eventually lead.

The separation has a sharper consequence than it first appears. Better tools do not only let
newcomers start further along; they also absorb some of the mistakes that used to do the
teaching. That need not slow anyone's learning overall, but it takes particular lessons away,
and nothing in the output shows which. So the capability a team most needs to grow is neither
fluency with the tools nor years in the profession, but calibrated distrust: knowing which
output to check, how hard, and which needs no check at all. Section 7 argues for that reading,
and the essay ends by saying what would show it wrong.

## 1 The puzzle inside the engineering team

An engineering lead looks across a team and sees an unfamiliar distribution of capability.
An experienced developer is cautiously adapting a well-established practice to AI. A much
newer colleague already works comfortably with agents, producing results that seem
disproportionate to their years in the profession. Both contribute something real, and
familiar labels such as junior and senior provide an incomplete description of the
difference.

The contrast can be misleading in either direction. Rapid delivery may represent a
substantial improvement in what a person can accomplish. It may also leave understanding or
follow-up work elsewhere in the team. Careful supervision may reflect unfamiliarity with a
tool, or a well-founded judgement about the consequences of a mistake. Visible speed alone
cannot distinguish these cases.

There is evidence that AI can narrow performance gaps on some development tasks. Cui and
colleagues combined three field experiments involving 4,867 developers at Microsoft,
Accenture and another large company. Access to an assistant offering code completions
increased completed tasks by about 26 percent overall, with larger gains among
less-experienced developers. The individual experiments were noisy, and these results concern
that form of assistance rather than every contemporary agent workflow. They nevertheless show
why unexpectedly strong performance by a newcomer should be taken seriously.
[[1]](#1-ai-assistance-and-developer-productivity)

Harbour's adoption ladder captures a recognisable personal journey: asking questions,
directing sessions, saving repeatable prompts, delegating bounded tasks, and eventually
organising continuing work. Its research papers exposed the limits of reading that journey as a
population model — they found no reliable population count for saved-prompt use, and the survey
categories do not directly measure Harbour's later stages — and the ladder has since absorbed
the point. It now describes "a distribution over cohorts, not a queue", with each cohort
starting on a higher rung because the tools moved between their start dates. This essay starts
from that revision rather than against it. What it adds is an account of why that distribution
cannot be measured by any single survey, and of what the tools moving does to learning as well
as to entry. [[2]](#2-the-harbour-adoption-papers)

## 2 Three clocks running at once

The first clock measures engineering experience. It includes knowledge of a codebase,
judgement about trade-offs, and experience diagnosing problems whose causes are not obvious.
These capabilities are uneven even within one person. A developer can understand distributed
systems deeply and still be new to the business rules of a particular product.

The second measures experience working with AI. It includes knowing what context to supply,
how to divide work, when to redirect a session and how to recover from an unproductive
approach. Familiarity with one tool does not establish equal fluency with another. A developer
who excels with an interactive assistant may need to learn a different practice when
delegating longer tasks.

The third clock is calendar time. Models, interfaces and shared practices change while both
forms of experience accumulate. A difficult technique can become a standard feature. A
workaround can become redundant. An effective workflow can reach a new user through a
colleague without that user reproducing the experiments that produced it.

| Clock | What it describes | Useful observation |
|---|---|---|
| Engineering experience | Knowledge and judgement about the work | Can the developer explain and resolve consequential problems |
| AI experience | Practice using and directing available tools | Can the developer obtain useful results and recover when a workflow fails |
| Calendar time | Changes in tools and shared methods | What became possible or easier without additional individual practice |

An adoption cohort is a group that begins using a technology during a similar period. It is
different from a career cohort. A senior engineer and a graduate can join the same AI adoption
cohort, bringing very different knowledge with them. Conversely, two developers of similar
seniority may have learned AI work under different technical conditions.

This is the essay's most practical claim, and it is a claim about measurement. Comparing this
year's newcomers with last year's newcomers mixes a change in people with a change in tools.
Following one person over a year mixes learning with improvements in their environment. A larger
sample removes neither mix, because every clock moves in both. That is why a survey asking
developers where they stand can describe a population but cannot say which clock put each person
where they are.

Watching the same people do comparable work over time helps. A snapshot can show that two
developers differ; it cannot say whether the difference came from earlier learning, better tools,
the tasks each was given or help from colleagues, and repeated observation makes those
explanations testable. It is not the only useful design, and it cannot separate the clocks by
itself, since a change in tools reaches everyone being followed at once. The three clocks say
which comparisons will mislead, not how large each effect is.

An everyday example makes the distinction concrete. One developer once needed a carefully
staged sequence to make an agent inspect a repository and implement a change. A newcomer may
receive an effective version of that sequence as a built-in workflow. The newcomer has acquired
access to its results immediately. Whether they have also acquired the judgement needed to
recognise its limits is a separate question.

The clocks are also not independent. The calendar clock sets the exchange rate for the other
two: when a tool absorbs a class of mistake, it can remove the lesson along with the mistake.
Section 6 returns to what that costs.

## 3 What newcomers inherit and what they can skip

Research on technological leapfrogging provides a vocabulary for shorter routes. Lee and Lim's
study of Korean industries distinguished following an established path, skipping stages and
creating a different path. They identified stage-skipping in DRAM and automobiles, and path
creation in CDMA mobile phones. Their explanation included existing knowledge, technological
effort and collaboration with foreign companies. Being late created possibilities that still
required capability and investment to exploit. [[3]](#3-technological-leapfrogging)

For an AI adopter, the inherited advantage can take several forms. Better models may remove a
technical obstacle. Software may package a complicated process. A colleague may demonstrate a
reliable practice and explain where it fails. Each can reduce the experimentation needed to
begin useful work. The later entrant benefits from discoveries already made, even when those
discoveries are invisible in the interface.

Factory electrification illustrates a second advantage: the freedom to organise work around the
newer technology. In his historical analysis, Paul David described how individual electric
motors enabled factories to move beyond arrangements shaped by central power transmission
through shafts and belts. The benefits included greater freedom in machine placement and
materials handling. Existing factories faced costs in replacing serviceable structures; new
facilities could incorporate different designs from the outset. Realising the benefits still
required practical learning among architects and engineers.
[[4]](#4-electrification-and-the-organisation-of-work)

The analogy suggests why two developers using the same agent may behave differently. One might
preserve an established manual sequence, assigning selected steps to AI. Another might begin
with a bounded outcome and organise the workflow around delegation. The latter has less
procedural history to accommodate. Which approach works better depends on the task, the
reliability of the agent and the surrounding system.

It helps to classify a skipped step by its function. Some steps compensate for a temporary tool
limitation. Others teach a concept or expose a failure mode. Still others coordinate people or
control an irreversible action. These functions can coexist within the same step, so removing it
may require replacing only part of what it did.

A long prompt that once compensated for poor instruction-following may become unnecessary.
Understanding why an apparent implementation violates a business rule may still matter. A newer
tool might eventually help with that judgement too. The classification must therefore be
revisited as capability changes; history does not entitle any particular procedure to permanent
preservation.

## 4 What happens to accumulated expertise

Technological change rarely affects every component of experience equally. A useful assessment
asks what a person knows and which parts remain relevant to the new work. Years of practice are
evidence of opportunities to learn, but they do not specify what was learned or how well it
transfers.

Mary Tripsas examined the typesetter industry from 1886 to 1990 across successive technological
generations. Established manufacturers sometimes retained strong positions despite disruption to
their technical capabilities. Proprietary typeface libraries and other complementary assets
continued to support their businesses. Survival depended on the interaction between investment,
technical capability and assets that retained commercial value. This is evidence about firms,
rather than an experiment on individual expertise.
[[5]](#5-expertise-that-survives-technical-change)

The parallel for engineering is that familiarity with one implementation method can lose value
while product knowledge remains useful. Understanding a customer's constraints may become more
consequential when code can be generated rapidly. Conversely, a specialist's advantage may
shrink if the new tool performs the difficult part of that speciality reliably. Both
possibilities should be tested against work rather than inferred from seniority.

Psychology supplies a mechanism for the friction of established habits. Bilalić, McLeod and
Gobet gave chess players problems containing a familiar but inferior solution and a better
alternative. The familiar solution could prevent experts from finding the better one, an effect
known as Einstellung. Stronger experts were less susceptible — the grandmasters found the better
solution on the problems used — but they fixated in turn when the better solution was made
harder to see. The authors' own summary is that the inflexibility of experts is "both reality
and myth". Expertise raises the difficulty at which fixation appears; it does not remove it.
[[6]](#6-familiar-solutions-and-flexible-expertise)

An engineering interpretation is that procedural familiarity and understanding of purpose can
adapt differently. Someone who knows a reliable sequence may keep applying it after the tool
changes. Someone who understands why each step was necessary may be better placed to simplify
the sequence — though by the chess result only up to a point, since the same person can fixate
again once the better alternative is less obvious. That is the case for revisiting procedures
on a schedule rather than trusting the expert to notice. This is a hypothesis about transfer,
not a diagnosis that can be made from a person's age or preferences.

A large 2026 study of this transition in software engineering found a sign that should give any
ladder pause. In Microsoft's early-2026 rollout of command-line agents, across tens of thousands
of engineers, prior use of the IDE assistant raised the odds of trying GitHub Copilot CLI — by
49% for engineers with one to fourteen days of prior use, up to 83% for those with sixty or
more — and lowered retention, defined as use on at least five of the fourteen days from first
use, by 12 to 15%. The authors explain it as substitution rather than lost skill: an engineer who already
trusts an assistant in the editor has "a familiar alternative to fall back on", and the new
habit never forms. Either reading breaks the assumption that time on one practice buys the next,
and the authors' reading is itself a calendar-clock effect: what a person goes on to learn
depends on which tools are already to hand.
[[12]](#12-adoption-and-retention-in-a-large-engineering-organisation)

That distinction also makes caution easier to evaluate. A request to review generated code could
be an inherited habit or a response to observed defects. Asking what the review protects, what
evidence it supplies and whether that evidence could be obtained more cheaply turns a
disagreement about style into a question about the work.

Early adopters have no guaranteed final position. They may combine useful knowledge with new
methods, or preserve methods whose costs now exceed their benefits. Later entrants may continue
learning rapidly, or discover that their initial success depended on a narrow range of tasks.
Experience is continually revalued through those encounters.

## 5 Technology changes relationships as well as capabilities

The unit of analysis also matters. An individual can appear effective because colleagues supply
context, catch errors or absorb later repairs. A team can become more effective because its
members contribute different capabilities, even when no individual becomes equally skilled in
every part of the work.

Stephen Barley's study of CT scanners makes that social dimension concrete. He observed two
radiology departments introducing identical equipment. The new technology disturbed established
distributions of expertise between radiologists and technologists. Some technologists knew more
about aspects of CT than some radiologists did. The departments developed different working
arrangements through patterns of interaction, despite using the same machinery. In one setting,
explanations and exchanges helped affirm both parties' knowledge; the study shows how technical
change and everyday relationships shaped one another.
[[7]](#7-technology-and-professional-relationships)

The Microsoft rollout gives the mechanism a contemporary number. First use spread through
colleagues: an engineer whose skip-level peers were largely using the command-line agent — more
than a quarter of them — had 216% higher odds of trying it, and one whose manager used it had
82% higher odds. Tenure barely mattered. These are associations — teams that work together may
also adopt together for reasons of their own — but Barley's two departments suggest a mechanism,
and the rollout shows the pattern at scale.
[[12]](#12-adoption-and-retention-in-a-large-engineering-organisation)

For an engineering lead, this suggests that an experienced colleague and a developer fluent with
agents may need a reciprocal learning relationship. The first can explain why a proposed change
is unsafe in the existing system. The second can demonstrate a faster way to investigate or
implement it. Neither contribution needs to be reduced to the other's position in the reporting
hierarchy.

The conditions for that exchange deserve attention. If asking a junior colleague for help feels
costly, useful practices may spread slowly. If enthusiasm for agents makes questions about
correctness unwelcome, important knowledge may remain unspoken. These are plausible
organisational mechanisms suggested by the historical case. Their presence in a particular team
must be established through observation and conversation.

Shared work can make the exchange concrete. An experienced engineer might bring a difficult
maintenance task; a colleague might demonstrate an agent workflow while they jointly examine the
result. The learning opportunity includes both the handling of the tool and the reasoning behind
accepting or rejecting its output. This is a proposed practice, rather than a proven intervention
from the CT study.

It also changes the meaning of catching up. A team may gain more by combining expertise than by
waiting for every member to reproduce everyone else's abilities. The relevant result is the
team's ability to deliver and sustain useful software, alongside the development opportunities
available to its members. Individual fluency remains valuable, but it is only part of that
result.

## 6 Delivering work and learning from it

A developer can get better at delivering software without getting equally better at
understanding it. One developer ships a working feature with an agent and still needs help to
explain why it works or to change it safely. Another learns quickly by asking the agent to
explain its choices and trying variations of them. The merged change looks the same either way.

Lisanne Bainbridge saw a version of this in industrial control in 1983. Automation took over
the routine work and left operators to handle the abnormal cases, so they got less practice at
the very skills an intervention needed. She proposed keeping manual and diagnostic skill alive
through training and good feedback. Hers is an analysis of control rooms, not evidence that
every kind of automation erodes skill. [[8]](#8-maintaining-expertise-under-automation)

Shen and Tamkin tested something close to it in code. They asked 52 mostly junior engineers to
learn Trio, a Python library none of them knew. Those with AI assistance averaged 50 percent on
a comprehension quiz straight afterwards, against 67 percent for those without, and they were
not reliably faster. Within the assisted group, the people who asked for explanations and
conceptual help understood more, but they chose to work that way, so that is a lead rather than
a finding. The study measured understanding on the day, not expertise over years.
[[9]](#9-ai-assistance-and-learning)

This is the cost section 2 pointed to. When a tool stops a developer making a mistake, they also
miss what the mistake would have taught them. They need not learn less overall: the time saved
can go into other lessons, and the agent can teach directly, as the explanation-seekers in the
Trio study suggest. But a particular lesson can go missing without anyone noticing.

So the practical question is which of those lessons still matter, and section 3's test applies:
ask what the missing step was doing. Some lessons belonged to a limitation the tool has since
removed, and can go with it; nobody needs to learn to coax a model that no longer needs coaxing.
Others are still essential. Debugging your own mistake exposes the assumption behind it; reading a
colleague's reasoning reveals a constraint you had not seen. Where the agent now does those for
the developer, something else has to show them what they would have learned. A developer might
explain a generated change before merging it, predict how it would behave if a requirement
changed, or give it a deliberately awkward input and watch what happens. Each is worth keeping
only if the work that follows gets better.

## 7 What good judgement looks like as the tools improve

Picture a developer who hands a prototype to an agent and lets it run, then supervises the same
agent closely on a migration of a live system. That is not a retreat. Dhanorkar, Passi and
Vorvoreanu heard the same pattern from 17 experienced developers: permissive use for prototypes,
strict review for changes to interconnected existing systems, with much of the difference
settled before any work was delegated — which settings the agent runs under and what it may
touch, what the authors call a priori control. The study reports what developers say they do; it
does not show how common each pattern is or which works best.
[[11]](#11-oversight-in-actual-development-work)

The judgement that developer is exercising is what this essay calls calibrated distrust: knowing
which output to check, and how hard, in work they understand well enough to be surprised by it.
The phrase can sound as though suspicion is the goal. It is not. Good judgement includes knowing
when a check is unnecessary — letting a throwaway prototype run, or trusting a change that a good
test suite already covers — because checking everything is its own failure: slow, and a way of
never finding out what the tool can be trusted with.

Calibrated distrust, more than fluency with the tools or years in the profession, decides who can
be trusted with more. It is learned mostly from consequence, from being caught out and seeing why,
which is why it tends to come with experience, and why a tool that heads off mistakes can take
away some of the occasions for learning it even as it speeds delivery.

The contemporary evidence fits that claim without proving it. The Trio learners with
assistance understood less, and fewer of their errors were theirs to meet. Anthropic's telemetry
found experienced Claude Code users both more likely to approve everything up front and more
likely to interrupt: they let work proceed and stepped in along the way. That pattern is
consistent with calibration, but it does not show that those interruptions were well judged, or
that auto-approval led to better work. [[10]](#10-how-supervision-changes-with-experience) And
the field at large still keeps a hand on the wheel: of the 1,100 developers and other
technologists in Stack Overflow's late-April 2026 pulse survey, 63% rarely or never let agents
run entirely on autopilot. [[13]](#13-how-the-field-supervises-agents)

This is also why more autonomy is not the same as more capability. A developer who stops an agent
at the right moment may be showing better judgement than one who lets it finish. Progress shows
in what the work achieved and what it cost afterwards, not in how little supervision it needed.

The tools will keep moving the line. As they improve, some checks that matter today will stop
mattering, and judgement will be needed in places no one has noticed yet. A developer with good
judgement changes what they check as the tools change; what stays is the habit of asking what a
check protects.

## 8 What an engineering lead can learn from this

Start by looking closely at a handful of ordinary tasks, without ranking anyone. For each, note
what the developer set out to do, which tool and workflow they used, what help they needed and
what happened after the change shipped. Note whether it was a prototype or a change to a system
people depend on; the same behaviour means different things in each. How quickly someone reached
a first plausible answer is worth knowing, but it leaves out the review and repair other people
did afterwards, so count those too.

If calibrated distrust is learned from consequence, the most useful thing a delivery system can
give a developer is cheap, visible wrongness. A developer assumes a generated date parser handles
time zones; a test fails, and the failure names the input that broke it and why. They find out in
minutes, before anything ships, and learn something about time zones and about what the agent
assumed. A review ledger, a provenance trail and a failing test can all record where an agent's
claims failed, but a record teaches no one by itself: the lesson lands only if the developer sees
it soon enough, with enough explanation to understand it. A run of green merges does not do this,
however reassuring, because it shows where the work ended and hides where it went wrong on the
way.

Use what you see to start conversations, not to reach verdicts. If review effort is rising, ask
whether the tasks grew, the agent is producing more code, context is missing or the checks are
weak. If a developer gets useful results quickly and handles later changes with confidence,
recognise it, even when they got there by a different route from the rest of the team.

Help knowledge travel both ways. Ask experienced engineers to explain the constraints behind their
decisions, and colleagues fluent with agents to show their workflows, including how they recover
when one fails.

When a tool changes, pick a few established procedures and ask of each whether it still protects
something that matters, whether it could be simpler, or whether it is no longer needed. That keeps
one generation's temporary workaround from becoming an unexplained rule for every newcomer.

For the engineering lead, this changes what progress looks like. The experienced developer may
need to let go of a procedure that once mattered. The newcomer may need to understand a failure
the tool has so far spared them. Both can learn from working through a real change together.

Later arrivals should benefit from better tools. They do not need to repeat every awkward stage
their colleagues went through. But when a step disappears, it is worth asking what disappeared
with it: wasted effort, a useful lesson, or a check that still matters.

That question becomes practical when we return to work after delivery. Can its author explain a
surprising result, adapt it to a new requirement, or recognise when the agent needs help? Those
moments tell us more about growing capability than the speed of the first demonstration.

Let the tools shorten the route. Make sure the work still gives people a chance to learn.

## Annotated reading list

This is a selective research essay, not a systematic review. The sources below include field
experiments, qualitative studies, historical analyses and vendor telemetry. Historical cases support
possible mechanisms; they do not supply estimates of their effects on AI adoption. Bracketed references
in the text identify the relevant source.

### 1 AI assistance and developer productivity

Cui, K. Z., Demirer, M., Jaffe, S., Musolff, L., Peng, S. and Salz, T. *The Effects of Generative AI on
High-Skilled Work: Evidence from Three Field Experiments with Software Developers.* Microsoft Research
summary, June 2025; subsequently published in Management Science, 2026.

Three company field experiments. Useful evidence that less-experienced developers can obtain larger
productivity gains. The intervention supplied code completions, so the results should not be applied
unchanged to autonomous agents or broader engineering responsibility.

[Read the source](https://doi.org/10.1287/mnsc.2025.00535) ·
[Microsoft Research summary](https://www.microsoft.com/en-us/research/publication/the-effects-of-generative-ai-on-high-skilled-work-evidence-from-three-field-experiments-with-software-developers/)

### 2 The Harbour adoption papers

Kershaw, J. and Claude. *Developer adoption ladder; Developer adoption ladder earlier dates; Where
Harbour joins.* Harbour papers, September 2026.

The starting point for the cohort question. These exploratory syntheses map existing research to a
product-specific ladder. Their distinctions between population evidence and interpretation are useful;
their rung mappings are not independently validated population categories.

The ladder itself, revised from those papers, is the better starting point for the cohort argument
than any one of them: its paragraph on cohorts makes the essay's opening move in John Kershaw's words.

[docs/ladder.md](../../ladder.md) ·
[developer-adoption-ladder.md](developer-adoption-ladder.md) ·
[developer-adoption-ladder-earlier-dates.md](developer-adoption-ladder-earlier-dates.md) ·
[where-harbour-joins.md](where-harbour-joins.md)

### 3 Technological leapfrogging

Lee, K. and Lim, C. *Technological regimes, catching-up and leapfrogging: Findings from the Korean
industries.* Research Policy, 30, 459–483, 2001.

A comparative industry study distinguishing path following, stage skipping and path creation. Read for
the conditions surrounding catch-up, including investment and external knowledge. Its subjects are
industries and firms rather than individual learners.

[Read the source](https://doi.org/10.1016/S0048-7333(00)00088-3)

### 4 Electrification and the organisation of work

David, P. A. *The Dynamo and the Computer: An Historical Perspective on the Modern Productivity Paradox.*
American Economic Review, 80, 355–361, 1990.

A short historical interpretation of why a general-purpose technology can take time to improve
productivity. Especially useful for understanding complementary changes in layout and practice. It
supplies an analogy for AI workflows, not a timetable for their development.

[Read the source](https://gwern.net/doc/economics/automation/1990-david.pdf)

### 5 Expertise that survives technical change

Tripsas, M. *Unraveling the process of creative destruction: Complementary assets and incumbent survival
in the typesetter industry.* Strategic Management Journal, 18 (Summer Special Issue), 119–142, 1997.

A historical study combining quantitative and qualitative evidence. It explains why losing a technical
advantage need not erase every advantage an incumbent holds. The connection to a developer's transferable
knowledge is an interpretation across levels of analysis.

[Read the source](https://www.edegan.com/pdfs/Tripsas%20%281997%29%20-%20Unraveling%20the%20process%20of%20creative%20destruction.pdf)

### 6 Familiar solutions and flexible expertise

Bilalić, M., McLeod, P. and Gobet, F. *Inflexibility of experts: Reality or myth? Quantifying the
Einstellung effect in chess masters.* Cognitive Psychology, 56, 73–102, 2008.

Controlled problem-solving experiments showing both fixation and greater resistance among stronger
experts. A useful corrective to simple claims that experience always helps or always obstructs
adaptation. Transfer from chess to professional AI work remains a hypothesis.

[Read the source](https://pubmed.ncbi.nlm.nih.gov/17418112/)

### 7 Technology and professional relationships

Barley, S. R. *Technology as an Occasion for Structuring: Evidence from Observations of CT Scanners and
the Social Order of Radiology Departments.* Administrative Science Quarterly, 31, 78–108, 1986.

An observational comparison of two departments using identical equipment. The closest historical reading
for the leadership problem in this essay: distributions of knowledge and everyday interactions shaped
different organisational outcomes. Two cases establish possibilities, not universal predictions.

[Read the source](https://cerf.radiologie.fr/sites/cerf.radiologie.fr/files/Enseignement/DES/Modules-Base/Barley%2C%201986.pdf)

### 8 Maintaining expertise under automation

Bainbridge, L. *Ironies of Automation.* Automatica, 19, 775–779, 1983.

A concise analysis of difficulties created when humans supervise automation and handle exceptions. It
connects the design of work to skill maintenance and training. It is a conceptual synthesis drawing on
control-system research rather than a study of coding agents.

[Read the source](https://doi.org/10.1016/0005-1098(83)90046-8)

### 9 AI assistance and learning

Shen, J. H. and Tamkin, A. *How AI Impacts Skill Formation.* arXiv 2601.20245, 2026. Author research
summary published by Anthropic on 29 January 2026.

A randomised study of learning an unfamiliar programming library, with an immediate comprehension
assessment. Read for the distinction between output and understanding. It does not establish long-term
deskilling, and the comparisons between interaction styles are exploratory.

[Read the source](https://www.anthropic.com/research/AI-assistance-coding-skills)

### 10 How supervision changes with experience

Anthropic. *Measuring AI agent autonomy in practice.* Research report, 18 February 2026.

Vendor telemetry documenting approval and interruption patterns in Claude Code. Useful behavioural
evidence about changes in oversight. Selection into the product and concurrent changes in tasks, tools
and users limit causal interpretations and population-wide generalisation.

[Read the source](https://www.anthropic.com/research/measuring-agent-autonomy)

### 11 Oversight in actual development work

Dhanorkar, S., Passi, S. and Vorvoreanu, M. *Human oversight of agentic systems in practice: Examining
the oversight work, challenges and heuristics of developers using software agents.* arXiv 2606.05391,
2026.

An exploratory interview study of 17 experienced developers. It distinguishes a priori control,
co-planning, real-time monitoring and post hoc review, and shows how task context affects supervision. It describes reported practices
rather than measuring their prevalence or causal effects on software quality.

[Read the source](https://arxiv.org/abs/2606.05391)

### 12 Adoption and retention in a large engineering organisation

Murphy-Hill, E., Butler, J. and Savelieva, A. *Adoption and Impact of Command-Line AI Coding Agents: A
Study of Microsoft's Early 2026 Rollout of Claude Code and GitHub Copilot CLI.* arXiv 2607.01418, 2026.

An observational study of tens of thousands of engineers over the first four months of a rollout, with
individual-level adoption and retention. The closest thing in this list to a direct measurement of the
essay's claims about social transmission and about one practice failing to carry into the next. It is
one organisation; its effects are associations rather than experiments; and its explanation of the
negative retention effect — a familiar alternative to fall back on — is the authors' reading, not a
tested mechanism.

[Read the source](https://arxiv.org/abs/2607.01418)

### 13 How the field supervises agents

Stack Overflow. *Agents on a leash: Agentic AI remains mostly single-agent and monitored at work.*
Stack Overflow blog, 27 May 2026.

A pulse survey of 1,100 developers and working professionals, fielded in late April 2026. Agent use at
work at any frequency stood at 59%, against 31% in the 2025 Developer Survey; 63% rarely or never let
agents run entirely on autopilot, and 60% block unapproved system changes. A self-selected sample
reported in a blog post: read for the direction of practice, not for a population estimate. The post
reports the 63% across all respondents and does not say whether non-users of agents were asked.

[Read the source](https://stackoverflow.blog/2026/05/27/agents-on-a-leash-agentic-ai-remains-mostly-monitored-at-work/)

For a short reading route, begin with Barley for team relationships, Bainbridge for supervision and
learning, and David for changes in the organisation of work. Lee and Lim then provide the vocabulary for
comparing different routes through technological change, and Murphy-Hill, Butler and Savelieva show the
same questions measured in 2026.

## Further reading

Not cited above, and not needed for the argument. Each goes further down a road the essay only points
along, and each was read at its source before it was listed here.

**Lee, J. D. and See, K. A.** *Trust in automation: Designing for appropriate reliance.* Human Factors,
46, 50–80, 2004. What this essay calls calibrated distrust, human-factors research has studied for
decades as *appropriate reliance*. The review argues that trust guides reliance precisely when complete
understanding of the automation is impractical, and models how context and display shape it.
[Read the source](https://doi.org/10.1518/hfes.46.1.50_30392) ·
[PubMed record](https://pubmed.ncbi.nlm.nih.gov/15151155/)

**Parasuraman, R. and Riley, V.** *Humans and automation: Use, misuse, disuse, abuse.* Human Factors, 39,
230–253, 1997. The vocabulary for the two ways reliance goes wrong: misuse is over-reliance, which fails
in monitoring; disuse is neglect, commonly caused by false alarms. An agent that cries wolf and an agent
that is never checked are different failures with different fixes.
[Read the source](https://doi.org/10.1518/001872097778543886)

**Kahneman, D. and Klein, G.** *Conditions for intuitive expertise: A failure to disagree.* American
Psychologist, 64, 515–526, 2009. Two traditions that usually disagree agree that intuitive judgement can
be trusted only where the environment is regular and the person has had the chance to learn its
regularities — and that feeling sure is no guide. The strongest general case for section 7's claim that
calibration is learned from consequence.
[Read the source](https://doi.org/10.1037/a0016755) ·
[PubMed record](https://pubmed.ncbi.nlm.nih.gov/19739881/)

**Bilalić, M., McLeod, P. and Gobet, F.** *The mechanism of the Einstellung (set) effect.* Current
Directions in Psychological Science, 19, 111–115, 2010. The same
authors' short sequel to the chess study, with eye-tracking: the first idea steers attention toward
information consistent with it, and keeps doing so while the player believes they are looking for
alternatives. Why "the expert will notice" is not a procedure.
[Read the source](https://doi.org/10.1177/0963721410363571) ·
[Author copy](http://bura.brunel.ac.uk/bitstream/2438/5777/1/Fulltext.pdf)

**Strauch, B.** *Ironies of automation: Still unresolved after all these years.* IEEE Transactions on
Human-Machine Systems, 48, 419–433, 2018. Bainbridge's paper traced through thirty-five years of
research and accident investigation, where its ironies kept reappearing.
[Read the source](https://doi.org/10.1109/THMS.2017.2732506)

**Brynjolfsson, E., Li, D. and Raymond, L.** *Generative AI at work.* Quarterly Journal of Economics,
140, 889–942, 2025. Outside software, and a sharper version of section 1's puzzle: across 5,172
customer-support agents, AI assistance raised issues resolved per hour by 15% on average; less
experienced workers gained in speed and quality, while the most experienced saw small gains in speed and
small declines in quality. The authors also find evidence that assistance helped workers learn.
[Read the source](https://doi.org/10.1093/qje/qjae044) ·
[NBER working paper](https://www.nber.org/papers/w31161)

**Becker, J., Rush, N., Barnes, E. and Rein, D.** *Measuring the impact of early-2025 AI on experienced
open-source developer productivity.* METR, arXiv 2507.09089, 2025. A randomised trial with 16
experienced developers on 246 tasks in projects they knew well: allowing AI made tasks take 19% longer,
while the developers estimated afterwards that it had made them 20% faster. The cleanest demonstration
that visible speed and felt speed can both mislead.
[Read the source](https://arxiv.org/abs/2507.09089) ·
[METR summary](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)

**Elsewhere in the Harbour Archive.** *The Cheap Ships* (document 5) asks what happens to Harbour when
agent work becomes a hundred times cheaper, and ends where this essay does: with the operator's
attention as the expensive thing. [Harbour Archive #5](https://harbour.cat/archive/5)

## Next

Three questions went to `proposals.md` with the first version of this essay: whether later
entrants reach accepted outcomes with fewer preparatory steps on comparable tasks, and whether
that advantage survives maintenance; which kinds of prior knowledge predict lower repair effort;
and whether a practice spreads faster through a shared task than through written instructions.
Each asks for evidence Harbour already keeps or could keep, and each leaves room for the essay to
be wrong. None would separate the three clocks by itself, but each would show how much of what a
team sees one of them explains.

Two of them bear directly on papers already in the archive. `developer-adoption-ladder.md` reads the
ladder as a sequence of practices and could not find a population instrument for its middle rungs; this
essay's adoption-cohort distinction says why one instrument will not do — a cross-section of newcomers
mixes a change in people with a change in tools. `what-lowers-the-verification-cost.md` found no study
showing a verified artifact changes supervision; the reciprocal-learning claim in section 5 is a second
route to the same outcome and is equally unmeasured.

Section 7's reading needs a test of its own, because it could be wrong in two ways a team can
observe. It would be wrong if calibration carried freely between domains, so that a developer
fluent with agents on one codebase supervised as well on an unfamiliar one; and wrong if the people
who best handled later changes to their generated work were simply the fastest, whatever their
record of being caught out. Harbour's operators review agent work in more than one repository, some
of which they know far better than others. Whether their review catches the same share of an
agent's mistakes in both is a direct test of the first condition, and it is already in
`proposals.md`.

**This version is unchecked.** Version 1 was checked against its eleven sources in
`learning-while-the-tools-change-check.md`, and versions 2 to 5 were revised by the check's own
author, who is now this essay's second author — which `standard.md` allows for an essay, on
condition that it is visible. The check covers version 1 only. The new material a reader should
weigh for themselves is the rollout's figures, read at the source on 2026-09-22; the chess
boundary condition; the reading in section 7, with the two conditions under Next that would refute
it; and the Stack Overflow figure, which version 2 took second-hand and attributed to agent users,
and which version 3 read at the source, where it is reported across all respondents. Version 4
follows Astra 6's review of version 3. It adds no source and no figure. It narrows three claims
that had outrun their evidence: that better tools slow learning, where they remove particular
lessons; that the telemetry's approval pattern shows calibration, where it is only consistent with
it; and that following the same people is the only design that can separate the clocks, where it
helps but is neither the only design nor enough by itself. Its four closing paragraphs are Astra
6's own. Version 5 makes three small edits from Astra 6's rereading of version 4: section 7 states
its claim without an aside about the essay, section 8 no longer anticipates the conclusion's
shared task, and section 6 now asks which lost lessons still matter before proposing to replace
them.