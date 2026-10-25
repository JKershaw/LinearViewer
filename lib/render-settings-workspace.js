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
import { drillRow, actionRow, staticRow } from './components/settings-row.js';
import { askInPlace } from './components/settings-ask.js';
import { group } from './components/settings-group.js';
import { haltControls } from './components/halt-controls.js';

const workspaceUrl = (urlKey, suffix) => `/workspace/${encodeURIComponent(urlKey)}${suffix}`;

const noteHtml = (text, testid = '') => `<p class="settings-note"${testid ? ` data-testid="${escapeHtml(testid)}"` : ''}>${escapeHtml(text)}</p>`;

// LIN-3890: Settings times are relative ("in 89d", "3h ago") through the one
// formatter in lib/render.js, not exact UTC stamps.
const when = (iso) => formatRelativeTime(iso);

const HALT_VALUE = { none: 'Running', pause: 'Paused', stop: 'Stopped' };

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export function runningBody({
  urlKey, workspaceName = 'this workspace', isOwner = false, runSetup = false, hasRunner = false,
  lastPoll = null, haltMode = 'none', periodicals = false, error = null, changed = null
}) {
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (changed ? `<p class="settings-note settings-flash" data-testid="settings-flash">${escapeHtml(changed)}</p>` : '');

  const runnerRows = hasRunner
    ? `${staticRow({ label: 'Last poll', valueHtml: lastPoll ? `${escapeHtml(when(lastPoll.at))} · ${escapeHtml(lastPoll.kind)}` : 'not seen yet', testid: 'settings-runner-last-poll' })}${actionRow({ label: 'Runner set-up guide', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-guide' })}${actionRow({ label: 'New runner prompt', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-new-prompt' })}`
    : (runSetup ? actionRow({ label: 'Set up a runner', href: workspaceUrl(urlKey, '/runner'), testid: 'settings-runner-setup' }) : '');
  const runnerNote = hasRunner
    ? 'Last poll is the runner key’s last use: Harbour gets no heartbeat from the runner, so this says nothing about whether it is up. A new runner prompt does not revoke the old key; that works until it expires or you revoke it. Run buttons show for the workspace owner.'
    : (runSetup ? 'No runner yet. Run buttons appear for the workspace owner once one is set up.' : 'No runner yet. The workspace owner can set one up.');
  const runner = group({ title: 'Runner', testid: 'settings-section-runner', rowsHtml: runnerRows, note: runnerNote });

  // Pause / stop / resume: owner-only, asked in place with a reason. The controls are one
  // implementation shared with Dispatch (lib/components/halt-controls.js); the owner gate stays here.
  let haltRows = staticRow({ label: 'Runs', valueHtml: escapeHtml(HALT_VALUE[haltMode] || HALT_VALUE.none), testid: 'settings-halt-state' });
  if (isOwner) {
    haltRows += haltControls({ presentation: 'ask', current: haltMode, action: workspaceUrl(urlKey, '/settings/running/halt') });
  }
  const periodicalsRow = askInPlace({
    summary: periodicals ? 'Turn off periodic reviews' : 'Turn on periodic reviews',
    willHappen: periodicals
      ? 'Periodic reviews stop appearing on Home for everyone in this workspace.'
      : 'Periodic reviews appear on Home for everyone in this workspace.',
    askWhy: true, tone: 'teal', confirmLabel: periodicals ? 'Turn off' : 'Turn on',
    action: workspaceUrl(urlKey, '/settings/workspace-features'),
    fields: [['feature', 'periodicals'], ['enabled', periodicals ? 'false' : 'true']],
    testid: 'settings-toggle-periodicals'
  });
  const everyone = group({
    title: `For everyone in ${workspaceName}`,
    testid: 'settings-section-workspace-features',
    rowsHtml: `${haltRows}${staticRow({ label: 'Periodic reviews', valueHtml: periodicals ? 'On' : 'Off', testid: 'settings-periodicals-state' })}${periodicalsRow}`,
    note: `Pausing or stopping is for the workspace owner${isOwner ? '' : ' (you are not the owner, so these buttons are hidden)'}. Periodic reviews are 16 weekly templates you run by hand from Home; nothing runs them on a schedule. Every change here asks why and goes into the change log, where it can be undone.`
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

function keyRow(k) {
  const expiry = k.expiresAt ? `expires ${when(k.expiresAt)}` : 'no expiry';
  const used = k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : 'never used';
  const owner = k.hasOwner ? '' : ' · no owner · re-issue';
  const revoke = k.revoke.allowed
    ? `<button type="button" class="btn btn--red settings-key-revoke" data-revoke-route="${escapeHtml(k.revoke.route)}" data-testid="settings-key-revoke">Revoke this key</button><p class="settings-ask-text">Anything using this key stops working. This cannot be undone.</p>`
    : `<p class="settings-note" data-testid="settings-key-owner-only">${escapeHtml(k.revoke.ownerOnlyNote)}</p>`;
  const body = `
          <p class="settings-ask-text">${escapeHtml(k.can)}${k.label ? ` · ${escapeHtml(k.label)}` : ''}</p>
          <p class="settings-ask-text">${escapeHtml(expiry)} · ${escapeHtml(used)}${escapeHtml(owner)}</p>${revoke}`;
  return drillRow({
    label: k.waiting ? `${k.kind} (waiting to be used)` : k.kind,
    value: `${k.lastUsedAt ? used : expiry}${k.hasOwner ? '' : ' · no owner'}`,
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

export function agentAccessBody({ urlKey, keys = [], workspaceName = 'this workspace', modelWrites = false, error = null, changed = null }) {
  // LIN-3890: person-made live keys are the rows; per-run keys (lineage, no grants)
  // are one summary row, so the count the sidebar shows is the count of these rows.
  const personKeys = keys.filter(k => !k.run);
  const runKeys = keys.filter(k => k.run);
  const list = personKeys.length
    ? personKeys.map(keyRow).join('')
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
    note: 'Live keys you or the workspace made, each with what it can do. Run keys are the keys dispatched runs use; they expire on their own.'
  });
  const links = group({
    title: 'Related',
    rowsHtml: `${drillRow({ label: 'Event log', value: 'Proxy', href: workspaceUrl(urlKey, '/proxy#events'), testid: 'settings-link-events' })}${drillRow({ label: 'Agent prompt', value: 'Proxy', href: workspaceUrl(urlKey, '/proxy'), testid: 'settings-link-agent-prompt' })}`
  });
  // LIN-3854: whether agents with a read-write proxy token may change model routing. For everyone,
  // so it asks why in place and is logged (no proxy endpoint can change it).
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (changed ? '<p class="settings-note settings-flash" data-testid="settings-flash">Saved.</p>' : '');
  const modelWritesGroup = group({
    title: `For everyone in ${workspaceName}`,
    testid: 'settings-section-agent-models',
    rowsHtml: `${staticRow({ label: 'Agents can change models', valueHtml: modelWrites ? 'On' : 'Off', testid: 'settings-modelRoutingProxyWrites-state' })}${askInPlace({
      summary: modelWrites ? 'Stop agents changing models' : 'Let agents change models',
      willHappen: modelWrites
        ? 'Agents with a read-write proxy token can only read the model table again.'
        : 'Agents with a read-write proxy token can change which model each job runs on, apply a preset or undo a change. Every change they make is logged and can be undone.',
      askWhy: true, tone: modelWrites ? 'red' : 'teal', confirmLabel: modelWrites ? 'Turn off' : 'Turn on',
      action: workspaceUrl(urlKey, '/settings/workspace-features'),
      fields: [['feature', 'modelRoutingProxyWrites'], ['enabled', modelWrites ? 'false' : 'true']],
      testid: 'settings-toggle-modelRoutingProxyWrites'
    })}`,
    note: 'Off by default, and no proxy endpoint can change this switch. Any member may change it; the change goes into the change log.'
  });
  return `${flash}${keysGroup}${modelWritesGroup}${links}`;
}

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------

// Who made the change, as the viewer reads it (LIN-3890): "You" for their own
// change, "via an agent key" for a proxy change whose creator has no display
// name. The account id is compared here and never written into the markup.
function actorLabel(row, viewerAccountId) {
  if (viewerAccountId && row.actorId === viewerAccountId) return 'You';
  if (row.actorVia === 'proxy' && row.actorName === 'a member') return 'via an agent key';
  return row.actorName;
}

function changeRow(row, { urlKey, isOwner, viewerAccountId }) {
  const meta = `${actorLabel(row, viewerAccountId)} · ${when(row.at)}${row.reason ? ` · “${row.reason}”` : ''}`;
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

export function changeLogBody({ urlKey, rows = [], isOwner = false, viewerAccountId = null, error = null, undone = null }) {
  const flash = error
    ? `<p class="settings-note settings-flash settings-flash-error" data-testid="settings-flash">${escapeHtml(error)}</p>`
    : (undone ? '<p class="settings-note settings-flash" data-testid="settings-flash">Change undone.</p>' : '');
  const body = rows.length
    ? rows.map(r => changeRow(r, { urlKey, isOwner, viewerAccountId })).join('')
    : staticRow({ label: 'Changes', valueHtml: 'none yet', testid: 'settings-change-empty' });
  return `${flash}${group({
    title: 'Changes made for everyone',
    testid: 'settings-section-change-log',
    rowsHtml: body,
    note: 'Every change that affects everyone in the workspace, from any area, newest first. Model routing changes are listed here too. Key changes, custom prompts and sources are not settings changes and are not logged.'
  })}`;
}
