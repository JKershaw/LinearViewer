Scope: GitHub Actions CI, for AI agents checking status without authentication. Moved verbatim from CLAUDE.md (LIN-2896).

## GitHub Actions CI (for AI Agents)

This is a public repository, so GitHub Actions status can be checked without authentication using curl.

### Check Recent Runs

```bash
# List recent workflow runs
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=5" | \
  jq '.workflow_runs[] | {id, status, conclusion, head_branch, display_title}'

# Quick status of latest run
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=1" | \
  jq '.workflow_runs[0] | {status, conclusion, html_url}'
```

### Check Specific Run

```bash
# Get run status by ID
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs/RUN_ID" | \
  jq '{status, conclusion, html_url}'

# Get job details for a run
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs/RUN_ID/jobs" | \
  jq '.jobs[] | {name, status, conclusion}'
```

### Poll for Completion

```bash
# Wait and check (useful after pushing changes)
sleep 30 && curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=1" | \
  jq '.workflow_runs[0] | {status, conclusion}'
```

### Status Values

| Field | Values |
|-------|--------|
| `status` | `queued`, `in_progress`, `completed` |
| `conclusion` | `success`, `failure`, `cancelled`, `skipped` (only when completed) |

**Unit job MongoDB**: the `Unit tests` job's `mongodb` service is pinned to `mongo:8.0.32` (production's version) with `GLIBC_TUNABLES=glibc.pthread.rseq=1`. mongo 8.x refuses to start on kernel 6.19 to 7.0.13 (SERVER-121912, LIN-3693), and the runner fleet is mixed (6.8 / 6.17 / 7.0.0). Measured on 7.0.0: with `rseq=1` the refused 8.x images start and take load; `rseq=0` doesn't help (probe run 39302841645, PR #1991). The pin must move with production. The job prints `uname -r` so each run records its kernel.

**Note**: CI runs on pull requests targeting `main` and on pushes to `main` (i.e. after a PR merges). The `ci-success` job aggregates the unit and e2e jobs into a single stable check — require it as a branch-protection status check so automated agents can confirm CI is green before merging.
