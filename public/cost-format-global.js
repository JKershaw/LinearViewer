/**
 * public/cost-format-global.js (LIN-4446): the bridge from the shared formatter to the classic page scripts.
 *
 * Loaded as `<script type="module">` (renderPage's `{ module }` entry), so the import of /shared/cost-format.js, which
 * is lib/cost-format.js served as-is, is the one implementation the server also runs. Module scripts run after the
 * document is parsed and before DOMContentLoaded, so a classic script that reads window.CostFormat during its own
 * execution sees nothing. Consumers read it only from handlers and callbacks that run after that point, and
 * public/workspace-kpis.js defers its chart build to DOMContentLoaded for the same reason.
 */
import { formatUsd } from '/shared/cost-format.js';

window.CostFormat = { formatUsd };
