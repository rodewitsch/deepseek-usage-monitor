import { ENDPOINTS, PLATFORM_ORIGIN } from './constants.js';
import {
  ApiError,
  dayKeyFromUnix,
  isAuthCode,
  localDayKey,
  normaliseApiKeyIdentity,
  toNumber,
  unwrapEnvelope,
} from './format.js';
import { requestPlatformJson } from './http.js';

/**
 * Thin client for the (undocumented) DeepSeek console API.
 * Every request carries the console session token as a Bearer token.
 */

/** Wallet balance from the platform console (`normal_wallets` + `bonus_wallets`). */
export function parseBalance(summaryPayload) {
  const bizData = unwrapEnvelope(summaryPayload, 'balance');
  const paid = sumWallets(bizData?.normal_wallets);
  const granted = sumWallets(bizData?.bonus_wallets);
  const currency = pickCurrency([...paid.keys(), ...granted.keys()]);
  const toppedUp = paid.get(currency) || 0;
  const bonus = granted.get(currency) || 0;

  return {
    currency,
    total: toppedUp + bonus,
    toppedUp,
    granted: bonus,
    isAvailable: toppedUp + bonus > 0,
  };
}

function sumWallets(wallets) {
  const totals = new Map();
  for (const wallet of Array.isArray(wallets) ? wallets : []) {
    const currency = String(wallet?.currency || '').toUpperCase();
    if (!currency) continue;
    totals.set(currency, (totals.get(currency) || 0) + toNumber(wallet.balance));
  }
  return totals;
}

function pickCurrency(currencies) {
  if (currencies.includes('USD')) return 'USD';
  if (currencies.includes('CNY')) return 'CNY';
  return currencies[0] || 'USD';
}

/**
 * The console only accepts day-aligned starts (00:00 UTC of the requested day)
 * plus the caller's UTC offset as `tz`; arbitrary seconds → `biz_code 1
 * INVALID_PARAM`. Windows longer than 31 days are rejected as well.
 */
export function usageWindow({ windowDays = 30, now = new Date() } = {}) {
  const tz = -now.getTimezoneOffset() * 60;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(dayStart);
  startDay.setDate(startDay.getDate() - (Math.min(windowDays, MAX_WINDOW_DAYS) - 1));

  const toUnix = (date) => Math.floor(date.getTime() / 1000) - tz;
  return { start: toUnix(startDay), end: toUnix(dayStart) + 86400, tz };
}

const MAX_WINDOW_DAYS = 31;

/** Today only: the API switches to hourly buckets for a single day. */
function todayWindow(now) {
  const { start, end, tz } = usageWindow({ windowDays: 1, now });
  return { start, end, tz };
}

/**
 * Usage for the last `windowDays` days, split per API key, model and day.
 * Returns a normalised structure independent from the raw payload shape.
 */
export async function fetchUsageByKey(token, { windowDays = 30, now = new Date() } = {}) {
  const window = usageWindow({ windowDays, now });
  const todayRange = todayWindow(now);

  const qs = ({ start, end, tz }) => new URLSearchParams({ start: String(start), end: String(end), tz: String(tz) });

  const [amountPayload, costPayload, todayAmountPayload, todayCostPayload] = await Promise.all([
    requestPlatformJson(`${ENDPOINTS.usageAmountByKey}?${qs(window)}`, token),
    requestPlatformJson(`${ENDPOINTS.usageCostByKey}?${qs(window)}`, token),
    requestPlatformJson(`${ENDPOINTS.usageAmountByKey}?${qs(todayRange)}`, token),
    requestPlatformJson(`${ENDPOINTS.usageCostByKey}?${qs(todayRange)}`, token),
  ]);

  const amountData = unwrapEnvelope(amountPayload, 'usage/amount');
  const costData = unwrapEnvelope(costPayload, 'usage/cost');
  const todayAmountData = unwrapEnvelope(todayAmountPayload, 'today/amount');
  const todayCostData = unwrapEnvelope(todayCostPayload, 'today/cost');

  const keys = new Map();
  const daily = new Map();
  const models = new Map();

  const ensureKey = (identity) => {
    const id = identity.id;
    if (!keys.has(id)) {
      keys.set(id, {
        id,
        name: identity.name,
        todayCost: 0,
        windowCost: 0,
        todayTokens: 0,
        windowTokens: 0,
        lastUsedDay: null,
      });
    }
    return keys.get(id);
  };

  const todayKey = localDayKey(now);

  for (const series of Array.isArray(amountData?.series) ? amountData.series : []) {
    const identity = normaliseApiKeyIdentity(series.api_key);
    const key = ensureKey(identity);
    const model = series.model || 'unknown';

    for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
      const day = dayKeyFromUnix(bucket.time, window.tz);
      let tokens = 0;
      for (const [type, value] of Object.entries(bucket.usage || {})) {
        if (String(type).toUpperCase() === 'REQUEST') continue;
        tokens += toNumber(value);
      }
      if (!tokens) continue;

      const dayEntry = daily.get(day) || createDay(day);
      dayEntry.tokens += tokens;
      daily.set(day, dayEntry);
      key.windowTokens += tokens;
      models.set(model, (models.get(model) || 0) + tokens);
      key.lastUsedDay = maxDay(key.lastUsedDay, day);
    }
  }

  const costBlocks = Array.isArray(costData?.data) ? costData.data : [];
  for (const block of costBlocks) {
    const currency = String(block?.currency || '').toUpperCase();
    for (const series of Array.isArray(block?.series) ? block.series : []) {
      const identity = normaliseApiKeyIdentity(series.api_key);
      const key = ensureKey(identity);

      // Each (api_key, model) series carries its own cost buckets, and they
      // must all be summed — do NOT dedupe by timestamp.
      for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
        const day = dayKeyFromUnix(bucket.time, window.tz);
        const amount = toNumber(bucket.cost);
        if (!amount) continue;

        const dayEntry = daily.get(day) || createDay(day);
        dayEntry.costs[currency] = (dayEntry.costs[currency] || 0) + amount;
        daily.set(day, dayEntry);
        key.windowCost += amount;
        key.lastUsedDay = maxDay(key.lastUsedDay, day);
      }
    }
  }

  const currency = pickCurrency(
    [...new Set(costBlocks.map((block) => String(block?.currency || '').toUpperCase()).filter(Boolean))],
  );

  // Hourly "today" series → per-key and total figures for the current day.
  let todayCost = 0;
  let todayTokens = 0;

  for (const series of Array.isArray(todayAmountData?.series) ? todayAmountData.series : []) {
    const key = ensureKey(normaliseApiKeyIdentity(series.api_key));
    for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
      let tokens = 0;
      for (const [type, value] of Object.entries(bucket.usage || {})) {
        if (String(type).toUpperCase() === 'REQUEST') continue;
        tokens += toNumber(value);
      }
      key.todayTokens += tokens;
      todayTokens += tokens;
    }
  }

  const todayBlocks = Array.isArray(todayCostData?.data) ? todayCostData.data : [];
  const todayCurrency = todayBlocks.some((block) => String(block?.currency || '').toUpperCase() === currency)
    ? currency
    : pickCurrency(todayBlocks.map((block) => String(block?.currency || '').toUpperCase()).filter(Boolean));

  for (const block of todayBlocks) {
    if (String(block?.currency || '').toUpperCase() !== todayCurrency) continue;
    for (const series of Array.isArray(block?.series) ? block.series : []) {
      const key = ensureKey(normaliseApiKeyIdentity(series.api_key));
      for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
        const amount = toNumber(bucket.cost);
        key.todayCost += amount;
        todayCost += amount;
      }
    }
  }

  let windowCost = 0;
  let windowTokens = 0;
  const dailyList = [];

  // Walk every calendar day of the window so days without spend still render
  // as a (flat) bar instead of disappearing from the chart.
  // NOTE: step in UTC milliseconds — `cursor.setDate()` works in local time and
  // would skip a day because the cursor starts at a UTC-shifted midnight.
  const startMs = (window.start + window.tz) * 1000;
  const endMs = (window.end + window.tz) * 1000;
  for (let ms = startMs + 86400000; ms < endMs; ms += 86400000) {
    const key = new Date(ms).toISOString().slice(0, 10);
    if (key > todayKey) break;
    const day = daily.get(key);
    const cost = day?.costs[currency] || 0;
    const tokens = day?.tokens || 0;
    dailyList.push({ date: key, cost, tokens });
    windowCost += cost;
    windowTokens += tokens;
  }

  // Today comes from the fresher hourly series; prefer it over the daily rollup.
  const todayBar = dailyList.find((bar) => bar.date === todayKey);
  if (todayBar) {
    diffOut(todayBar);
    todayBar.cost = todayCost;
    todayBar.tokens = todayTokens;
  } else {
    dailyList.push({ date: todayKey, cost: todayCost, tokens: todayTokens });
  }

  function diffOut(bar) {
    windowCost -= bar.cost;
    windowTokens -= bar.tokens;
  }

  windowCost += todayCost;
  windowTokens += todayTokens;

  return {
    currency,
    todayCost,
    todayTokens,
    windowCost,
    windowTokens,
    daily: dailyList,
    keys: [...keys.values()].sort((a, b) => b.windowCost - a.windowCost),
    models: [...models.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
    windowStart: new Date(window.start * 1000).toISOString(),
    windowEnd: new Date(window.end * 1000).toISOString(),
    timezoneOffsetSeconds: window.tz,
  };
}

function createDay(date) {
  return { date, tokens: 0, costs: {} };
}

function maxDay(current, candidate) {
  return !current || candidate > current ? candidate : current;
}

export { PLATFORM_ORIGIN, isAuthCode, ApiError };
