# Area read: Auth, accounts & workspaces @ 0cf05ce8f (control, after, LIN-4463)

The untouched control for the browser after-read, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). Adoption and the verdict are in [area-read-adoption-0cf05ce8f.md](../area-read-adoption-0cf05ce8f.md). The before-control is [auth-accounts-and-workspaces-c205190fd.md](auth-accounts-and-workspaces-c205190fd.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | Auth, accounts & workspaces (`auth-accounts-and-workspaces`), the control |
| Base commit | `0cf05ce8f` |
| `docs/areas/areas.json` blob | `db8851b97ab0294c2b121006823b38b6159a8940` |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` |
| Note | `docs/areas/auth-accounts-and-workspaces.md`, blob `fa65fd2b584bb2c8edc90c4038bcdb4ca5289e1f`, 2,466 B |
| Universe | 64 files, 945,008 B (same as `c205190fd`) |
| N | 14 (frozen) |
| Sample | 14 files, 205,106 B; identical paths and blobs at `c205190fd` |
| Bundle | note plus sample, 208,027 B, built from git objects at `0cf05ce8f` |

## Passes

Two passes, each a fresh general-purpose agent. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. File names and header comments say what each module owns, though the workspace change log lesson is not among the files given.
- K2: 3. The email transport is decided by one predicate in lib/email-availability.js, but the NODE_ENV production checks and the sha256 helper are restated in lib/email-transport.js and lib/email-auth.js, and model routing is split across lib/workspace-preferences.js and a routing module that was not given.
- K3: 3. Most helpers read clearly from the file in front of you, but routes/jira-auth.js (completeJiraNewLogin) and lib/workspace-preferences.js (the model resolvers) depend on functions defined in files that were not given.
- K4: 3. Names such as resolveEmailTransportKind and pendingSpend say what they do, but account, user and workspace are used interchangeably, and comments lean on unexplained ticket codes such as LIN-1887 G1 and D8.
- Code mean: 3.3

Note
- M1: 4. Each lesson names the file, the steps to retire a setting, and the reason (old rows still read, and undo would otherwise be wrong), so a reader can act on it.
- M2: 3. Each waiting entry names its file and what it waits for, and some give a reason (a team-workspace decision, a naming call), but the email and session entries say only what would close them, not why they are unscheduled.
- Note mean: 3.5

Where I could not tell: lib/workspace-change-log.js (SETTINGS, summarizeWorkspaceEntry, undo) is not in the bundle, so the lesson cannot be checked against code. The model-routing module (resolveFromRows, resolveAgentFromTable, tableFromPreferences), lib/workspace.js (linkProvider, sameKindSourceBound), lib/account-session.js (establishAccount), lib/connection-credential.js (convertToConnectionBacked), lib/harbour-token-format.js and lib/task-share-store.js are referenced but absent. The review documents cited in the waiting entries are also absent.
```

Pass A: code raw mean 3.25 (reported 3.3); note mean 3.5.

### Pass B

```
Code
- K1: 4. File names and module headers say what each module owns (`lib/email-availability.js`, `lib/refresh-strategy.js`), so the right file is usually findable from the name alone.
- K2: 3. The email transport rule, refresh table and routing resolvers each state where they are decided, but the production-env check is restated across modules (`lib/session-options.js`, `lib/workspace-preferences.js`), and the same-kind refusal and model routing are decided in files not given.
- K3: 3. Pure helpers such as `normalizeEmail` and `resolveEmailTransportKind` read clearly alone, but `completeJiraNewLogin` in `routes/jira-auth.js` depends on several unseen helpers (`resolveKeyOrRespond`, `respondToAccountConflict`, `convertToConnectionBacked`).
- K4: 3. Terms like "provider partition" and "pendingSpend" are used consistently, but comments carry ticket numbers and historical asides ("This comment used to say..."), "Harbour" and "Linear" alternate, and a JSDoc block sits above the wrong function in `lib/workspace-preferences.js`.
- Code mean: 3.3

Note
- M1: 4. The one lesson says exactly what to remove, what to keep, and why (old rows still read, are not undoable, and the route would fall back to a feature flag), so it is actionable.
- M2: 3. Each entry names its file and what is waiting, but only the Jira and task-share entries say why they are unscheduled, and the email and session-options entries give no reason for deferral.
- Note mean: 3.5

Where I could not tell: `lib/workspace-change-log.js`, `summarizeWorkspaceEntry`, `SETTINGS`, and the undo route the lesson names are not in the bundle; `sameKindSourceBound` and `linkProvider` (`lib/workspace.js`) and the model-routing functions (`lib/model-routing.js`) are not given, so I could not check where those rules are decided; the review documents the note cites are not provided, so I could not check the Waiting entries against them; whether the hosted email door is currently on, as the note says, cannot be confirmed from these files.
```

Pass B: code raw mean 3.25 (reported 3.3); note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.25 (reported 3.3) | 3.5 |
| Pass B | 3.25 (reported 3.3) | 3.5 |
| **Area** | **3.25** | **3.5** |

- **Noise guard:** the passes' code means differ by 0.00, so the read is decided.
- **Control flag:** the control's code is untouched between the commits, and all 14 sampled blobs are identical (adoption file, section 4). Its note moved from 2,081 B to 2,466 B, and that movement is reported on its own.

## Contamination check

| Pass | Tool calls | Tools used | Inside own inputs? |
| --- | --: | --- | --- |
| A | 7 | Read 7 | yes |
| B | 4 | Read 4 | yes |
