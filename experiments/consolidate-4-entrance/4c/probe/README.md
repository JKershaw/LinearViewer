# Perturbation probe (4c)

These scripts ran the unit tests against behaviour-preserving rewrites of one Harbour module
(`lib/dispatch-entrance.js`) to see which tests depend on its text. They name a scratch directory
and a `block-net.mjs` that was never committed.

`indent`, `nocomment` and `rename` are generic. They live in `scripts/code-shape/probe.mjs`
(`<repo> <commit> --target <path> --test-cmd '<cmd>'`, which extracts the commit to a temp tree,
reads TAP, and reports the failures each rewrite adds). Blocking the network is the test command's
job: see `experiments/rebuild-exp1/kit/lib/no-network.mjs`. The other five rewrites (`fields`,
`callshape`, `declared`, `access`, `gate`) anchor on this one module and stay here, in `perturb.cjs`.
