#!/usr/bin/env python3
"""Fetch the record behind "how the charter got complicated" (LIN-4007).

GET only, through the local Harbour proxy (HARBOUR_LOCAL_BASE). Writes:

- ../how-the-charter-got-complicated-transcript/comment-N.md: the six transcript
  comments on LIN-4007, byte for byte as the proxy returns them;
- ../how-the-charter-got-complicated-data/: derived CSVs only (no raw ticket JSON):
  sections.csv (description headings), comments.csv (comment metadata and opener),
  rulings.csv, cost.csv (model mapped to a tier, never an identifier), tree.csv
  (the ticket tree walked from the retro's input-6 index), and fetched-at.txt.

Usage:  HARBOUR_LOCAL_BASE=http://127.0.0.1:NNNN python3 fetch.py
"""

import csv
import glob
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER = os.path.join(HERE, "..", "how-the-charter-got-complicated")
TRANSCRIPT_DIR = PAPER + "-transcript"
DATA_DIR = PAPER + "-data"
RETRO_INPUTS = os.path.join(HERE, "..", "..", "..", "reviews", "charter-retro-2026-10-26", "inputs")

PAPER_ISSUE = "LIN-4007"
# The six transcript comments on LIN-4007, in the order the description gives them.
TRANSCRIPT_IDS = ["63d57c6d", "0bbb2898", "c1cfce0b", "13ea57c9", "a8a41e70", "bb6387ab"]

# Tickets read for the five main UI tickets (C2) and the Haiku/Sonnet/router comparison (Q4).
UI_TICKETS = ["LIN-3833", "LIN-3975", "LIN-3977", "LIN-3983", "LIN-3952"]
COMPARISON_TICKETS = [
    # short at launch, Haiku
    "LIN-3986", "LIN-4003", "LIN-3995", "LIN-3992",
    # long but byte-identical router moves
    "LIN-3872", "LIN-3876", "LIN-3877", "LIN-3883", "LIN-3893", "LIN-3917",
    # Sonnet UI tickets
    "LIN-3846", "LIN-3849",
]

BASE = os.environ.get("HARBOUR_LOCAL_BASE", "").rstrip("/") + "/api/proxy"


def get(path):
    """GET one proxy path and return the parsed JSON. No other verb is ever sent."""
    req = urllib.request.Request(BASE + path, method="GET")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def tier(model):
    """Map a dispatch model identifier to its tier name. Identifiers are not written to the repo."""
    if not model:
        return "not recorded"
    for name in ("haiku", "sonnet", "opus", "fable"):
        if name in model.lower():
            return name.capitalize()
    return "other"


def opener(body):
    """The first non-empty line, markdown stripped, cut to 120 characters on one line."""
    for line in (body or "").split("\n"):
        text = re.sub(r"[*#`_]+", "", line).strip()
        if text:
            return re.sub(r"\s+", " ", text)[:120]
    return ""


def write_transcript():
    issue = get(f"/issues/{PAPER_ISSUE}")
    os.makedirs(TRANSCRIPT_DIR, exist_ok=True)
    by_prefix = {c["id"][:8]: c for c in issue.get("comments") or []}
    for n, prefix in enumerate(TRANSCRIPT_IDS, start=1):
        comment = by_prefix[prefix]
        path = os.path.join(TRANSCRIPT_DIR, f"comment-{n}.md")
        with open(path, "wb") as f:
            f.write(comment["body"].encode("utf-8"))
        print(f"comment-{n}.md  {comment['id'][:8]}  {comment['createdAt']}  {len(comment['body'].encode('utf-8'))} bytes")


def section_rows(ident, desc):
    """Split a description at its ## and ### headings. Each row is one heading, the ## it sits under, and its size."""
    rows = []
    parent, heading, chars = "(preamble)", "(preamble)", 0
    for line in (desc or "").split("\n"):
        if re.match(r"^#{2,3} ", line):
            rows.append((ident, parent, heading, chars))
            if line.startswith("## "):
                parent = line[3:].strip()
            heading, chars = line.lstrip("#").strip(), 0
        chars += len(line) + 1
    rows.append((ident, parent, heading, chars))
    return rows


def ticket_rows(ident):
    issue = get(f"/issues/{ident}")
    desc = issue.get("description") or ""
    sections = section_rows(ident, desc)
    comments = []
    for c in issue.get("comments") or []:
        body = c.get("body") or ""
        comments.append((ident, c["id"], c["createdAt"], len(body), opener(body)))
    rulings = []
    for r in get(f"/rulings?issueIdentifier={urllib.parse.quote(ident)}&includeResolved=true").get("rulings", []):
        d = r.get("decision") or {}
        res = r.get("resolution") or {}
        rulings.append((
            ident, d.get("decision_id", ""), (d.get("question") or "")[:140],
            r.get("disposition", ""), res.get("status", "") if isinstance(res, dict) else "",
        ))
    cost = []
    for s in get(f"/issues/{ident}/cost").get("workerSessions") or []:
        cost.append((
            ident, s.get("kind", ""), tier(s.get("model")), s.get("effort") or "",
            s.get("dispatchedAt", ""), s.get("costUsd") if s.get("costUsd") is not None else "",
            s.get("durationMs") if s.get("durationMs") is not None else "",
        ))
    meta = (ident, issue.get("title", "")[:100], issue.get("state", {}).get("name", ""),
            len(desc), len(comments), issue.get("createdAt", ""))
    return meta, sections, comments, rulings, cost


def walk_tree():
    """Walk the retro's input-6 ticket index from the roots the research named."""
    rows = {}
    for path in sorted(glob.glob(os.path.join(RETRO_INPUTS, "input-6-data-part-*.md"))):
        text = open(path, encoding="utf-8").read()
        block = re.search(r"```csv\n(.*?)```", text, re.S).group(1)
        for row in csv.DictReader(block.splitlines()):
            rows[row["id"]] = row
    children = {}
    for row in rows.values():
        if row["parent"]:
            children.setdefault(row["parent"], []).append(row["id"])
    roots = ["LIN-3490", "LIN-3892", "LIN-3757", "LIN-3855"]
    seen, order, stack = set(), [], [(r, r) for r in reversed(roots)]
    while stack:
        node, root = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        order.append((node, root))
        for kid in sorted(children.get(node, []), reverse=True):
            stack.append((kid, root))
    out = []
    for node, root in order:
        row = rows.get(node)
        if row is None:
            # The parent LIN-3490 etc. are roots, not index rows, when they sit above the cut.
            out.append((node, "", root, "", "", "", "", ""))
            continue
        out.append((node, row["parent"], root, row["state"], row["created"], row["completed"],
                    row["desc_chars"], row["title"][:90]))
    return out


def write_csv(name, header, rows):
    with open(os.path.join(DATA_DIR, name), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main():
    if not BASE.startswith("http"):
        sys.exit("HARBOUR_LOCAL_BASE is not set")
    os.makedirs(DATA_DIR, exist_ok=True)
    write_transcript()

    metas, sections, comments, rulings, cost = [], [], [], [], []
    for ident in UI_TICKETS + COMPARISON_TICKETS:
        meta, s, c, r, k = ticket_rows(ident)
        metas.append(meta + ("UI" if ident in UI_TICKETS else "comparison",))
        sections += s
        comments += c
        rulings += r
        cost += k
        print(f"{ident}: desc {meta[3]}, comments {meta[4]}, rulings {len(r)}, sessions {len(k)}")

    write_csv("tickets.csv", ["ticket", "title", "state", "desc_chars", "comments", "created", "set"], metas)
    write_csv("sections.csv", ["ticket", "under", "heading", "chars"], sections)
    write_csv("comments.csv", ["ticket", "comment_id", "created", "chars", "opener"], comments)
    write_csv("rulings.csv", ["ticket", "decision_id", "question", "disposition", "resolution_status"], rulings)
    write_csv("cost.csv", ["ticket", "kind", "tier", "effort", "dispatched", "cost_usd", "duration_ms"], cost)
    write_csv("tree.csv", ["id", "parent", "root", "state", "created", "completed", "desc_chars_snapshot", "title"],
              walk_tree())
    with open(os.path.join(DATA_DIR, "fetched-at.txt"), "w", encoding="utf-8") as f:
        f.write(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ") + "\n")
    print("done")


if __name__ == "__main__":
    main()
