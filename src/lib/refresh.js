import { fetchUsageByKey, parseBalance } from './api.js';
import { ENDPOINTS } from './constants.js';
import { ApiError, localDayKey } from './format.js';
import { mergeUsageIntoHistory } from './history.js';
import { requestPlatformJson } from './http.js';
import { t } from './i18n.js';
import { getHistory, getSettings, getSnapshot, saveHistory, saveSnapshot, clearToken } from './settings.js';
import { discoverPlatformToken } from './token.js';

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
  await saveSnapshot(snapshot, null);
  // Accumulate the day-by-day record beyond the 31-day API window. History is
  // a nice-to-have: a failure here must never fail the whole refresh.
  await recordHistory(usage, snapshot.todayKey);
  return { snapshot, lastError: null };
}

/**
 * Merges the fresh API series into the local history and persists it.
 * Returns the merged history (or the stored one when the merge threw).
 */
export async function recordHistory(usage, todayKey = localDayKey(), { trusted = true } = {}) {
  try {
    const current = await getHistory();
    const { history, changed } = mergeUsageIntoHistory(current, usage, { todayKey, trusted });
    if (changed) await saveHistory(history);
    return history;
  } catch (error) {
    console.warn('[DeepSeek Usage] history update failed:', error?.message || error);
    return getHistory();
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

/** Keeps the previous numbers visible, but never shows a stale "today". */
async function failWith(error) {
  const normalised = normaliseError(error);
  console.warn('[DeepSeek Usage] refresh failed:', normalised.message);
  const previous = await getSnapshot();
  const stale = previous.snapshot
    ? {
        ...previous.snapshot,
        usage: previous.snapshot.usage
          ? { ...previous.snapshot.usage, todayCost: 0, todayTokens: 0 }
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
