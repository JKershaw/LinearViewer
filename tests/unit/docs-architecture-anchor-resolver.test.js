/**
 * Anchor resolver for docs/architecture/ citations (LIN-2896).
 *
 * CLAUDE.md was shrunk and its content moved verbatim into 8 docs under
 * docs/architecture/; every place that used to cite CLAUDE.md for that
 * content was re-pointed to cite the new doc instead. That re-pointing was
 * done by hand across four sweeps, and each of the first three under-bounded
 * the reference set (13 named sites -> +2 corrected destinations -> +~19
 * "both-paths" sites a literal grep found that re-reading known sites
 * missed -> +docs/papers/harbour/, caught only once the scope became "the
 * whole docs/ tree", not a flat `docs/*.md` glob, which silently skips
 * nested directories). A hand sweep can under-bound again the same way. This
 * test re-derives the reference set itself, at run time, by walking the
 * repository the same way a human sweep would — so a citation nobody
 * thought of when writing this test still gets caught, and it is not just
 * "the referenced file exists" but "the specific thing the citation names is
 * actually in it" (a resolver that only checks non-blankness/line-count lets
 * a docs/architecture/ file full of the WRONG content pass; that is the
 * defect this test exists to not repeat — see the plan-review finding on
 * the sibling LIN-2897 resolver).
 *
 * Review found this test itself under-bounded (implementation review,
 * 2026-09-18): 31 of 53 citation rows — every citation to 5 of the 8 docs —
 * had neither a literal quote nor a "both-paths" keyword nearby, so they fell
 * through to an `else` branch that only asserted "the file has a markdown
 * heading somewhere". Replacing those 5 docs' entire contents with a single
 * `## Stub` heading and filler text passed the full unit suite. The `else`
 * branch below now asserts each doc still contains the section heading it
 * was moved with (not the doc's current working-tree content standing in for
 * its own expectation, which is exactly what a mutation corrupts).
 *
 * A first fix derived that expected heading from each doc's own git
 * creation commit (`git log --diff-filter=A`). Re-review (2026-09-18,
 * follow-up) proved that CI-inert: `.github/workflows/test.yml` runs
 * `actions/checkout@v4` with no `fetch-depth`, i.e. depth 1. In a depth-1
 * clone HEAD is a grafted root commit, so `--diff-filter=A` reports every
 * file as added at HEAD — the "expected" heading collapses to the doc's own
 * current content, exactly the self-referential check this test exists to
 * not be. The reviewer proved it by committing the same 5-doc `## Stub`
 * mutation, cloning at `--depth 1`, and getting 57/57 green: the guard
 * degrades silently in the one environment that judges merges.
 *
 * EXPECTED_HEADINGS below replaces the git-history lookup with a static,
 * git-independent map. This is deliberately NOT the same move as pinning the
 * *citation* list (forbidden below, and by LIN-2896): the citation sweep
 * (`rows`, built by `walk()`) enumerates an open-ended, previously
 * under-bounded set of referring *sites* across the whole repo — pinning
 * that list is exactly the defect class this ticket exists to stop, because
 * a new site nobody thought of would silently get no check. The heading map
 * instead enumerates the *destination* set, which is closed and small: the
 * ticket fixes it at exactly 8 filenames, `existingDocs` reads it from disk
 * at run time, and the "lists exactly the docs that exist, both ways" test
 * below already fails loudly if a doc is added/removed without updating
 * CLAUDE.md. The self-consistency test right after EXPECTED_HEADINGS adds
 * the matching guard for this map: it fails loudly if `existingDocs` and
 * `EXPECTED_HEADINGS`'s keys ever diverge, so a doc added without an entry
 * here cannot silently fall through to "no check" the way the citation sweep
 * used to. Net effect: no git dependency (so no shallow-clone loophole), and
 * no `.github/workflows/test.yml` or `package.json` change.
 *
 * The same review also found the one surviving `CLAUDE.md:<line>` anchor
 * (into CLAUDE.md itself, not docs/architecture/) had no drift guard at all.
 * The second describe block below extends the sweep to that class.
 *
 * Run with: node --test tests/unit/docs-architecture-anchor-resolver.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const architectureDir = join(repoRoot, 'docs/architecture');

// The 4 directories excluded from the sweep (LIN-2896): dated/frozen artifacts
// that legitimately keep citing a location that has since moved — freezing a
// historical record is not drift. Recursive prefix match, not a shallow glob:
// a flat `docs/*.md` predicate is exactly what let docs/papers/harbour/ (a
// nested, NON-denylisted directory) slip through a real sweep once already.
const DENYLIST_DIRS = ['docs/reviews', 'docs/archive', 'plans', 'scripts/eval'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.md']);

function isDenylisted(relPath) {
  return DENYLIST_DIRS.some((d) => relPath === d || relPath.startsWith(`${d}/`));
}

function walk(absDir, relDir, out) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || isDenylisted(rel)) continue;
      walk(join(absDir, entry.name), rel, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) out.push(rel);
    }
  }
  return out;
}

const REFERENCE_PATTERN = /docs\/architecture\/([a-z][a-z-]*\.md)/;
const QUOTE_PATTERN = /"([^"]{8,})"/;
const COMMENT_PREFIX = /^\s*(\*\/?|\/\/|>)\s?/;

// Enumerated at run time, never a pinned list (LIN-2896 requirement — a
// pinned list reproduces the exact under-bounding this test exists to stop).
const sourceFiles = walk(repoRoot, '', []);
const existingDocs = new Set(readdirSync(architectureDir).filter((f) => f.endsWith('.md')));

// The section heading each doc was moved with (LIN-2896 beat 1), fixed here
// as a literal — deliberately NOT read from git history (a depth-1 CI
// checkout makes HEAD a grafted root commit, under which every file looks
// "added at HEAD" and a history-derived heading collapses to the doc's own
// current content — see the file header) and NOT read from the doc's
// current working-tree content (self-referential: would pass no matter what
// the doc says now, which is exactly what a `## Stub` mutation exploits).
// This is a pinned map of the *destination* set (8 filenames, fixed by the
// ticket), not the *citation* set (the open-ended, previously under-bounded
// set of referring sites `rows` enumerates below) — see the file header for
// why those are different under LIN-2896's "no pinned list" constraint.
const EXPECTED_HEADINGS = new Map([
  ['source-map.md', '## Architecture'],
  ['prompt-system.md', '### Prompt System (two independent paths)'],
  ['auth.md', '## Authentication'],
  ['configuration.md', '## Environment Variables'],
  ['dispatch-and-proxy.md', '## Dispatch API'],
  ['views.md', '### View Tiers'],
  ['ci.md', '## GitHub Actions CI (for AI Agents)'],
  ['experiments.md', '## Collective (experimental, LIN-450)'],
]);

const rows = [];
for (const relFile of sourceFiles) {
  const absFile = join(repoRoot, relFile);
  const lines = readFileSync(absFile, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(REFERENCE_PATTERN);
    if (!match) continue;
    const nextLineStripped = i + 1 < lines.length ? lines[i + 1].replace(COMMENT_PREFIX, '') : '';
    // Quote search: only text AFTER the citation on its own line, plus one
    // following line — narrow enough to skip an unrelated quote earlier in
    // the same sentence or a few lines further down, wide enough to catch a
    // quoted anchor that word-wraps once (the house comment style). If the
    // citation's own clause closes right after it (") ." / ".") on the same
    // line, stop there — a quote past that boundary is a new sentence, not a
    // description of this citation's target.
    const rawAfterMatch = lines[i].slice(match.index + match[0].length);
    const clauseEnd = rawAfterMatch.search(/\)?\.(\s|$)/);
    const quoteContext = clauseEnd === -1
      ? `${rawAfterMatch} ${nextLineStripped}`.replace(/\s+/g, ' ')
      : rawAfterMatch.slice(0, clauseEnd).replace(/\s+/g, ' ');
    // Keyword search: the whole line plus one following line — a keyword
    // like "both-paths" carries no false-positive risk regardless of where
    // on the line it falls relative to the citation.
    const keywordContext = `${lines[i]} ${nextLineStripped}`.replace(/\s+/g, ' ');
    rows.push({ file: relFile, line: i + 1, targetDoc: match[1], quoteContext, keywordContext });
  }
}

describe('docs/architecture/ anchor resolver (LIN-2896)', () => {
  test('the sweep actually found citations (guard against a silently-broken pattern)', () => {
    assert.ok(rows.length >= 20,
      `the sweep found only ${rows.length} docs/architecture/ citation(s) across the repo — expected at ` +
      `least 20. Either the citation pattern (${REFERENCE_PATTERN}) stopped matching real sites, or the ` +
      `walk's denylist/extension filters over-excluded. A resolver that silently stops finding anything is ` +
      `the same failure mode as one that under-bounds its reference set: green for the wrong reason.`);
  });

  test('CLAUDE.md\'s "Where the detail lives" section lists exactly the docs that exist, both ways', () => {
    const claudeMd = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    const sectionMatch = claudeMd.match(/## Where the detail lives\n([\s\S]*?)\n## /);
    assert.ok(sectionMatch, 'CLAUDE.md must carry a "## Where the detail lives" section');
    const listed = new Set([...sectionMatch[1].matchAll(/docs\/architecture\/([a-z][a-z-]*\.md)/g)].map((m) => m[1]));
    const missingFromClaudeMd = [...existingDocs].filter((d) => !listed.has(d));
    const danglingInClaudeMd = [...listed].filter((d) => !existingDocs.has(d));
    assert.deepEqual(missingFromClaudeMd, [],
      `docs/architecture/ has doc(s) that CLAUDE.md's "Where the detail lives" section does not point to: ` +
      `${missingFromClaudeMd.join(', ')} — add a pointer bullet for each, or the doc is unreachable from CLAUDE.md.`);
    assert.deepEqual(danglingInClaudeMd, [],
      `CLAUDE.md's "Where the detail lives" section points at doc(s) that do not exist under docs/architecture/: ` +
      `${danglingInClaudeMd.join(', ')} — the referring site is CLAUDE.md's "Where the detail lives" section.`);
  });

  test('EXPECTED_HEADINGS (pinned, git-free) covers exactly the docs that exist, both ways', () => {
    // Guards the pin itself: without this, a doc added under
    // docs/architecture/ without a matching EXPECTED_HEADINGS entry would
    // silently get no heading check at all (EXPECTED_HEADINGS.get(doc) would
    // be undefined and docText.includes(undefined) would throw, but only if
    // some citation happens to route through the `else` branch for it — a
    // doc with only literal-quote/both-paths citations would get no signal
    // whatsoever). Failing loudly here instead means the pinned map can
    // never silently fall out of sync with the doc set it is supposed to
    // cover.
    const pinned = new Set(EXPECTED_HEADINGS.keys());
    const missingFromPin = [...existingDocs].filter((d) => !pinned.has(d));
    const staleInPin = [...pinned].filter((d) => !existingDocs.has(d));
    assert.deepEqual(missingFromPin, [],
      `docs/architecture/ has doc(s) with no EXPECTED_HEADINGS entry: ${missingFromPin.join(', ')} — add the ` +
      `heading it was moved with, or its heading gets no drift check.`);
    assert.deepEqual(staleInPin, [],
      `EXPECTED_HEADINGS pins heading(s) for doc(s) that no longer exist under docs/architecture/: ` +
      `${staleInPin.join(', ')} — remove the stale entry.`);
  });

  for (const row of rows) {
    test(`${row.file}:${row.line} -> docs/architecture/${row.targetDoc} resolves`, () => {
      assert.ok(existingDocs.has(row.targetDoc),
        `${row.file}:${row.line} cites docs/architecture/${row.targetDoc}, which does not exist under ` +
        `docs/architecture/ (it has: ${[...existingDocs].join(', ')}). The referring site expected that file to exist.`);

      const docText = readFileSync(join(architectureDir, row.targetDoc), 'utf8');
      const quoteMatch = row.quoteContext.match(QUOTE_PATTERN);
      // Reject a "quote" that is really a pattern description, not literal
      // expected text (a placeholder like `<N>` or a trailing `...`) —
      // e.g. a failure-message template such as "<N> jobs registered
      // today: ..." is never meant to appear verbatim in the target doc.
      const isLiteralQuote = quoteMatch && !/[<>]|\.\.\.\s*$/.test(quoteMatch[1]);

      if (isLiteralQuote) {
        const normalizedQuote = quoteMatch[1].replace(/\s+/g, ' ').trim();
        const normalizedDoc = docText.replace(/\s+/g, ' ');
        assert.ok(normalizedDoc.includes(normalizedQuote),
          `${row.file}:${row.line} cites docs/architecture/${row.targetDoc} for the quoted text ` +
          `"${normalizedQuote}", but that text is not in the doc. The referring site expected to find it there ` +
          `verbatim — either the doc's content moved/changed and the quote is now stale, or the citation is wrong.`);
      } else if (/both[- ]paths/i.test(row.keywordContext)) {
        // The dominant, highest-risk citation class in this file: a claim
        // that BOTH the handwritten and AI-generated prompt paths are
        // documented together. Checking only "the file exists" would pass
        // even if the doc had been edited down to name just one path — the
        // exact defect class (LIN-2302) this whole ticket exists to guard
        // against (see CLAUDE.md's own "Invariants" section, G5).
        assert.ok(docText.includes('lib/prompt-templates.js') && docText.includes('lib/openrouter.js'),
          `${row.file}:${row.line} cites docs/architecture/${row.targetDoc} for a "both-paths" rule, but that ` +
          `doc no longer names both the handwritten path (lib/prompt-templates.js) and the AI-generated path ` +
          `(lib/openrouter.js). A both-paths rule that only names one path is a false claim of exactly the ` +
          `class LIN-2302 landed.`);
      } else {
        // No literal quote and no both-paths keyword nearby — the weakest
        // remaining citation class, and the one review found landing 31 of
        // 53 rows in an `else` that only checked "has a heading" (any
        // heading, e.g. `## Stub`). Assert the doc still contains the
        // specific section heading it was moved with (derived above from
        // its own creation commit), not just any heading.
        const heading = EXPECTED_HEADINGS.get(row.targetDoc);
        assert.ok(docText.includes(heading),
          `${row.file}:${row.line} cites docs/architecture/${row.targetDoc}, which no longer contains the ` +
          `section heading it was moved with (${JSON.stringify(heading)}, derived from the doc's creation ` +
          `commit) — the referring site expected that section's content to still be here.`);
      }
    });
  }
});

// Residual anchors into CLAUDE.md itself (review item 2). The sweep above
// only ever looks for docs/architecture/ citations, so a reference that
// still points at "CLAUDE.md" plus a line number — left behind because the
// content it names never moved out of CLAUDE.md — gets no drift guard at
// all: CLAUDE.md is live real estate, so a future edit can silently move or
// delete that line and nothing here would notice. Swept over the same
// walk/denylist as above, enumerated at run time (not a pinned list of
// known anchors, for the same reason as the docs/architecture/ sweep).
const CLAUDE_MD_LINE_ANCHOR = /CLAUDE\.md:(\d+)/;
const BACKTICK_PATTERN = /`([^`]{6,})`/g;

const claudeMdAnchorRows = [];
for (const relFile of sourceFiles) {
  const absFile = join(repoRoot, relFile);
  const lines = readFileSync(absFile, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(CLAUDE_MD_LINE_ANCHOR);
    if (!match) continue;
    const nextLineStripped = i + 1 < lines.length ? lines[i + 1].replace(COMMENT_PREFIX, '') : '';
    const context = `${lines[i]} ${nextLineStripped}`.replace(/\s+/g, ' ');
    // What the citation names, verifiable: any backtick-quoted code span
    // near it, long enough (6+ chars) to not be a generic word like `fetch`.
    const quotedSpans = [...context.matchAll(BACKTICK_PATTERN)].map((m) => m[1]);
    claudeMdAnchorRows.push({ file: relFile, line: i + 1, targetLine: Number(match[1]), quotedSpans });
  }
}

describe('residual CLAUDE.md line anchors (LIN-2896 review item 2)', () => {
  test('the sweep found the anchor(s) it expects (guard against a silently-broken pattern)', () => {
    assert.ok(claudeMdAnchorRows.length >= 1,
      `the sweep found ${claudeMdAnchorRows.length} residual CLAUDE.md line anchor(s) outside denylisted ` +
      `dirs — expected at least 1 (tests/unit/session-id-render-seam.test.js's reference to the house ` +
      `test-harness pattern). Either the anchor moved/was removed (update this expectation deliberately) or ` +
      `the pattern (${CLAUDE_MD_LINE_ANCHOR}) stopped matching.`);
  });

  for (const row of claudeMdAnchorRows) {
    test(`${row.file}:${row.line} -> CLAUDE.md line ${row.targetLine} still holds the cited content`, () => {
      const claudeLines = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8').split('\n');
      assert.ok(row.targetLine >= 1 && row.targetLine <= claudeLines.length,
        `${row.file}:${row.line} cites CLAUDE.md line ${row.targetLine}, which is past CLAUDE.md's current ` +
        `${claudeLines.length} lines — CLAUDE.md has shrunk or that content moved since this anchor was written.`);

      assert.ok(row.quotedSpans.length > 0,
        `${row.file}:${row.line} cites CLAUDE.md line ${row.targetLine} but names no backtick-quoted content ` +
        `near the citation, so there is nothing here to verify it against — add a quoted excerpt of what that ` +
        `line says, or drop the line-numbered citation in favour of a section reference.`);

      const citedLine = claudeLines[row.targetLine - 1];
      for (const span of row.quotedSpans) {
        assert.ok(citedLine.includes(span),
          `${row.file}:${row.line} cites CLAUDE.md line ${row.targetLine} for the content ${JSON.stringify(span)}, ` +
          `but that line now reads: ${JSON.stringify(citedLine)}. The citation has drifted — CLAUDE.md moved or ` +
          `changed since this anchor was written.`);
      }
    });
  }
});
