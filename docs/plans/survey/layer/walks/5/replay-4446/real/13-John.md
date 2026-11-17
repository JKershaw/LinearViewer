# What John really wrote

## Comment on LIN-4446 at 15:39:21 (relayed by the driving agent)

**John's read of slice 1** (relayed by the driving agent; John approved these words):

> Read slice 1, and the KPI page looks fine. Serving pure shared files at /shared/ is right. The per-module bridge back to a global shouldn't become the pattern: the sensible, clean direction is for pages to become ES modules that import shared code directly, one view at a time, with any bridge only a temporary ramp that visibly shrinks. The next slices run that way, as a tidy task.
