# Slice 2: what slice 1 hands forward

*Started 19 Nov. Items picked up while slice 1 runs, to go into the slice 2 draft for John. The draft itself is written once slice 1 lands, from what it really left.*

## To include (John's rulings)

1. **Retire the frozen Waiting-list reader.**
   - **Where it stands:** LIN-4495's cutover (PR #2468, merged 21:26 on 19 Nov as e942c1031) removed the Waiting lists. It kept a frozen copy of their reader, commented "only for the one-off import", with no end date. The stability scripts now use it too.
   - **The rule it breaks:** a kept path says when it goes.
   - **What to do:** once LIN-4496's live import has run, remove the reader and move the stability scripts onto the records store.
   - **Ruled by John,** 19 Nov ~21:35: option (a), add it to the slice 2 draft.

## How tidies like this are handled

A judgement call, not a rule (John, 19 Nov). Tidying as we go, a small standalone task, or waiting until the end can each be right, depending on the case. Keeping the running slice going matters most. John expects much of this to sort itself out once the upgrade is done.
