import { BUDGET_COLORS } from './constants.js';

/**
 * Daily budgets.
 *
 * Two kinds of budget are supported:
 *   - `dailyBudget`          — the whole account (all API keys);
 *   - `keyBudgets[apiKeyId]` — an individual budget per API key.
 *
 * They are independent: a key budget can be set even when the account budget
 * is off, and the most severe active budget decides the badge colour.
 */

const OFF = { status: 'off', budget: 0, spent: 0, percent: 0, remaining: null, color: BUDGET_COLORS.neutral };
const SEVERITY = { over: 3, warn: 2, ok: 1, off: 0 };

/**
 * Evaluates one spend/budget pair.
 * Accepts either a settings object (legacy call sites) or a raw budget number.
 */
export function evaluateBudget(spent, settingsOrBudget, warnPercentMaybe) {
  const isNumber = typeof settingsOrBudget === 'number';
  const budget = isNumber ? Number(settingsOrBudget) || 0 : Number(settingsOrBudget?.dailyBudget) || 0;
  const warn = isNumber ? Number(warnPercentMaybe) || 90 : Number(settingsOrBudget?.budgetWarnPercent) || 90;
  return evaluate(spent, budget, warn);
}

function evaluate(spent, budget, warnPercent) {
  const spentValue = Number(spent) || 0;
  if (!(budget > 0)) return { ...OFF, spent: spentValue };

  const percent = (spentValue / budget) * 100;
  let status = 'ok';
  if (spentValue >= budget) status = 'over';
  else if (spentValue >= budget * (warnPercent / 100)) status = 'warn';

  return {
    status,
    budget,
    spent: spentValue,
    percent,
    remaining: budget - spentValue,
    color: BUDGET_COLORS[status],
  };
}

/** Cost spent today, restricted to the given key ids (empty list = all keys). */
export function spentToday(usage, keyIds = []) {
  if (!usage) return 0;
  if (!keyIds.length) return Number(usage.todayCost) || 0;
  return keyIds.reduce((total, id) => {
    const key = findKey(usage, id);
    return total + (Number(key?.todayCost) || 0);
  }, 0);
}

export function findKey(usage, id) {
  return usage?.keys?.find((entry) => entry.id === id || entry.name === id) || null;
}

/**
 * Full budget picture for the current selection.
 *
 * Returns `{ account, keys[], worst }`; `worst` is the most severe active
 * budget and is what colours the badge.
 */
export function evaluateBudgets(usage, settings, selectedKeyIds = []) {
  const warnPercent = Number(settings?.budgetWarnPercent) || 90;
  const keyBudgets = settings?.keyBudgets || {};

  // The account budget is measured on the selection: choosing two keys means
  // "these two together", no selection means the whole account.
  const account = evaluate(
    spentToday(usage, selectedKeyIds),
    Number(settings?.dailyBudget) || 0,
    warnPercent,
  );

  const perKey = selectedKeyIds
    .map((id) => {
      const key = findKey(usage, id);
      const budget = Number(keyBudgets[id]) || 0;
      if (!(budget > 0)) return null;
      return { id, name: key?.name || id, ...evaluate(key?.todayCost ?? 0, budget, warnPercent) };
    })
    .filter(Boolean);

  const active = [account, ...perKey].filter((entry) => entry.status !== 'off');
  const worst = active.sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status])[0] || { ...OFF };

  return { account, keys: perKey, worst, warnPercent };
}

/** Stable identifier of a budget crossing, used to de-duplicate notifications. */
export function budgetNoticeKey(scope, status, dayKey) {
  return `${dayKey}:${scope}:${status}`;
}
