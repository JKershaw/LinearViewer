# Survey global: prompt v2, code only (v2 without the codebase's own reports and maps; John's steer, 4 Nov 21:20)

---

**Live text moved (LIN-4248).** The prompt is now the `survey-place` template in `lib/prompt-template-defs.js`, sent by hand, and it is not copied here, so the text lives in one place. Against the hand-sent text (in this file's git history and on branch `claude/cool-rubin-6acj5j`), the template changes only three things: the comment goes on the surveyed ticket (`{TICKET}`), which replaces the hard-coded `LIN-4150` record ticket; `{BASE}` is `origin/main`'s commit, which the session resolves when it starts; and the Goal/Process frame and a Scope and Authority line wrap the text.
