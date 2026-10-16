# Rung 3: design-first informed rebuild of routes/proxy-reads.js, prediction (written before launch)

**Baseline** (`65969467`, kit `shape.mjs`): 448 code lines, 281 comment lines, 18 functions, 98 decision points. The worst handler is the attachments route (31 decision points, 111 code lines); the factory's span is 431 lines.

**Run**
- Merges: about 75%. Done without a ruling: about 55%.
- 50–120 minutes.

**Result**
- 330–440 code lines. The handlers share a lot (provider resolution, error mapping, logging), so most of the cut comes from saying that once.
- Worst function at most 15 decision points: about 65%.
- The attachments hang is fixed and pinned: about 80%.
- My independent replay (3,000 requests, 100% line coverage) finds: 0–3 behaviour changes beyond the hang fix and accepted fuzz, about 75%; a regression an agent would notice, about 15%.

**Risk:** the router's behaviour is wide (14 routes, many error shapes), and both replays depend on fakes modelled on `routes/proxy.js`. A shared blind spot in those fakes is possible. Mine and the worker's are built independently, which helps.
