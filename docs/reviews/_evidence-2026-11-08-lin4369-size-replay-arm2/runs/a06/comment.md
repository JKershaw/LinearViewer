Scoping: size recorded in the description as **just the task**, decided by the standing policy (err larger). Nothing the Surveys found binds beyond the task's own goal. Making the fake repaint the way the component does is that goal: whole-node markup swaps, the selector forms it uses, and reading markup back as text. Without it the opened-task suite can't pass, and every repaint would look like it kept the card. No cuts to the ask.

Things to know before building:
- The Observation tests already share a separate DOM shim in the fixtures folder. Neither Survey mentioned it. This ticket leaves it standing, so there will still be a second shared fake. Possible follow-up.
- Once real nodes come back, the opened-task suite reaches repaint paths it has never run. If one fails for a real reason, the fix is production code, which the ask rules out. Stop and ask for a ruling then; don't patch it inside the fake.
- Staleness check: HEAD is the commit the Surveys read (29f14bf6). Nothing the ticket names has changed since.
