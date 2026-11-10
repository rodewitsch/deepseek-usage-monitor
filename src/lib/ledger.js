/**
 * Day-by-day spend ledger, built from the console API instead of local storage.
 *
 * The console rejects a single window longer than 31 days (`biz_code 1
 * INVALID_PARAM`), but it happily serves ANY 31-day window, however far in the
 * past. Verified against the live API: windows starting 1–4 months ago all
 * return `biz_code 0` with real costs. So the whole history is assembled by
 * walking backwards in 31-day chunks — nothing has to be accumulated locally,
 * and a fresh install sees the full picture on its very first refresh.
 *
 * The ledger has the same shape the old stored history had, so every consumer
 * (comparison, depletion, spikes, export) keeps working unchanged:
 *   { currency, days: { 'YYYY-MM-DD': { cost, tokens } }, keys: { id: { day: cost } } }
 */

import { ENDPOINTS } from './constants.js';
import { dayKeyFromUnix, normaliseApiKeyIdentity, toNumber, unwrapEnvelope } from './format.js';
import { requestPlatformJson } from './http.js';
import { shiftDayKey } from './history.js';

/** Hard cap enforced by the console; a longer window is rejected outright. */
export const MAX_WINDOW_DAYS = 31;
/** Days fetched per request — one day of headroom under the hard cap. */
const CHUNK_DAYS = 30;
/** Ceiling on chunks per ledger build (36 × 30 ≈ 3 years). */
const MAX_CHUNKS = 36;

/**
 * Unix range for one chunk, day-aligned the way the console requires.
 *
 * `start`/`end` must land on 00:00 of a local day expressed as UTC, and `tz`
 * is the caller's offset in seconds. `end` is exclusive (the last useful day is
 * `end - 1`), matching the console's own day-aligned convention.
 */
function chunkRange(endDayKey, tz, days) {
  const startDayKey = shiftDayKey(endDayKey, -(days - 1));
  const toUnix = (dayKey) => {
    const [year, month, day] = String(dayKey).split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 1000) - tz;
  };
  return { start: toUnix(startDayKey), end: toUnix(shiftDayKey(endDayKey, 1)) };
}

/**
 * Builds the ledger for the last `days` days (default ≈ one year).
 *
 * Chunks are requested from newest to oldest, so the data the popup needs most
 * (today, this month, last month) is available even if a deep chunk fails. A
 * failing chunk is skipped rather than aborting the whole build: a gap in the
 * distant past is far better than an empty popup.
 *
 * @param {string} token       console session token
 * @param {object} [options]
 * @param {number} [options.days]      how far back to fetch (default 365)
 * @param {string} [options.todayKey]  override for tests
 * @param {number} [options.tz]        UTC offset in seconds (default: machine)
 * @returns {Promise<{currency: string|null, days: object, keys: object}>}
 */
export async function fetchLedger(token, { days = 365, todayKey = null, tz = null } = {}) {
  const now = new Date();
  const offset = tz === null ? -now.getTimezoneOffset() * 60 : tz;
  const lastDay = todayKey || localDayKeyFrom(now);

  const ledger = { currency: null, days: {}, keys: {} };
  const totalChunks = Math.max(1, Math.min(MAX_CHUNKS, Math.ceil(days / CHUNK_DAYS)));

  for (let chunk = 0; chunk < totalChunks; chunk += 1) {
    const endDayKey = shiftDayKey(lastDay, -chunk * CHUNK_DAYS);
    const { start, end } = chunkRange(endDayKey, offset, CHUNK_DAYS);
    const qs = new URLSearchParams({ start: String(start), end: String(end), tz: String(offset) });

    let payload;
    try {
      payload = await requestPlatformJson(`${ENDPOINTS.usageCostByKey}?${qs}`, token);
    } catch (error) {
      // Auth errors are fatal; a gap in an old chunk is not.
      if (error?.kind === 'auth' || error?.kind === 'waf') throw error;
      console.warn(`[DeepSeek Usage] ledger chunk ${chunk} failed:`, error?.message || error);
      continue;
    }

    mergeCostPayload(ledger, payload, offset);
  }

  return ledger;
}

/**
 * Folds one `usage/by_api_key/cost` payload into the ledger.
 *
 * Each `(api_key, model)` series carries its own bucket list and they must all
 * be summed — buckets are NOT deduplicated by timestamp. The response carries
 * several currency blocks; the first one is taken, because mixing USD and CNY
 * rows into one total would be meaningless.
 */
export function mergeCostPayload(ledger, payload, tz) {
  const data = unwrapEnvelope(payload, 'ledger/cost');
  const blocks = Array.isArray(data?.data) ? data.data : [];

  for (const block of blocks) {
    const currency = String(block?.currency || '').toUpperCase();
    if (!currency) continue;
    // Lock onto the first currency seen and ignore the rest.
    if (!ledger.currency) ledger.currency = currency;
    if (ledger.currency !== currency) continue;

    for (const series of Array.isArray(block.series) ? block.series : []) {
      if (!Array.isArray(series?.buckets)) continue;
      const identity = normaliseApiKeyIdentity(series.api_key);
      const keySeries = identity.id ? (ledger.keys[identity.id] = ledger.keys[identity.id] || {}) : null;

      for (const bucket of series.buckets) {
        const amount = toNumber(bucket?.cost);
        if (!amount) continue;
        const day = dayKeyFromUnix(bucket.time, tz);
        const entry = ledger.days[day] || (ledger.days[day] = { cost: 0, tokens: 0 });
        entry.cost += amount;
        if (keySeries) keySeries[day] = (keySeries[day] || 0) + amount;
      }
    }
  }

  return ledger;
}

function localDayKeyFrom(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
