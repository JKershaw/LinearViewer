/**
 * LIN-4494: the records errors, in the Records leaf so the checked write path (lib/records/writes.js) can throw them
 * without importing the store. lib/records-store.js re-exports them, so existing importers are unchanged.
 */
export class RecordsVersionConflict extends Error {
  constructor(id) {
    super(`record ${id} changed while this write was made; read it and send the write again`);
    this.name = 'RecordsVersionConflict';
    this.code = 'VERSION_CONFLICT';
  }
}

export class RecordsNotFound extends Error {
  constructor(id) {
    super(`no record '${id}'`);
    this.name = 'RecordsNotFound';
    this.code = 'NOT_FOUND';
  }
}
