/**
 * Two-tenant erasure seed, generated FROM `INVENTORY` (LIN-3423).
 *
 * A person and a bystander each own a workspace alone, and share a third, so
 * every level has something to remove, anonymise, keep and leave untouched. The
 * rows are built by reading each INVENTORY row's `find` / `scope` /
 * `accountFields`, so adding a collection to INVENTORY seeds it here with no
 * edit. The self-service delete ticket reuses this file.
 *
 *   alone   `acme`      workspace `ws-acme`  owned by the person only
 *   eu      `acme-eu`   workspace `ws-eu`    owned by the bystander only (prefix-collides with `acme`)
 *   shared  `shared-ws` workspace `ws-shared` owned by the person, the bystander is a plain member
 *
 * Every seeded document is tagged in `seed.index` so a test can say what should
 * have happened to it without re-deriving the rules.
 */

export const PERSON = {
  name: 'person',
  accountId: '11111111-aaaa-4aaa-8aaa-111111111111',
  aliasId: '4444aaaa-bbbb-4bbb-8bbb-222222222222',
  email: 'person@example.test'
};
export const BYSTANDER = {
  name: 'bystander',
  accountId: '22222222-aaaa-4aaa-8aaa-333333333333',
  email: 'bystander@example.test'
};

export const WORKSPACES = {
  alone: { urlKey: 'acme', workspaceId: 'ws-acme', owner: 'person' },
  eu: { urlKey: 'acme-eu', workspaceId: 'ws-eu', owner: 'bystander' },
  shared: { urlKey: 'shared-ws', workspaceId: 'ws-shared', owner: 'person' }
};

/** Strings that must never reach output or errors. */
export const SENTINELS = {
  prompt: 'SENTINEL-typed-text-do-not-print',
  tokenHash: 'SENTINELTOKENHASH0123456789abcdef',
  label: 'SENTINEL-token-label'
};

const FUTURE = new Date('2099-01-01T00:00:00Z');
const PAST = new Date('2001-01-01T00:00:00Z');
const AT = new Date('2026-10-01T00:00:00Z');

function setPath(doc, path, value) {
  const parts = path.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = cur[parts[i]] || {};
  cur[parts[parts.length - 1]] = value;
}

/** An `_id` shaped for a regex scope, found by trying the shapes the stores use. */
function idForRegexScope(spec, urlKey) {
  const re = new RegExp(spec.build(urlKey));
  const candidates = [`${urlKey}:item-1`, `${urlKey}::item-1`, `sweep:v1:${urlKey}`, `companion:v1:${urlKey}`, `companion:v1:${urlKey}:proxy`];
  return candidates.find((c) => re.test(c)) || null;
}

/**
 * @param {Object[]} inventory - INVENTORY
 * @param {{person?: Object, bystander?: Object}} [tenants]
 * @returns {{docs: Object<string, Object[]>, index: Object[], tenants: Object, workspaces: Object}}
 */
export function buildErasureSeed(inventory, { person = PERSON, bystander = BYSTANDER } = {}) {
  const docs = {};
  const index = [];
  let counter = 0;
  const add = (collection, doc, tags) => {
    if (!docs[collection]) docs[collection] = [];
    docs[collection].push(doc);
    index.push({ collection, _id: doc._id, ...tags });
  };
  const uid = (prefix) => `${prefix}-${String(++counter).padStart(4, '0')}`;
  const accountOf = (tenant) => (tenant === 'person' ? person.accountId : bystander.accountId);

  // Which tenant has rows in which workspace.
  const placements = [
    { tenant: 'person', workspace: 'alone' },
    { tenant: 'bystander', workspace: 'eu' },
    { tenant: 'person', workspace: 'shared' },
    { tenant: 'bystander', workspace: 'shared' }
  ];

  for (const row of inventory) {
    const c = row.collection;

    if (row.kind === 'group') {
      for (const tenant of ['person', 'bystander']) {
        const account = accountOf(tenant);
        const home = tenant === 'person' ? WORKSPACES.alone : WORKSPACES.eu;
        const doc = { _id: uid(c) };
        if (c === 'accounts') {
          doc._id = account;
          doc.identities = [{ provider: 'email', scope: tenant === 'person' ? person.email : bystander.email, credentials: {} }];
          doc.createdAt = AT;
        } else if (c === 'account-workspaces') {
          doc.accountId = account;
          doc.workspaceId = home.workspaceId;
          doc.role = 'owner';
          doc.createdAt = AT;
        } else if (c === 'sessions') {
          doc.expires = FUTURE;
          doc.session = { accountId: account, workspaces: [{ id: home.workspaceId, urlKey: home.urlKey }] };
        } else if (c === 'connections') {
          doc._id = `${account}::linear::${home.workspaceId}`;
          doc.accountId = account;
          doc.provider = 'linear';
          doc.referents = [{ provider: 'linear', scope: home.workspaceId, urlKey: home.urlKey }];
        } else if (c === 'owner-credentials') {
          doc._id = `${account}::${home.urlKey}::linear`;
          doc.accountId = account;
          doc.urlKey = home.urlKey;
          doc.refreshToken = SENTINELS.tokenHash;
        } else if (c === 'user-preferences') {
          doc._id = account;
          doc.preferences = { selectedTeamByWorkspace: { [home.urlKey]: 'team-1' } };
        } else if (c === 'email-magic-links') {
          doc.emailNorm = tenant === 'person' ? person.email : bystander.email;
          doc.linkToAccountId = null;
          doc.mode = 'signin';
        } else if (c === 'account-merge-events') {
          doc.canonicalId = account;
          doc.mergedId = `merged-${tenant}`;
        } else {
          for (const spec of row.find) {
            if (spec.by === 'field') setPath(doc, spec.field, account);
          }
          if (row.accountFields.length) doc.urlKey = home.urlKey;
          if (c === 'proxy-tokens' || c === 'dispatch-tokens') doc.tokenHash = SENTINELS.tokenHash + tenant;
          if (c === 'task_share_links') doc.workspaceId = home.workspaceId;
          if (c === 'saved-chats') doc.transcript = [{ text: SENTINELS.prompt }];
        }
        add(c, doc, { kind: 'group', tenant, workspace: tenant === 'person' ? 'alone' : 'eu' });
      }
      continue;
    }

    if (row.kind === 'history') {
      for (const { tenant, workspace } of placements) {
        const k = WORKSPACES[workspace];
        const account = accountOf(tenant);
        const doc = { _id: uid(c), urlKey: k.urlKey, prompt: SENTINELS.prompt };
        for (const f of row.accountFields) {
          if (f.kind === 'array') {
            const [head, ...rest] = f.path.split('.');
            doc[head] = [{ [rest.join('.')]: account, at: AT, maxTasks: 3 }];
          } else {
            setPath(doc, f.path, account);
          }
        }
        if (row.scope.some((s) => s.by === 'id')) doc._id = k.urlKey + (tenant === 'person' ? '' : '');
        if (row.scope.some((s) => s.by === 'id') && docs[c]?.some((d) => d._id === doc._id)) continue;
        if (c === 'dispatch-queue') {
          doc.status = 'pending';
          doc.dispatchedAt = AT;
          doc.expiresAt = FUTURE;
        }
        if (c === 'dispatch-history') {
          doc.status = 'done';
          doc.resolvedAt = AT;
        }
        add(c, doc, { kind: 'history', tenant, workspace });
      }
      continue;
    }

    if (row.kind === 'workspace') {
      for (const workspace of ['alone', 'eu', 'shared']) {
        const k = WORKSPACES[workspace];
        const doc = { _id: uid(c), payload: SENTINELS.prompt };
        for (const spec of row.scope) {
          if (spec.by === 'field') doc[spec.field] = k.urlKey;
          else if (spec.by === 'id') doc._id = k.urlKey;
          else if (spec.by === 'idRegex') doc._id = idForRegexScope(spec, k.urlKey) || doc._id;
        }
        add(c, doc, { kind: 'workspace', tenant: WORKSPACES[workspace].owner, workspace });
      }
      continue;
    }

    if (row.kind === 'leave') {
      add(c, { _id: uid(c), note: 'left alone' }, { kind: 'leave', tenant: 'both', workspace: null });
    }
  }

  // The person's alias (a merged-away account). `mergeAccounts` leaves identities[] on the alias, so an
  // address can sit only there.
  const aliasDoc = {
    _id: person.aliasId,
    identities: [{ provider: 'email', scope: 'alias-only@example.test', credentials: {} }],
    mergedInto: person.accountId,
    createdAt: AT
  };
  add('accounts', aliasDoc, { kind: 'group', tenant: 'person', workspace: null });

  // The bystander is a plain member of the shared workspace.
  add('account-workspaces', { _id: 'edge-bystander-shared', accountId: bystander.accountId, workspaceId: WORKSPACES.shared.workspaceId, createdAt: AT }, { kind: 'group', tenant: 'bystander', workspace: 'shared' });
  // The person owns the shared workspace; the connection that pairs it with its urlKey.
  add('account-workspaces', { _id: 'edge-person-shared', accountId: person.accountId, workspaceId: WORKSPACES.shared.workspaceId, role: 'owner', createdAt: AT }, { kind: 'group', tenant: 'person', workspace: 'shared' });
  for (const tenant of ['person', 'bystander']) {
    const account = accountOf(tenant);
    add('connections', {
      _id: `${account}::linear::${WORKSPACES.shared.workspaceId}`,
      accountId: account,
      provider: 'linear',
      referents: [{ provider: 'linear', scope: WORKSPACES.shared.workspaceId, urlKey: WORKSPACES.shared.urlKey }]
    }, { kind: 'group', tenant, workspace: 'shared' });
  }

  return {
    docs,
    index,
    tenants: { person, bystander },
    workspaces: WORKSPACES,
    constants: { FUTURE, PAST, AT }
  };
}

/** Insert a seed into a fresh db. Collections the seed has no rows for stay absent. */
export async function seedDb(db, seed) {
  for (const [collection, rows] of Object.entries(seed.docs)) {
    await db.collection(collection).insertMany(rows.map((r) => structuredClone(r)));
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Every document of every named collection, as sorted JSON, for byte-identical comparisons. */
export async function snapshotDb(db, collections) {
  const out = {};
  for (const c of collections) {
    const rows = await db.collection(c).find({}).toArray();
    out[c] = rows.map(stable).sort();
  }
  return out;
}
