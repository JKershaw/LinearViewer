# Key rotation checklist (LIN-4512), 27 Nov

Names come from Harbour's code and `docs/architecture/configuration.md`. No production values were read. Railway's Variables tab is the real list; step 11 catches anything not named here.

For each key, the pattern is: make the new one, set it in Railway (which redeploys), check the feature still works, then revoke the old one.

1. `GITHUB_APP_PRIVATE_KEY`, the key that was exposed. GitHub, then the App's settings, then Private keys: generate a new key. Paste the PEM into Railway. Check GitHub sign-in or a GitHub-backed workspace still works. Delete the old key in GitHub.
2. `GITHUB_CLIENT_SECRET`. On the same App page, under Client secrets: generate a new one, set it, check GitHub login, delete the old one.
3. `OPENROUTER_API_KEY` and `OPENROUTER_FREE_TIER_KEY`. In OpenRouter's Keys page, create new keys, set both, check a recommendation runs, and delete the old keys.
4. `RESEND_API_KEY`. In Resend, create a new key, set it, send yourself a magic-link sign-in, and revoke the old key.
5. Linear:
   - `LINEAR_CLIENT_SECRET`: rotate it in the Linear OAuth app, set it, and check Linear sign-in.
   - `LINEAR_ACCESS_TOKEN` (optional): if it's set, make a new personal API key and revoke the old one, or remove the variable if it's unused.
6. `JIRA_CLIENT_SECRET`, if set. Rotate it in the Atlassian developer console, or remove it while Jira is set aside.
7. `YAP_PASSWORD`. Change it on the Yap server and in Railway, or remove it if Collective is unused. Safety finding 1 is about this password.
8. `MONGODB_URI`. Change the database user's password with the database provider and update the URI. There's a brief blip while it redeploys.
9. `SESSION_SECRET`, last. Set a new random value (for example `openssl rand -hex 32`). Everyone is signed out, you included; sign back in.
10. Harbour proxy tokens:
    - Revoke old and unused ones.
    - Give simple-dispatcher on the Mac a fresh consumer token (its `HARBOUR_TOKEN`) and restart it.
    - My session token can go too. Mint me a new one afterwards for the Periodicals.
11. Anything else in Railway's Variables that looks secret and isn't above: rotate it, or remove it if unused. The leak printed "another private key", and I can't tell which one.
12. Optional: delete the 20 Nov local transcript on the Mac (worker 5244c11f). Its values are dead once rotated anyway.
13. Tell me what was rotated or removed. I'll write the list on LIN-4512, close it, and end findings 968a75fc and ce6e4602.
