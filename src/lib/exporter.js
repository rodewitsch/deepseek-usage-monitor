/**
 * CSV / JSON export of the spend data the extension already holds: the local
 * daily history (whole account + per key) and the per-model split of the
 * current API window. Pure functions — the popup only appends the blob to an
 * `<a download>`.
 */

/** Fields of one history day, in the order they are written. */
const DAY_COLUMNS = ['date', 'cost', 'tokens'];

/**
 * CSV of the daily history.
 *
 * @param {object} history normalised history (see `history.js`)
 * @param {object} [options]
 * @param {object} [options.usage]    current usage (adds the per-model columns)
 * @param {string} [options.todayKey] day whose model split is exported
 * @param {string} [options.currency] overrides `history.currency`
 */
export function historyToCsv(history, { usage = null, todayKey = null, currency = null } = {}) {
  const cur = currency || history?.currency || 'USD';
  const models = Array.isArray(usage?.models?.models) ? usage.models.models : [];

  const header = [`date`, `cost_${cur}`, 'tokens', `keys_${cur}`];
  for (const model of models) header.push(`${model.model}_cost_${cur}`, `${model.model}_tokens`);

  const rows = [header];
  const days = Object.keys(history?.days || {}).sort();

  for (const date of days) {
    const day = history.days[date];
    const keys = keyTotalsForDay(history, date);
    const row = [
      date,
      round(day.cost),
      Math.round(Number(day.tokens) || 0),
      round(keys),
    ];

    for (const model of models) {
      if (date === todayKey) {
        row.push(round(model.costToday), Math.round(Number(model.tokensToday) || 0));
      } else {
        // The model split is only known for the current API window; older
        // days keep the day totals but no per-model breakdown.
        row.push('', '');
      }
    }
    rows.push(row);
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * JSON export: the history plus the snapshot summary and the per-model split
 * of the current window, so a single file is enough for an external tool.
 */
export function historyToJson(history, { usage = null, balance = null, todayKey = null, exportedAt = Date.now() } = {}) {
  const days = Object.keys(history?.days || {}).sort();
  return JSON.stringify(
    {
      exportedAt: new Date(exportedAt).toISOString(),
      currency: history?.currency || usage?.currency || 'USD',
      today: todayKey,
      history: {
        firstDay: days[0] || null,
        lastDay: days[days.length - 1] || null,
        days: days.map((date) => ({
          date,
          cost: round(history.days[date].cost),
          tokens: Math.round(Number(history.days[date].tokens) || 0),
          keys: keyTotalsForDay(history, date),
        })),
      },
      window: usage
        ? {
            start: usage.windowStart || null,
            end: usage.windowEnd || null,
            cost: round(usage.windowCost),
            tokens: Math.round(Number(usage.windowTokens) || 0),
          }
        : null,
      balance: balance || null,
      models: Array.isArray(usage?.models?.models)
        ? usage.models.models.map((model) => ({
            model: model.model,
            cost: round(model.cost),
            costToday: round(model.costToday),
            tokens: Math.round(Number(model.tokens) || 0),
            tokensToday: Math.round(Number(model.tokensToday) || 0),
            cacheHit: Math.round(Number(model.cacheHit) || 0),
            cacheMiss: Math.round(Number(model.cacheMiss) || 0),
          }))
        : [],
      cache: usage?.models?.cache || null,
    },
    null,
    2,
  );
}

/** `api-keys.csv`-friendly list of the keys seen in the window. */
export function keysToCsv(usage, currency = null) {
  const cur = currency || usage?.currency || 'USD';
  const rows = [['key', `today_${cur}`, `window_${cur}`, 'tokens', 'last_used_day']];
  for (const key of usage?.keys || []) {
    rows.push([
      key.name || key.id,
      round(key.todayCost),
      round(key.windowCost),
      Math.round(Number(key.tokens) || 0),
      key.lastUsedDay || '',
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Sum of every key's cost on one day. */
function keyTotalsForDay(history, date) {
  let total = 0;
  for (const series of Object.values(history?.keys || {})) {
    total += Number(series?.[date]) || 0;
  }
  return total;
}

/** Fixed 6-decimal trim; keeps the CSV parseable and avoids 1e-7 notation. */
function round(value) {
  const number = Number(value) || 0;
  return Math.round(number * 1e6) / 1e6;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `deepseek-usage-2026-11-04.csv` — ASCII only, safe on every OS. */
export function exportFileName(extension, todayKey = new Date().toISOString().slice(0, 10)) {
  return `deepseek-usage-${todayKey}.${extension}`;
}
