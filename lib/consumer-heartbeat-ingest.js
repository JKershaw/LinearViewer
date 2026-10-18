/**
 * The one heartbeat ingest handler, mounted on two doors (LIN-1952):
 *   POST /api/dispatch/heartbeat        behind authenticateDispatchToken (simple-dispatcher)
 *   POST /api/proxy/runner/heartbeat    under the runner gate (the runner kit)
 * Auth is the door's job; this handler only needs `urlKey` and `tokenId`
 * resolved by it.
 *
 * Contract: 204 on accept; 400 with the structured error envelope when the body
 * is oversize or parseHeartbeat returns null. The 4 KB cap is enforced HERE, not
 * by the global express.json({limit: '250kb'}), and an oversize body is a 400
 * rather than a 413 so the route keeps a two-outcome (204 / 400) contract. The
 * 400 message never echoes the body.
 */
import { badRequest, jsonError } from './errors.js';
import { parseHeartbeat } from './consumer-heartbeat.js';

export const MAX_HEARTBEAT_BODY_BYTES = 4096;

/**
 * @param {Object} deps
 * @param {{record: Function}} deps.store - ConsumerHeartbeatStore
 * @param {Function} [deps.logEvent] - (req, endpoint, status) audit logger, where the door has one
 * @param {string} deps.endpoint - route string for logEvent
 * @param {(req: Object) => ({urlKey: string, tokenId: (string|null)})} deps.identify
 * @returns {import('express').RequestHandler}
 */
export function createHeartbeatIngest({ store, logEvent = null, endpoint, identify }) {
  const log = (req, status) => { if (logEvent) logEvent(req, endpoint, status); };

  return async (req, res) => {
    const declared = Number(req.headers['content-length']);
    let size = Number.isFinite(declared) ? declared : 0;
    if (size <= MAX_HEARTBEAT_BODY_BYTES) {
      try {
        size = Buffer.byteLength(JSON.stringify(req.body ?? null));
      } catch {
        size = Infinity;
      }
    }
    if (size > MAX_HEARTBEAT_BODY_BYTES) {
      log(req, 400);
      return badRequest.json(res, `Heartbeat body must be at most ${MAX_HEARTBEAT_BODY_BYTES} bytes`);
    }

    const parsed = parseHeartbeat(req.body);
    if (!parsed) {
      log(req, 400);
      return badRequest.json(res, 'Invalid heartbeat: schema 1 with consumerKind, instanceId, sentAt and intervalMs (1000-3600000) is required');
    }

    try {
      const { urlKey, tokenId } = identify(req);
      await store.record({ urlKey, tokenId, parsed });
      log(req, 204);
      res.status(204).end();
    } catch (err) {
      log(req, 500);
      console.error('Consumer heartbeat ingest error:', err.message);
      jsonError(res, 500, 'Failed to record heartbeat');
    }
  };
}
