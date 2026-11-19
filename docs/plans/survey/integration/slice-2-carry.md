# Slice 2: what slice 1 hands forward

*Started 19 Nov. Items picked up while slice 1 runs, to go into the slice 2 draft for John. The draft itself is written once slice 1 lands, from what it really left.*

## To include (John's rulings)

1. **Retire the frozen Waiting-list reader.**
   - **Where it stands:** LIN-4495's cutover (PR #2468, merged 21:26 on 19 Nov as e942c1031) removed the Waiting lists. It kept a frozen copy of their reader, commented "only for the one-off import", with no end date. The stability scripts now use it too.
   - **The rule it breaks:** a kept path says when it goes.
   - **What to do:** once LIN-4496's live import has run, remove the reader and move the stability scripts onto the records store.
   - **Ruled by John,** 19 Nov ~21:35: option (a), add it to the slice 2 draft.

## How tidies like this are handled (John, 19 Nov)

In order of preference, and only where it's wise:
1. tidy as we go;
2. a small standalone tidy task;
3. wait until the end.

Keeping the running slice going comes first: no tidy interrupts it.
