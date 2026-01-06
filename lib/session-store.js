/**
 * Custom session store implementation for express-session.
 * Stores sessions in MongoDB (production) or MangoDB (file-based, development).
 * Implements the express-session Store interface with automatic TTL-based expiration.
 */
import session from 'express-session';

/**
 * MongoDB-compatible session store for express-session.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 *
 * Sessions are stored with an expiration timestamp and automatically
 * cleaned up when accessed after expiry or via the cleanup() method.
 *
 * @extends session.Store
 */
export class MongoSessionStore extends session.Store {
  /**
   * Creates a new session store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection to store sessions
   * @param {number} [options.ttl=2592000] - Session time-to-live in seconds (default: 30 days)
   */
  constructor(options = {}) {
    super();
    this.collection = options.collection;
    this.ttl = options.ttl || 2592000; // 30 days in seconds (refresh token based auth)
  }

  /**
   * Retrieves a session by its ID.
   * Returns null if session doesn't exist or has expired.
   *
   * @param {string} sid - Session ID
   * @param {function} callback - Callback(error, session)
   */
  get(sid, callback) {
    this.collection.findOne({ _id: sid })
      .then(doc => {
        if (!doc) return callback?.(null, null);

        // Check if session has expired; if so, delete it and return null
        if (doc.expires && doc.expires < new Date()) {
          this.destroy(sid);
          return callback?.(null, null);
        }

        callback?.(null, doc.session);
      })
      .catch(err => callback?.(err));
  }

  /**
   * Creates or updates a session.
   * Uses upsert to handle both new sessions and updates.
   *
   * @param {string} sid - Session ID
   * @param {Object} session - Session data to store
   * @param {function} callback - Callback(error)
   */
  set(sid, session, callback) {
    const expires = new Date(Date.now() + this.ttl * 1000);
    this.collection.updateOne(
      { _id: sid },
      { $set: { session, expires } },
      { upsert: true }
    )
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  /**
   * Deletes a session by its ID.
   * Called when user logs out or session is invalidated.
   *
   * @param {string} sid - Session ID
   * @param {function} callback - Callback(error)
   */
  destroy(sid, callback) {
    this.collection.deleteOne({ _id: sid })
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  /**
   * Refreshes the expiration time of an existing session.
   * Called on each request to keep active sessions alive.
   *
   * @param {string} sid - Session ID
   * @param {Object} session - Session data (unused, but required by interface)
   * @param {function} callback - Callback(error)
   */
  touch(sid, session, callback) {
    const expires = new Date(Date.now() + this.ttl * 1000);
    this.collection.updateOne(
      { _id: sid },
      { $set: { expires } }
    )
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  /**
   * Removes all expired sessions from the store.
   * Called periodically (e.g., on OAuth routes) to prevent stale session buildup.
   *
   * @returns {Promise} Resolves when cleanup is complete
   */
  cleanup() {
    return this.collection.deleteMany({
      expires: { $lt: new Date() }
    }).catch(err => {
      console.error('Session cleanup error:', err);
    });
  }
}
