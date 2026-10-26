#!/usr/bin/env python3
"""Classify the record fetched by fetch.py and print the tables the evidence file cites.

Reads ../how-the-charter-got-complicated-data/ and the retro's input-6 index (for run kinds).
Writes c3-cut-points.csv, c3-record-now.csv, q4-comparison.csv and c4-run-kinds.csv to the same
folder, and prints them. Re-runnable with no network access.

Classes:
- description headings: pipeline (research, plan, implementation outcome), operator (headings that
  say operator), john (open for / answered by John), brief (everything else, including the UI
  session's briefs and John's own text);
- comments, by opening line: john (John, answers to open questions, rulings), operator
  (Operator, Prediction, Score, Visual judge), pipeline (research, plan, review, close-out,
  autopilot, implementation, fix-ups, CI and PR lines), unmatched (reported, not assumed).
  An autopilot comment that speaks of the operator is recoded operator (research §3 bias 2).

Cut points, both measured on current text (see the evidence file's limits):
- cut 1, at launch: description without its pipeline sections, plus comments created before the
  first pipeline comment;
- cut 2, at first implementation dispatch: the current description, plus every comment created
  before that dispatch.
"""

import csv
import glob
import os
import re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "how-the-charter-got-complicated-data")
RETRO_INPUTS = os.path.join(HERE, "..", "..", "..", "reviews", "charter-retro-2026-10-26", "inputs")

UI = ["LIN-3833", "LIN-3975", "LIN-3977", "LIN-3983", "LIN-3952"]
COMPARISON = ["LIN-3986", "LIN-4003", "LIN-3995", "LIN-3992", "LIN-3872", "LIN-3876", "LIN-3877",
              "LIN-3883", "LIN-3893", "LIN-3917", "LIN-3846", "LIN-3849"]
CLASSES = ["brief", "john", "operator", "pipeline", "unmatched"]


def rows(name):
    with open(os.path.join(DATA, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def desc_class(under, heading):
    u, h = under.lower(), heading.lower()
    if u.startswith(("research findings", "implementation plan", "implementation outcome")) or \
            h.startswith(("research findings", "implementation plan", "implementation outcome")):
        return "pipeline"
    if "operator" in h or "operator" in u:
        return "operator"
    if u.startswith(("open for john", "answered by john")) or h.startswith(("open for john", "answered by john")):
        return "john"
    return "brief"


PIPELINE_OPENER = re.compile(
    r"^(research|plan|review|close-out|autopilot|implementation|fix|ci on|pr:|unblock|breakdown|branch|"
    r"one more|revise|decision|lin-\d+: implementation|done)")


def comment_class(opener, body_head):
    o = opener.lower()
    if re.match(r"^(john\b|ruling\b|answers to [\"“]?open, for john|answered by john)", o):
        return "john"
    if re.match(r"^(operator|prediction|score|visual judge)\b", o):
        return "operator"
    if PIPELINE_OPENER.match(o):
        if o.startswith("autopilot") and "operator" in body_head.lower():
            return "operator"
        return "pipeline"
    return "unmatched"


def load():
    sections = defaultdict(list)
    for r in rows("sections.csv"):
        sections[r["ticket"]].append({"cls": desc_class(r["under"], r["heading"]), "chars": int(r["chars"])})
    comments = defaultdict(list)
    for r in rows("comments.csv"):
        comments[r["ticket"]].append({"created": r["created"], "chars": int(r["chars"]), "opener": r["opener"],
                                      "id": r["comment_id"]})
    # comments.csv keeps the opener only; the autopilot-operator recode reads the opener's own words.
    for t in comments:
        for c in comments[t]:
            c["cls"] = comment_class(c["opener"], c["opener"])
    cost = defaultdict(list)
    for r in rows("cost.csv"):
        cost[r["ticket"]].append(r)
    return sections, comments, cost


def cut_points(sections, comments, cost):
    out = []
    for t in UI + COMPARISON:
        secs, cms = sections[t], sorted(comments[t], key=lambda c: c["created"])
        pipe_times = [c["created"] for c in cms if c["cls"] == "pipeline"]
        t1 = min(pipe_times) if pipe_times else "9999"
        impl = sorted(s["dispatched"] for s in cost[t] if s["kind"] == "implementation" and s["dispatched"])
        t2 = impl[0] if impl else None
        for cut in ("cut1", "cut2", "now"):
            tot = Counter()
            for s in secs:
                if cut == "cut1" and s["cls"] == "pipeline":
                    continue
                tot[s["cls"]] += s["chars"]
            for c in cms:
                if cut == "cut1" and c["created"] >= t1:
                    continue
                if cut == "cut2" and t2 and c["created"] >= t2:
                    continue
                tot[c["cls"]] += c["chars"]
            total = sum(tot.values())
            out.append([t, cut, total] + [round(100 * tot[k] / total, 1) if total else 0 for k in CLASSES])
    return out


def q4(sections, comments, cost):
    out = []
    for t in COMPARISON + UI:
        secs, cms = sections[t], sorted(comments[t], key=lambda c: c["created"])
        pipe_times = [c["created"] for c in cms if c["cls"] == "pipeline"]
        t1 = min(pipe_times) if pipe_times else "9999"
        launch = sum(s["chars"] for s in secs if s["cls"] != "pipeline") + \
            sum(c["chars"] for c in cms if c["created"] < t1)
        sess = cost[t]
        impl = sorted([s for s in sess if s["kind"] == "implementation"], key=lambda s: s["dispatched"])
        t2 = impl[0]["dispatched"] if impl else "9999"
        post = [c for c in cms if c["created"] > t2 and c["cls"] in ("john", "operator")]
        hours = sum(float(s["duration_ms"]) for s in impl if s["duration_ms"]) / 3.6e6
        out.append([
            t, "UI" if t in UI else "comparison", launch,
            len(impl), "/".join(sorted({s["tier"] for s in impl})) or "none",
            sum(1 for s in sess if s["kind"] == "plan-review"),
            sum(1 for s in sess if s["kind"] == "review"),
            len(post), round(hours, 2),
        ])
    return out


def run_kinds():
    counts = Counter()
    for path in sorted(glob.glob(os.path.join(RETRO_INPUTS, "input-6-data-part-*.md"))):
        text = open(path, encoding="utf-8").read()
        block = re.search(r"```csv\n(.*?)```", text, re.S).group(1)
        for r in csv.DictReader(block.splitlines()):
            for pair in filter(None, r["run_kinds"].split(" ")):
                kind, n = pair.rsplit(":", 1)
                counts[kind] += int(n)
    return counts


def c5_summary():
    """Count the hand coding in c5-coding.csv against the tree's state, one row per ticket."""
    state = {r["id"]: r["state"] for r in rows("tree.csv") if r["state"]}
    coding = {r["id"]: r["code"] for r in rows("c5-coding.csv")}
    missing = sorted(set(state) - set(coding))
    counts = Counter()
    for ident, code in coding.items():
        if ident not in state:
            continue
        counts[(state[ident] == "Done", code)] += 1
    out = []
    for done, label in ((True, "Done"), (False, "open (not Done)")):
        for code in ("served", "process-only", "not-needed", "umbrella", "open"):
            if counts[(done, code)]:
                out.append([label, code, counts[(done, code)]])
    return out, missing


def c5_report():
    out, missing = c5_summary()
    write("c5-summary.csv", ["state", "code", "tickets"], out)
    print("tree tickets without a code:", missing)


def write(name, header, data):
    with open(os.path.join(DATA, name), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(data)
    print(f"\n== {name}")
    print(",".join(header))
    for row in data:
        print(",".join(str(x) for x in row))


def main():
    sections, comments, cost = load()
    cuts = cut_points(sections, comments, cost)
    write("c3-cut-points.csv", ["ticket", "cut", "total_chars"] + [f"{k}_pct" for k in CLASSES],
          [r for r in cuts if r[1] != "now"])
    write("c3-record-now.csv", ["ticket", "cut", "total_chars"] + [f"{k}_pct" for k in CLASSES],
          [r for r in cuts if r[1] == "now"])
    write("q4-comparison.csv",
          ["ticket", "set", "launch_chars", "impl_sessions", "impl_tiers", "plan_review_sessions",
           "review_sessions", "post_dispatch_john_operator_comments", "impl_hours"],
          q4(sections, comments, cost))
    rk = run_kinds()
    write("c4-run-kinds.csv", ["run_kind", "runs"], sorted(rk.items(), key=lambda kv: -kv[1]))
    c5_report()
    unmatched = Counter()
    for t in UI:
        for c in comments[t]:
            if c["cls"] == "unmatched":
                unmatched[t] += 1
    print("\nunmatched comments on UI tickets:", dict(unmatched))


if __name__ == "__main__":
    main()
