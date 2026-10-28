import { BUDGET_COLORS } from './constants.js';
import { evaluateBudgets } from './budget.js';
import { formatBadgeValue } from './format.js';

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
      title: authProblem
        ? 'DeepSeek Usage — session expired, sign in on platform.deepseek.com'
        : 'DeepSeek Usage — no data yet, click to refresh',
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
  const keyLabel = names.length === 1 ? ` · ${names[0]}` : names.length > 1 ? ` · ${names.length} keys` : '';
  const money = (value) => `${scoped.currency} ${Number(value).toFixed(4)}`;
  const label = {
    balance: `Balance ${money(scoped.balance?.total ?? 0)}`,
    monthCost: `${settings.windowDays}d spend ${money(scoped.windowCost)}`,
    todayTokens: `Today ${Math.round(scoped.todayTokens).toLocaleString('en-US')} tokens`,
    todayCost: `Today ${money(scoped.todayCost)}`,
  }[metric];

  const parts = [`DeepSeek${keyLabel}: ${label}`];

  for (const line of budgetLines(budgets, money)) parts.push(line);

  return parts.join('\n');
}

function budgetLines(budgets, money) {
  const lines = [];
  const describe = (budget, scope) => {
    const pct = Math.round(budget.percent);
    const state =
      budget.status === 'over' ? 'over budget' : budget.status === 'warn' ? 'close to budget' : 'within budget';
    const left = budget.remaining >= 0 ? `${money(budget.remaining)} left` : `${money(-budget.remaining)} over`;
    return `${scope}${pct}% of ${money(budget.budget)} daily budget (${state}, ${left})`;
  };

  if (budgets.account.status !== 'off') lines.push(describe(budgets.account, ''));
  for (const budget of budgets.keys) lines.push(describe(budget, `${budget.name}: `));
  return lines;
}
