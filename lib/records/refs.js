/**
 * LIN-4494: the ticket reference shape, and the one rule for a record id derived from its source. In the Records leaf
 * (lib/records-store.js re-exports the ticket shape).
 */
import { createHash } from 'node:crypto';

// A ticket identifier is an upper-case team key and a number (LIN-4493). A record or task id is lower-case
// (`finding-3f9a0c21`), and its hex suffix can be all digits (`change-44394596`): the case is what tells them apart.
const TICKET_RE = /^[A-Z][A-Z0-9]*-\d+$/;
/** How far up a ticket's parent chain a task is made; the route's ticket read stops at the same depth. */
export const MAX_TICKET_DEPTH = 12;

/** A ticket reference (`LIN-4493`), as opposed to a task or record id. */
export const looksLikeTicket = (ref) => typeof ref === 'string' && TICKET_RE.test(ref.trim());

/**
 * A record id that is a function of where the record comes from: `<kind>-<8 hex>` over its parts joined by newlines.
 * Every writer that makes one record and then ends another with it (make-a-task, supersede), and every import (the
 * Waiting entries, the parked-ticket manifest), names its record this way, so a retry or a re-run finds the record it
 * made instead of making a second one (the store's version index refuses a second v1 under one id).
 */
export const fixedIdOf = (kind, ...parts) => `${kind}-${createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 8)}`;

/**
 * A ticket's task id, a function of the ticket (LIN-4494): the manifest's task and a task written with that ticket as its
 * `ref` (lib/records/writes.js, LIN-4496) are one task, made and claimed once.
 */
export const ticketTaskIdOf = (ticket) => fixedIdOf('task', 'ticket', ticket);
