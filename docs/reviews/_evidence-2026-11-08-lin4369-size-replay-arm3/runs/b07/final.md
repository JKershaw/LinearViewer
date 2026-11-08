I've sized LIN-4252 as **just the task**, with no cuts to what was asked, using the standing size policy. Nobody has posted a size ruling on the ticket.

**Is the ticket stale?** No. None of the files it names has changed since it was written (last touched 2026-11-05; HEAD is 29f14bf6e). Every code claim in both Surveys holds when I re-read the code. I couldn't run the suites because this clone has no `node_modules`.

**Why the size stays at just the task.** The Surveys found real gaps, but each one is part of building the fake the ticket asks for, not a separate piece of work:
- **Repainting by `outerHTML`:** `public/prompt-section.js` repaints its slots this way at five places. The ticket's list doesn't mention it, but the fake can't repaint that page without it.
- **Reading markup back as written:** about 30 lin-4010 assertions match against the container's markup. The check that decides whether a question card is kept compares old and new markup. lin-4242's fake returns an empty string there, so every repaint would "keep" the card and the test would pass without checking anything.
- **The selector forms `prompt-section.js` uses:** lin-4242's matcher throws on them, so lin-4010 couldn't pass on it.
- **Clicks on real page elements:** lin-4010's click helper makes up its own buttons. If it stays, part of a second fake stays too.

These are what "models what a repaint needs" covers.

**Left in the Surveys:** moving the other ~19 suites onto the fake, removing the 16 checks in `prompt-section.js` that exist only for the fakes, and splitting that file. The ask works without them, and the ticket rules them out.

**Found in the code, missed by both Surveys:** `tests/fixtures/observation-dom-shim.js` is already a shared fake DOM, used by three Observation suites. The new file's header should name it, so there is clearly one fake to use for repaint claims.

**Risk for the build stage:** with a working `querySelector`, lin-4010 runs repaint code for the first time. If any of it fails for a real reason, "no production code changes" and "same test names and counts" can't both hold. That should come back as a ruling, not be patched inside the fake.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b07/output/`:
- `description.md`: the size record for the description
- `comment.md`: the scoping comment
- `tracker-actions.md`: status set to In Progress

DONE: LIN-4252 sized as just the task with no cuts (standing policy); size record, comment and status change written
