# Navigation: the side rail (7 Nov 2026)

Harbour's navigation grew one item at a time, as features arrived. Each item made sense on the day it was added. Together they make a bar that no longer tells a person where they are or where to go. This review describes what is wrong with it today and what John chose to replace it with: **a side rail** (shape B of the navigation prototype, 7 Nov).

This is feedback, not a build plan. It says what is wanted and how it should feel; how to build it is the builder's call. The pictures show intent, not pixels.

**This replaces an earlier ruling.** On 3 Nov John ruled "keep today's bar" for round 3's item 25 (ruling `lin4040-view-bar`, LIN-4163). Choosing the side rail on 7 Nov supersedes it.

It sits beside [UI sweep 4](../ui-sweep-4-2026-11-07/README.md), which covers what is inside each page. This review covers the frame around every page: the rail, the top of the page, the footer, headings, tab titles, and the way back from a page you drilled into.

## How this was checked

`main` at `aec9e16`, run locally with a copy of this workspace's real backlog. Every page was captured at 1280px and 390px, in light and dark, for the runner owner, a new user without a runner, and someone signed out. The checks also covered keyboard order, the workspace menu, search, the badge, the footer, and how feature flags change the bar.

## What is wrong today

[1](shots/1-today-desktop.png), [2](shots/2-today-phone.png), [3](shots/3-today-workspace-menu.png)

- **One flat row of nine lowercase items:** tasks · swipe · swim · observation · settings · kpis · live console · dispatch · proxy. They are not grouped by what a person is doing. Settings sits in the middle of the views. A new user sees Proxy and KPIs, which don't apply to them yet.
- **The places move.** Opening Dispatch moves it ahead of Live Console. The current place is marked twice, with an arrow and an underline, and the arrow pushes everything to its right along.
- **The page jumps under you.** Headings start at five different left edges across Home, the task page, Observation, Live Console and Run on my machine. Heading sizes vary from 20px to 24px.
- **Pages people use aren't in the bar.** The Backlog page and Run on my machine have no item. On the Backlog page no item is lit at all, and its heading is the workspace's name rather than "Backlog".
- **Headings and tab titles don't name the page.** Settings has no heading. Home's tab says "Local Workspace - Projects". Other tabs say "Swim - Lanes", "Observation", or a task title prefixed with "Swipe".
- **Search appears only on task pages,** and only filters the rows already on the page.
- **The "waiting on you" badge goes to Observation › Rulings,** even on Home, where the same questions are now answered in place.
- **The workspace menu puts a red "remove"** right beside the workspace you're in, one slip from switching. "+ Linear" and "+local workspace" are spaced differently.
- **On a phone the header takes three bands, about 155px.** The wordmark shrinks to 11px, "workspace:" sits on its own line, the tabs are 11–12px, and Live Console, Dispatch and Proxy hide behind a small "···".
- **The footer changes from page to page.** A lone "reset" appears only on Home. The AI status shows on some pages and not others. Each legal page drops its own link, so the row shifts.
- **Public pages have their own header.** Library, Templates and Privacy show a plain "Harbour" with no way back to the landing page or, for someone signed in, to their workspace. Getting started has a different type treatment again. The Swipe and Swim previews have a small row of links at the top right.

## What is wanted: the side rail

[4](shots/4-rail-home.png), [5](shots/5-rail-task.png), [6](shots/6-rail-settings.png), [7](shots/7-rail-dark.png), [8](shots/8-rail-phone.png)

The rail should feel like the chart table in a wheelhouse: everything you can reach, laid out where it always is, grouped by what you are doing. Glance left to see where you are, and where else you could be. The page beside it gets on with its job without carrying the navigation in its own head.

At the top of the rail sit the wordmark, the workspace, and search. Below them are the places, in groups that name what a person is doing:

- **Your desk:** Home and Backlog. Home carries the count of what is waiting on you.
- **Watch:** Live (today's Live Console) and Runs (today's Observation).
- **Views:** Swipe, Swim, and any view a person turns on in Features.
- **Tools:** Dispatch, Connect an agent (today's Proxy page), KPIs, Prompts.
- **Settings** sits on its own at the foot of the rail.

A place that can't do anything yet for this person (Live and Dispatch without a runner, say) stays out of the rail until it can, and a group with nothing in it goes.

**On a phone,** the rail becomes a drawer behind ☰. The top band is a single row: ☰, the page's name, what is waiting on you, and search. The type stays at desktop sizes.

**A page you drill into** (a task, a run, a settings area) lights its parent place in the rail and gives one way back to it. The prototype shows a back arrow and a "← Home" line together on the phone; one is enough.

**Settings has its own list of areas,** which sits beside the rail on desktop. The two should read as a place and its sections, not as two competing sidebars.

The names Live, Runs and Connect an agent are suggestions. They say what a person does there rather than how the feature is built. Better words are welcome.

## What every page should do, inside the rail

1. **Every page sits in the same frame.** Same left edge for the content, same heading size, same space above the heading. A page may be narrow or wide, but it starts in the same place.
2. **The places stay put.** Same order on every page. A feature flag adds a place in its own slot and never reshuffles the rest.
3. **Where you are is marked once.**
4. **Every page has a heading and a tab title that name it,** such as "Backlog · Local Workspace".
5. **Search is in the same place on every page and finds tasks across the workspace.**
6. **"Waiting on you" leads to the questions themselves,** on Home. With nothing waiting, the count goes away.
7. **The workspace menu switches and adds workspaces.** Removing one belongs in Settings.
8. **On a phone, the top is one band,** and nothing is smaller than on desktop.
9. **The footer is quiet and the same on every page:** Library, Templates, Privacy, Terms, Source. Home's lone "reset" goes, or moves next to the thing it resets.
10. **Signed-out and public pages share the frame.** They show the wordmark, a way back, and Sign in (or, for someone signed in, a way back to their workspace). They don't need the rail.
11. **The keyboard can reach everything.** It can also skip past the rail to the page, and focus is always visible.

## Every place, and who goes there

| Group | Place | Who, how often | Today |
| -- | -- | -- | -- |
| Your desk | Home | Everyone, every visit | "tasks", first in the bar |
| | Backlog | Everyone, most days | A link at the foot of Home; no item lit when you're on it |
| | A task, a run | Everyone, from a row | Pages reached from a row. Only the task page has a way back |
| Watch | Live (Live Console) | The owner with a runner, while work runs | In the bar when on; behind "···" on a phone |
| | Runs (Observation) | The owner, now and then: run history, rulings, scan-due | In the bar |
| Views | Swipe, Swim, flagged views | Some people, for triage | In the bar for everyone; flagged views behind "···" |
| Tools | Dispatch | The owner, rarely | In the bar (owner with a runner) |
| | Connect an agent (Proxy) | The owner, once per agent | In the bar for everyone. Overlaps Settings › Agent access |
| | KPIs, Escalation, Effort | The owner, now and then | KPIs in the bar; the other two reached from pages |
| | Prompts | The owner, rarely | From Settings › Features |
| Set up | Settings (8 areas) | The owner, now and then | Fifth in the bar |
| | Run on my machine | The owner, once | Not in the bar; reached from Settings › Running and "Set up a runner" |
| | Your workspaces | People with more than one | "workspace:" in the header |
| Reading | Library, Templates, Getting started, Privacy, Terms, public KPIs | Anyone | The footer, with their own plain header |

## Left to the builder

- **Whether Runs and Live stay two places or become one with two tabs.** Either works if a person can tell what each is for.
- **Where Run on my machine and the measurement pages (Escalation, Effort) live.** They can sit in the rail, inside Settings or KPIs, or be reached from where they're needed. The rule is that none of them is an orphan.
- **Whether the rail can be collapsed on desktop.**

## Not real in the pictures

The page bodies are cut down. The counts come from the 29 Oct copy of the backlog. The phone task view shows two ways back where one is wanted. Colours and spacing show intent. The prototype itself is a private page John can share (shape B); its HTML is not committed.
