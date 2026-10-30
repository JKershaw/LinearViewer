# LIN-4024 evidence: Home in light and dark, owner and new user

Home on a seeded local workspace, with one task opened, at 1280px and 390px, in light and dark:

| | light | dark |
|---|---|---|
| Runner owner, 1280px | `home-owner-light-1280.png` | `home-owner-dark-1280.png` |
| Runner owner, 390px | `home-owner-light-390.png` | `home-owner-dark-390.png` |
| New user, no runner (copy-first), 1280px | `home-new-user-light-1280.png` | `home-new-user-dark-1280.png` |
| New user, no runner (copy-first), 390px | `home-new-user-light-390.png` | `home-new-user-dark-390.png` |

The owner's workspace has one open ruling, on LOCAL-3 (a Todo subtask of the started charter LOCAL-1). Each owner shot opens the charter and LOCAL-3: the count line and the header badge both say 1 waiting on you, the charter row and its opened task say a subtask needs you, and LOCAL-3 shows the question with its answers. Each new-user shot opens the charter and LOCAL-2. At 390px the workspace name has its own line under the wordmark (item 23, ruling `lin4024-header-name`).

Made by `tests/visual/lin-4024-home-screenshots.spec.js` in CI's image (`mcr.microsoft.com/playwright:v1.57.0-noble`, linux/amd64, Node 24):

```
npx playwright test --config=playwright.visual.config.js tests/visual/lin-4024-home-screenshots.spec.js
```

For the picture only, the sticky header is made static, so a full-page capture draws it at the top.
