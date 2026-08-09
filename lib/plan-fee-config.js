/**
 * Plan-fee configuration seam (LIN-1958, Session 2 of LIN-1625, beat 1/4).
 *
 * Schema/config only: exposes whatever plan-fee amount an operator has set
 * via env var, or `null` when unset — modeled on the `|| null` env-config
 * convention in lib/deploy-info.js (no DB, no default value invented, read
 * fresh per call so a restart with the var set takes effect immediately).
 *
 * The amortisation rule that would turn this raw amount into a cash-per-task
 * figure — over what period, across which workspaces, and what a
 * zero-terminal-marked-task period publishes — is an explicit open item this
 * session does not resolve. Reading the configured value is the whole seam;
 * a consumer with no value set must render an explicit "—", never `$0`.
 */
export function getPlanFeeConfig() {
  const raw = process.env.PLAN_FEE_MONTHLY_USD;
  if (raw === undefined || raw === '') return { monthlyUsd: null };
  const monthlyUsd = Number(raw);
  return { monthlyUsd: Number.isFinite(monthlyUsd) ? monthlyUsd : null };
}
