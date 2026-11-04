/**
 * Local daily history.
 *
 * The console API only serves a 31-day, day-aligned window, so anything longer
 * has to be accumulated here. Every successful refresh merges the API's daily
 * series into `history.days` (a day is overwritten, never summed — the API is
 * the source of truth while a day is still inside the window) and the result
 * is persisted to `chrome.storage.local`. Days older than the API window stay
 * in the record, which is the whole point of the module.
 *
 * Per-key daily totals live under `history.keys` so a future chart can plot a
 * key over the full history. The current currency is remembered as well: mixing
 * USD and CNY rows in one chart would be meaningless.
 */

const DAY_MS = 86400000;

export const HISTORY_KEY = 'usageHistory';
/** Hard cap on retained days (~5 years) — a safety net, not a product limit. */
export const HISTORY_MAX_DAYS = 1830;

/** Fresh, empty history object. */
export function emptyHistory() {
  return { currency: null, days: {}, keys: {}, updatedAt: null };
}

/** Normalises whatever is stored (or `undefined`) into a complete shape. */
export function normaliseHistory(raw) {
  const history = emptyHistory();
  if (!raw || typeof raw !== 'object') return history;

  history.currency = typeof raw.currency === 'string' && raw.currency ? raw.currency : null;
  history.updatedAt = Number(raw.updatedAt) || null;

  for (const [date, day] of Object.entries(raw.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== 'object') continue;
    history.days[date] = {
      cost: Number(day.cost) || 0,
      tokens: Number(day.tokens) || 0,
    };
  }

  for (const [id, series] of Object.entries(raw.keys || {})) {
    if (!series || typeof series !== 'object') continue;
    const cleaned = {};
    for (const [date, cost] of Object.entries(series)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const value = Number(cost) || 0;
      if (value) cleaned[date] = value;
    }
    if (Object.keys(cleaned).length) history.keys[String(id)] = cleaned;
  }

  return history;
}

/**
 * Merges one refresh into the history.
 *
 * @param {object} history      current (normalised) history
 * @param {object} usage        the `usage` object from `refreshUsage()`
 * @param {object} options
 * @param {string} options.todayKey  today as `YYYY-MM-DD` in the machine's zone
 * @param {number} [options.now]     timestamp used for `updatedAt`
 * @param {boolean} [options.trusted] true when the numbers come from the API;
 *        scraped page values may only fill days the history does not know yet.
 * @returns {{history: object, changed: boolean, addedDays: string[], firstDay: string|null}}
 */
export function mergeUsageIntoHistory(history, usage, { todayKey, now = Date.now(), trusted = true } = {}) {
  const next = normaliseHistory(history);
  const currency = usage?.currency || next.currency || 'USD';
  const before = snapshotFingerprint(next);

  // A currency switch invalidates the stored costs (they are amounts, not
  // ratios). Keep nothing rather than silently mixing two currencies.
  if (next.currency && next.currency !== currency) {
    next.days = {};
    next.keys = {};
  }
  next.currency = currency;

  const daily = Array.isArray(usage?.daily) ? usage.daily : [];
  for (const day of daily) {
    if (!day?.date) continue;
    const cost = Number(day.cost) || 0;
    const tokens = Number(day.tokens) || 0;
    const known = next.days[day.date];

    if (!trusted && known) continue;
    // The page only knows the current window total; do not let it blank a day.
    if (!trusted && cost === 0 && tokens === 0) continue;

    next.days[day.date] = { cost, tokens };
  }

  const keys = Array.isArray(usage?.keys) ? usage.keys : [];
  for (const key of keys) {
    if (!key?.id) continue;
    const series = next.keys[key.id] || {};
    for (const [date, cost] of Object.entries(key.dailyCost || {})) {
      if (!trusted && series[date]) continue;
      const value = Number(cost) || 0;
      if (value) series[date] = value;
    }
    if (Object.keys(series).length) next.keys[key.id] = series;
  }

  const trimmed = trimHistory(next);
  trimmed.updatedAt = now;

  const firstDay = firstRecordedDay(trimmed);
  const addedDays = sortedDays(trimmed).filter(
    (date) => !before.days[date] || before.days[date] !== fingerprintDay(trimmed.days[date]),
  );
  return {
    history: trimmed,
    changed: snapshotFingerprint(trimmed).fingerprint !== before.fingerprint || before.firstDay !== firstDay,
    addedDays,
    firstDay,
  };
}

/**
 * Keeps only the newest `HISTORY_MAX_DAYS` days. Key series are trimmed to the
 * remaining range too, so the record cannot grow through abandoned keys.
 */
export function trimHistory(history) {
  const days = sortedDays(history);
  if (days.length > HISTORY_MAX_DAYS) {
    const cutoff = days[days.length - HISTORY_MAX_DAYS];
    for (const date of days) {
      if (date < cutoff) delete history.days[date];
    }
  }

  const oldest = firstRecordedDay(history);
  if (!oldest) return history;
  for (const [id, series] of Object.entries(history.keys)) {
    for (const date of Object.keys(series)) {
      if (date < oldest) delete series[date];
    }
    if (!Object.keys(series).length) delete history.keys[id];
  }
  return history;
}

/** `YYYY-MM-DD` keys, ascending. */
export function sortedDays(history) {
  return Object.keys(history?.days || {}).sort();
}

export function firstRecordedDay(history) {
  const days = sortedDays(history);
  return days[0] || null;
}

/** Sum of `history.days` cost for [from, to] (`YYYY-MM-DD`, inclusive). */
export function sumHistoryCost(history, { from = null, to = null } = {}) {
  let total = 0;
  for (const date of sortedDays(history)) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    total += Number(history.days[date]?.cost) || 0;
  }
  return total;
}

/** Days in [from, to] that actually have a recorded cost > 0. */
export function countSpendDays(history, { from = null, to = null } = {}) {
  let count = 0;
  for (const date of sortedDays(history)) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    if ((Number(history.days[date]?.cost) || 0) > 0) count += 1;
  }
  return count;
}

/** `YYYY-MM-DD` shifted by `delta` days, without touching the machine's zone rules (UTC math). */
export function shiftDayKey(dayKey, delta) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + delta * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

/** First day of the month `monthsAgo` months before `dayKey`. */
export function monthStart(dayKey, monthsAgo = 0) {
  const [year, month] = String(dayKey).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 - monthsAgo, 1));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Month-over-month comparison of complete calendar months, plus the same
 * day-of-month split for the running month (a fair "this month so far").
 *
 * @returns {{
 *   currentMonth: string, previousMonth: string,
 *   current: number|null, previous: number|null,
 *   ratio: number, comparable: boolean,
 *   monthStart: string, sameDaysPrevious: number|null, sameDaysCurrent: number|null,
 *   sameDaysRatio: number, sameDaysComparable: boolean
 * }}
 */
export function compareMonths(history, todayKey, { monthsAgo = 1 } = {}) {
  const currentStart = monthStart(todayKey, 0);
  const previousStart = monthStart(todayKey, monthsAgo);
  // `previousEnd` = the day before the current month starts, so it also works
  // with `monthsAgo > 1`; "same days" is clamped to that end (e.g. Feb 28).
  const previousEnd = shiftDayKey(currentStart, -1);

  const current = sumHistoryCost(history, { from: currentStart, to: todayKey });
  const previous = sumHistoryCost(history, { from: previousStart, to: previousEnd });

  // "Same days" = the first N days of the previous month, N = today's date.
  // Derived from the previous month's first day and clamped to its last day,
  // so a 31st never overflows into the next month (Feb 29 included).
  const previousFirst = `${previousStart.slice(0, 8)}01`;
  const sameDaysToRaw = shiftDayKey(previousFirst, Number(todayKey.slice(8, 10)) - 1);
  const sameDaysTo = sameDaysToRaw > previousEnd ? previousEnd : sameDaysToRaw;
  const sameDaysPrevious = sumHistoryCost(history, { from: previousStart, to: sameDaysTo });
  const sameDaysCurrent = current;

  const hasMonth = countSpendDays(history, { from: previousStart, to: previousEnd }) > 0;
  return {
    currentMonth: currentStart.slice(0, 7),
    previousMonth: previousStart.slice(0, 7),
    current,
    previous: hasMonth ? previous : null,
    ratio: hasMonth && previous > 0 ? current / previous : 0,
    comparable: hasMonth && previous > 0,
    monthStart: currentStart,
    sameDaysPrevious: hasMonth ? sameDaysPrevious : null,
    sameDaysCurrent,
    sameDaysRatio: hasMonth && sameDaysPrevious > 0 ? sameDaysCurrent / sameDaysPrevious : 0,
    sameDaysComparable: hasMonth && sameDaysPrevious > 0,
    sameDaysUntil: sameDaysTo,
  };
}

/**
 * Today vs. yesterday. Yesterday is only taken from the history, so a refresh
 * that has not yet seen the API still yields a meaningful number.
 */
export function compareToday(usage, history, todayKey) {
  const yesterdayKey = shiftDayKey(todayKey, -1);
  const yesterday = history?.days?.[yesterdayKey]?.cost;
  const todayCost = Number(usage?.todayCost) || 0;
  const hasYesterday = Number.isFinite(yesterday);

  return {
    todayKey,
    yesterdayKey,
    todayCost,
    yesterday: hasYesterday ? Number(yesterday) : null,
    delta: hasYesterday ? todayCost - Number(yesterday) : 0,
    ratio: hasYesterday && yesterday > 0 ? todayCost / Number(yesterday) : 0,
    comparable: hasYesterday && Number(yesterday) > 0,
  };
}

/**
 * Average daily spend from the history (days with no spend count as zero, so
 * a quiet weekend genuinely lowers the pace).
 *
 * @returns {{average: number, days: number, spendDays: number}}
 */
export function dailyAverage(history, { from = null, to = null } = {}) {
  const days = sortedDays(history).filter((date) => (!from || date >= from) && (!to || date <= to));
  if (!days.length) return { average: 0, days: 0, spendDays: 0 };

  const total = days.reduce((sum, date) => sum + (Number(history.days[date]?.cost) || 0), 0);
  const spendDays = days.filter((date) => (Number(history.days[date]?.cost) || 0) > 0).length;
  return { average: total / days.length, days: days.length, spendDays, total };
}

/**
 * "Balance runs out on …": balance ÷ average daily spend.
 *
 * @param {number} balance     current wallet balance
 * @param {number} average     average daily spend (from the history)
 * @param {string} todayKey
 * @returns {{runsOutOn: string, daysLeft: number, depleted: boolean, perDay: number}|null}
 *   `null` when there is no meaningful average or balance.
 */
export function estimateDepletion(balance, average, todayKey) {
  const amount = Number(balance);
  const perDay = Number(average);
  if (!Number.isFinite(amount) || !Number.isFinite(perDay) || perDay <= 0) return null;
  if (amount <= 0) return { runsOutOn: todayKey, daysLeft: 0, depleted: true, perDay };

  const daysLeft = Math.floor(amount / perDay);
  return {
    runsOutOn: shiftDayKey(todayKey, daysLeft),
    daysLeft,
    depleted: false,
    perDay,
  };
}

function snapshotFingerprint(history) {
  const days = {};
  for (const date of sortedDays(history)) days[date] = fingerprintDay(history.days[date]);
  return {
    days,
    keys: JSON.stringify(Object.entries(history.keys).sort()),
    currency: history.currency,
    firstDay: firstRecordedDay(history),
    fingerprint: `${history.currency}|${JSON.stringify(days)}|${Object.keys(history.keys).length}`,
  };
}

function fingerprintDay(day) {
  return `${Number(day?.cost) || 0}:${Number(day?.tokens) || 0}`;
}
