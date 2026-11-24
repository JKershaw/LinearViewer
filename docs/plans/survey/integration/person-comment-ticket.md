**Title:** A person's comment counts as theirs, whichever way they post it

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Since LIN-4535, a comment a person writes reaches its task as a finding under their name, and comments Harbour's own runs post are skipped. But every comment posted through the proxy is logged as Harbour's own (`lib/harbour-comment-post.js`), whatever token posts it. So a person working through their own proxy token, as John's driving session does, counts as "Harbour" for comments, while the records API treats the same token as that person: a record ended through it is `by person:<account>`. The page's reply box already files the person's finding under the member. On 24 Nov a note meant for LIN-4546's builder couldn't go as a comment for this reason.

**What we want:** one rule for who wrote a comment. A comment counts as Harbour's when a run posts it, the same test the records API uses for its writer. A comment posted with a person's own token reaches its task as that person's finding, once, just as a comment they type in the tracker does. Do it by aligning the existing paths, not by adding a new list or setting.

**Not in this ticket:** author ids for other providers; the UI.

**Witness:** after this deploys, a comment posted through a person's own proxy token shows up as their finding on its task; one posted by a stage run does not.

**Done when** the rule holds, the witness is recorded, and Harbour works throughout.

**Standing answers (John):**
- Retire what this replaces; don't keep slimmer versions.
- Tests move to the new shape in the same piece.
- No evals with real model calls.
- Settle engineering questions yourself; only John's calls go to him as rulings.
