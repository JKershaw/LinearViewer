/**
 * Relative-link guard for docs/architecture/ (LIN-3117).
 *
 * CLAUDE.md's text was moved verbatim into docs/architecture/ (LIN-2896). Its
 * `docs/X.md` links worked from the repo root and broke one folder down, and
 * nothing checked links going OUT of docs/architecture/ (the anchor-resolver
 * test checks citations coming IN). Four such links shipped broken.
 *
 * This test walks every docs/architecture/*.md at run time (no pinned list, no
 * git: CI clones at depth 1) and checks each inline relative link. The file it
 * names must exist, resolved from the linking file's OWN folder. A `.md#anchor`
 * must match a heading in that file under GitHub's slug rules, and a bare
 * `#anchor` is checked against the linking file's own headings.
 *
 * Run with: node --test tests/unit/docs-architecture-links.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const architectureDir = join(repoRoot, 'docs/architecture');

// The real scan must find at least this many relative links, or it has gone
// blind (a parser regression or a wrong glob would otherwise pass by seeing
// nothing). Today's count is 7.
const MIN_LINKS = 7;

// A link is `[text](target)`; the text may span lines, the target has no
// spaces or parens. `![img](src)` matches too, which is what we want.
const LINK_PATTERN = /\[([^\]]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

// Blanks fenced code blocks but keeps every line, so line numbers survive.
function outsideFences(markdown) {
  let fence = null;
  return markdown.split('\n').map((line) => {
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      return '';
    }
    if (open) {
      fence = open[1];
      return '';
    }
    return line;
  }).join('\n');
}

// Inline code spans cannot hold a link, so they are blanked too.
function outsideCodeSpans(markdown) {
  return outsideFences(markdown).replace(/(`+)[^`\n]*?\1/g, '');
}

// GitHub's heading slug: drop the link target, lower-case, drop punctuation
// (keeping letters, numbers, marks, `_` and `-`), then each space becomes a
// hyphen. Spaces are not collapsed, so "A — B" slugs to "a--b".
function slugOf(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

// Duplicate headings get -1, -2 suffixes, as GitHub does.
function headingSlugs(markdown) {
  const seen = new Map();
  const slugs = new Set();
  for (const line of outsideFences(markdown).split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/);
    if (!heading) continue;
    const base = slugOf(heading[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

// Scans every *.md directly in `dir`, resolving each relative link from the
// file's own folder. Returns the counts it checked and the broken links, so a
// caller can prove the scan was not vacuous.
function scanDocs(dir) {
  const slugCache = new Map();
  const slugsOf = (absPath) => {
    if (!slugCache.has(absPath)) slugCache.set(absPath, headingSlugs(readFileSync(absPath, 'utf8')));
    return slugCache.get(absPath);
  };

  const result = { links: 0, anchors: 0, broken: [] };
  const docs = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();

  for (const name of docs) {
    const file = join(dir, name);
    const text = outsideCodeSpans(readFileSync(file, 'utf8'));

    for (const match of text.matchAll(LINK_PATTERN)) {
      const target = match[2];
      if (SCHEME_PATTERN.test(target)) continue;

      const line = text.slice(0, match.index).split('\n').length;
      const where = `${name}:${line} → ${target}`;
      const hash = target.indexOf('#');
      const pathPart = (hash === -1 ? target : target.slice(0, hash)).split('?')[0];
      const anchor = hash === -1 ? null : decodeURIComponent(target.slice(hash + 1));
      result.links += 1;

      let targetAbs = file;
      if (pathPart !== '') {
        targetAbs = resolve(dirname(file), pathPart);
        let isFile = false;
        try {
          isFile = statSync(targetAbs).isFile();
        } catch {
          isFile = false;
        }
        if (!isFile) {
          result.broken.push(`${where} (no such file)`);
          continue;
        }
      }

      if (anchor === null || !targetAbs.endsWith('.md')) continue;
      result.anchors += 1;
      if (!slugsOf(targetAbs).has(anchor)) {
        result.broken.push(`${where} (no heading #${anchor})`);
      }
    }
  }
  return result;
}

describe('docs/architecture relative links (LIN-3117)', () => {
  test('every relative link in docs/architecture/ resolves from its own folder', () => {
    const { broken } = scanDocs(architectureDir);
    assert.equal(broken.length, 0, `broken links in docs/architecture/:\n${broken.join('\n')}`);
  });

  test('the scan is not vacuous: it finds the links and checks anchors', () => {
    const { links, anchors } = scanDocs(architectureDir);
    assert.ok(links >= MIN_LINKS, `expected at least ${MIN_LINKS} relative links, found ${links}`);
    assert.ok(anchors >= 1, 'expected at least one .md#anchor to be checked');
  });

  describe('fixtures prove the scanner fails on each kind of break', () => {
    // Builds a repo-shaped temp tree with docs/architecture/ and sibling docs,
    // so the fixtures reuse the same resolution path as the real scan. Keys
    // starting `arch/` are written into docs/architecture/; the prefix keeps
    // these fixture names from reading as citations to the real docs.
    function fixtureTree(files) {
      const root = mkdtempSync(join(tmpdir(), 'docs-arch-links-'));
      const arch = join(root, 'docs', 'architecture');
      mkdirSync(arch, { recursive: true });
      for (const [key, body] of Object.entries(files)) {
        const abs = join(root, key.replace(/^arch\//, 'docs/architecture/'));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body);
      }
      return { root, arch, cleanup: () => rmSync(root, { recursive: true, force: true }) };
    }

    test('a link to a missing file fails', () => {
      const fx = fixtureTree({ 'arch/a.md': '[x](../gone.md)\n' });
      try {
        const { broken } = scanDocs(fx.arch);
        assert.equal(broken.length, 1);
        assert.match(broken[0], /a\.md:1 → \.\.\/gone\.md \(no such file\)/);
      } finally {
        fx.cleanup();
      }
    });

    test('a root-relative docs/ link from inside docs/architecture/ fails (the LIN-3117 cause)', () => {
      const fx = fixtureTree({
        'arch/a.md': '[x](docs/views.md)\n',
        'docs/views.md': '# Views\n',
      });
      try {
        const { broken } = scanDocs(fx.arch);
        assert.equal(broken.length, 1);
        assert.match(broken[0], /docs\/views\.md \(no such file\)/);
      } finally {
        fx.cleanup();
      }
    });

    test('a .md link to a missing anchor fails', () => {
      const fx = fixtureTree({
        'arch/a.md': '[x](b.md#nope)\n',
        'arch/b.md': '## Yes\n',
      });
      try {
        const { broken } = scanDocs(fx.arch);
        assert.equal(broken.length, 1);
        assert.match(broken[0], /a\.md:1 → b\.md#nope \(no heading #nope\)/);
      } finally {
        fx.cleanup();
      }
    });

    test('a good file link and a good anchor pass, including a same-file anchor', () => {
      const fx = fixtureTree({
        'arch/a.md': '## Own Heading\n\n[x](b.md#yes-now) and [y](#own-heading)\n',
        'arch/b.md': '## Yes, now!\n',
        'docs/other.md': '# Other\n',
      });
      try {
        const { links, anchors, broken } = scanDocs(fx.arch);
        assert.deepEqual(broken, []);
        assert.equal(links, 2);
        assert.equal(anchors, 2);
      } finally {
        fx.cleanup();
      }
    });

    test('links inside fenced code and inline code spans are not checked', () => {
      const fx = fixtureTree({
        'arch/a.md': [
          '```',
          '[x](missing.md)',
          '```',
          'Inline `[y](also-missing.md)` is code.',
          '',
        ].join('\n'),
      });
      try {
        const { links, broken } = scanDocs(fx.arch);
        assert.deepEqual(broken, []);
        assert.equal(links, 0);
      } finally {
        fx.cleanup();
      }
    });

    test('duplicate headings get -1 suffixes, so the second one is a real anchor', () => {
      const fx = fixtureTree({
        'arch/a.md': '## Notes\n\n## Notes\n\n[x](b.md#notes-1)\n',
        'arch/b.md': '## Notes\n\n## Notes\n',
      });
      try {
        const { broken } = scanDocs(fx.arch);
        assert.deepEqual(broken, []);
      } finally {
        fx.cleanup();
      }
    });
  });
});
