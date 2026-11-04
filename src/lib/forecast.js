/**
 * "Today" pacing: how much has already been spent and what the full day is
 * projected to cost, given the time that has passed so far.
 */

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

/**
 * @param {number} todayCost  spend accumulated so far today
 * @param {Date}   now        current time
 * @param {number} windowDays number of days the average is taken over
 * @param {number} windowCost total spend in that window (excluding today)
 */
export function projectToday(todayCost, now = new Date(), { windowCost = 0, windowDays = 30 } = {}) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsedMs = Math.max(0, now.getTime() - midnight.getTime());
  const remainingMs = Math.max(0, MS_PER_DAY - elapsedMs);
  const elapsedHours = elapsedMs / MS_PER_HOUR;

  const spent = Number(todayCost) || 0;
  // Guard the first minutes of the day, where dividing by a tiny fraction
  // would extrapolate to absurd numbers.
  const rate = elapsedHours >= 0.5 ? spent / elapsedHours : 0;
  const projected = elapsedHours >= 0.5 ? rate * 24 : spent;

  // Average of the previous complete days (the window total excludes today).
  const days = Math.max(1, Math.min(Number(windowDays) || 30, 31));
  const baseline = (Number(windowCost) || 0) / days;

  return {
    elapsedHours,
    remainingHours: remainingMs / MS_PER_HOUR,
    ratePerHour: rate,
    projected,
    baseline,
    /** Projected vs. the average day: > 1 means today is heavier than usual. */
    ratio: baseline > 0 ? projected / baseline : 0,
    /** True before ~00:30, when a projection is meaningless. */
    tooEarly: elapsedHours < 0.5,
    midnight,
  };
}
