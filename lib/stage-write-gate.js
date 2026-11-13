/**
 * LIN-4468: the write gate the proxy mounts name by operation. It is the route-level half of the
 * stage write allowance (lib/stage-writes.js holds the table): the readWrite scope check, and the
 * stage's allowance for the named operation. The ticket match is the second half, and runs after
 * the provider read in routes/proxy-writes.js. Imported by every write mount, so no router takes
 * the gate as a dependency that a test or a caller could leave out.
 */
import { jsonError } from './errors.js';
import { READ_WRITE } from './proxy-scopes.js';
import { stageWriteAllows, normalizeWritesStamp, STAGE_WRITE_OPS, ISSUE_PATCH_FIELDS } from './stage-writes.js';

/**
 * Build a gate for one operation. A name outside STAGE_WRITE_OPS throws at mount, so a route
 * cannot be wired without a classified operation.
 * @param {string} name - the middleware's name, for the mount-time error and the layer name
 * @param {string} op - one of STAGE_WRITE_OPS
 * @param {{scope: boolean}} options - whether the readWrite scope check is part of the gate
 */
function writeGate(name, op, { scope }) {
  if (!STAGE_WRITE_OPS.includes(op)) {
    throw new Error(`${name}: unknown write operation "${op}" (lib/stage-writes.js STAGE_WRITE_OPS)`);
  }
  const gate = (req, res, next) => {
    if (scope && req.proxyTokenScope !== READ_WRITE) {
      return jsonError(res, 403, 'This endpoint requires a read-write token');
    }
    // Only the body fields the PATCH reads are checked, so a triage token is refused a named field before any read.
    const fields = op === 'updateIssue' ? ISSUE_PATCH_FIELDS.filter(field => req.body?.[field] !== undefined) : [];
    if (!stageWriteAllows(req.proxyWrites, op, { fields })) {
      return jsonError(res, 403, `This stage's write allowance (${normalizeWritesStamp(req.proxyWrites)}) does not permit ${op}.`);
    }
    next();
  };
  Object.defineProperty(gate, 'name', { value: `${name}:${op}` });
  return gate;
}

/**
 * readWrite scope plus the stage's write allowance for `op`. Used on every write mount that needs
 * the token to be read-write.
 * @param {string} op - one of STAGE_WRITE_OPS
 * @returns {Function} Express middleware
 */
export function requireWriteScope(op) {
  return writeGate('requireWriteScope', op, { scope: true });
}

/**
 * The stage's write allowance for `op`, with no scope check. Used on a grant-gated mount, whose gate
 * is the grant rather than the token's scope.
 * @param {string} op - one of STAGE_WRITE_OPS
 * @returns {Function} Express middleware
 */
export function requireStageWrite(op) {
  return writeGate('requireStageWrite', op, { scope: false });
}
