import { BUDGET_COLORS } from './constants.js';
import { evaluateBudget } from './budget.js';
import { formatBadgeValue } from './format.js';

/**
 * Works out what to paint on the toolbar icon.
 * Returns `{ text, color, title, value, metric }`.
 */
export function computeBadge(snapshot, settings) {
  const metric = settings.badgeMetric || 'todayCost';
  const scoped = scopeUsage(snapshot, settings.badgeApiKey);

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
  let currency = scoped.currency || 'USD';

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

  const text = formatBadgeValue(metric, value, {
    currency,
    format: settings.badgeFormat,
  });

  let color = metric === 'balance' ? BUDGET_COLORS.balance : BUDGET_COLORS.neutral;

  const lowBalance = Number(settings.lowBalanceThreshold) || 0;
  if (metric === 'balance' && lowBalance > 0 && value < lowBalance) color = BUDGET_COLORS.over;

  // Spend metrics are coloured by the daily budget (green / orange / red).
  const budget = evaluateBudget(scoped.todayCost, settings);
  if (metric !== 'balance' && budget.status !== 'off') color = budget.color;

  return {
    text,
    color,
    title: buildTitle(scoped, settings, metric, budget),
    value,
    metric,
    currency,
  };
}

/** Restricts a usage snapshot to one API key when `apiKeyId` is set. */
export function scopeUsage(snapshot, apiKeyId) {
  if (!snapshot?.usage) return null;
  const usage = snapshot.usage;
  const balance = snapshot.balance || null;

  if (!apiKeyId) {
    return {
      currency: usage.currency,
      todayCost: usage.todayCost,
      todayTokens: usage.todayTokens,
      windowCost: usage.windowCost,
      windowTokens: usage.windowTokens,
      balance,
      key: null,
    };
  }

  const keyMatch =
    usage.keys.find((key) => key.id === apiKeyId) ||
    usage.keys.find((key) => key.name === apiKeyId) ||
    null;
  if (!keyMatch) return null;

  return {
    currency: usage.currency,
    todayCost: keyMatch.todayCost,
    todayTokens: keyMatch.todayTokens,
    windowCost: keyMatch.windowCost,
    windowTokens: keyMatch.windowTokens,
    balance: null,
    key: keyMatch,
  };
}

function buildTitle(scoped, settings, metric, budget) {
  const keyLabel = scoped.key ? ` · ${scoped.key.name}` : '';
  const money = (value) => `${scoped.currency} ${Number(value).toFixed(4)}`;
  const label = {
    balance: `Balance ${money(scoped.balance?.total ?? 0)}`,
    monthCost: `${settings.windowDays}d spend ${money(scoped.windowCost)}`,
    todayTokens: `Today ${Math.round(scoped.todayTokens).toLocaleString('en-US')} tokens`,
    todayCost: `Today ${money(scoped.todayCost)}`,
  }[metric];

  const parts = [`DeepSeek${keyLabel}: ${label}`];
  if (budget?.status !== 'off') {
    const pct = Math.round(budget.percent);
    const state = budget.status === 'over' ? 'over budget' : budget.status === 'warn' ? 'close to budget' : 'within budget';
    const left = budget.remaining >= 0 ? `${money(budget.remaining)} left` : `${money(-budget.remaining)} over`;
    parts.push(`${pct}% of ${money(budget.budget)} daily budget (${state}, ${left})`);
  }
  return parts.join('\n');
}
