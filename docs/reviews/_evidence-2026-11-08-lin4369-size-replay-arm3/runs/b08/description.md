## Size of the move
**Size:** just the task
**Why:** One shared fake DOM both suites run on, modelling every way the page repaints, including whole-slot replacement and markup read back as text; the other copies and fake-only guards in the code don't bind.
**Cuts:** none
**Decided by:** the standing policy
