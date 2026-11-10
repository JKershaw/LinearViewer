/**
 * lib/render-task-timeline.js: the "Sessions on one clock" section of the task page (LIN-4405, part 2 of LIN-4395).
 *
 * Prints the model lib/task-timeline.js builds; it derives nothing and does no layout maths: every `left`/`width` is a
 * percentage the model computed. Positioned HTML, no SVG, no client layout. On desktop each lane is a label column
 * (kind · model · elapsed / worked · cost) beside its track; below 600 px the CSS alone (public/task-page.css) puts the
 * label above a full-width track, on the same clock.
 *
 * Each lane is a `<details>` that opens to its dispatches. Its `<summary>` is named by its own visible text (kind,
 * role, model, elapsed, worked and cost), and the track inside it is `aria-hidden`, so the name is complete without an
 * `aria-label` (front-end-pages lesson, Design & Interface Review, 8 Nov 2026: a control rendered per row needs its own
 * accessible name).
 *
 * Words: "elapsed" is the lineage's own start to end (or to now while it runs), and "worked" is the sum of its
 * dispatches' first-to-last request spans. Neither is Stages' "took", which is the latest attempt's duration, so the
 * two never share a word on the page.
 *
 * Viewer-blind. Dollars go through `formatUsd` (lib/cost-format.js) only, and only when the model carries spend
 * (`spend !== false`); a guest's model has been through `withoutSpend`, so no cost word is written at all. No cost is
 * ever put in an attribute: the `data-*` hooks are `data-testid`, `data-lane-id`, `data-role`, `data-kind`,
 * `data-state`, `data-times` and `data-counted-under` (documented in public/llms.txt).
 */

import { escapeHtml } from './utils/html.js';
import { formatUsd } from './cost-format.js';
import { fmtDuration } from './render-run-steps.js';
import { stageLabel } from './run-view.js';
import { fmtWhen } from './task-page-loader.js';
import { renderSection } from './components/section.js';

const ROLE_WORD = { held: 'held', fresh: 'fresh' };
const DISPATCH_ROLE_WORD = { wake: 'woken', resumed: 'resumed', orchestration: 'started', work: 'started' };

/** `left: …%; width: …%` from a placed stretch. */
function placed({ leftPct, widthPct }) {
  return `left:${leftPct}%;width:${widthPct}%`;
}

/** A UTC clock time with seconds, for the dispatch rows (`14:47:24`). */
function clockOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * A `<time>` the page's local-time pass rewrites (public/common.js `initLocalTimes`). Its UTC fallback text is the task
 * page's one formatter, `fmtWhen` (`8 Nov, 14:40 UTC`, the year only when it is not this one), the shape the local-time
 * pass also writes, so the axis keeps its width.
 */
function timeTag(iso, className, testid) {
  const text = iso ? fmtWhen(iso) : null;
  if (!text) return '';
  return `<time class="${className}" data-testid="${testid}" datetime="${escapeHtml(iso)}" data-local-time="zoned">${escapeHtml(text)}</time>`;
}

/** A lane's name: its kind's word, and held or fresh when it reads as one (a plain `custom` base reads by kind alone). */
function laneName(lane) {
  const role = ROLE_WORD[lane.role];
  return role ? `${stageLabel(lane.kind)} · ${role}` : stageLabel(lane.kind);
}

/** A lane's cost words, or null when the model carries no spend (a guest's). */
function laneCost(lane, spend) {
  if (!spend) return null;
  const figure = formatUsd(lane.costUsd);
  if (lane.countedUnder) {
    return figure ? `lineage cost ${figure}, counted under ${lane.countedUnder}` : `lineage cost not complete, counted under ${lane.countedUnder}`;
  }
  if (figure) return figure;
  if (lane.incomplete) return 'cost not complete';
  if (!lane.telemetry) return 'no usage posted';
  return 'not priced';
}

/** A lane's time words: elapsed (so far, while running) and worked, or that its working times are unknown. */
function laneTimes(lane) {
  const parts = [];
  const elapsed = fmtDuration(lane.elapsedMs);
  if (elapsed) parts.push(lane.state === 'running' ? `elapsed ${elapsed} so far` : `elapsed ${elapsed}`);
  if (lane.times === 'unknown') parts.push('working times unknown');
  else {
    const worked = fmtDuration(lane.workedMs);
    if (worked) parts.push(`worked ${worked}`);
  }
  if (lane.state === 'end-not-recorded') parts.push('end not recorded');
  if (lane.state === 'running') parts.push('running');
  return parts;
}

/** One dispatch's row inside an opened lane. */
function dispatchRow(row, spend) {
  const parts = [`${stageLabel(row.kind)} ${DISPATCH_ROLE_WORD[row.role] || 'started'}`];
  const at = clockOf(row.dispatchedAt);
  if (at) parts.push(`at ${at} UTC`);
  if (row.firstRequestAt && row.lastRequestAt) {
    parts.push(`worked ${fmtDuration(row.workedMs) || '0s'} (${clockOf(row.firstRequestAt)}–${clockOf(row.lastRequestAt)})`);
  } else {
    parts.push('no requests recorded');
  }
  if (row.requests) parts.push(`${row.requests} request${row.requests === 1 ? '' : 's'}`);
  if (row.model) parts.push(row.model);
  if (spend) {
    const figure = formatUsd(row.costUsd);
    if (figure) parts.push(figure);
    else if (row.requests) parts.push('not priced');
  }
  return `<li class="tl-dispatch" data-testid="task-timeline-dispatch" data-role="${escapeHtml(row.role)}" data-kind="${escapeHtml(row.kind)}">${escapeHtml(parts.join(' · '))}</li>`;
}

/** The break shading every track carries, so a folded stretch reads the same on every lane. */
function breakBands(scale) {
  return scale.breaks.map(b => `<span class="tl-break" style="${placed(b)}"></span>`).join('');
}

/** One lane: a `<details>` whose summary is the label and the track, opening to the dispatches. */
function laneHtml(lane, timeline) {
  const spend = timeline.spend !== false;
  const { scale, marks } = timeline;
  const cost = laneCost(lane, spend);
  const meta = [lane.model, ...laneTimes(lane), cost].filter(Boolean);
  const counted = lane.countedUnder ? ` · counted under ${lane.countedUnder}` : '';

  const line = `<span class="tl-line${lane.times === 'unknown' ? ' tl-line--unknown' : ''}" data-testid="task-timeline-line" style="${placed(lane.span)}"></span>`;
  const clipStart = lane.clipped.start ? `<span class="tl-clip tl-clip--start" data-testid="task-timeline-clip" style="left:${lane.span.leftPct}%" title="continues outside this task"></span>` : '';
  const clipEnd = lane.clipped.end ? `<span class="tl-clip tl-clip--end" data-testid="task-timeline-clip" style="left:${Math.round((lane.span.leftPct + lane.span.widthPct) * 100) / 100}%" title="continues outside this task"></span>` : '';
  const segs = lane.segments.map(s => `<span class="tl-seg" data-testid="task-timeline-segment" data-role="${escapeHtml(s.role)}" style="${placed(s)}"></span>`).join('');
  const ticks = lane.ticks.map(t => `<span class="tl-tick tl-tick--${escapeHtml(t.noRecords && t.role !== 'wake' && t.role !== 'resumed' ? 'bare' : t.role)}" data-testid="task-timeline-tick" data-role="${escapeHtml(t.role)}"${t.noRecords ? ' data-times="none"' : ''} style="left:${t.leftPct}%"></span>`).join('');
  const merges = marks.merges.map(m => `<span class="tl-merge" style="left:${m.leftPct}%"></span>`).join('');
  const open = lane.state === 'running' && scale.nowPct !== null ? `<span class="tl-open-end" style="left:${scale.nowPct}%"></span>` : '';

  const notes = [];
  if (lane.times === 'unknown') notes.push('<p class="tl-note" data-testid="task-timeline-unknown">Working times unknown: this session ran before Harbour recorded request times, so only its start and end are drawn.</p>');
  if (lane.clipped.start || lane.clipped.end) notes.push(`<p class="tl-note" data-testid="task-timeline-clip-note">This session continues outside this task; only the part on this task's clock is drawn.</p>`);
  const rows = Array.isArray(lane.dispatches) && lane.dispatches.length
    ? `<ul class="tl-dispatches" data-testid="task-timeline-dispatches">${lane.dispatches.map(row => dispatchRow(row, spend)).join('')}</ul>`
    : '';

  const attrs = [
    'class="tl-lane"',
    'data-testid="task-timeline-lane"',
    `data-lane-id="${escapeHtml(String(lane.id || ''))}"`,
    `data-role="${escapeHtml(lane.role || 'kind')}"`,
    `data-kind="${escapeHtml(lane.kind)}"`,
    `data-state="${escapeHtml(lane.state)}"`,
    `data-times="${escapeHtml(lane.times)}"`,
    lane.countedUnder ? `data-counted-under="${escapeHtml(lane.countedUnder)}"` : '',
  ].filter(Boolean).join(' ');

  return `<li ${attrs}><details class="tl-details"><summary class="tl-summary" data-testid="task-timeline-summary">`
    + `<span class="tl-label"><span class="tl-name" data-testid="task-timeline-name">${escapeHtml(laneName(lane))}${escapeHtml(counted)}</span>`
    + `<span class="tl-meta" data-testid="task-timeline-meta">${escapeHtml(meta.join(' · '))}</span></span>`
    + `<span class="tl-track" aria-hidden="true">${breakBands(scale)}${line}${clipStart}${clipEnd}${segs}${ticks}${merges}${open}</span>`
    + `</summary><div class="tl-body">${notes.join('')}${rows || '<p class="tl-note">No dispatches recorded.</p>'}</div></details></li>`;
}

/** The task's total: the own read's figure, "not complete" naming any priced part, or nothing for a guest. */
function totalWords(totals, spend) {
  if (!spend) return null;
  if (totals.complete) return `total ${formatUsd(totals.totalUsd)}`;
  const priced = totals.pricedUsd > 0 ? formatUsd(totals.pricedUsd) : null;
  return priced ? `total not complete (${priced} priced)` : 'total not complete';
}

/**
 * The section's body, also the fragment the timeline endpoints return.
 *
 * @param {Object|null|undefined} timeline  lib/task-timeline.js `taskTimeline` (or `withoutSpend` of it), or
 *   `{error: true}` when the read failed
 * @returns {string}
 */
export function renderTaskTimeline(timeline) {
  if (!timeline || timeline.error) {
    return '<p class="sess-muted tl-empty" data-testid="task-timeline-error">○ sessions could not be read</p>';
  }
  const spend = timeline.spend !== false;
  const { lanes, scale, marks, totals } = timeline;
  if (!lanes.length || !scale) {
    const merged = marks && marks.untimedMerge ? ' · merged, time not recorded' : '';
    return `<p class="sess-muted tl-empty" data-testid="task-timeline-empty">○ no sessions recorded${escapeHtml(merged)}</p>`;
  }

  const own = lanes.filter(l => !l.countedUnder).length;
  const summary = [`${own} session${own === 1 ? '' : 's'}`];
  if (totals.foreignLanes) summary.push(`${totals.foreignLanes} counted under another task`);
  const total = totalWords(totals, spend);
  if (total) summary.push(total);
  let mergeHtml = '';
  if (marks.merges.length === 1) mergeHtml = ` · merged ${timeTag(marks.merges[0].at, 'tl-merged-at', 'task-timeline-merged-at')}`;
  else if (marks.merges.length > 1) summary.push(`${marks.merges.length} merges`);
  else if (marks.untimedMerge) summary.push('merged, time not recorded');

  const notes = [];
  if (spend && totals.lineagesTruncated) {
    notes.push('<p class="tl-note" data-testid="task-timeline-truncated">Some of the oldest dispatch rows were over the read limit and not read; a session that lost a priced part says its cost is not complete.</p>');
  }

  const axisBreaks = scale.breaks.map(b => `<span class="tl-axis-break" data-testid="task-timeline-break" style="${placed(b)}">⋯ ${escapeHtml(b.words)} ⋯</span>`).join('');
  const mergeLabels = marks.merges.map(m => `<span class="tl-axis-merge" data-testid="task-timeline-merge" style="left:${m.leftPct}%"></span>`).join('');
  const axis = `<div class="tl-axis" data-testid="task-timeline-axis"><span class="tl-axis-pad"></span><span class="tl-axis-track">`
    + `${timeTag(scale.startAt, 'tl-axis-start', 'task-timeline-start')}${axisBreaks}${mergeLabels}${timeTag(scale.endAt, 'tl-axis-end', 'task-timeline-end')}</span></div>`;
  const key = (kind, words) => `<span class="tl-legend-item"><span class="tl-key tl-key--${kind}"></span>${words}</span>`;
  const legend = `<p class="tl-legend" data-testid="task-timeline-legend">${key('seg', 'working')}${key('line', 'held or waiting')}${key('tick', 'woken or resumed')}${marks.merges.length ? key('merge', 'merged') : ''}</p>`;

  return `<div class="tl" data-testid="task-timeline-body">`
    + `<p class="tl-summary-line" data-testid="task-timeline-total">${escapeHtml(summary.join(' · '))}${mergeHtml}</p>${notes.join('')}`
    + `${axis}<ol class="tl-lanes" data-testid="task-timeline-lanes">${lanes.map(lane => laneHtml(lane, timeline)).join('')}</ol>${legend}</div>`;
}

/**
 * The whole section, placed under Stages. `fragmentUrl` is the timeline endpoint the page script re-reads while a
 * session runs (public/task-page.js); none means the section is never refreshed. Nothing is rendered when the page
 * model carries no timeline at all (a loader built without the reader).
 *
 * @param {Object|null|undefined} timeline
 * @param {{fragmentUrl?: string}} [opts]
 * @returns {string}
 */
export function renderTaskTimelineSection(timeline, { fragmentUrl = '' } = {}) {
  if (timeline === undefined) return '';
  const url = fragmentUrl ? ` data-timeline-url="${escapeHtml(fragmentUrl)}"` : '';
  return renderSection({
    className: 'sess-section task-timeline',
    title: 'Sessions on one clock',
    attrs: `data-testid="task-timeline"${url}`,
    body: `<div class="task-timeline-mount" data-testid="task-timeline-mount">${renderTaskTimeline(timeline)}</div>`,
  });
}
