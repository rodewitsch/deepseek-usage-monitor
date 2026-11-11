import { fetchUsageByKey, parseBalance } from './api.js';
import { ENDPOINTS } from './constants.js';
import { ApiError, localDayKey } from './format.js';
import { requestPlatformJson } from './http.js';
import { t } from './i18n.js';
import { fetchLedger } from './ledger.js';
import { getSettings, getSnapshot, saveSnapshot, clearToken } from './settings.js';
import { discoverPlatformToken } from './token.js';

/** How far back the ledger reaches (in days). */
export const LEDGER_DAYS = 365;

/**
 * Fetches balance + usage and persists one snapshot object.
 * Returns `{ snapshot, lastError }`.
 */
export async function refreshUsage({ forceToken = false } = {}) {
  const settings = await getSettings();
  const found = await discoverPlatformToken({ force: forceToken });
  let token = found.token;
  let source = found.source;

  if (!token) {
    const error = new ApiError(t('errorNoSession'), 'auth');
    const previous = await getSnapshot();
    await saveSnapshot(
      {
        ...(previous.snapshot || {}),
        updatedAt: previous.snapshot?.updatedAt || null,
        todayKey: localDayKey(),
      },
      { message: error.message, kind: error.kind, at: Date.now() },
    );
    return { snapshot: (await getSnapshot()).snapshot, lastError: { message: error.message, kind: 'auth', at: Date.now() } };
  }

  let balancePayload;
  let usage;
  try {
    ({ balancePayload, usage } = await load(token, settings));
  } catch (error) {
    const normalised = normaliseError(error);
    // A cached token can go stale (or be the wrong key). Drop it, re-read the
    // session from the browser and try exactly once more.
    if (normalised.kind === 'auth' && !forceToken) {
      console.warn('[DeepSeek Usage] token rejected, re-reading the session');
      await clearToken();
      const retry = await discoverPlatformToken({ force: true });
      if (retry.token && retry.token !== token) {
        token = retry.token;
        source = retry.source;
        try {
          ({ balancePayload, usage } = await load(token, settings));
        } catch (retryError) {
          return failWith(retryError);
        }
      } else {
        // Re-reading produced the same token (or none): the session itself is
        // invalid, so never keep feeding the same rejected token to the API.
        await clearToken();
        return failWith(normalised);
      }
    } else {
      return failWith(normalised);
    }
  }

  const now = new Date();
  const snapshot = {
    updatedAt: Date.now(),
    todayKey: localDayKey(now),
    tokenSource: source,
    balance: parseBalance(balancePayload),
    usage,
  };

  // The day-by-day ledger is read from the API in 31-day chunks (see
  // `ledger.js`), so nothing is accumulated locally. A failure here must never
  // fail the whole refresh — the snapshot is already usable without it.
  snapshot.ledger = await buildLedger(token, snapshot.todayKey);

  await saveSnapshot(snapshot, null);
  return { snapshot, lastError: null };
}

/**
 * Builds the ledger for the last year, falling back to whatever the previous
 * snapshot holds when the API refuses mid-way.
 *
 * @param {string} token
 * @param {string} todayKey
 * @returns {Promise<{currency: string|null, days: object, keys: object} | null>}
 */
export async function buildLedger(token, todayKey = localDayKey()) {
  try {
    return await fetchLedger(token, { days: LEDGER_DAYS, todayKey });
  } catch (error) {
    console.warn('[DeepSeek Usage] ledger build failed:', error?.message || error);
    const previous = await getSnapshot();
    return previous.snapshot?.ledger || null;
  }
}

async function load(token, settings) {
  const now = new Date();
  const [balancePayload, usage] = await Promise.all([
    requestPlatformJson(ENDPOINTS.userSummary, token),
    fetchUsageByKey(token, { windowDays: settings.windowDays, now }),
  ]);
  return { balancePayload, usage };
}

/**
 * Keeps the previous numbers visible instead of blanking them.
 *
 * "Today" is the one figure that must NOT survive a failed refresh: a value
 * from hours ago shown as today's spend is worse than no value at all. It is
 * therefore replaced with `null` (the UI renders "—") rather than with `0`,
 * which used to be indistinguishable from a genuinely empty day.
 */
async function failWith(error) {
  const normalised = normaliseError(error);
  console.warn('[DeepSeek Usage] refresh failed:', normalised.message);
  const previous = await getSnapshot();
  const stale = previous.snapshot
    ? {
        ...previous.snapshot,
        usage: previous.snapshot.usage
          ? {
              ...previous.snapshot.usage,
              todayCost: null,
              todayTokens: null,
              todayUnknown: true,
              stale: true,
            }
          : null,
        stale: true,
      }
    : null;
  const lastError = { message: normalised.message, kind: normalised.kind, at: Date.now() };
  await saveSnapshot(stale, lastError);
  return { snapshot: stale, lastError };
}

function normaliseError(error) {
  if (error instanceof ApiError) return error;
  return new ApiError(error?.message || String(error), 'api');
}
