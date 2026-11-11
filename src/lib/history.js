/**
 * Day-by-day spend maths: comparisons, averages and depletion estimates.
 *
 * The ledger these functions operate on is built from the API by `ledger.js`
 * and lives in `snapshot.ledger` — nothing is accumulated in storage, so a
 * fresh install has the full history on its very first refresh.
 *
 * Shape: `{ currency, days: { 'YYYY-MM-DD': { cost, tokens } }, keys: { id: { day: cost } } }`
 */

const DAY_MS = 86400000;

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
  // `null` = the API has not told us yet; comparing against it would claim a
  // 100% drop for what is really a missing number.
  const todayCost =
    usage?.todayCost === null || usage?.todayCost === undefined || usage?.todayUnknown
      ? null
      : Number(usage.todayCost) || 0;
  const hasYesterday = Number.isFinite(yesterday);

  return {
    todayKey,
    yesterdayKey,
    todayCost,
    yesterday: hasYesterday ? Number(yesterday) : null,
    delta: hasYesterday && todayCost !== null ? todayCost - Number(yesterday) : 0,
    ratio: hasYesterday && yesterday > 0 && todayCost !== null ? todayCost / Number(yesterday) : 0,
    comparable: hasYesterday && Number(yesterday) > 0 && todayCost !== null,
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
