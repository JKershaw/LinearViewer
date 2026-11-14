# Run 8 (LIN-4481): fill the three groups with no carried ruling and record the re-read of every group with a site in a
# window hunk. Usage (repo root): python3 -I finish-rulings-run8.py <census-rulings-run8-carry.tsv> <out.tsv>
import csv, sys
FIRST = {
  'G0025': ('borderline', "First ruling (run 7's G0027 was a table group). Two decisions share the literal: 'local' shown as 'harbour' is mapped twice in classic browser code (public/common.js:441, whose comment says it is the shared helper, and public/dispatch.js:1147), and the localhost-only rule is written in lib/dispatch-entrance.js:262 and again in offeredTargetsFor (lib/dispatch-targets.js:84). Low cost; the target home is lib/dispatch-targets.js."),
  'G0076': ('real', "G0049 re-keyed: lib/dispatch-leftover.js left the group when it took HALT_MODES (row 142, resolved). The mode-to-word maps remain, HALT_BANNER_WORD (lib/render.js:223, keyed off HALT_MODES by comment only) and HALT_MODE_LABELS (public/dispatch.js:797); runner.mjs is the kit's designed mirror. Home: lib/workspace-halt.js HALT_MODES. Row 102."),
  'G0176': ('borderline', "First ruling (grown from table). digest-feedback.js:219 parses a withdrawal and proxy-runner.js:244 clears a cache on one: single-kind checks, fine. public/dispatch.js:1062 restates the three-kind stamp set whose home is DECISION_LIFECYCLE_STAMP_KINDS (lib/dispatch-feedback-kinds.js); it is a classic script under a drift test (row 56)."),
}
REREAD = {
  'G0002': 'Re-read: shrunk 43 -> 31 sites; the test-token half moved into isHermeticTestToken (LIN-4456/4450, G0008 gone). The bare NODE_ENV reads and the limiter skips stand. Ruling stands.',
  'G0011': "Re-read: the site in lib/run-closeout-state.js moved inside closeOutDecision (LIN-4460). readTaskRunFacts().stopAt is still the home and the re-derivations stand. Ruling stands.",
  'G0018': "Re-read: the blind-read prompt site moved into its record (lib/prompts/stage-kinds.js:586, LIN-4467). The parse authority is still dispatch-terminal. Ruling stands.",
  'G0059': 'Re-read: public/flight-companion.js sites moved with the module conversion (LIN-4463); same comparisons. Ruling stands.',
  'G0097': 'Re-read: public/flight-companion.js site moved with the module conversion. Ruling stands.',
  'G0127': "Re-read: routes/workspace-api-audit.js now calls isHermeticTestToken but still inlines the NODE_ENV-and-local half beside shouldMockAi, by its own comment's choice (a data-mock carve-out). Ruling stands.",
  'G0142': 'Re-read: the site moved with isLiveRun to lib/run-live-wait.js (LIN-4459); the inline running/queued tests elsewhere stand. Ruling stands.',
  'G0144': 'Re-read: public/task-page.js sites moved with the module conversion (LIN-4472). Ruling stands.',
  'G0150': 'Re-read: public/flight-companion.js site moved with the module conversion. Ruling stands.',
}
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
cols = ['rank_run8', 'id_run8', 'id_run7', 'decision', 'areas/files/sites', 'status_vs_run7', 'basis', 'window_hunk', 'ruling', 'reason', 'reread_run8']
out = open(sys.argv[2], 'w'); out.write('\t'.join(cols) + '\n'); dist = {}
for r in rows:
    gid = r['id_run8']; reread = REREAD.get(gid, '')
    if gid in FIRST:
        r['ruling'], r['reason'] = FIRST[gid]; r['basis'] = 'ruled from sites'
    elif r['ruling'] == 'RULE': raise SystemExit('unruled ' + gid)
    if r['window_hunk'] == 'yes' and not reread and gid not in FIRST: raise SystemExit('no re-read for ' + gid)
    dist[r['ruling']] = dist.get(r['ruling'], 0) + 1
    out.write('\t'.join([r['rank_run8'], gid, r['id_run7'], r['decision'], r['areas/files/sites'], r['status_vs_run7'], r['basis'], r['window_hunk'], r['ruling'], r['reason'], reread]) + '\n')
print(len(rows), dist)
