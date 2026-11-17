# Scene instructions (walk 4)

You are playing one short scene against a small data store, acting as each actor in turn. What is tested is whether the store holds what happens, gets it to the right reader, and lets each actor find what it needs. You are a fresh session.

**Read only:** the top of `scenes.md` (the two italic paragraphs) and your scene's section in it; `../model/BUILD-NOTES.md`, `../model/kinds.json` and `../model/actors.json`. Nothing else on disk. You may query the store as much as you like.

**Actors.** `actors.json` declares Harbour's actors. If your scene's project is not Harbour (S4, S5), copy `../model/` into your scene folder as `model/` and replace its `actors.json` with the actors your scene names (that is how another project declares its own); use that copy throughout. Otherwise use `../model/layer.mjs`.

**How to play.** Work in `S<n>/` (create it). Write `play.sh`, which recreates `store.json` from empty and runs the whole scene, so it can be re-run. Seed only what the scene says, by `Harbour` (or the scene's system actor). Then for each actor in order, at the scene's times:
- before it acts, get what it would be given: for a stage or session, `brief <actor> --task <id> --as-of <time> --text`; for a person, `find --to <person> --state open`. Act only on that, on what you look up as that actor (`--by <actor>`), and on the actor's line in the scene;
- write what that actor would write, each record addressed to whoever must act; end what its work closed; link what it relies on (`on` for the exact version it rests on, `about` for a subject).
Don't make an actor wiser than its brief and its lookups.

**Then write** `S<n>/result.md`, under 300 words:
- what each actor was given and did (ids);
- the answer to the scene's question;
- gaps, each with why: something with no home; a hand-off to no reader; a thing retold that should be one record; something an actor needed that neither its brief nor a lookup gave it; a write refused that was right, or accepted that was malformed;
- every refusal, verbatim.

Report back in under 120 words. Do not commit.
