/**
 * LIN-4494: the ticket reference shape, in the Records leaf (lib/records-store.js re-exports it).
 */
// A ticket identifier is an upper-case team key and a number (LIN-4493). A record or task id is lower-case
// (`finding-3f9a0c21`), and its hex suffix can be all digits (`change-44394596`): the case is what tells them apart.
const TICKET_RE = /^[A-Z][A-Z0-9]*-\d+$/;
/** How far up a ticket's parent chain a task is made; the route's ticket read stops at the same depth. */
export const MAX_TICKET_DEPTH = 12;

/** A ticket reference (`LIN-4493`), as opposed to a task or record id. */
export const looksLikeTicket = (ref) => typeof ref === 'string' && TICKET_RE.test(ref.trim());
