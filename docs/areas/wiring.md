# Wiring

Area notes for `wiring` in the registry. Format and rules: README.md.

## Lessons

- A ticket's task is made through one seam, built once in `server.js` (`taskForTicketAt`, LIN-4501) over the checked
  writer (`lib/records/writes.js` `taskOfTicket`) with `askedOf` (`lib/asked-of.js`). The dispatch seat and the take
  fallback share it. A new place that needs a ticket's task calls it; it does not build another `createRecordWrites`,
  which would be one more wiring of the pipeline with its own `askedText`. The first writer of `asked` decides it for good.
- A new top-level `const` in `server.js` built from a factory needs a row in `tests/fixtures/key-state-census.json`
  (`tests/unit/key-state-census.test.js`). A local run of the area's own tests misses it; run the census too.
