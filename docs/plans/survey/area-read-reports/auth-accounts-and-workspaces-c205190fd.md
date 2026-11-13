# Area read: Auth, accounts & workspaces @ c205190fd (control, before, LIN-4463)

The untouched control for the browser before-read, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). Adoption and the verdict are in [area-read-adoption-0cf05ce8f.md](../area-read-adoption-0cf05ce8f.md). The after-control is [auth-accounts-and-workspaces-0cf05ce8f.md](auth-accounts-and-workspaces-0cf05ce8f.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | Auth, accounts & workspaces (`auth-accounts-and-workspaces`), the control |
| Base commit | `c205190fd` |
| `docs/areas/areas.json` blob | `d13fca20e50c37e859e82fbc820177acefd4e48d` |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` |
| Note | `docs/areas/auth-accounts-and-workspaces.md`, blob `c69796f01b2fc3f1ede6816e126479cb99b09691`, 2,081 B |
| Universe | 64 files, 945,008 B |
| N | 14 (frozen) |
| Sample | 14 files, 205,106 B; identical paths and blobs at `0cf05ce8f` (adoption file, section 3) |
| Bundle | note plus sample, 207,642 B, built from git objects at `c205190fd` |

## Passes

Two passes, each a fresh general-purpose agent. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. File names and header comments say what each module owns (`lib/owner-credential-store.js`, `lib/workspace-preferences.js`, `routes/jira-auth.js`), so the file to open for a behaviour is usually clear.
- K2: 3. Some rules are declared once with explicit "single source" wording, but the production-signal rule and the one-source-per-kind refusal are restated across files and in repeated comments (`lib/session-options.js`, `routes/jira-auth.js`).
- K3: 3. Store methods and email helpers read clearly in place, but the Jira route handlers and the workspace-preference resolvers depend on helpers in other modules whose behaviour is not in view (`routes/jira-auth.js`, `lib/workspace-preferences.js`).
- K4: 3. Names such as `markSpendIntent`, `resolveCredentialState` and `putIfRefreshToken` say what they do, but comments lean on internal codes (LIN-1887, D8, G1, N3, L4.1) and use "user", "account" and "person" for the same concept (`lib/owner-credential-store.js`, `lib/user-preferences.js`).
- Code mean: 3.3

Note
- M1: 4. The one lesson names the steps in order (take it out of `SETTINGS`, keep `summarizeWorkspaceEntry`, leave the preference unread) and gives the reason for each, though the wording is dense.
- M2: 3. Each waiting entry names its file and what is waiting, but only the Jira entry says why it is not scheduled; the session-options and email-auth entries give urgency or a condition, not a reason for deferral.
- Note mean: 3.5

Where I could not tell: the note's format rules in README.md; `lib/workspace-change-log.js` and the route that falls back to a feature flag (the lesson depends on them); `lib/model-routing.js` (`resolveFromRows`); `lib/workspace.js` (`linkProvider`, `sameKindSourceBound`); `lib/connection-credential.js` (`convertToConnectionBacked`); whether the deferred items are still open; and the cited review documents and LIN-4393, none of which are in view.
```

Pass A: code raw mean 3.25 (reported 3.3); note mean 3.5.

### Pass B

```
Code
- K1: 4. Most files are named for their surface and each header lists what it owns, so the file to open is usually clear from the name. Cites: lib/email-availability.js, routes/jira-auth.js
- K2: 3. Email availability and refresh strategy each have one declared home, but NODE_ENV production gating is restated across several files and routes/jira-auth.js repeats its conflict and refusal exits. Cites: lib/email-availability.js, routes/jira-auth.js
- K3: 3. Most helpers state their steps, but completeJiraNewLogin depends on closure state and on establishAccount, convertToConnectionBacked and resolveFromRows, which are defined in files not given. Cites: routes/jira-auth.js, lib/workspace-preferences.js
- K4: 3. Terms such as partition, legacy and add-source are used consistently, but comments carry ticket numbers and history narration, and "workspace", "container" and "user"/"account" drift between files. Cites: routes/jira-auth.js, lib/user-preferences.js
- Code mean: 3.3

Note
- M1: 4. The one lesson says what to do, names the file and explains what breaks if the steps are skipped, though the reason for leaving the stored preference unmigrated is left implicit.
- M2: 3. Each waiting entry names its file, but the first two say what is wrong or what would fix it without saying why they are unscheduled, and only the Jira entry gives a reason.
- Note mean: 3.5

Where I could not tell: lib/workspace-change-log.js (SETTINGS, summarizeWorkspaceEntry, undo) and the modules the code imports (lib/workspace.js, lib/account-session.js, lib/connection-credential.js, lib/model-routing.js) are not in the bundle, so I could not check where those rules are decided. The review documents cited in the Waiting entries, and ticket LIN-4393, are not in the bundle, so I could not verify the security claims or the dates.
```

Pass B: code raw mean 3.25 (reported 3.3); note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.25 (reported 3.3) | 3.5 |
| Pass B | 3.25 (reported 3.3) | 3.5 |
| **Area** | **3.25** | **3.5** |

- **Noise guard:** the passes' code means differ by 0.00, so the read is decided.
- **Control flag:** the control's code is untouched between the commits (adoption file, section 4). Its note moved, and that movement is reported on its own.

## Contamination check

| Pass | Tool calls | Tools used | Inside own inputs? |
| --- | --: | --- | --- |
| A | 11 | Read 11 | yes |
| B | 19 | Read 19 | yes |
