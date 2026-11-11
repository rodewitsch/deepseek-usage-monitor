/**
 * Alert rules for Milestone 3 — all pure functions, no chrome.* and no DOM:
 *
 *   - pace alert   — the projected end-of-day spend will exceed the budget
 *                    while today's spend has not crossed it yet;
 *   - spike alert  — a day (or a key) is far above the rolling average, which
 *                    is what a runaway loop or a leaked key looks like;
 *   - key alerts   — a new API key appeared, or a key has not been used for N
 *                    days (its budget is still being paid for nothing).
 *
 * Notifications are de-duplicated by the caller with the marker helpers at the
 * bottom; this module only decides *what* is worth telling the user.
 */

import { projectToday } from './forecast.js';
import { shiftDayKey } from './history.js';

/** Minimum spend for a spike alert — no point shouting about $0.02. */
export const SPIKE_MIN_COST = 0.5;
/** The current day must be at least this many times the average to count. */
export const SPIKE_RATIO = 3;

/**
 * Budget pace: today is still under the budget, but the rate so far projects
 * past it before midnight. Exceeding the budget itself is already covered by
 * `notifyBudget()`, so this only reports the *forecast* case.
 *
 * @param {object} usage          `snapshot.usage`
 * @param {object} settings
 * @param {string[]} keyIds       badge key selection (empty = whole account)
 * @param {Date} now
 * @returns {{scope: string, name: string, budget: number, spent: number,
 *            projected: number, overBy: number, percent: number, hoursLeft: number}|null}
 */
export function forecastBudgetBreach(usage, settings, keyIds = [], now = new Date()) {
  if (!usage) return null;

  const warnPercent = Number(settings?.budgetWarnPercent) || 90;
  const target = pickBudgetTarget(usage, settings, keyIds);

  if (!(target.budget > 0)) return null;
  if (target.spent >= target.budget) return null; // already handled as "over"

  const forecast = projectToday(target.spent, now, {
    windowCost: Number(usage.priorDaysCost) || 0,
    windowDays: Number(settings?.windowDays) || 30,
  });
  if (forecast.tooEarly) return null;

  // Require the pace to clear the budget with a little room, so a projection
  // that merely grazes it does not trigger every refresh near midnight.
  const margin = target.budget * 1.01;
  if (forecast.projected < margin) return null;

  // Also respect the user's warn level: do not warn about exceeding a budget
  // when the projection is still below where their own warning starts.
  if (forecast.projected < target.budget * (warnPercent / 100)) return null;

  return {
    scope: target.scope,
    name: target.name,
    budget: target.budget,
    spent: target.spent,
    projected: forecast.projected,
    overBy: forecast.projected - target.budget,
    percent: target.spent > 0 ? (forecast.projected / target.budget) * 100 : 0,
    hoursLeft: forecast.remainingHours,
  };
}

/**
 * Which budget the pace alert should watch: the badge scope when it has one,
 * otherwise the most-used key budget, otherwise the account budget.
 */
function pickBudgetTarget(usage, settings, keyIds) {
  const keyBudgets = settings?.keyBudgets || {};
  const selected = (Array.isArray(keyIds) ? keyIds : []).filter(Boolean);

  // A key selection means "these keys together" — but a single selected key
  // with its own budget is more precise, so prefer it.
  if (selected.length === 1) {
    const id = selected[0];
    const key = findKey(usage, id);
    const budget = Number(keyBudgets[id]) || 0;
    if (budget > 0) {
      return {
        scope: `key:${id}`,
        name: key?.name || id,
        budget,
        spent: unknownToNull(key?.todayCost),
      };
    }
  }

  if (selected.length) {
    const spent = selected.reduce((total, id) => total + (Number(findKey(usage, id)?.todayCost) || 0), 0);
    return { scope: 'account', name: '', budget: Number(settings?.dailyBudget) || 0, spent };
  }

  // Whole account: the account budget is the user's own "this is too much".
  return {
    scope: 'account',
    name: '',
    budget: Number(settings?.dailyBudget) || 0,
    spent: unknownToNull(usage.todayCost),
  };
}

/** `null`/`undefined` = unknown today. Everything else is a number. */
function unknownToNull(value) {
  if (value === null || value === undefined) return null;
  return Number(value) || 0;
}

/**
 * Spike detection: today's spend (or one key's spend) far above its own
 * rolling average.
 *
 * The average comes from the accumulated history and *excludes today*, so a
 * heavy day cannot inflate the baseline it is being compared with.
 *
 * @param {object} history       normalised history (see `history.js`)
 * @param {object} usage         `snapshot.usage`
 * @param {string} todayKey
 * @param {object} [options]
 * @param {number} [options.minDays]     days of history needed before alerting
 * @param {number} [options.ratio]
 * @param {number} [options.minCost]
 * @returns {{account: object|null, keys: object[]}}
 */
export function detectSpikes(history, usage, todayKey, options = {}) {
  const ratio = Number(options.ratio) || SPIKE_RATIO;
  const minCost = Number(options.minCost) || SPIKE_MIN_COST;
  const minDays = Number(options.minDays) || 3;

  const days = Object.keys(history?.days || {})
    .filter((date) => date < todayKey)
    .sort();
  if (days.length < minDays) return { account: null, keys: [] };

  const average =
    days.reduce((total, date) => total + (Number(history.days[date]?.cost) || 0), 0) / days.length;
  if (!(average > 0)) return { account: null, keys: [] };

  const check = (cost, scope, name) => {
    // Unknown (null) is not zero: no spike report for a missing number.
    if (cost === null || cost === undefined) return null;
    const spent = Number(cost) || 0;
    if (spent < minCost) return null;
    const dayRatio = spent / average;
    if (dayRatio < ratio) return null;
    return { scope, name, spent, average, ratio: dayRatio, multiple: dayRatio };
  };

  const account = check(usage?.todayCost, 'account', '');

  // Per-key spikes use that key's own history where it exists; a key with no
  // past is skipped (a brand-new key is a different alert).
  const keySpikes = [];
  for (const key of Array.isArray(usage?.keys) ? usage.keys : []) {
    const series = history?.keys?.[key.id];
    if (!series) continue;
    const past = Object.entries(series)
      .filter(([date]) => date < todayKey)
      .map(([, cost]) => Number(cost) || 0);
    if (past.length < minDays) continue;
    const keyAverage = past.reduce((total, cost) => total + cost, 0) / past.length;
    if (!(keyAverage > 0)) continue;

    const spent = Number(key.todayCost) || 0;
    if (spent < minCost || spent / keyAverage < ratio) continue;
    keySpikes.push({
      scope: `key:${key.id}`,
      name: key.name || key.id,
      spent,
      average: keyAverage,
      ratio: spent / keyAverage,
    });
  }

  return { account, keys: keySpikes };
}

/**
 * Key lifecycle.
 *
 * @param {object} known     `{ [id]: {name, firstSeen, lastSeen, lastUsedDay} }`
 *                            from the previous refresh (may be empty)
 * @param {object} usage     current `snapshot.usage`
 * @param {string} todayKey
 * @param {object} [options]
 * @param {number} [options.inactiveDays] keys unused for this long are reported
 * @param {boolean} [options.newKeys]     whether new keys are seeded silently
 * @returns {{registry: object, newKeys: object[], inactiveKeys: object[]}}
 *            `registry` is what the caller should persist
 */
export function trackKeys(known, usage, todayKey, options = {}) {
  const inactiveDays = Number(options.inactiveDays) || 0;
  const reportNew = options.newKeys !== false;
  const registry = {};
  const newKeys = [];
  const inactiveKeys = [];

  const keys = Array.isArray(usage?.keys) ? usage.keys : [];

  for (const key of keys) {
    const previous = known?.[key.id];
    const entry = {
      name: key.name || key.id,
      firstSeen: previous?.firstSeen || todayKey,
      lastSeen: todayKey,
      lastUsedDay: maxDay(previous?.lastUsedDay, key.lastUsedDay || (key.todayCost > 0 ? todayKey : null)),
    };
    registry[key.id] = entry;

    if (!previous && reportNew) {
      newKeys.push({ id: key.id, name: entry.name });
    }
  }

  // Keys that vanished from the window are kept, so a key that comes back is
  // not reported as "new" all over again.
  for (const [id, previous] of Object.entries(known || {})) {
    if (registry[id]) continue;
    registry[id] = { ...previous };
  }

  if (inactiveDays > 0) {
    const cutoff = shiftDayKey(todayKey, -inactiveDays);
    for (const key of keys) {
      const entry = registry[key.id];
      if (!entry?.lastUsedDay) continue; // never used: not "inactive", just new
      if (entry.lastUsedDay >= cutoff) continue;
      inactiveKeys.push({
        id: key.id,
        name: entry.name,
        lastUsedDay: entry.lastUsedDay,
        days: daysBetween(entry.lastUsedDay, todayKey),
      });
    }
  }

  return { registry, newKeys, inactiveKeys };
}

/** Budget/alert marker, e.g. `2026-11-06:pace:account`. */
export function alertNoticeKey(dayKey, kind, scope = '') {
  return `${dayKey}:${kind}${scope ? `:${scope}` : ''}`;
}

function findKey(usage, id) {
  return usage?.keys?.find((entry) => entry.id === id || entry.name === id) || null;
}

function maxDay(current, candidate) {
  if (!candidate) return current || null;
  return !current || candidate > current ? candidate : current;
}

function daysBetween(fromDay, toDay) {
  const toMs = (day) => {
    const [year, month, dayOfMonth] = String(day).split('-').map(Number);
    return Date.UTC(year, month - 1, dayOfMonth);
  };
  return Math.round((toMs(toDay) - toMs(fromDay)) / 86400000);
}
