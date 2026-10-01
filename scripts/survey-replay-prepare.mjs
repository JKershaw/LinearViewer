// LIN-3189: builds one isolated local worktree per selected ticket at the parent of its original merge, and writes the fixed role prompts (implementer, reviewer, close-out, blind reader) the replay hands its in-session subagents.
// Usage: node scripts/survey-replay-prepare.mjs --root <dir outside both repos> [--selection data/survey-replay/selection.json] [--tracker data/survey/reliability-tracker.json] [--sd ../simple-dispatcher]
//        node scripts/survey-replay-prepare.mjs --root <dir> --remove      # detach and delete every replay worktree afterwards
// Committed with the pre-registration: the prompt texts below are the protocol and are not edited once the first replay runs.
// Worktrees are detached (no branch), share each repo's object store, and are never pushed. node_modules is symlinked from the
// clone the script runs beside. Ticket text is the tracker snapshot's, i.e. the description as finally written. No proxy calls.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = resolve(arg('--root', ''));
if (!arg('--root')) throw new Error('--root is required');
const sel = JSON.parse(readFileSync(arg('--selection', 'data/survey-replay/selection.json'), 'utf8'));
const tracker = JSON.parse(readFileSync(arg('--tracker', 'data/survey/reliability-tracker.json'), 'utf8'));
const repoDir = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

const RULES = (wt) => `Hard rules, for every role:
- Work only inside ${wt}. Read nothing outside it (node_modules resolution aside).
- Never push, fetch, pull or open a PR; never call an HTTP service, the Harbour proxy or $HARBOUR_LOCAL_BASE; never dispatch anything.
- Do not look past HEAD in git: no \`git log\`/\`show\`/\`diff\` against other refs or commits beyond those named here, no \`--all\`, no branches, no reflog, no stash list. The future of this repository is off limits.
- Run unit tests only, by file (\`node --test <file>\`; in simple-dispatcher \`node --require ./test/isolate-local-halt.js --test <file>\`). Do not start the app, a server, Playwright or any E2E/visual suite.
- Do not spawn subagents.`;

export const PROMPTS = {
  implementer: ({ id, repo, wt, title, description }) => `[replay ${id} implementer]
You are the implementer for one ticket in the ${repo} repository. A local git worktree at ${wt} is checked out at the commit just before this ticket's work was merged.

## Ticket ${id}: ${title}

${description}

## Your job
Implement the ticket as a careful engineer would ship it: the production change plus the tests you judge it needs, following the repository's CLAUDE.md. Run the unit tests relevant to what you changed. When done, commit your work locally on the detached HEAD (\`git add -A && git commit -m "${id}: <summary>"\`).

${RULES(wt)}

End with a short summary: files changed, tests run and their result.`,

  reviewer: ({ id, repo, wt, title, description, parent }) => `[replay ${id} reviewer]
You are the code reviewer for one ticket in the ${repo} repository. The change under review is \`git diff ${parent} HEAD\` in the worktree at ${wt}.

## Ticket ${id}: ${title}

${description}

## Your job
Review the change for correctness against the ticket: requirements unmet, bugs, missed cases or call sites, and whether its tests would catch a regression. You may read the code and run unit tests. Do not edit any file.

${RULES(wt)}

End with exactly one line \`VERDICT: APPROVE\` or \`VERDICT: REQUEST CHANGES\`, then a numbered list of must-fix findings (real defects or unmet requirements only), then any optional nits.`,

  closeout: ({ id, repo, wt, title, description, parent, review }) => `[replay ${id} close-out]
You are the close-out for one ticket in the ${repo} repository. The change is \`git diff ${parent} HEAD\` in the worktree at ${wt}. A reviewer has read it; the review is below.

## Ticket ${id}: ${title}

${description}

## The review
${review}

## Your job
If the review requests changes, fix each must-fix finding (or say in one line why it should not be fixed), run the relevant unit tests, and commit locally. Then verify the change is ready to merge: the ticket's requirements are met and the unit tests it touches pass.

${RULES(wt)}

End with exactly one line \`CLOSE-OUT: READY\` or \`CLOSE-OUT: NOT READY — <reason>\`.`,

  // Measurement, not part of the lean pipeline's cost. A and B are assigned by the parity of the ticket number.
  blind: ({ id, repo, title, description, wt, diffA, diffB }) => `[replay ${id} blind]
Two independent changes were written for the same ticket in the ${repo} repository, each against the same parent commit, which is checked out read-only at ${wt}. You do not know who wrote either. Judge them on the merits.

## Ticket ${id}: ${title}

${description}

## Change A
\`\`\`diff
${diffA}
\`\`\`

## Change B
\`\`\`diff
${diffB}
\`\`\`

## Your job
Decide which change better does what the ticket asks: correct behaviour, complete coverage of the cases and call sites, no new defect, and tests that would catch a regression. Style and comment volume do not count. You may read the parent tree at ${wt}; do not edit it, run git commands, or call any service.

List each defect you find in A and in B (a defect is behaviour that would be wrong in use, not a style preference). Then end with exactly one line: \`JUDGEMENT: A BETTER\`, \`JUDGEMENT: EQUIVALENT\` or \`JUDGEMENT: B BETTER\`.`,
};

if (process.argv.includes('--remove')) {
  for (const s of sel.selected) {
    const wt = join(root, s.id), repo = repoDir[s.repo];
    for (const w of [wt, `${wt}-parent`]) if (existsSync(w)) git(repo, ['worktree', 'remove', '--force', w]);
  }
  process.exit(0);
}

mkdirSync(join(root, 'prompts'), { recursive: true });
const manifest = [];
for (const s of sel.selected) {
  const repo = repoDir[s.repo], wt = join(root, s.id), parent = s.merge.parent;
  for (const [w, label] of [[wt, 'replay'], [`${wt}-parent`, 'parent (read-only, blind reader)']]) {
    if (!existsSync(w)) git(repo, ['worktree', 'add', '--detach', w, parent]);
    if (!existsSync(join(w, 'node_modules')) && existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(w, 'node_modules'));
    void label;
  }
  const t = tracker.list.find((x) => x.identifier === s.id);
  const ctx = { id: s.id, repo: s.repo, wt, title: t.title, description: t.description, parent };
  writeFileSync(join(root, 'prompts', `${s.id}-implementer.md`), PROMPTS.implementer(ctx));
  manifest.push({ id: s.id, repo: s.repo, stratum: s.stratum, wt, parentWt: `${wt}-parent`, parent, merge: s.merge.sha });
}
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${manifest.length} worktrees under ${root}`);
