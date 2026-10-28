import { BUDGET_COLORS } from './constants.js';

/**
 * Daily-budget evaluation.
 *
 * Status:
 *   - `off`   — no budget configured
 *   - `ok`    — below the warn ratio (green)
 *   - `warn`  — at/above the warn ratio, below the budget (orange)
 *   - `over`  — at/above the budget (red)
 */
export function evaluateBudget(spent, settings) {
  const budget = Number(settings?.dailyBudget) || 0;
  const spentValue = Number(spent) || 0;

  if (!(budget > 0)) {
    return { status: 'off', budget: 0, spent: spentValue, percent: 0, remaining: null, color: BUDGET_COLORS.neutral };
  }

  const warnRatio = (Number(settings?.budgetWarnPercent) || 90) / 100;
  const percent = (spentValue / budget) * 100;

  let status = 'ok';
  if (spentValue >= budget) status = 'over';
  else if (spentValue >= budget * warnRatio) status = 'warn';

  return {
    status,
    budget,
    spent: spentValue,
    percent,
    remaining: budget - spentValue,
    color: BUDGET_COLORS[status],
  };
}

/** Stable identifier of a budget crossing, used to de-duplicate notifications. */
export function budgetNoticeKey(status, dayKey) {
  return `${dayKey}:${status}`;
}
