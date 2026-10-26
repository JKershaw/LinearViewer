/**
 * Style-guide page renderer (LIN-457, Phase 0C).
 *
 * A public, static design-reference page that exercises every design token
 * shipped in `:root` (public/style.css) plus the core CLI/terminal primitives
 * (state glyphs, box-drawing). It is the comprehensive visual-regression target
 * for the next phase, so it MUST stay deterministic: no live data, no
 * per-request variation, and no deploy info in the footer.
 *
 * Follows the public legal-page pattern (lib/render-legal.js): a full document
 * via the shared `renderPage()` shell, `is-landing` body class, and the shared
 * page footer. Tokens are rendered live via `var(--token)` so the page mirrors
 * the stylesheet rather than re-encoding it; the literal values are shown only
 * as captions for reference.
 */

import { renderPageFooter } from './components/footer.js';
import { renderPage } from './components/page.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderField } from './components/field.js';
import { renderCard } from './components/card.js';
import { renderStatusPill } from './components/status-pill.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderButton } from './components/button.js';
import { renderIconButton } from './components/icon-button.js';
import { renderIcon, ICON_NAMES } from './components/icon.js';
import { renderTag, renderChip } from './components/tag.js';
import { renderAccentBar } from './components/accent-bar.js';
import { renderSegmentBar } from './components/segment-bar.js';
import { renderTabs } from './components/tabs.js';
import { renderDisclosure } from './components/disclosure.js';
import { renderSurface } from './components/surface.js';
import { switchRow, drillRow, actionRow, staticRow } from './components/settings-row.js';
import { askInPlace } from './components/settings-ask.js';
import { groupNote, statusLine, group } from './components/settings-group.js';
import { keyRow } from './components/settings-key-row.js';
import { decisionPanel, agentLists, suggestionsByHarness, routingWords } from './components/decision-panel.js';
import { renderSettingsShell, renderSettingsNav } from './components/settings-frame.js';
import { AREAS } from './settings-areas.js';
import { renderPlainSections } from './components/plain-page.js';

// Token-reference blocks render through the canonical `section` component
// (LIN-461) — the /styleguide page is its visual-regression lock. The headings
// keep `titleTag: 'h3'` to match the prior structure; the canonical
// `.section .section-header` rule styles them, the intended, reviewed
// convergence shift. The `.legal-content h3` rule that once overrode it is gone (LIN-3950).
const sgSection = (title, body) =>
  renderSection({ titleTag: 'h3', title, body });

// The button looks the live pages emit (LIN-3950). Each sample is the builder's own output, and the
// caption under it is the class string that output carries, so the page cannot show a look the code
// does not produce.
const BUTTON_LOOKS = [
  { label: 'default' },
  { label: 'primary', variant: 'primary' },
  { label: 'ghost', variant: 'ghost' },
  { label: 'remove', tone: 'red' },
  { label: 'cancel', quiet: true },
  { label: 'save', quiet: true, tone: 'green' },
  { label: 'connect', quiet: true, tone: 'blue' },
  { label: 'disconnect', quiet: true, tone: 'red' },
];
const buttonSample = (opts) => {
  const html = renderButton(opts);
  const cls = html.match(/class="([^"]*)"/)[1];
  return `<span class="sg-look-sample">${html}<code>${cls}</code></span>`;
};

// Settings pieces (LIN-3890). Each piece's anatomy is written here: purpose, parts, desktop and phone
// sizes, states, and light/dark. Its live sample is drawn by the builder it names (SETTINGS_SAMPLES).
// Settings styles stay in public/settings.css, which this page links.
export const SETTINGS_PIECES = [
  {
    id: 'switch-row',
    name: 'Switch row',
    purpose: 'A setting that is on or off. The state is the control: pressing the switch changes the setting.',
    parts: 'Label, optional one-line note, switch (role="switch", shows on or off as text too).',
    sizes: 'Desktop 15.2px label, full pane width. Phone 390px: label 15.2px, switch 40px touch target, no inner padding.',
    states: 'On, off, saving, refused (error line under the label).',
    theme: 'Light and dark: switch track uses the brand teal when on, the line token when off.'
  },
  {
    id: 'value-row',
    name: 'Value row',
    purpose: 'Shows a value and a chevron. Opens in place to show more, or links to another page.',
    parts: 'Label, value (mono for machine facts), chevron ›. In place: a details element with a body. Link: an anchor.',
    sizes: 'Desktop 15.2px label, value on the same line. Phone 390px: label and value wrap as one row, both 15.2px.',
    states: 'Closed, open, read-only (no chevron, no body), link.',
    theme: 'Light and dark: value uses --muted; the chevron uses --fg-dim.'
  },
  {
    id: 'action-row',
    name: 'Action row',
    purpose: 'A single thing the user can do from the row. Teal for a normal action, red when it stops or removes something.',
    parts: 'Label, optional note, button (btn--primary or btn--red) or link.',
    sizes: 'Desktop 15.2px label, filled button. Phone 390px: label 15.2px, button full width, 40px tall.',
    states: 'Idle, pressed, disabled (owner-only: not rendered for members).',
    theme: 'Light and dark: fill is --teal or --red with white text.'
  },
  {
    id: 'ask-in-place',
    name: 'Ask in place',
    purpose: 'Confirms a change before it is made, on the same row, with a real Cancel. Replaces the browser confirm box in Settings.',
    parts: 'Summary (the row label), statement of what will happen, optional “Why?” text area (max 500 characters), Confirm (filled), Cancel (quiet button).',
    sizes: 'Desktop: panel sits under the row, 2 rows of text area. Phone 390px: buttons stack full width, 40px tall.',
    states: 'Closed (summary and any state word), open, with reason (the browser will not send an empty reason), refused (the error goes on the status line). Script transport (key revoke): the same panel, sent without a page load.',
    theme: 'Light and dark: Confirm is the brand fill (btn--primary), or --red for stop, remove and revoke; Cancel is a quiet link button.'
  },
  {
    id: 'status-line',
    name: 'Status line',
    purpose: 'Says what just happened on this page: a saved change, or an error. Errors stay until the next change.',
    parts: 'Text, optional action link (for example “Make active”).',
    sizes: 'Desktop 13.6px, one line. Phone 390px: wraps, 13.6px.',
    states: 'Confirmation (teal text), error (red text, keeps settings-flash-error).',
    theme: 'Light and dark: confirmation uses --teal text, error uses --red.'
  },
  {
    id: 'note',
    name: 'Note',
    purpose: 'One line under a group or row that says what the setting does in plain words.',
    parts: 'Text only.',
    sizes: 'Desktop 13.6px, one line at 1280px. Phone 390px: 13.6px, may wrap.',
    states: 'Default only.',
    theme: 'Light and dark: --muted.'
  },
  {
    id: 'group-title',
    name: 'Group title',
    purpose: 'Names who a group of rows affects, so rows do not repeat it: “For you”, “For everyone in <workspace>”.',
    parts: 'Title text only.',
    sizes: 'Desktop 12.8px, uppercase label. Phone 390px: 12.8px.',
    states: 'Default only.',
    theme: 'Light and dark: --muted.'
  },
  {
    id: 'key-row',
    name: 'Key row',
    purpose: 'One access key. Leads with its name, then kind, relative expiry and last use. Problems are flagged on the row.',
    parts: 'Name, kind, “expires in 89d” and “last used 3h ago” (relative), optional flag, Revoke (an ask in place).',
    sizes: 'Desktop 15.2px name on one line, kind and times after it. Phone 390px: the name, then kind and times wrap under it, all 15.2px.',
    states: 'Plain, flagged (no owner · re-issue, waiting to be used), opened, revoke asking, owner-only (no Revoke).',
    theme: 'Light and dark: flag uses --amber text; “Run keys · N” summary row uses the plain row style.'
  },
  {
    id: 'area-frame',
    name: 'Area frame',
    purpose: 'The page around one Settings area: the Settings heading, the back link, the area title and one line of purpose.',
    parts: 'Settings heading (phone index only), “‹ Settings” back link, area title, purpose line, the area body.',
    sizes: 'Desktop: sidebar left, area right. Phone 390px: index shows the list; an area opens with “‹ Settings” then its title, before the first row.',
    states: 'Index (no area selected in the list), area (its row is selected in the list on desktop and phone).',
    theme: 'Light and dark: sidebar uses the same surface as the pane; selected row uses --teal-soft.'
  },
  {
    id: 'sidebar-state',
    name: 'Sidebar state',
    purpose: 'One short word under each area in the sidebar, in a tone that says whether it needs you.',
    parts: 'Area name, state word, dot (red only when it needs you).',
    sizes: 'Desktop 13.6px state word. Phone 390px: 13.6px.',
    states: 'ok (teal or muted text), warn (amber: paused or stopped), bad (red dot: needs you).',
    theme: 'Light and dark: warn uses --amber and --amber-dim for text; bad uses --red.'
  },
  {
    id: 'decision-panel',
    name: 'Decision panel',
    purpose: 'The one choice of harness, model and effort for a job, a group or a run, with the job’s numbers first. Models and Home show the same panel; it holds nothing about either page.',
    parts: 'The numbers (runs, priced spend, typical cost a run, coverage). Then Harness, labelled by what it runs. Then Model: a search input, and under it suggested models for the harness in force. Each is a button, the chosen one marked, with its name and its rate per million tokens on one line, its reason under it, and, where this job ran on it, its typical cost; a rate the job’s own runs decided says so on its row. Under them, one note says the rates are for comparison, where an alias’s rate comes from (its runs, else the newest model it names), and that a Claude Code subscription may cover the cost; another names any suggestion with no known rate. Then Effort: follow, then low to max. A stored value outside that set shows as itself. Where the harness in force takes no effort (OpenCode), one line says so in place of the Effort row. Words, not ids: every name is the display name, and a blank field says whose default applies.',
    sizes: 'The panel is 32rem wide at most (a label column of 8 to 12 characters beside each control); at 390px it fills the width. On Home the panel sits in the full-screen sheet. Each sample below sits in its own frame.',
    states: 'Following Settings (a blank field says what it resolves to); chosen; a suggestion chosen (marked, by keyboard or pointer); an effort outside the set, shown and kept; OpenCode in force, where effort is hidden and the line says why; no runs, priced runs, and unpriced runs, which never read $0.',
    theme: 'Light and dark: fields take the --bg fill and --fg-vdim border, labels --fg-dim, prices and costs the machine (mono) face; reasons and words the content face.'
  },
];

// Live Console pieces (LIN-3977). The lane row and the stream row are built on the client
// (public/live-console.js), so these entries carry their anatomy only, with no live sample.
export const LIVE_CONSOLE_PIECES = [
  {
    id: 'lane-row',
    name: 'Lane row',
    purpose: 'One working agent, one row: what it is doing now, in plain words, and where it leads. One lane per task (the rule is in lib/live-console.js, chooseKeyLane). A run that waits on a person reads as waiting on you, in words, not only colour.',
    parts: 'Task identifier (to the task page), task title, stage word ("Build", never "implementation"), how long the stage has run ("for 4m"), the state word, the run link ("open run ↗", to the run page), ticket progress "ticket 2 so far", a dead credential (only when it is dead, never "credential unknown"), and the heartbeat ("12 tools · 8m 11s") as secondary detail.',
    sizes: 'Desktop: the identifier, title and workspace share one line. Phone 390px: the parts wrap onto the next line; nothing scrolls sideways.',
    states: 'Working (the bar breathes while motion is allowed); waiting on you (its word says so and the question it asks is shown); a stale working lane leaves the rail after an hour (today\'s behaviour, kept).',
    theme: 'Light and dark: the bar and state word take the state tokens; prose in the content face, the identifier, times and heartbeat in the structural (mono) face.'
  },
  {
    id: 'stream-row',
    name: 'Live run row',
    purpose: 'One moment that happened: a stage started, finished or failed; a run started waiting on you; a PR opened; a stage was stopped. Each row names its run and links to it.',
    parts: 'Glyph, task (to the run page, else to the task page), the action word, the summary, the workspace name, and a relative time with the exact local time, zone named, on hover.',
    sizes: 'Desktop: one line. Phone 390px: the summary wraps under the task; the time stays at the end of its line.',
    states: 'Started, finished, failed, stopped, waiting on you, evidence (a link to the artifact). A new row slides in while motion is allowed. A status row and the derived moment it describes show once.',
    theme: 'Light and dark: the glyph takes the kind\'s state token; the summary is prose, the identifier and time the structural face.'
  },
  {
    id: 'timeline-key',
    name: 'Timeline key',
    purpose: 'What the bars, ticks and range controls say, in words. Each bar\'s full label is read in the detail line under the key, so no label is cut off without a way to read it.',
    parts: 'The key sentence (amber running, green done, red failed; a tick is a check-in). The detail line: the bar\'s task and stage, its ticket progress and check-ins, and an "open run →" link. Each range group has a visible label that says what it sets ("Strip", "Timeline").',
    sizes: 'Desktop and phone: the key and the detail line wrap; the axis shows times at the ends and middle of the window.',
    states: 'No bar read yet ("Hover or focus a bar to read it"); a bar read by hover, focus or a first touch tap; a second tap on the same bar opens its run.',
    theme: 'Light and dark: the bar colours are the state tokens; the key and detail are prose in the content face.'
  },
];

// Live samples (LIN-3950): each piece is drawn by the builder the Settings pages use, not by hand. A
// sample sits in an `inert` wrapper, so its forms and links do nothing. Its phone root is the wrapper
// (`.settings-shell`, settings.css): rows take its size at every width, matching the sizes above.
// The key row is given a fixed clock, so the page is byte-stable.
const SAMPLE_NOW = Date.parse('2026-01-15T12:00:00.000Z');
const SAMPLE_OPEN = '<div class="settings-shell sg-settings-sample" inert>';
const SAMPLE_END = '<!-- /sg-settings-sample -->';
// LIN-3987: the sample hints are the same words the pages print (routingWords), not hand-written strings.
const SAMPLE_WORDS = {
  claude: routingWords({ harness: 'claude-code', model: null, effort: null }),
  opencode: routingWords({ harness: 'opencode', model: null, effort: null })
};
const SETTINGS_SAMPLES = {
  // LIN-3962: one panel, two pages. Models' names its fields and carries the job's numbers; Home's has no names
  // and sits on the run's own draft. Both are the component's own output, so the sample cannot show a look the code does not make.
  // Each sample has its own caption and sits apart from the next, so the two never read as one panel (LIN-3962 review).
  'decision-panel': () => `<div class="sg-decision-sample">
      <p class="sg-decision-caption">Models: a job’s panel, with its numbers. An effort outside the set is shown and kept.</p>
      ${decisionPanel({
        testid: 'sg-decision-models',
        numbers: { testid: 'sg-spend-models', shareTestid: 'sg-share-models', heading: 'Last 30 days', runs: 4, priced: 3, unpriced: 1, noTelemetry: 0, spendUsd: 1.2, typicalUsd: 0.4, share: 0.6 },
        harness: { value: 'claude-code', inForce: 'claude-code', follow: `Follow Make (${SAMPLE_WORDS.claude.harness})` },
        model: { value: null, follow: `Follow Make (${SAMPLE_WORDS.claude.model})`, lists: agentLists([]), suggestions: suggestionsByHarness([]) },
        effort: { value: 'turbo', follow: `Follow Make (${SAMPLE_WORDS.claude.effort})` },
        nameOf: (field) => `c__job__agent-session__sample__${field}`,
        fieldAttrs: (field) => `data-models-field="${field}"`,
        autoSwitch: true, clearEffort: true
      })}
    </div><div class="sg-decision-sample">
      <p class="sg-decision-caption">Home: a run that follows Settings, with OpenCode in force, where effort is hidden.</p>
      ${decisionPanel({
        testid: 'sg-decision-home',
        harness: { value: null, inForce: 'opencode', follow: 'From Models', hint: `Right now: ${SAMPLE_WORDS.opencode.harness}` },
        model: { value: 'openai/gpt-5.5', follow: 'From Models', hint: `Right now: ${SAMPLE_WORDS.opencode.model}`, lists: { any: [] }, suggestions: {} },
        effort: { value: null, follow: 'From Models', hint: `Right now: ${SAMPLE_WORDS.opencode.effort}` },
        fieldAttrs: (field) => `data-testid="sg-run-${field}"`
      })}
    </div>`,
  'switch-row': () => switchRow({ key: 'sample', label: 'Keep a copy of changes', on: true, action: '#' }),
  'value-row': () => drillRow({ label: 'Model', value: 'claude-sonnet-5-5', bodyHtml: groupNote('Opens in place to show more.') })
    + drillRow({ label: 'Runs', value: '12', href: '#' }),
  'action-row': () => actionRow({ label: 'Add a source', tone: 'teal', action: '#' })
    + actionRow({ label: 'Stop running', tone: 'red', action: '#' }),
  'ask-in-place': () => askInPlace({
    summary: 'Stop the workspace', willHappen: 'Running work stops at the next step. Nothing is lost.',
    askWhy: true, action: '#', confirmLabel: 'Stop', tone: 'red', cancelHref: '#',
  }),
  'status-line': () => statusLine({ tone: 'ok', text: 'Saved. It applies to the next run.' })
    + statusLine({ tone: 'bad', text: 'Could not save. Try again.' }),
  'note': () => groupNote('Applies to every run, not only the next one.'),
  'group-title': () => group({ title: 'For you', rowsHtml: staticRow({ label: 'Name', valueHtml: 'Sample' }) }),
  'key-row': () => keyRow({
    label: 'laptop', kind: 'dispatch', source: 'dispatch', expiresAt: '2026-04-15T12:00:00.000Z',
    lastUsedAt: '2026-01-15T09:00:00.000Z', hasOwner: true, waiting: false, can: 'Dispatches prompts',
    revoke: { allowed: true, route: '#' },
  }, { now: SAMPLE_NOW, cancelHref: '#' }),
  'area-frame': () => renderSettingsShell({
    urlKey: 'sample', states: {}, area: AREAS.find(a => a.id === 'account'), view: 'area',
    bodyHtml: groupNote('The area body goes here.'),
  }),
  'sidebar-state': () => renderSettingsNav({
    urlKey: 'sample', current: 'account',
    states: { sources: { text: 'ok', tone: 'ok' }, running: { text: 'paused', tone: 'warn' }, health: { text: 'stopped', tone: 'bad' } },
  }),
};

// The Plain layout (LIN-3950), one sample of every section kind. It sits inside the page's own
// frame, so it is a wrapper and not a second <main>. It takes no `.settings-shell` wrapper: `.plain-page`
// owns the phone root its rows need (LIN-3956), and `inert` keeps its form from doing anything.
const PLAIN_SAMPLE_SECTIONS = [
  { kind: 'html', title: 'Prose', body: '<p>Prose with a <a href="#">link</a>. Trusted markup goes here.</p>' },
  { kind: 'fields', title: 'Fields', fields: [{ label: 'Email', value: 'you@example.com' }, { label: 'Plan', value: 'Free' }] },
  { kind: 'rows', title: 'Rows', rowsHtml: switchRow({ key: 'plain', label: 'Keep a copy of changes', on: true, action: '#' }), note: 'A note sits under the group.' },
  { kind: 'form', title: 'Form', action: '#', method: 'POST', fields: [{ name: 'label', label: 'Label', value: 'Sample' }], submitLabel: 'Save' },
  { kind: 'empty', title: 'Empty', text: 'Nothing here yet.' },
];
const plainSample = () => `<div class="plain-page sg-settings-sample sg-plain-sample" inert>${renderPlainSections(PLAIN_SAMPLE_SECTIONS, 'h3')}</div>`;

const settingsPieceSection = (piece) => `<div class="sg-settings-piece" id="settings-piece-${piece.id}" data-testid="styleguide-settings-${piece.id}">
        <h4 class="sg-settings-piece-name">${piece.name}</h4>
        <dl class="sg-settings-anatomy">
          <dt>Purpose</dt><dd>${piece.purpose}</dd>
          <dt>Parts</dt><dd>${piece.parts}</dd>
          <dt>Sizes</dt><dd>${piece.sizes}</dd>
          <dt>States</dt><dd>${piece.states}</dd>
          <dt>Light and dark</dt><dd>${piece.theme}</dd>
        </dl>
        ${SAMPLE_OPEN}${SETTINGS_SAMPLES[piece.id]()}</div>${SAMPLE_END}
      </div>`;

// Task page pieces (LIN-3975). The run control is the shared PromptSection (drawn on Home and Swipe above, so it has
// no sample here). These entries carry the anatomy of the pieces the task page owns: its top answer, the moment,
// a step still ahead, and an attempt's link to its run.
export const TASK_PAGE_PIECES = [
  {
    id: 'top-answer',
    name: 'Top answer',
    purpose: 'Where the task is and what it needs, in the reader\'s words, before anything else on the page. It says which state is Harbour\'s and which is the tracker\'s, so a reader never has to guess which "idle" or "In Progress" is meant.',
    parts: 'The tracker line, "Tracker: In Review" (the tracker\'s own word, from the page-load read, outside what a poll repaints). The status pill, labelled "Harbour:", with the sentence beside it (relative: "Build running for 6 minutes"), and the moment the sentence is about, as a tap time.',
    sizes: 'Desktop: the tracker line, the pill and the sentence each take one line. Phone 390px: the pill and sentence wrap; the answer and the run control stay on the first screen.',
    states: 'Idle, running, waiting on you, failed (what failed, and that it can be run again), ready to merge, finished, nothing yet. A poll repaints the pill and sentence and never the tracker\'s word.',
    theme: 'Light and dark: the pill takes its state token; the tracker line and the Harbour label are muted text; the sentence is the content face.'
  },
  {
    id: 'task-time',
    name: 'Moment (tap for exact time)',
    purpose: 'A moment on the page, in the words a reader takes in at a glance ("2 hours ago"), with the exact time one tap away. A hover tooltip does not work on a phone, so the exact time is the tap, not the hover.',
    parts: 'The relative words, as the text of a time element with its ISO datetime. A tap, or Enter when focused, shows the exact time in the reader\'s own zone with the zone named (for example "26 Oct, 13:04 BST"); the same tap shows the words again. The UTC time is the title, for a reader without script.',
    sizes: 'One line everywhere; the exact time replaces the words in place, so it never pushes a neighbour off the line.',
    states: 'Words (the default), exact (after a tap or Enter, aria-expanded true). A moment with no usable time draws nothing.',
    theme: 'Light and dark: the text takes the colour of its line; the focus ring is the house focus ring.'
  },
  {
    id: 'quiet-step',
    name: 'Step still ahead',
    purpose: 'A step the task has not reached is one quiet line, so the stages read as a story. A column of empty dashed boxes read as things to fill in.',
    parts: 'The stage name, and "usually next" (or the reason it is next, when the next-step rule gives one). No bar, no box.',
    sizes: 'One line; the same height on a phone and on desktop.',
    states: 'Ahead (quiet). A step that has run is a stage with its attempts, not this line.',
    theme: 'Light and dark: the name takes the body colour, the state word the muted colour.'
  },
  {
    id: 'attempt-run-link',
    name: 'Attempt run link',
    purpose: 'Each attempt links to the run page where its run is shown. An attempt the run page cannot open says why, in plain words, rather than linking to a page that would not open.',
    parts: 'The attempt line ("attempt 2 · done · 26 Oct, 13:04 BST"), then "open run ›" to the run page. An attempt older than the run page\'s 30-day window reads "older than 30 days: no run page". A guest gets neither the link nor the reason, since a guest has no run page.',
    sizes: 'The link sits at the end of the attempt line and wraps under it on a phone.',
    states: 'Linked (the run page resolves it), unlinked with the reason (aged out, or no session), nothing (a guest).',
    theme: 'Light and dark: the link takes the brand colour; the reason is muted.'
  },
];

const taskPagePieceSection = (piece) => `<div class="sg-settings-piece" id="task-page-piece-${piece.id}" data-testid="styleguide-task-page-${piece.id}">
        <h4 class="sg-settings-piece-name">${piece.name}</h4>
        <dl class="sg-settings-anatomy">
          <dt>Purpose</dt><dd>${piece.purpose}</dd>
          <dt>Parts</dt><dd>${piece.parts}</dd>
          <dt>Sizes</dt><dd>${piece.sizes}</dd>
          <dt>States</dt><dd>${piece.states}</dd>
          <dt>Light and dark</dt><dd>${piece.theme}</dd>
        </dl>
      </div>`;

const liveConsolePieceSection = (piece) => `<div class="sg-settings-piece" id="live-console-piece-${piece.id}" data-testid="styleguide-live-console-${piece.id}">
        <h4 class="sg-settings-piece-name">${piece.name}</h4>
        <dl class="sg-settings-anatomy">
          <dt>Purpose</dt><dd>${piece.purpose}</dd>
          <dt>Parts</dt><dd>${piece.parts}</dd>
          <dt>Sizes</dt><dd>${piece.sizes}</dd>
          <dt>States</dt><dd>${piece.states}</dd>
          <dt>Light and dark</dt><dd>${piece.theme}</dd>
        </dl>
      </div>`;

// Color tokens shipped in :root. `kind: 'border'` tokens are demoed as a box
// outline rather than a fill so low-contrast hairlines are visible.
const COLOR_TOKENS = [
  { name: '--bg', value: '#ffffff', kind: 'fill' },
  { name: '--bg-muted', value: '#f8f9fa', kind: 'fill' },
  { name: '--bg-alt', value: 'rgba(0, 0, 0, 0.03)', kind: 'fill' },
  { name: '--fg', value: '#1a1a1a', kind: 'fill' },
  { name: '--fg-dim', value: '#666666', kind: 'fill' },
  { name: '--fg-vdim', value: '#eeeeee', kind: 'fill' },
  { name: '--fg-mid', value: '#bbbbbb', kind: 'fill' },
  { name: '--green', value: '#16a34a', kind: 'fill' },
  { name: '--ok', value: '#2a8f4e', kind: 'fill' },
  { name: '--teal', value: '#0d9488', kind: 'fill' },
  { name: '--teal-soft', value: '#0d948820', kind: 'fill' },
  { name: '--on-brand', value: '#001512', kind: 'fill' },
  { name: '--yellow', value: '#d4a600', kind: 'fill' },
  { name: '--blue', value: '#2563eb', kind: 'fill' },
  { name: '--purple', value: '#7c3aed', kind: 'fill' },
  { name: '--red', value: '#cc0000', kind: 'fill' },
  { name: '--red-hover', value: '#990000', kind: 'fill' },
  { name: '--accent', value: '#c33', kind: 'fill' },
  { name: '--border', value: '#ddd', kind: 'border' },
  { name: '--border-strong', value: '#ccc', kind: 'border' },
  { name: '--border-subtle', value: 'rgba(0, 0, 0, 0.08)', kind: 'border' }
];

// LIN-785 semantic vocabulary + running-status palette. In light these alias the
// raw tokens above (so they are a visual no-op); S2 primitives consume these names.
const SEMANTIC_TOKENS = [
  { name: '--text', value: 'var(--fg)', kind: 'fill' },
  { name: '--muted', value: 'var(--fg-dim)', kind: 'fill' },
  { name: '--faint', value: 'var(--fg-vdim)', kind: 'fill' },
  { name: '--card', value: 'var(--bg-muted)', kind: 'fill' },
  { name: '--card-h', value: 'var(--bg-alt)', kind: 'fill' },
  { name: '--raised', value: 'var(--bg)', kind: 'fill' },
  { name: '--inset', value: 'var(--bg-alt)', kind: 'fill' },
  { name: '--brand', value: 'var(--teal)', kind: 'fill' },
  { name: '--brand-dim', value: '#0f766e', kind: 'fill' },
  { name: '--green-dim', value: '#15803d', kind: 'fill' },
  { name: '--amber', value: '#FFB224', kind: 'fill' },
  { name: '--amber-dim', value: '#8a5a00', kind: 'fill' },
  { name: '--red-dim', value: '#b91c1c', kind: 'fill' },
  { name: '--slate', value: '#64748b', kind: 'fill' },
  { name: '--slate-dim', value: '#475569', kind: 'fill' },
  { name: '--focus', value: '#0d6efd', kind: 'fill' },
  { name: '--line', value: 'var(--border)', kind: 'border' },
  { name: '--line-soft', value: 'var(--border-subtle)', kind: 'border' }
];

const MOTION_TOKENS = [
  { name: '--motion-fast', value: '120ms' },
  { name: '--motion-base', value: '240ms' },
  { name: '--motion-pulse', value: '1.6s' }
];

const FONT_TOKENS = [
  { name: '--font-structural', sample: 'Structural ├─ └─ 0123' },
  { name: '--font-content', sample: 'Readable content type' },
  { name: '--font-mono', sample: 'Generic monospace 0123' }
];

const FONT_SIZE_TOKENS = [
  { name: '--font-size-sm', value: '0.85em' },
  { name: '--font-size-base', value: '1em' },
  { name: '--font-size-lg', value: '1.25em' }
];

const SPACE_TOKENS = [
  { name: '--space-1', value: '0.25rem' },
  { name: '--space-2', value: '0.5rem' },
  { name: '--space-3', value: '1rem' },
  { name: '--space-4', value: '1.5rem' },
  { name: '--space-5', value: '2rem' }
];

const RADIUS_TOKENS = [
  { name: '--radius-sm', value: '5px' },
  { name: '--radius-md', value: '8px' },
  { name: '--radius-lg', value: '14px' },
  { name: '--radius-full', value: '999px' }
];

const SHADOW_TOKENS = [
  { name: '--shadow-sm', value: '0 1px 2px rgba(0, 0, 0, 0.05)' },
  { name: '--shadow-md', value: '0 2px 8px rgba(0, 0, 0, 0.1)' },
  { name: '--shadow-lg', value: '0 8px 24px rgba(0, 0, 0, 0.12)' },
  { name: '--shadow', value: 'var(--shadow-md)' }  // LIN-785 default elevation alias
];

const Z_TOKENS = [
  { name: '--z-base', value: '1' },
  { name: '--z-sticky', value: '100' },
  { name: '--z-overlay', value: '1000' }
];

// CLI/terminal state glyphs (public/llms.txt, render.js). Part of the aesthetic
// primitives the baseline must lock in alongside the raw tokens.
const STATE_GLYPHS = [
  { glyph: '✓', token: '--green', label: 'done' },
  { glyph: '◐', token: '--yellow', label: 'in progress' },
  { glyph: '○', token: '--fg-dim', label: 'todo' }
];

function colorSwatch({ name, value, kind }) {
  const chipStyle = kind === 'border'
    ? `border-color: var(${name})`
    : `background: var(${name})`;
  return `<figure class="sg-swatch">
        <div class="sg-chip sg-chip--${kind}" style="${chipStyle}"></div>
        <figcaption><code class="sg-name">${name}</code><span class="sg-value">${value}</span></figcaption>
      </figure>`;
}

// One row per icon in the §10 set, demoed at text size with currentColor.
function iconRow(name) {
  return `<div class="sg-icon-cell">
          ${renderIcon({ name, title: name })}
          <code class="sg-name">${name}</code>
        </div>`;
}

// The full S2 primitive set (LIN-786), rendered token-only so it resolves to
// whichever .theme-* wraps it. Shared by the standalone "Primitives" section and
// each theme panel so every primitive is demoed in BOTH light and dark.
function primitivesDemo() {
  return `<div class="sg-primitive-grid">
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Run-status pill</span>
          <div class="sg-primitive-row">
            ${renderStatusPill({ state: 'running', label: 'running', dot: true })}
            ${renderStatusPill({ state: 'done', label: 'done', dot: true })}
            ${renderStatusPill({ state: 'error', label: 'error', dot: true })}
            ${renderStatusPill({ state: 'queued', label: 'queued', dot: true })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Button</span>
          <div class="sg-primitive-row">
            ${renderButton({ label: 'default' })}
            ${renderButton({ label: 'primary', variant: 'primary' })}
            ${renderButton({ label: 'ghost', variant: 'ghost' })}
            ${renderButton({ label: 'with icon', icon: renderIcon({ name: 'spark' }) })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Tabs (LIN-3983)</span>
          <div class="sg-primitive-row">
            ${renderTabs({ ariaLabel: 'demo views', testIdPrefix: 'sg-tab', activeKey: 'runs', tabs: [{ key: 'runs', label: 'Runs' }, { key: 'rulings', label: 'Rulings' }, { key: 'due', label: 'Scan-due' }] })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Icon button</span>
          <div class="sg-primitive-row">
            ${renderIconButton({ icon: renderIcon({ name: 'check' }), label: 'approve' })}
            ${renderIconButton({ icon: renderIcon({ name: 'branch' }), label: 'branch', variant: 'ghost' })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Tag &amp; Chip</span>
          <div class="sg-primitive-row">
            ${renderTag({ label: 'research', count: 3 })}
            ${renderTag({ label: 'brand', tone: 'brand' })}
            ${renderChip({ label: 'LIN-786' })}
            ${renderChip({ label: 'feat/theme-s2' })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Accent bar</span>
          <div class="sg-primitive-stack">
            ${renderAccentBar({ state: 'running', label: 'running' })}
            ${renderAccentBar({ state: 'done', label: 'done' })}
            ${renderAccentBar({ state: 'error', label: 'error' })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Segment bar</span>
          ${renderSegmentBar({ ariaLabel: 'worker runs: 2 done, 1 running, 1 queued', segments: [
            { state: 'done', title: 'done' },
            { state: 'done', title: 'done' },
            { state: 'running', title: 'running' },
            { state: 'queued', title: 'queued' }
          ] })}
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Disclosure</span>
          ${renderDisclosure({ summary: 'Activity log (3)', body: '<p>Disclosed body content on this theme’s surface.</p>' })}
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Surface / InsetPanel</span>
          <div class="sg-primitive-stack">
            ${renderSurface({ body: '<p>Default surface (<code>--card</code>).</p>' })}
            ${renderSurface({ variant: 'inset', body: '<p>Inset panel (<code>--inset</code> well).</p>' })}
          </div>
        </div>
      </div>`;
}

export function renderStyleguide() {
  // No deployInfo: keep the footer (and thus the page) byte-stable for the
  // visual-regression baseline. isLanding hides workspace/AI chrome.
  const footerHtml = renderPageFooter({ isLanding: true, currentPage: '/styleguide' });

  const colorSwatches = COLOR_TOKENS.map(colorSwatch).join('\n        ');
  const semanticSwatches = SEMANTIC_TOKENS.map(colorSwatch).join('\n        ');

  const motionRows = MOTION_TOKENS.map(({ name, value }) =>
    `<div class="sg-font-row">
          <span class="sg-space-bar" style="transition: width var(${name}) ease; width: 4rem"></span>
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  const fontSamples = FONT_TOKENS.map(({ name, sample }) =>
    `<div class="sg-font-row">
          <p class="sg-font-sample" style="font-family: var(${name})">${sample}</p>
          <code class="sg-name">${name}</code>
        </div>`).join('\n        ');

  const fontSizeSamples = FONT_SIZE_TOKENS.map(({ name, value }) =>
    `<div class="sg-font-row">
          <p class="sg-font-sample" style="font-size: var(${name})">The quick brown fox</p>
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  const spaceBars = SPACE_TOKENS.map(({ name, value }) =>
    `<div class="sg-space-row">
          <div class="sg-space-bar" style="width: var(${name})"></div>
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  // Layout clearance token (LIN-984): the pinned shared-header height reserved
  // as `scroll-margin-top` on interactive controls (so they don't scroll under
  // the sticky nav) and as the offset for page-fixed near-top controls. Shown
  // as a length bar alongside the spacing scale, not part of the scale itself.
  const navClearanceBar =
    `<div class="sg-space-row">
          <div class="sg-space-bar" style="width: var(--nav-sticky-h)"></div>
          <code class="sg-name">--nav-sticky-h</code><span class="sg-value">6rem (7.75rem ≤640px) — sticky header clearance</span>
        </div>`;

  const radiusBoxes = RADIUS_TOKENS.map(({ name, value }) =>
    `<figure class="sg-swatch">
        <div class="sg-box" style="border-radius: var(${name})"></div>
        <figcaption><code class="sg-name">${name}</code><span class="sg-value">${value}</span></figcaption>
      </figure>`).join('\n        ');

  const shadowBoxes = SHADOW_TOKENS.map(({ name, value }) =>
    `<figure class="sg-swatch">
        <div class="sg-box" style="box-shadow: var(${name})"></div>
        <figcaption><code class="sg-name">${name}</code><span class="sg-value">${value}</span></figcaption>
      </figure>`).join('\n        ');

  // Exercise z-index tokens by stacking offset boxes; later tokens sit on top.
  const zStack = Z_TOKENS.map(({ name, value }, i) =>
    `<div class="sg-z-card" style="z-index: var(${name}); left: ${i * 2.5}rem; top: ${i * 1.25}rem">
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  const glyphs = STATE_GLYPHS.map(({ glyph, token, label }) =>
    `<div class="sg-glyph-row">
          <span class="sg-glyph" style="color: var(${token})">${glyph}</span>
          <span class="sg-glyph-label">${label}</span>
          <code class="sg-name">${token}</code>
        </div>`).join('\n        ');

  // A representative cross-section of leaf + larger components, rendered once
  // per theme so theme impact is visible at-a-glance. Tokens inside resolve to
  // whichever .theme-* class wraps the panel (or :root for the default panel).
  const themePanel = (themeClass, label) => {
    const swatches = ['--bg-muted', '--green', '--yellow', '--blue', '--red']
      .map(t => `<span style="background: var(${t})"></span>`).join('');
    return `<div class="sg-theme-panel ${themeClass}">
        <p class="sg-theme-label">${label}</p>
        <div class="sg-theme-swatches">${swatches}</div>
        <div class="sg-theme-row">
          ${STATE_GLYPHS.map(({ glyph, token, label: l }) =>
            `<span class="sg-glyph" style="color: var(${token})" title="${l}">${glyph}</span>`).join('')}
        </div>
        <div class="sg-theme-row">
          ${renderStatusPill({ state: 'done', label: 'done' })} ${renderStatusPill({ state: 'in-progress', label: 'in progress' })} ${renderStatusPill({ state: 'todo', label: 'todo' })} ${renderStatusPill({ state: 'failed', label: 'failed' })}
        </div>
        ${renderCard({ accent: 'in-progress', title: 'Sample card', meta: 'in progress', body: '<p>A larger component on this theme’s surface.</p>' })}
        <div class="sg-theme-row">
          ${renderButton({ label: 'save', quiet: true, tone: 'green' })}
          ${renderButton({ label: 'connect', quiet: true, tone: 'blue' })}
          ${renderButton({ label: 'disconnect', quiet: true, tone: 'red' })}
        </div>
        ${primitivesDemo()}
        ${plainSample()}
      </div>`;
  };

  return renderPage({
    title: 'Style Guide - Harbour',
    stylesheets: ['/style.css', '/common-actions.css', '/settings.css', '/styleguide.css'],
    bodyClass: 'is-landing',
    followSystemTheme: true,
    headExtra: '<meta name="robots" content="noindex">',
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="plain-page styleguide-content">
    <h2 class="plain-title">Style Guide</h2>
    <p class="sg-intro">A static reference of every design token shipped in <code>:root</code>, rendered live via <code>var(--token)</code>. This page is the visual-regression baseline; it intentionally carries no live data.</p>

    ${sgSection('Color', `<div class="sg-grid">
        ${colorSwatches}
      </div>`)}

    ${sgSection('Semantic tokens', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The LIN-785 semantic vocabulary (surfaces, text, lines, brand) plus the running-status palette (<code>--amber</code>/<code>--slate</code> + AA-safe <code>-dim</code> text companions). In light these alias the raw tokens, so adding them is a visual no-op; S2 primitives consume these names.</p>
      <div class="sg-grid">
        ${semanticSwatches}
      </div>`)}

    ${sgSection('Motion', `<p class="sg-intro" style="margin-bottom: var(--space-3)">Tokenized durations (LIN-785 §7) for the <code>pulse</code> / <code>shimmer</code> keyframes; neutralized under <code>prefers-reduced-motion</code>.</p>
      <div class="sg-stack">
        ${motionRows}
      </div>`)}

    ${sgSection('Typography — families', `<div class="sg-stack">
        ${fontSamples}
      </div>`)}

    ${sgSection('Typography — scale', `<div class="sg-stack">
        ${fontSizeSamples}
      </div>`)}

    ${sgSection('Spacing', `<div class="sg-stack">
        ${spaceBars}
        ${navClearanceBar}
      </div>`)}

    ${sgSection('Border radius', `<div class="sg-grid">
        ${radiusBoxes}
      </div>`)}

    ${sgSection('Elevation', `<div class="sg-grid">
        ${shadowBoxes}
      </div>`)}

    ${sgSection('Z-index', `<div class="sg-z-stack">
        ${zStack}
      </div>`)}

    ${sgSection('State glyphs', `<div class="sg-stack">
        ${glyphs}
      </div>
      <pre class="sg-tree">├─ parent task
│  ├─ subtask
│  └─ subtask
└─ sibling</pre>`)}

    ${sgSection('Section component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>section</code> server component (LIN-461). Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderSection({ boxed: true, title: 'Boxed section', body: `<p>The <code>--boxed</code> variant (dispatch / proxy / settings): <code>--space-3</code> padding, <code>--bg-alt</code> fill, <code>--radius-sm</code> corners.</p>` })}
      ${renderSection({ titleVariant: 'ruled', title: 'Ruled header', body: `<p>The <code>--ruled</code> heading modifier (prompts catalog): an underlined section title.</p>` })}`)}

    ${sgSection('Page header component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>pageHeader</code> server component (LIN-462): the page-level <code>&lt;h1&gt;</code> + optional tagline. Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderPageHeader({ title: 'Title only' })}
      ${renderPageHeader({ title: 'Title with subtitle', subtitle: 'The tagline rides under the heading via .page-header__subtitle.' })}`)}

    ${sgSection('Field component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>field</code> server component (LIN-463): a horizontal dim-label + value row (dispatch / proxy / settings). The value slot holds text, a status span, or a control. Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderField({ label: 'value:', value: 'plain text value' })}
      ${renderField({ label: 'repo:', valueHtml: '<code>JKershaw/LinearViewer</code>' })}
      ${renderField({ label: 'scope:', valueHtml: '<select><option>read-only</option><option>read-write</option></select>' })}`)}

    ${sgSection('Card component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>card</code> server component (LIN-468): a slot-based content card (<code>accent</code>, <code>title</code>, <code>meta</code>, <code>labels</code>, <code>body</code>). Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderCard({ title: 'Plain card', meta: '128 chars', body: '<p>A <code>title</code> + <code>meta</code> + <code>body</code> card: token hairline, <code>--bg-alt</code> fill, <code>--radius-sm</code> corners.</p>' })}
      ${renderCard({ accent: 'in-progress', title: 'Accented card', meta: 'in progress', body: '<p>The <code>accent</code> slot adds a state-colored left border (<code>in-progress | done | todo | backlog | failed</code>).</p>' })}
      ${renderCard({ accent: 'done', title: 'Labelled card', labels: '<span>research</span><span>plan</span>', body: '<p>The <code>labels</code> slot holds the chip row; chip styling itself is owned by a later task.</p>' })}`)}

    ${sgSection('Status pill component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>statusPill</code> server component (LIN-465): a state→glyph+label chip sharing <code>card</code>'s state vocabulary (<code>in-progress | done | todo | backlog | failed</code>) and Phase-0 color tokens. Ship and swipe render this class alongside their per-page pill classes. Variants below are the visual-regression lock.</p>
      <div class="sg-stack">
        <div>${renderStatusPill({ state: 'done', label: 'done' })} ${renderStatusPill({ state: 'in-progress', label: 'in progress' })} ${renderStatusPill({ state: 'todo', label: 'todo' })} ${renderStatusPill({ state: 'backlog', label: 'backlog' })} ${renderStatusPill({ state: 'failed', label: 'failed' })}</div>
        <div>${renderStatusPill({ state: 'done' })} ${renderStatusPill({ state: 'in-progress' })} ${renderStatusPill({ state: 'todo' })} ${renderStatusPill({ char: '◐', label: 'glyph override' })} ${renderStatusPill({ variant: 'tag', label: 'neutral tag' })}</div>
        <div>${renderStatusPill({ state: 'done', char: '✓', variant: 'bare' })} ${renderStatusPill({ state: 'in-progress', char: '◐', variant: 'bare' })} ${renderStatusPill({ state: 'todo', char: '○', variant: 'bare' })} ${renderStatusPill({ state: 'backlog', char: '◌', variant: 'bare' })} <code>bare</code> variant — box-less inline glyphs for the LIN-782-locked project tree (LIN-850)</div>
      </div>`)}

    ${sgSection('Empty state component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>emptyState</code> server component (LIN-466): the "nothing here yet" placeholder. The per-page looks (custom-prompts, roadmap, swipe, and the newer page-local variants) genuinely diverge, so the canonical <code>.emptyState</code> class carries only the shared dim foreground and composes with each retained per-page variant class. Convergence onto one look is still open; the base look below is the visual-regression lock.</p>
      <div class="sg-stack">
        ${renderEmptyState({ text: 'No items yet. Create one to get started.' })}
        ${renderEmptyState({ tag: 'p', text: '○ queue empty' })}
      </div>`)}

    ${sgSection('Buttons & inputs', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The button builder (<code>lib/components/button.js</code>) renders each live look: the bordered base, the quiet look and its tones, drawn by the same classes the pages emit. The token input has no builder yet, so it stays hand-written (<code>public/common-actions.css</code>).</p>
      <div class="sg-controls">
        ${BUTTON_LOOKS.map(buttonSample).join('')}
        <input class="token-label-input" type="text" placeholder="token label…" aria-label="token label">
      </div>`)}

    ${sgSection('Primitives', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The Theme S2 primitive set (LIN-786 §9): the theme-owned, page-agnostic building blocks LIN-783 composes. Every primitive reads the semantic token layer only — no page logic, no raw colour. Interactive members inherit the global <code>:focus-visible</code> ring; primary <code>Button</code> and <code>IconButton</code> meet the 40px touch-target floor; run-status and segment cells expose state via label/<code>title</code>, never colour alone. Each is shown again in both themes under <em>Themes</em> below.</p>
      ${primitivesDemo()}`)}

    ${sgSection('Iconography', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The minimal line-icon set (LIN-786 §10): inline <code>&lt;svg&gt;</code> stroked in <code>currentColor</code>, so each icon inherits its text colour and themes for free. Sizing is owned by <code>.icon</code> (1em square).</p>
      <div class="sg-icon-grid">
        ${ICON_NAMES.map(iconRow).join('\n        ')}
      </div>`)}

    ${sgSection('Settings pieces', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The pieces every Settings area is built from (LIN-3890). Each has its anatomy written here and a live sample drawn by its builder in <code>lib/components/</code> (LIN-3950), inside an inert wrapper. Styles are owned by <code>public/settings.css</code>, which this page links.</p>
      <div class="sg-settings-anatomy-list">
        ${SETTINGS_PIECES.map(settingsPieceSection).join('\n        ')}
      </div>`)}

    ${sgSection('Task page pieces', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The pieces the task page is built from (LIN-3975). Each has its anatomy written here. The run control is the shared panel above, so it has no sample of its own on this page.</p>
      <div class="sg-settings-anatomy-list">
        ${TASK_PAGE_PIECES.map(taskPagePieceSection).join('\n        ')}
      </div>`)}

    ${sgSection('Live Console pieces', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The pieces the Live Console is built from (LIN-3977). Each has its anatomy written here. The lane and stream rows are drawn by <code>public/live-console.js</code>, so they have no live sample on this page; the run page and the other pages that name a run reuse the same words.</p>
      <div class="sg-settings-anatomy-list">
        ${LIVE_CONSOLE_PIECES.map(liveConsolePieceSection).join('\n        ')}
      </div>`)}

    ${sgSection('Plain page', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The Plain layout (LIN-3950), built once from the shared pieces: sections, fields, rows, a form and an empty state. The Legal pages, and the other Plain pages after them, are drawn from it. One sample of each section kind, in the page's own theme and in each theme panel below.</p>
      ${plainSample()}`)}

    ${sgSection('Themes', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The same components rendered under each theme so the impact of different themes is visible at-a-glance. A theme is a pure override of the color tokens via the <code>.theme-*</code> hook (<code>public/style.css</code>); the structural tokens stay shared and the default (light) is <code>:root</code>, so every existing page renders unchanged.</p>
      <div class="sg-theme-grid">
        ${themePanel('', 'light (default — :root)')}
        ${themePanel('theme-dark', 'dark (.theme-dark)')}
      </div>`)}
  </main>
  ${footerHtml}`
  });
}
