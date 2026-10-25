/**
 * Settings › workspace areas built from the shell's rows (LIN-3846): Running,
 * Agent access and Change log. (Sources, Models and Health keep the existing
 * builders in render-settings.js, which they wrap.)
 *
 * Who a setting affects is in the group title; a change for everyone asks why
 * in place (`askInPlace` with `askWhy`) and lands in the change log. Halt is a
 * request the runner honours, so the controls are owner-only: a member sees
 * the state and a note instead of the buttons. The routes refuse a member too
 * (routes/settings.js, lib/runner-owner-gate.js); the note is not the guard.
 */

import { escapeHtml } from './utils/html.js';
import { formatRelativeTime } from './render.js';
import { UNNAMED_MEMBER } from './workspace-change-log.js';
import { drillRow, actionRow, staticRow } from './components/settings-row.js';
import { askInPlace } from './components/settings-ask.js';
import { group, statusLine } from './components/settings-group.js';
import { haltControls } from './components/halt-controls.js';

const workspaceUrl = (urlKey, suffix) => `/workspace/${encodeURIComponent(urlKey)}${suffix}`;

const noteHtml = (text, testid = '') => `<p class="settings-note"${testid ? ` data-testid="${escapeHtml(testid)}"` : ''}>${escapeHtml(text)}</p>`;

// LIN-3890: Settings times are relative ("in 89d", "3h ago") through the one
// formatter in lib/render.js, not exact UTC stamps. `now` is injected by the
// caller so a test can freeze the clock; without it the formatter reads Date.now()
// a second time and an elapsed millisecond can turn "in 2d" into "in 1d".
const when = (iso, now) => formatRelativeTime(iso, now);

const HALT_VALUE = { none: 'Running', pause: 'Paused', stop: 'Stopped' };

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/**
 * The latest undoable change to one setting, offered on the row it changed (LIN-3890 outcome 4:
 * Undo sits on the row, in place of a flash). Empty when there is none, or when the viewer may not
 * undo it (a halt change is owner-only, routes/settings.js).
 */
export function undoRowFor(changeRows = [], setting, { urlKey, isOwner = false, cancelHref = '' }) {
  const row = changeRows.find(r => r.source === 'workspace' && r.setting === setting && r.undoable);
  if (!row || (setting === 'halt' && !isOwner)) return '';
  return askInPlace({
    summary: 'Undo the last change', askWhy: true, tone: 'teal', confirmLabel: 'Undo this change',
    willHappen: 'This puts the setting back as it was before that change, and is logged as a new entry. It is refused if the setting has changed since.',
    action: workspaceUrl(urlKey, `/settings/change-log/${encodeURIComponent(row.source)}/${encodeURIComponent(row.id)}/undo`),
    cancelHref, testid: `settings-undo-${row.id}`
  });
}

/**
 * Running (LIN-3890 outcome 6): with no runner, no Pause, Stop or Resume is offered, because none can
 * apply. The Runs state shows only when there is a runner or the workspace is halted. Periodic reviews
 * is one row: its state is the control, and changing it asks in place.
 */
export function runningBody({
  urlKey, workspaceName = 'this workspace', isOwner = false, runSetup = false, hasRunner = false,
  lastPoll = null, haltMode = 'none', periodicals = false, error = null, changed = null, now = Date.now(),
  changeRows = []
}) {
  const cancelHref = workspaceUrl(urlKey, '/settings/running');
  const flash = error ? statusLine({ tone: 'bad', text: error, testid: 'settings-flash' })
    : (changed ? statusLine({ text: 'Saved.', testid: 'settings-flash' }) : '');

  const runnerRows = hasRunner
    ? `${staticRow({ label: 'Last poll', valueHtml: lastPoll ? `${escapeHtml(when(lastPoll.at, now))} · ${escapeHtml(lastPoll.kind)}` : 'not seen yet', testid: 'settings-runner-last-poll' })}${actionRow({ label: 'Runner set-up', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-guide', note: 'A new prompt leaves the old key working until it expires or is revoked.' })}`
    : (runSetup ? actionRow({ label: 'Set up a runner', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-setup' }) : '');
  const runnerNote = hasRunner
    ? 'Last poll is the runner key’s last use, not a heartbeat.'
    : 'No runner yet. Run buttons appear for the workspace owner once one is set up.';
  const runner = group({ title: 'Runner', testid: 'settings-section-runner', rowsHtml: runnerRows, note: runnerNote });

  // Pause / stop / resume are a request the runner applies, so they are offered only when a runner
  // can apply them (or, once halted, the clear). LIN-3890 outcome 3: Runs is one row whose state is the
  // control; opening it shows the asks. The controls are one implementation shared with Dispatch
  // (lib/components/halt-controls.js); the owner gate stays here.
  const halted = haltMode !== 'none';
  const runsValue = HALT_VALUE[haltMode] || HALT_VALUE.none;
  let haltRows = '';
  if (isOwner && (hasRunner || halted)) {
    haltRows = drillRow({
      label: 'Runs', value: runsValue, testid: 'settings-halt-state',
      bodyHtml: haltControls({
        presentation: 'ask', current: haltMode, action: workspaceUrl(urlKey, '/settings/running/halt'),
        only: hasRunner ? null : ['resume']
      })
    });
  } else if (hasRunner || halted) {
    haltRows = staticRow({ label: 'Runs', valueHtml: escapeHtml(runsValue), testid: 'settings-halt-state' })
      + (isOwner ? '' : staticRow({ label: 'Pause and stop', valueHtml: 'only the workspace owner', testid: 'settings-halt-owner-only' }));
  }
  const periodicalsRow = askInPlace({
    summary: 'Periodic reviews', value: periodicals ? 'On' : 'Off', valueTestid: 'settings-periodicals-state',
    willHappen: periodicals
      ? 'Periodic reviews stop appearing on Home for everyone in this workspace.'
      : 'Periodic reviews appear on Home for everyone in this workspace.',
    askWhy: true, tone: periodicals ? 'red' : 'teal', confirmLabel: periodicals ? 'Turn off' : 'Turn on',
    action: workspaceUrl(urlKey, '/settings/workspace-features'),
    fields: [['feature', 'periodicals'], ['enabled', periodicals ? 'false' : 'true']],
    cancelHref, testid: 'settings-toggle-periodicals'
  });
  const everyone = group({
    title: `For everyone in ${workspaceName}`,
    testid: 'settings-section-workspace-features',
    rowsHtml: `${haltRows}${periodicalsRow}${undoRowFor(changeRows, 'periodicals', { urlKey, isOwner, cancelHref })}${undoRowFor(changeRows, 'halt', { urlKey, isOwner, cancelHref })}`,
    note: 'Periodic reviews run by hand from Home, not on a schedule. Changes ask why.'
  });

  const links = group({
    title: 'Queue',
    rowsHtml: drillRow({ label: 'Queue and history', value: 'Dispatch', href: workspaceUrl(urlKey, '/dispatch'), testid: 'settings-link-dispatch' })
  });
  return `${flash}${runner}${everyone}${links}`;
}

// ---------------------------------------------------------------------------
// Agent access
// ---------------------------------------------------------------------------

// LIN-3890 outcome 7: the name leads, then the kind, the relative expiry and the last use. A
// problem is flagged on the row itself (no owner, waiting), and Revoke is an ask in place with
// a real Confirm and Cancel, sent through the DELETE route by the script transport.
function keyRow(k, now, urlKey) {
  const name = k.label || k.kind;
  const expiry = k.expiresAt ? `expires ${when(k.expiresAt, now)}` : 'no expiry';
  const used = k.lastUsedAt ? `last used ${when(k.lastUsedAt, now)}` : 'never used';
  const flags = [!k.hasOwner && 'no owner · re-issue', k.waiting && 'waiting to be used'].filter(Boolean);
  const flagHtml = flags.map(f => `<span class="settings-row-flag" data-testid="settings-key-flag">${escapeHtml(f)}</span>`).join('');
  const revoke = k.revoke.allowed
    ? askInPlace({
      summary: 'Revoke this key', willHappen: 'Anything using this key stops working. This cannot be undone.',
      transport: 'script', method: 'DELETE', action: k.revoke.route, confirmLabel: 'Revoke key', tone: 'red',
      cancelHref: workspaceUrl(urlKey, '/settings/agent-access'), testid: 'settings-key-revoke'
    })
    : `<p class="settings-note" data-testid="settings-key-owner-only">${escapeHtml(k.revoke.ownerOnlyNote)}</p>`;
  const body = `
          <p class="settings-ask-text">${escapeHtml(k.can)}${k.label ? ` · ${escapeHtml(k.label)}` : ''}</p>${revoke}`;
  return drillRow({
    label: name,
    value: `${k.kind} · ${expiry} · ${used}`,
    flagHtml,
    bodyHtml: body, testid: `settings-key-${k.source}`
  });
}

function newKeyBody(urlKey) {
  return `
          <form class="settings-form settings-newkey-form" data-newkey-route="${escapeHtml(workspaceUrl(urlKey, '/api/proxy/tokens'))}" data-testid="settings-newkey-form">
            <label class="settings-ask-label">Name <input type="text" name="label" maxlength="100" class="settings-newkey-label" data-testid="settings-newkey-label" placeholder="What is it for?"></label>
            <label class="settings-ask-label"><input type="radio" name="scope" value="read" checked> Read</label>
            <label class="settings-ask-label"><input type="radio" name="scope" value="readWrite"> Read and update</label>
            <p class="settings-ask-text">It lasts 90 days and is shown once. Keys that can start runs are minted by the workspace owner only, from the agent prompt.</p>
            <button type="submit" class="btn--quiet settings-newkey-submit" data-testid="settings-newkey-submit">Create key</button>
            <p class="settings-newkey-secret" data-testid="settings-newkey-secret" hidden></p>
          </form>`;
}

export function agentAccessBody({ urlKey, keys = [], workspaceName = 'this workspace', modelWrites = false, error = null, changed = null, now = Date.now(), changeRows = [] }) {
  // LIN-3890: person-made live keys are the rows; per-run keys (lineage, no grants)
  // are one summary row, so the count the sidebar shows is the count of these rows.
  const personKeys = keys.filter(k => !k.run);
  const runKeys = keys.filter(k => k.run);
  const list = personKeys.length
    ? personKeys.map(k => keyRow(k, now, urlKey)).join('')
    : staticRow({ label: 'Keys', valueHtml: 'none yet', testid: 'settings-keys-empty' });
  const runRow = staticRow({
    label: `Run keys · ${runKeys.length}`,
    valueHtml: runKeys.length ? 'each lasts 48 h' : 'none now',
    testid: 'settings-keys-run'
  });
  const keysGroup = group({
    title: 'Keys that can get into this workspace',
    testid: 'settings-section-keys',
    rowsHtml: `${list}${runRow}${drillRow({ label: 'New key', value: 'Read, or read and update', bodyHtml: newKeyBody(urlKey), testid: 'settings-newkey' })}`,
    note: 'Keys you or the workspace made. Run keys expire on their own.'
  });
  const links = group({
    title: 'Related',
    rowsHtml: `${drillRow({ label: 'Event log', value: 'Proxy', href: workspaceUrl(urlKey, '/proxy#events'), testid: 'settings-link-events' })}${drillRow({ label: 'Agent prompt', value: 'Proxy', href: workspaceUrl(urlKey, '/proxy'), testid: 'settings-link-agent-prompt' })}`
  });
  // LIN-3854: whether agents with a read-write proxy token may change model routing. For everyone,
  // so it asks why in place and is logged (no proxy endpoint can change it). One row: the state is
  // the control (LIN-3890 outcome 3).
  const cancelHref = workspaceUrl(urlKey, '/settings/agent-access');
  const flash = error ? statusLine({ tone: 'bad', text: error, testid: 'settings-flash' })
    : (changed ? statusLine({ text: 'Saved.', testid: 'settings-flash' }) : '');
  const modelWritesGroup = group({
    title: `For everyone in ${workspaceName}`,
    testid: 'settings-section-agent-models',
    rowsHtml: `${askInPlace({
      summary: 'Agents can change models', value: modelWrites ? 'On' : 'Off', valueTestid: 'settings-modelRoutingProxyWrites-state',
      willHappen: modelWrites
        ? 'Agents with a read-write proxy token can only read the model table again.'
        : 'Agents with a read-write proxy token can change which model each job runs on, apply a preset or undo a change. Every change they make is logged and can be undone.',
      askWhy: true, tone: modelWrites ? 'red' : 'teal', confirmLabel: modelWrites ? 'Turn off' : 'Turn on',
      action: workspaceUrl(urlKey, '/settings/workspace-features'),
      fields: [['feature', 'modelRoutingProxyWrites'], ['enabled', modelWrites ? 'false' : 'true']],
      cancelHref, testid: 'settings-toggle-modelRoutingProxyWrites'
    })}${undoRowFor(changeRows, 'modelRoutingProxyWrites', { urlKey, isOwner: true, cancelHref })}`,
    note: 'Off by default. No proxy endpoint can change this switch, and any member may change it.'
  });
  return `${flash}${keysGroup}${modelWritesGroup}${links}`;
}

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------

// Who made the change, as the viewer reads it (LIN-3890): "You" for their own
// change; a proxy change carries "via an agent key" (the key's creator is the
// actor, so "You, via an agent key" when the viewer minted that key), and a
// creator with no display name reads "via an agent key" alone. The account id
// is compared here and never written into the markup.
function actorLabel(row, viewerAccountId) {
  const mine = Boolean(viewerAccountId) && row.actorId === viewerAccountId;
  if (row.actorVia === 'proxy') {
    if (mine) return 'You, via an agent key';
    return row.actorName === UNNAMED_MEMBER ? 'via an agent key' : `${row.actorName}, via an agent key`;
  }
  return mine ? 'You' : row.actorName;
}

function changeRow(row, { urlKey, isOwner, viewerAccountId, now }) {
  const meta = `${actorLabel(row, viewerAccountId)} · ${when(row.at, now)}${row.reason ? ` · “${row.reason}”` : ''}`;
  const labelHtml = `
        <span class="settings-row-label">${escapeHtml(row.summary)}<span class="settings-row-note">${escapeHtml(meta)}</span></span>`;
  let tail = '';
  if (row.kind === 'undo') tail = '<span class="settings-row-value">undo</span>';
  else if (row.undone) tail = '<span class="settings-row-value">undone</span>';
  else if (row.undoable) {
    if (row.setting === 'halt' && !isOwner) {
      tail = '<span class="settings-row-value" data-testid="settings-change-owner-only">Only the owner can undo this</span>';
    } else {
      return `
      <div class="settings-row settings-change-row" data-testid="settings-change-${escapeHtml(row.source)}" data-change-id="${escapeHtml(row.id)}">${labelHtml}
        ${askInPlace({
          summary: 'Undo', willHappen: 'This puts the setting back as it was before this change, and is logged as a new entry. It is refused if the setting has changed since.',
          askWhy: true, tone: 'teal', confirmLabel: 'Undo this change',
          action: workspaceUrl(urlKey, `/settings/change-log/${encodeURIComponent(row.source)}/${encodeURIComponent(row.id)}/undo`),
          testid: `settings-undo-${row.id}`
        })}
      </div>`;
    }
  }
  return `
      <div class="settings-row settings-row-static settings-change-row" data-testid="settings-change-${escapeHtml(row.source)}" data-change-id="${escapeHtml(row.id)}">${labelHtml}
        ${tail}
      </div>`;
}

export function changeLogBody({ urlKey, rows = [], isOwner = false, viewerAccountId = null, error = null, undone = null, now = Date.now() }) {
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (undone ? '<p class="settings-note settings-flash" data-testid="settings-flash">Change undone.</p>' : '');
  const body = rows.length
    ? rows.map(r => changeRow(r, { urlKey, isOwner, viewerAccountId, now })).join('')
    : staticRow({ label: 'Changes', valueHtml: 'none yet', testid: 'settings-change-empty' });
  return `${flash}${group({
    title: 'Changes made for everyone',
    testid: 'settings-section-change-log',
    rowsHtml: body,
    note: 'Changes for everyone, newest first. Keys and sources are not logged.'
  })}`;
}
