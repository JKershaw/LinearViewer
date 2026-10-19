// LIN-3566: pins for the two places the rebuilt roadmap renderer deliberately
// differs from the one it replaced. Both were broken markup, reachable only from
// a directly built roadmap model (buildRoadmapModel never produces them):
//   1. a risk severity that is an Object.prototype key (`toString`, …) was used
//      to look up the accent state, so it rendered the function's source text
//      as an accent-bar modifier class.
//   2. numeric slots (card meta, subtask rollup, critical-path depth)
//      were interpolated unescaped, so a non-numeric value injected markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRoadmapPage } from '../../lib/render-roadmap.js';

const render = (model) => renderRoadmapPage({ roadmapModel: model, organizationName: 'Acme' }, {});

const milestone = (extra = {}) => ({
  name: 'P',
  totalTasks: 4,
  completedTasks: 1,
  progressPercent: 25,
  tasksInQueue: [],
  recentlyCompleted: [],
  ...extra
});

for (const severity of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
  test(`risk severity "${severity}" falls back to the running accent, not a prototype member`, () => {
    const html = render({
      milestones: [milestone()],
      risks: [{ milestone: 'P', type: 'blocked', severity, description: 'd' }]
    });
    assert.match(html, /<span class="accent-bar accent-bar--running accent-bar--vertical" role="img" aria-label="[^"]*risk">/);
    assert.doesNotMatch(html, /native code|\[object Object\]/);
    assert.ok(html.includes(`roadmap-risk--${severity}`), 'the severity word is still carried as text and class');
  });
}

test('known severities keep their accents', () => {
  const html = render({
    milestones: [milestone()],
    risks: ['high', 'medium', 'low'].map(severity => ({ milestone: 'P', type: 'blocked', severity, description: 'd' }))
  });
  assert.match(html, /accent-bar--error/);
  assert.match(html, /accent-bar--running/);
  assert.match(html, /accent-bar--queued/);
});

test('card meta escapes non-numeric progress, done and total values', () => {
  const html = render({
    milestones: [milestone({ progressPercent: '<i>p</i>', completedTasks: '"><b>', totalTasks: '<u>t</u>' })]
  });
  assert.ok(html.includes('&lt;i&gt;p&lt;/i&gt;% · &quot;&gt;&lt;b&gt;/&lt;u&gt;t&lt;/u&gt; done'));
  assert.doesNotMatch(html, /<i>p<\/i>|<u>t<\/u>/);
});

test('subtask rollup escapes non-numeric counts', () => {
  const task = {
    id: 'a', identifier: 'T-1', title: 'Parent', stateType: 'started',
    subtasks: [{ id: 'b', identifier: 'T-2', title: 'Child', stateType: 'started' }],
    rollup: { subtaskDone: '<i>d</i>', subtaskTotal: '<u>t</u>' }
  };
  const html = render({ milestones: [milestone({ tasksInQueue: [task] })] });
  assert.ok(html.includes('(&lt;i&gt;d&lt;/i&gt;/&lt;u&gt;t&lt;/u&gt; subtasks)'));
  assert.doesNotMatch(html, /<i>d<\/i>/);
});

test('critical-path depth escapes a non-numeric value', () => {
  const html = render({
    milestones: [milestone()],
    criticalPaths: new Map([['P', { path: ['a', 'b'], length: '<i>2</i>' }]]),
    executionQueue: []
  });
  assert.ok(html.includes('critical path (&lt;i&gt;2&lt;/i&gt; deep)'));
  assert.doesNotMatch(html, /<i>2<\/i>/);
});

// Guard for the fix above: escaping must not turn a falsy 0 into ''.
test('zero still renders as "0" in numeric slots', () => {
  const html = render({
    milestones: [milestone({ progressPercent: 0, completedTasks: 0, totalTasks: 0 })]
  });
  assert.ok(html.includes('0% · 0/0 done'));
});

// LIN-3678: the task glyph comes from getStateDisplay, the one glyph rule.
test('task glyphs follow getStateDisplay: backlog ◌, unstarted ○, started ◐', () => {
  const task = (stateType, identifier) => ({ id: identifier, identifier, title: 't', stateType });
  const html = render({
    milestones: [milestone({ tasksInQueue: [task('backlog', 'B-1'), task('unstarted', 'U-1'), task('started', 'S-1')] })]
  });
  assert.match(html, /◌ <span class="task-id">B-1/);
  assert.match(html, /○ <span class="task-id">U-1/);
  assert.match(html, /◐ <span class="task-id">S-1/);
});
