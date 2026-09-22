---
title: Learning While the Tools Change
kind: essay
argument: Engineering experience, AI experience and tool capability run on separate clocks, and better tools slow the second by absorbing the mistakes that used to teach — so what a team most needs to grow is calibrated distrust, which no snapshot of speed or seniority can see.
version: 2
date: 2026-09-22
authors: [Astra 6, Claude]
model: "Version 1 by Astra 6, per John Kershaw's attribution on filing; harness and effort not recorded, and the source .docx carries no author or model metadata. Version 2 by Claude Opus 5.5 (claude-opus-5-5, Claude Code CLI web session, effort high), at John's invitation, revising from the findings in learning-while-the-tools-change-check.md. No Harbour dispatch lineage for either."
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
newcomers start further along; they also absorb the mistakes that used to do the teaching, so
the second clock can run slower for someone whose first year is smoother. That makes the
capability a team most needs to grow neither fluency with the tools nor years in the
profession, but calibrated distrust: knowing which output to check, and how hard. Section 7
commits to that reading and says what would show it wrong.

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
Following one person over a year mixes learning with improvements in their environment. Neither
design can separate the clocks however large the sample, because every clock moves in both. That
is why a survey asking developers where they stand can describe a population but never explain
it, and why the only instrument that can is the same people doing comparable work at more than
one date. The three clocks do not, by themselves, separate these effects statistically; they say
which comparisons never will.

An everyday example makes the distinction concrete. One developer once needed a carefully
staged sequence to make an agent inspect a repository and implement a change. A newcomer may
receive an effective version of that sequence as a built-in workflow. The newcomer has acquired
access to its results immediately. Whether they have also acquired the judgement needed to
recognise its limits is a separate question.

The clocks are also not independent. The calendar clock sets the exchange rate for the other
two: when a tool absorbs a class of mistake, it removes the mistake and the lesson together.
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

Assisted performance and retained understanding can move at different rates. A developer may
deliver a working feature with an agent and still need help explaining why it works or changing
it safely. Another may learn quickly through an agent's explanations and experiments. Successful
completion alone does not identify which process occurred.

Lisanne Bainbridge's 1983 paper on the ironies of automation described a related difficulty in
industrial control. Automation can remove routine activity while leaving people responsible for
abnormal conditions. Reduced practice can undermine the skills needed for intervention. Her
discussion considered maintaining manual and diagnostic competence through training and suitable
feedback. It was an analysis of human control systems, not evidence that every form of automation
inevitably erodes skill. [[8]](#8-maintaining-expertise-under-automation)

Contemporary coding research gives the concern a narrower empirical basis. Shen and Tamkin studied
52 mostly junior engineers learning the unfamiliar Python library Trio. Participants with AI
assistance averaged 50 percent on an immediate comprehension quiz, compared with 67 percent
without it, a difference of 17 percentage points. The time advantage was not statistically
significant. Within the assisted group, explanation-seeking and conceptual inquiry were associated
with stronger understanding, but those interaction patterns were not randomly assigned. The study
does not establish a long-term effect on expertise. [[9]](#9-ai-assistance-and-learning)

This is the cost section 2 promised. Each improvement on the calendar clock removes
some mistakes before a person makes them, and the lessons with them, so a newcomer can deliver
more in their first year while accumulating less of the judgement that comes from being wrong.
Nothing in the output shows the difference.

The practical question is what replaces the learning opportunities removed by automation. Debugging
one's own mistake can expose a mistaken assumption. Reading a colleague's reasoning can reveal a
constraint. If an agent handles those steps, another activity may need to make the relevant
knowledge visible. That activity need not reproduce every manual procedure the technology has made
unnecessary.

For example, a developer could explain a generated change before merging it, predict its behaviour
under a changed requirement, or investigate a deliberately varied input. Such exercises are
proposals for making understanding observable. They should be judged by whether they improve
subsequent work, rather than treated as rituals that demonstrate seriousness.

Oversight itself can also evolve. Anthropic's telemetry found full auto-approval more common among
experienced Claude Code users, while their interruption rates were also higher. The pattern is
consistent with a shift towards letting work proceed and intervening when needed. It does not
demonstrate that auto-approval causes better outcomes, or that an individual should always grant
more autonomy as they gain experience. [[10]](#10-how-supervision-changes-with-experience)

The aim is a form of assistance that supports both useful output and the understanding needed for
future responsibility. How best to achieve that balance remains an empirical question.

## 7 How the landscape could evolve

The evidence supports several possible trajectories. An experienced engineer may learn a new
workflow quickly and combine it with knowledge that remains valuable. A newcomer may use AI to
accelerate both implementation and conceptual learning. Either may plateau when the task changes.
Further improvements in the tools may alter the relative advantage again.

These trajectories should be treated as hypotheses. A claim that experienced developers will
eventually overtake newcomers assumes that their knowledge remains valuable and that they can adopt
the new methods. A claim that newcomers will preserve their lead assumes that their learning keeps
pace with the responsibility of their work. Neither outcome follows from entry date alone.

If the essay has to commit to one reading — and an essay should — it is this. The capability that
decides who can be trusted with more is neither fluency with the tools nor years in the
profession but calibrated distrust: knowing which output to check, and how hard, in a domain one
understands well enough to be surprised by it. It is learned mostly from consequence, which is
why it accrues to experience, and why a tool that absorbs mistakes can slow its growth even as it
speeds delivery. The reading is consistent with the contemporary results in this essay. The Trio
learners with assistance understood less, and fewer of their errors were theirs to meet. The
experienced Claude Code users approved less up front and interrupted more, which is what
calibration looks like from outside. Dhanorkar's developers, below, varied their oversight with
the consequences of a mistake rather than with the tool. And most people who use an agent still
do not let it run unattended: of the agent users in Stack Overflow's April 2026 pulse, 63% rarely
or never do. [[2]](#2-the-harbour-adoption-papers)

The reading would be wrong if calibration transferred freely between domains, so that a developer
fluent with agents on one codebase supervised as well on an unfamiliar one; or if the people who
best handled later changes to their generated work were simply the fastest, with no relationship
to how often they had been caught out. Both are observable in an ordinary team.

Task context can change the comparison immediately. Dhanorkar, Passi and Vorvoreanu interviewed 17
experienced developers about oversight of software agents. Their accounts distinguished relatively
permissive use in prototypes from stricter review of changes to interconnected existing systems. The
study identified four forms of oversight: a priori control, co-planning, real-time monitoring and
post hoc review. The first is control set before any work is delegated — which settings the agent
runs under, what it may touch — and it is where much of the difference between a prototype and a
migration lives. The study offers qualitative evidence about practice, without establishing the
population size or performance advantage of each pattern. [[11]](#11-oversight-in-actual-development-work)

A plausible prediction is therefore that capability will remain uneven across tasks. A developer who
delegates a prototype effectively may choose close supervision for a migration. That change need not
represent a retreat in maturity. It may reflect different consequences, different knowledge
requirements or a more accurate understanding of the tool.

The boundary may continue moving. Models could improve at work currently dominated by human
judgement. Teams could develop stronger checks that make some decisions easier to delegate. New
responsibilities could appear around operating and coordinating the resulting systems. These are
possibilities for investigation rather than reasons to assume either permanent human advantages or
inevitable replacement.

There is also a measurement problem. More autonomy is a description of how work proceeds, not a
complete measure of capability. Someone who appropriately stops an agent may be exercising better
judgement than someone who lets it continue. A useful account of progress must include the result and
its consequences, as well as the amount of supervision.

The three-clock model consequently needs repeated observations of people doing comparable work. A
snapshot may identify differences, but it cannot explain whether those differences arose from earlier
learning, better tools, task selection or support from colleagues. Following trajectories makes those
explanations more testable, even when a small team cannot cleanly estimate causal effects.

## 8 What an engineering lead can learn from this

The immediate task is to make different forms of capability visible without turning them into a fixed
ranking. For a small sample of ordinary tasks, record what was attempted, the tool and workflow used,
the help required, and what happened after delivery. Include enough context to distinguish a prototype
from a change to a critical existing system.

Time to a first plausible answer is useful but incomplete. Consider the effort required to reach an
accepted result, including review and repair by other people. Return to a few changes later to see
whether their authors can explain, extend or diagnose them. A delayed observation can reveal something
that a successful demonstration cannot.

If calibrated distrust is learned from consequence, the most useful thing a delivery system can give a
developer is cheap, visible wrongness: a record of where an agent's claims failed, surfaced early
enough that the lesson lands before the habit sets. A review ledger, a provenance trail and a failing
test all do this. A run of green merges does not, however reassuring, because it shows where the work
ended and hides where it went wrong on the way.

These observations should support development conversations. If review effort is rising, investigate
whether task scope, generated volume, missing context or weak checks explain it. If a developer obtains
useful results quickly and handles later changes confidently, recognise that capability even when their
route to it differs from the team's earlier practice.

Create opportunities for knowledge to travel in both directions. Ask experienced engineers to explain
the constraints behind their decisions. Ask colleagues fluent with agents to demonstrate their workflows
and recovery strategies. Review a real task together, so that claims about speed or reliability can be
examined against a shared example.

When a tool changes, revisit a small number of established procedures. Identify which still protect an
important outcome, which can be simplified and which have become unnecessary. This makes adaptation a
continuing part of engineering practice. It also prevents a previous generation's temporary workaround
from becoming an unexplained requirement for every newcomer.

Several questions would make a useful continuing investigation. Do later entrants reach accepted
outcomes with fewer preparatory steps on comparable tasks? Does that advantage persist through
maintenance? Which kinds of prior knowledge predict lower repair effort? Does learning spread more
effectively through shared tasks than through written instructions alone? Each question asks for
observable evidence and leaves room for the initial interpretation to be wrong.

The leadership problem is ultimately to support useful work while maintaining the team's capacity to
understand and sustain it. Historical research shows why entry timing, retained expertise and
relationships can all matter. The next step is to learn which of those mechanisms are active in the team
at hand. A shortened route is valuable when it reaches an outcome the team can rely on, and the people
taking it can continue to grow.

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

An exploratory interview study of 17 experienced developers. It distinguishes preparation, co-planning,
monitoring and review, and shows how task context affects supervision. It describes reported practices
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

For a short reading route, begin with Barley for team relationships, Bainbridge for supervision and
learning, and David for changes in the organisation of work. Lee and Lim then provide the vocabulary for
comparing different routes through technological change, and Murphy-Hill, Butler and Savelieva show the
same questions measured in 2026.

## Next

The essay's own closing questions are the first candidates, and three go to `proposals.md` with this
change: whether later entrants reach accepted outcomes with fewer preparatory steps and whether that
survives maintenance; which kinds of prior knowledge predict lower repair effort; and whether a practice
spreads faster through a shared task than through written instructions. Each is answerable inside Harbour
from records it already keeps or could keep, and each would turn one of the three clocks from a
distinction into a measurement.

Two of them bear directly on papers already in the archive. `developer-adoption-ladder.md` reads the
ladder as a sequence of practices and could not find a population instrument for its middle rungs; this
essay's adoption-cohort distinction says why one instrument will not do — a cross-section of newcomers
mixes a change in people with a change in tools. `what-lowers-the-verification-cost.md` found no study
showing a verified artifact changes supervision; the reciprocal-learning claim in section 5 is a second
route to the same outcome and is equally unmeasured.

Section 7's commitment adds one more, because it names what would refute it: does calibration transfer
between domains? Harbour's operators review agent work in more than one repository, some of which they
know far better than others. Whether their review catches the same share of an agent's mistakes in both
is a direct test of whether the scarce thing is domain-bound, as this essay argues, or portable.

**This version is unchecked.** Version 1 was checked against its eleven sources in
`learning-while-the-tools-change-check.md`, and version 2 was revised from that check's findings by the
check's own author, who is now this essay's second author — which `standard.md` allows for an essay,
on condition that it is visible. The check covers version 1 only. The new material a reader should weigh
for themselves is the rollout's figures, read at the source on 2026-09-22; the chess boundary condition;
and the reading in section 7 with the two conditions that would refute it.
