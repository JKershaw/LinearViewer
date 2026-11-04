/**
 * lib/request-usage-intake.js — the shared usage intake (LIN-4198, piece 1 of LIN-4195, D3/D4).
 *
 * One handler serves both routes that accept per-request usage records:
 *   POST /api/dispatch/usage/:itemId        (consumer dispatch token)
 *   POST /api/proxy/runner/usage/:id        (runner proxy token, `take` grant)
 * Mirrors the feedback routes' shared-validation precedent (lib/dispatch-feedback-validation.js):
 * the route owns auth and the 400 for a malformed item id; this module owns the body, the
 * ownership read, the per-record guards and the upsert.
 *
 * Contract:
 *   - Body `{records: [...]}`, at most USAGE_MAX_RECORDS_PER_CALL records. A missing or
 *     non-array `records`, or too many, rejects the WHOLE call (400).
 *   - Each record is judged on its own. A bad record is reported in `rejected` with a
 *     reason and does not fail the others.
 *   - A record whose five token counts are ALL zero is accepted: it is reported in
 *     `applied` and NOT stored (a `<synthetic>` message must not become a stored row).
 *   - A record whose prompt size exceeds USAGE_MAX_PROMPT_TOKENS is rejected: no model
 *     request is that large, so it is a running total posted by mistake.
 *   - Ownership is the feedback rule: the item must be `status:'taken'` in this workspace
 *     and taken by this token (readTakenForUsage). Otherwise 404.
 *   - `rootItemId` comes from the taken row through `anchorOf`. It is NEVER read from the
 *     body, so a body that names another lineage cannot move a record onto it.
 *   - `itemId` and `issueIdentifier` are stored from the row (nothing reads them yet).
 *
 * Response: `{applied: [requestId], rejected: [{requestId, reason}]}`, 200.
 */

import { RequestUsageStore, REQUEST_USAGE_COLLECTION, USAGE_TOKEN_FIELDS } from './request-usage-store.js';
import { promptTokensOf } from './model-pricing.js';
import { anchorOf } from './lineage-membership.js';
import { DispatchStoreFault } from './errors.js';

export { REQUEST_USAGE_COLLECTION };

export const USAGE_MAX_RECORDS_PER_CALL = 100;
export const USAGE_MAX_PROMPT_TOKENS = 2_000_000;
export const USAGE_MAX_TEXT_LENGTH = 200;

/** Text fields a record may carry (identity and metadata, never price). */
const TEXT_FIELDS = Object.freeze(['requestId', 'harness', 'model', 'effort', 'lane', 'agent']);
/** Numeric fields: the five token counters and the optional native cost. */
const NUMERIC_FIELDS = Object.freeze([...USAGE_TOKEN_FIELDS, 'costUsd']);

const isAbsent = (value) => value === undefined || value === null;

/**
 * Judge one record. Returns `{ ok: true, requestId, zero, record }` where `record` is the
 * normalized value to store (absent when `zero`), or `{ ok: false, requestId, reason }`.
 * Pure: no store, no clock.
 *
 * @param {unknown} raw
 * @returns {{ok: true, requestId: string, zero: boolean, record?: Object}|{ok: false, requestId: string|null, reason: string}}
 */
export function judgeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, requestId: null, reason: 'record must be an object' };
  }
  const requestId = raw.requestId;
  if (typeof requestId !== 'string' || requestId.trim() === '') {
    return { ok: false, requestId: null, reason: 'requestId is required' };
  }
  if (requestId.length > USAGE_MAX_TEXT_LENGTH) {
    return { ok: false, requestId, reason: `requestId exceeds ${USAGE_MAX_TEXT_LENGTH} characters` };
  }

  const record = { requestId };
  for (const field of TEXT_FIELDS.slice(1)) {
    const value = raw[field];
    if (isAbsent(value)) continue;
    if (typeof value !== 'string') return { ok: false, requestId, reason: `${field} must be a string` };
    if (value.length > USAGE_MAX_TEXT_LENGTH) {
      return { ok: false, requestId, reason: `${field} exceeds ${USAGE_MAX_TEXT_LENGTH} characters` };
    }
    record[field] = value;
  }

  for (const field of NUMERIC_FIELDS) {
    const value = raw[field];
    if (isAbsent(value)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { ok: false, requestId, reason: `${field} must be a finite non-negative number` };
    }
    record[field] = value;
  }

  if (!isAbsent(raw.at)) {
    const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? new Date(raw.at)
      : typeof raw.at === 'string' ? new Date(raw.at)
        : null;
    if (!at || Number.isNaN(at.getTime())) return { ok: false, requestId, reason: 'at is not a valid time' };
    record.at = at;
  }

  const promptTokens = promptTokensOf(record);
  if (promptTokens > USAGE_MAX_PROMPT_TOKENS) {
    return {
      ok: false,
      requestId,
      reason: `prompt tokens ${promptTokens} exceed ${USAGE_MAX_PROMPT_TOKENS}: no single model request is that large (a running total posted as one)`
    };
  }

  const zero = USAGE_TOKEN_FIELDS.every((field) => (record[field] ?? 0) === 0);
  return { ok: true, requestId, zero, record };
}

/**
 * Validate a whole intake body. Returns `{error}` for a call-level refusal (400), or
 * `{applied, toStore, rejected}`: `applied` is every requestId the call accepts (zero-token
 * records included, in input order), `toStore` the normalized records to upsert, `rejected`
 * the per-record refusals.
 *
 * @param {unknown} body
 * @returns {{error: string}|{applied: string[], toStore: Object[], rejected: Array<{requestId: string|null, reason: string}>}}
 */
export function validateUsageBody(body) {
  const records = body && typeof body === 'object' ? body.records : undefined;
  if (!Array.isArray(records)) return { error: 'records is required and must be an array' };
  if (records.length > USAGE_MAX_RECORDS_PER_CALL) {
    return { error: `records exceeds the maximum of ${USAGE_MAX_RECORDS_PER_CALL} per call` };
  }

  const applied = [];
  const toStore = [];
  const rejected = [];
  for (const raw of records) {
    const judged = judgeRecord(raw);
    if (!judged.ok) {
      rejected.push({ requestId: judged.requestId, reason: judged.reason });
      continue;
    }
    applied.push(judged.requestId);
    if (!judged.zero) toStore.push(judged.record);
  }
  return { applied, toStore, rejected };
}

/**
 * The whole intake, shared by both routes: validate the body, read the taken row with the
 * feedback ownership rule, then upsert the valid non-zero records under the row's lineage.
 *
 * @param {Object} args
 * @param {Object} args.dispatchQueueStore - needs readTakenForUsage
 * @param {Object} args.store - a RequestUsageStore (see requestUsageStoreFor)
 * @param {string} args.itemId - the posting item (the URL's id)
 * @param {string} args.urlKey
 * @param {string} args.tokenLabel - the posting token's label (dispatch or runner)
 * @param {string|null} [args.takenByTokenId] - the runner token id, for runner callers
 * @param {unknown} args.body
 * @param {Date} [args.now]
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function postUsage({ dispatchQueueStore, store, itemId, urlKey, tokenLabel, takenByTokenId, body, now = new Date() }) {
  const checked = validateUsageBody(body);
  if (checked.error) return { status: 400, body: { error: checked.error } };

  const row = await dispatchQueueStore.readTakenForUsage(itemId, urlKey, tokenLabel, { takenByTokenId });
  if (!row) return { status: 404, body: { error: 'Item not found or usage not allowed' } };

  if (checked.toStore.length > 0) {
    if (!store) return { status: 503, body: { error: 'Usage store unavailable' } };
    try {
      await store.upsertRecords({
        urlKey,
        rootItemId: anchorOf(row),
        itemId,
        issueIdentifier: row.issueIdentifier ?? null,
        records: checked.toStore,
        now
      });
    } catch (err) {
      // A failed upsert is safe to re-send (the write is idempotent), so writeLanded stays false.
      throw new DispatchStoreFault('postUsage', err);
    }
  }
  return { status: 200, body: { applied: checked.applied, rejected: checked.rejected } };
}

/**
 * The `request-usage` store for the app, built from the database handle. Lives here, not in
 * server.js, so server.js never names the collection (the store's allow-list is this file).
 *
 * @param {Object} db - a database handle with `collection(name)`
 * @returns {RequestUsageStore}
 */
export function requestUsageStoreFor(db) {
  return new RequestUsageStore({ collection: db.collection(REQUEST_USAGE_COLLECTION) });
}
