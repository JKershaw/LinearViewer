/**
 * public/cost-format-global.js (LIN-4446): the one bridge from the shared formatter to the classic page scripts.
 *
 * Loaded as `<script type="module">` (renderPage's `{ module }` entry). The import of '../lib/cost-format.js' resolves to
 * /lib/cost-format.js, which is lib/cost-format.js served as-is, so this is the one implementation the server also runs.
 * Module scripts run after the document is parsed and before DOMContentLoaded, so a classic script that reads
 * window.CostFormat during its own execution sees nothing. Consumers read it only from handlers and callbacks that run
 * after that point. Pages that are themselves modules import '../lib/cost-format.js' directly and do not need this bridge
 * (LIN-4471: workspace-kpis.js). The bridge's names and readers are inventoried in tests/unit/bridge-inventory.test.js.
 */
import { formatUsd } from '../lib/cost-format.js';

window.CostFormat = { formatUsd };
