# Yap mobile thread: timeline (22–23 April 2026)

Source: `git log` of the read-only clone of JKershaw/yap. Times as recorded in git (commits by "Claude" are in +0000; GitHub merge commits by John Kershaw are in +0100, so 07:48 +0000 = 08:48 +0100). Lines marked *(outside thread)* are other commits that landed on main in the same window, listed only for ordering. They are not reproduced in the PR files.

| Time (UTC) | Event | Authored by | Merged by | File |
|---|---|---|---|---|
| 2026-04-22 20:33 | Main is at 7d29890 (merge of PR #12). This is the "before" state for `standing/` | — | — | `standing/*.md` |
| 2026-04-22 20:52 | 0538d1c "Improve mobile UX: auto-grow textarea, safe areas, touch targets, font hierarchy" committed on branch `claude/add-chat-connection-pgLc6` | Claude | — | `pr-13-0538d1c.md` |
| 2026-04-22 20:53 | 0046799 merges PR #13 (0538d1c only) into main | — | John Kershaw (via GitHub) | `pr-13-0538d1c.md` |
| 2026-04-22 21:18 | *(outside thread)* ba31a8e "Add auto-reconnect, session resume, and client-side message cache", same branch, parent 0538d1c | Claude | — | (noted in `pr-13-0538d1c.md`) |
| 2026-04-22 21:20 | *(outside thread)* 185a58f merges PR #14 (ba31a8e) | — | John Kershaw | — |
| 2026-04-23 07:19 | *(outside thread)* 686f48f "Restructure TODO: split v1.0 bucket into v0.2–v0.7 minor releases" (changes `todo.md`) | Claude | — | `standing/todo.md.diff.md` |
| 2026-04-23 07:22 | *(outside thread)* a2e5e87 merges PR #15 (686f48f) | — | John Kershaw | — |
| 2026-04-23 07:32 | 906b8ea "Show who's here on mobile via a slide-in drawer" on branch `claude/fix-mobile-channel-members-fTjhR` | Claude | — | `pr-16.md` |
| 2026-04-23 07:42 | 3aa81b5 "Add e2e screenshots for the mobile who drawer" (adds test code only; no image files in the commit) | Claude | — | `pr-16.md` |
| 2026-04-23 07:44 | 3ebd17d merges PR #16 (906b8ea, 3aa81b5) | — | John Kershaw | `pr-16.md` |
| 2026-04-23 07:46 | *(outside thread)* 069deab "Rescope v0.2.0 from bundled runtime to documented integration" (adds `AGENTS.md`, changes `todo.md`, `philosophy.md`, `rejected-ideas.md`) | Claude | — | `standing/*.diff.md` |
| 2026-04-23 07:48 | 06b4711 "Keep chat header visible when mobile keyboard opens" on branch `claude/fix-mobile-keyboard-overlap-7xpoy` | Claude | — | `pr-17.md` |
| 2026-04-23 07:48 | c9cbf83 merges PR #17 (06b4711), 19 s after the commit | — | John Kershaw | `pr-17.md` |
| 2026-04-23 07:52 | fa2bad4 "Tidy up the mobile top bar" on branch `claude/mobile-topbar-cleanup-2mB8v` (parent c9cbf83) | Claude | — | `pr-19.md` |
| 2026-04-23 07:53 | *(outside thread)* c4bac8c merges PR #18 (069deab) | — | John Kershaw | — |
| 2026-04-23 08:03 | 7184a34 "Align mobile send button height with the input" | Claude | — | `pr-19.md` |
| 2026-04-23 08:03 | 456f01c merges PR #19 (fa2bad4, 7184a34) | — | John Kershaw | `pr-19.md` |
| 2026-04-23 08:12 | 72395ae "Fix stale dvh after mobile keyboard dismisses" on branch `claude/fix-mobile-keyboard-space-WiOoe` | Claude | — | `pr-20.md` |
| 2026-04-23 08:12 | 592cf39 merges PR #20 (72395ae). This is the "after" state for `standing/*.diff.md` | — | John Kershaw | `pr-20.md` |
| 2026-04-23 08:22 | *(outside thread)* b36ba38, merged 08:24 as PR #21 (14f7e92) | Claude | John Kershaw | — |

## Notes on the material

- Every thread commit has author and committer "Claude". Every merge commit has author "John Kershaw" and committer "GitHub".
- 0538d1c did not go to main directly. git shows it went in as PR #13, a single-commit PR.
- PR titles, descriptions, comments and reviews were not fetched. The anonymous GitHub API request got HTTP 403 from this session's proxy, and it was not retried. The only PR text available is each merge commit's message.
- No binary files or screenshots appear in any thread commit. No per-file diff was over 300 lines, so nothing was trimmed.
- `standing/`: `AGENTS.md` did not exist before 0538d1c, so there is no "before" copy. `design.md` did not change between 7d29890 and 72395ae, so it has no diff file. The changes to `todo.md`, `philosophy.md`, `rejected-ideas.md` and `AGENTS.md` in that range all come from commits outside the thread (686f48f, 069deab). No mobile-thread commit touches any standing file.
