/**
 * Consumer heartbeat store (LIN-1952). Collection `consumer-heartbeats`.
 *
 * One doc per (urlKey, instanceId), REPLACED on each beat (never an
 * accumulating log):
 *   { _id: `${urlKey}::${instanceId}`, urlKey, instanceId, consumerKind,
 *     tokenId, receivedAt, expiresAt (receivedAt + 15 min),
 *     clockSkewMs (receivedAt - sentAt), fields }
 * `fields` is every parsed key except consumerKind and instanceId.
 *
 * Expiry (LIN-610: no TTL indexes): a plain index on `expiresAt`, a block in
 * lib/hourly-cleanup.js that calls cleanup(), and reads that filter
 * `expiresAt > now`, so an expired doc is invisible before the sweep runs.
 *
 * Cap: at most MAX_LIVE_PER_WORKSPACE live docs per workspace. The trim runs
 * AFTER the write and evicts the oldest, so a new beat is never the one
 * rejected. A burst of distinct instances can briefly exceed the cap; the next
 * beat trims it.
 */

export const HEARTBEAT_TTL_MS = 15 * 60 * 1000;
export const MAX_LIVE_PER_WORKSPACE = 20;

export class ConsumerHeartbeatStore {
  /** @param {{collection: Object}} options - the 'consumer-heartbeats' collection */
  constructor({ collection }) {
    this.collection = collection;
  }

  /**
   * Upsert one beat, then trim the workspace to the cap. Throws on a backend
   * failure; the ingest handler turns that into a 500.
   *
   * @param {Object} args
   * @param {string} args.urlKey
   * @param {string|null} args.tokenId - id of the credential that sent it
   * @param {Object} args.parsed - parseHeartbeat() output
   * @param {Date} [args.now]
   */
  async record({ urlKey, tokenId, parsed, now = new Date() }) {
    const { consumerKind, instanceId, ...fields } = parsed;
    const _id = `${urlKey}::${instanceId}`;
    const doc = {
      _id,
      urlKey,
      instanceId,
      consumerKind,
      tokenId: tokenId ?? null,
      receivedAt: now,
      expiresAt: new Date(now.getTime() + HEARTBEAT_TTL_MS),
      clockSkewMs: now.getTime() - Date.parse(parsed.sentAt),
      fields
    };
    await this.collection.replaceOne({ _id }, doc, { upsert: true });
    await this._trim(urlKey, now);
  }

  /**
   * Live docs for a workspace, newest first.
   * @returns {Promise<Object[]>}
   */
  async listLive(urlKey, now = new Date()) {
    const docs = await this.collection.find({ urlKey, expiresAt: { $gt: now } }).toArray();
    return docs.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }

  /**
   * Delete expired docs. Never throws; returns the deleted count.
   * @returns {Promise<number>}
   */
  async cleanup(now = new Date()) {
    try {
      const result = await this.collection.deleteMany({ expiresAt: { $lt: now } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Consumer heartbeat cleanup error:', err);
      return 0;
    }
  }

  async _trim(urlKey, now) {
    const live = await this.listLive(urlKey, now);
    for (const doc of live.slice(MAX_LIVE_PER_WORKSPACE)) {
      await this.collection.deleteOne({ _id: doc._id });
    }
  }
}
