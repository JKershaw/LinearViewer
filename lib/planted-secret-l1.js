// TEMPORARY (LIN-2573 close-out, ledger item L1). This file plants a synthetic
// secret OUTSIDE the fixture allowlist so the `Secret scan (source)` job fails on a
// GitHub-hosted runner and `CI success` goes red with it. The value is not a
// credential: it is random bytes generated for this check. Delete this file and the
// branch once the red run is recorded.
export const bootstrap_token = 'HBLXNKj1NUCs84KiIrB5xIu9Iy-AicgU7Iu8QIGu2hc';
