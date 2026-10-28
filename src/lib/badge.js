import { BUDGET_COLORS } from './constants.js';
import { evaluateBudgets } from './budget.js';
import { formatBadgeValue } from './format.js';
import { t } from './i18n.js';

/**
 * Works out what to paint on the toolbar icon.
 * Returns `{ text, color, title, value, metric, currency }`.
 */
export function computeBadge(snapshot, settings) {
  const metric = settings.badgeMetric || 'todayCost';
  // The wallet balance is account-wide, so a key selection cannot narrow it.
  const keyIds =
    metric === 'balance' ? [] : Array.isArray(settings.badgeApiKeys) ? settings.badgeApiKeys : [];
  const scoped = scopeUsage(snapshot, keyIds);

  if (!scoped) {
    const authProblem = snapshot?.lastErrorKind === 'auth';
    return {
      text: authProblem ? '!' : '—',
      color: authProblem ? '#dc2626' : '#6b7280',
      title: authProblem ? t('badgeSessionExpired') : t('badgeNoData'),
      value: null,
      metric,
    };
  }

  let value = 0;
  const currency = scoped.currency || 'USD';

  switch (metric) {
    case 'balance':
      value = scoped.balance?.total ?? 0;
      break;
    case 'monthCost':
      value = scoped.windowCost;
      break;
    case 'todayTokens':
      value = scoped.todayTokens;
      break;
    case 'todayCost':
    default:
      value = scoped.todayCost;
      break;
  }

  const text = formatBadgeValue(value);

  let color = metric === 'balance' ? BUDGET_COLORS.balance : BUDGET_COLORS.neutral;

  const lowBalance = Number(settings.lowBalanceThreshold) || 0;
  if (metric === 'balance' && lowBalance > 0 && value < lowBalance) color = BUDGET_COLORS.over;

  // Spend metrics are coloured by whichever daily budget is closest to its limit.
  const budgets = evaluateBudgets(snapshot?.usage, settings, keyIds);
  if (metric !== 'balance' && budgets.worst.status !== 'off') color = budgets.worst.color;

  return {
    text,
    color,
    title: buildTitle(scoped, settings, metric, budgets),
    value,
    metric,
    currency,
  };
}

/**
 * Restricts a usage snapshot to a set of API keys.
 * An empty list means the whole account. Returns `null` when a selected key is
 * gone from the current payload (the badge then shows a dash).
 */
export function scopeUsage(snapshot, keyIds) {
  if (!snapshot?.usage) return null;
  const usage = snapshot.usage;
  const balance = snapshot.balance || null;
  const ids = (Array.isArray(keyIds) ? keyIds : [keyIds]).filter(Boolean);

  if (!ids.length) {
    return {
      currency: usage.currency,
      todayCost: usage.todayCost,
      todayTokens: usage.todayTokens,
      windowCost: usage.windowCost,
      windowTokens: usage.windowTokens,
      balance,
      keys: [],
    };
  }

  const matched = ids.map((id) => findKey(usage, id)).filter(Boolean);
  if (!matched.length) return null;

  return {
    currency: usage.currency,
    todayCost: sum(matched, 'todayCost'),
    todayTokens: sum(matched, 'todayTokens'),
    windowCost: sum(matched, 'windowCost'),
    windowTokens: sum(matched, 'windowTokens'),
    // The wallet balance is account-wide, it makes no sense per key.
    balance: null,
    keys: matched,
  };
}

function findKey(usage, id) {
  return usage.keys.find((key) => key.id === id) || usage.keys.find((key) => key.name === id) || null;
}

function sum(keys, field) {
  return keys.reduce((total, key) => total + (Number(key[field]) || 0), 0);
}

function buildTitle(scoped, settings, metric, budgets) {
  const names = scoped.keys.map((key) => key.name).filter(Boolean);
  const keyLabel =
    names.length === 1
      ? t('badgeScopeKey', [names[0]])
      : names.length > 1
        ? ` · ${t('keysCount', [String(names.length)])}`
        : '';
  const money = (value) => `${scoped.currency} ${Number(value).toFixed(4)}`;
  const label = {
    balance: t('badgeLabelBalance', [money(scoped.balance?.total ?? 0)]),
    monthCost: t('badgeLabelPeriod', [String(settings.windowDays), money(scoped.windowCost)]),
    todayTokens: t('badgeLabelTodayTokens', [Math.round(scoped.todayTokens).toLocaleString()]),
    todayCost: t('badgeLabelTodayCost', [money(scoped.todayCost)]),
  }[metric];

  const parts = [t('badgeTitle', [keyLabel, label])];

  for (const line of budgetLines(budgets, money)) parts.push(line);

  return parts.join('\n');
}

function budgetLines(budgets, money) {
  const lines = [];
  const describe = (budget, scope) => {
    const pct = Math.round(budget.percent);
    const state =
      budget.status === 'over'
        ? t('budgetStateOver')
        : budget.status === 'warn'
          ? t('budgetStateWarn')
          : t('budgetStateOk');
    const left =
      budget.remaining >= 0
        ? t('budgetLeft', [money(budget.remaining)])
        : t('budgetOverBy', [money(-budget.remaining)]);
    return t('budgetLine', [scope, String(pct), money(budget.budget), state, left]);
  };

  if (budgets.account.status !== 'off') lines.push(describe(budgets.account, ''));
  for (const budget of budgets.keys) lines.push(describe(budget, `${budget.name}: `));
  return lines;
}
