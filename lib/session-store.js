import session from 'express-session';

export class MongoSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.collection = options.collection;
    this.ttl = options.ttl || 86400; // 24 hours in seconds
  }

  get(sid, callback) {
    this.collection.findOne({ _id: sid })
      .then(doc => {
        if (!doc) return callback?.(null, null);

        // Check if expired
        if (doc.expires && doc.expires < new Date()) {
          this.destroy(sid);
          return callback?.(null, null);
        }

        callback?.(null, doc.session);
      })
      .catch(err => callback?.(err));
  }

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

  destroy(sid, callback) {
    this.collection.deleteOne({ _id: sid })
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  touch(sid, session, callback) {
    const expires = new Date(Date.now() + this.ttl * 1000);
    this.collection.updateOne(
      { _id: sid },
      { $set: { expires } }
    )
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  cleanup() {
    return this.collection.deleteMany({
      expires: { $lt: new Date() }
    }).catch(err => {
      console.error('Session cleanup error:', err);
    });
  }
}
