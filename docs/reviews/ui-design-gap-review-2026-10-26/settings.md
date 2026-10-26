# Settings

**What the page is for.** Settings is where a person changes how Harbour behaves, for the workspace or for themselves. The design is one pattern used everywhere:
- a sidebar of areas, grouped under the workspace and "You", each with a one-word state ("Linear", "Sonnet 5.5", "1 to fix");
- one narrow column for the chosen area;
- every page a grouped list built from three row kinds: a switch, a row that opens, and an action;
- on a phone, the sidebar becomes a list you tap through.

**Overall.** This is the closest of the three pages. The sidebar, its states, the narrow column, the grouped rows, the Features grouping and the change log with Undo have all landed. What's left is finish. See [README.md](README.md) for how to read the screenshots.

## S1. A centred heading sits over both columns (Medium)

**Design** ([settings-1](shots/settings-1-sources.png) marker 1). "Settings" heads the sidebar, left-aligned. The area's own title heads the column.

**Live** (marker 1). "Settings" and "Configure AI, features, and connections" are centred above both columns, and push them down about 110px. On a phone the centred heading comes before the list ([settings-4](shots/settings-4-phone.png)). See [shared.md X3](shared.md#x3-the-page-title-is-centred-and-light-medium).

## S2. Switches look like labels (Medium)

**Design** ([settings-3](shots/settings-3-features.png) marker 8). A row that turns something on or off ends in a toggle switch: teal when on, grey when off.

**Live** (marker 8). The control is a real switch button (`button.switch.settings-switch`), but it is drawn as a small bordered chip reading "● on" or "○ off" in mono.

**Why it matters.** The switch is one of the three row kinds the whole of Settings is built from. Drawn as a label, it doesn't say "tap to change", and a page of them reads as a status report rather than controls.

## S3. Summaries that say little (Medium)

**Design** ([settings-1](shots/settings-1-sources.png) marker 3). Each area's one-word state answers "what is it set to?": Models "Sonnet 5.5", Account "OpenRouter", Features "4 views on". States that need a person are red ("1 to fix", "1 key problem").

**Live** (marker 3). Models reads "GPT-5.4 Mini +2". Before the example settings were saved, it read "Default +1". Neither says what the agent jobs run on.

## S4. Uppercase labels and grey rows (Small)

**Design** ([settings-1](shots/settings-1-sources.png) marker 4). Group labels in sentence case, muted ("Task sources", "Add a source"). Rows are white inside a bordered group, with a rule between them. The sidebar uses the same grouped rows.

**Live** (marker 4). Labels are small uppercase with letter-spacing ("YOURS", "ADD A SOURCE"). On Features, "· FOR YOU" is repeated on every label ([settings-3](shots/settings-3-features.png)). Rows are grey-filled, and the sidebar is a plain list.

## S5. Blue chips on Sources (Small)

**Live** ([settings-1](shots/settings-1-sources.png) marker 6). "add" and "API token" are small blue chips at the ends of the rows. The design has plain rows that open, with a chevron. See [shared.md X1](shared.md#x1-two-primary-colours-medium).

## S6. Running: pausing is hidden behind a word (Medium)

**Design** ([settings-2](shots/settings-2-running.png) markers 7 and 8). Under "For everyone in Local Workspace": "Pause all runs" is an action row in red, and Periodic reviews is a switch.

**Live** (markers 7 and 8). "Runs · Running ›" is a row that opens, and "Periodic reviews · Off ›" is a teal label on a row that also opens.

**Why it matters.** Pausing every run is the one emergency control on the page. The design puts it in plain sight as an action. Live, it sits behind a row whose label is a state ("Running").

## S7. Phone (Small)

[settings-4](shots/settings-4-phone.png). The list of areas is right. The header loses the wordmark ([shared.md X4](shared.md#x4-the-phone-header-loses-the-logo-small)), and the centred heading comes first (S1).

## What is close

- The change log ([settings-5](shots/settings-5-change-log.png)): changes for everyone, newest first, with who, when and why, and Undo. One difference: an entry reads "Model routing: 17 changes" rather than saying what changed (see [models.md M7](models.md#m7-the-change-summary-reads-like-a-diff-medium)).
- The sidebar of areas with one-word states, the narrow column, and Features grouped into prompts, views and experiments.

## In the picture but not in scope

- **The states in the prototype's sidebar** ("1 to fix", "1 key problem", "OpenRouter"). They are example data. Live states follow the real workspace.
- **The "next run" view.**
