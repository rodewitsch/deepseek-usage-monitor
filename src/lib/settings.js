import { DEFAULT_SETTINGS, POPUP_SECTION_IDS, STORAGE_KEYS } from './constants.js';

export async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normaliseSettings(stored[STORAGE_KEYS.settings]);
}

export function normaliseSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw || {}) };

  if (!['todayCost', 'monthCost', 'balance', 'todayTokens'].includes(settings.badgeMetric)) {
    settings.badgeMetric = DEFAULT_SETTINGS.badgeMetric;
  }

  settings.refreshMinutes = clampInt(settings.refreshMinutes, 0, 1440, DEFAULT_SETTINGS.refreshMinutes);
  settings.windowDays = clampInt(settings.windowDays, 1, 90, DEFAULT_SETTINGS.windowDays);
  // 0 keeps the whole recorded history instead of a rolling window.
  settings.depletionWindowDays = clampInt(settings.depletionWindowDays, 0, 3650, DEFAULT_SETTINGS.depletionWindowDays);
  settings.budgetWarnPercent = clampInt(settings.budgetWarnPercent, 1, 100, DEFAULT_SETTINGS.budgetWarnPercent);
  settings.lowBalanceThreshold = clampNumber(settings.lowBalanceThreshold, 0, 1e9, DEFAULT_SETTINGS.lowBalanceThreshold);
  settings.dailyBudget = clampNumber(settings.dailyBudget, 0, 1e9, DEFAULT_SETTINGS.dailyBudget);
  settings.showDecimals = settings.showDecimals !== false;
  settings.showMonthComparison = settings.showMonthComparison !== false;
  settings.showDepletion = settings.showDepletion !== false;
  settings.budgetNotifications = settings.budgetNotifications !== false;
  settings.paceAlerts = settings.paceAlerts !== false;
  settings.spikeAlerts = settings.spikeAlerts !== false;
  settings.newKeyAlerts = settings.newKeyAlerts !== false;
  settings.inactiveKeyHighlight = settings.inactiveKeyHighlight !== false;
  // A multiplier below 1 would flag every day; 10x is a generous ceiling.
  settings.spikeRatio = clampNumber(settings.spikeRatio, 1, 10, DEFAULT_SETTINGS.spikeRatio);
  // 0 disables the inactive-key alert entirely.
  settings.inactiveKeyDays = clampInt(settings.inactiveKeyDays, 0, 365, DEFAULT_SETTINGS.inactiveKeyDays);
  settings.lowBalanceNotifications = settings.lowBalanceNotifications !== false;
  settings.statusNotifications = settings.statusNotifications !== false;
  // Opt-in: opening a background tab is visible behaviour, so it must be
  // something the user chose (see `ensureWafToken()` in waf.js).
  settings.wafTabRenew = settings.wafTabRenew === true;
  settings.badgeApiKeys = normaliseKeyList(settings.badgeApiKeys);
  settings.selectedApiKeys = normaliseKeyList(settings.selectedApiKeys);
  settings.keyBudgets = normaliseKeyBudgets(settings.keyBudgets);
  settings.popupSections = normaliseSections(settings.popupSections);
  settings.popupHidden = normaliseKeyList(settings.popupHidden).filter((id) =>
    POPUP_SECTION_IDS.includes(id),
  );

  // Migrate the single-key settings used before 1.1.
  if (settings.badgeApiKey && !settings.badgeApiKeys.length) {
    settings.badgeApiKeys = [String(settings.badgeApiKey)];
  }
  if (settings.focusApiKey && !settings.selectedApiKeys.length) {
    settings.selectedApiKeys = [String(settings.focusApiKey)];
  }
  delete settings.badgeApiKey;
  delete settings.focusApiKey;

  return settings;
}

/** De-duplicated, trimmed list of API key ids. */
function normaliseKeyList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))];
}

/**
 * Popup section order: keeps only known ids, drops duplicates and appends any
 * section missing from the stored order (e.g. added in a newer version).
 */
function normaliseSections(value) {
  const stored = normaliseKeyList(value).filter((id) => POPUP_SECTION_IDS.includes(id));
  const missing = POPUP_SECTION_IDS.filter((id) => !stored.includes(id));
  return [...stored, ...missing];
}

/** `{ keyId: positiveBudget }`, dropping empty/zero entries. */
function normaliseKeyBudgets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, budget] of Object.entries(value)) {
    const amount = clampNumber(budget, 0, 1e9, 0);
    if (id && amount > 0) out[String(id)] = amount;
  }
  return out;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normaliseSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

export async function getSnapshot() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.snapshot, STORAGE_KEYS.lastError]);
  return {
    snapshot: stored[STORAGE_KEYS.snapshot] || null,
    lastError: usableError(stored[STORAGE_KEYS.lastError] || null),
  };
}

/**
 * A WAF block is a transient state, not a fact about the account: once it is
 * older than this it is dropped instead of being shown forever.
 */
export const WAF_ERROR_TTL_MS = 15 * 60 * 1000;

/** Drops a stored WAF error that has outlived its usefulness. */
function usableError(lastError) {
  if (!lastError || lastError.kind !== 'waf') return lastError;
  const at = Number(lastError.at) || 0;
  if (at && Date.now() - at < WAF_ERROR_TTL_MS) return lastError;
  return null;
}

export async function saveSnapshot(snapshot, lastError = null) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.snapshot]: snapshot,
    [STORAGE_KEYS.lastError]: lastError,
  });
}

/** API keys seen so far, keyed by id (see `trackKeys()` in `alerts.js`). */
export async function getKeyRegistry() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.keyRegistry);
  const raw = stored[STORAGE_KEYS.keyRegistry];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

export async function saveKeyRegistry(registry) {
  await chrome.storage.local.set({ [STORAGE_KEYS.keyRegistry]: registry });
}

export async function getTokenInfo() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.token, STORAGE_KEYS.tokenSource]);
  return {
    token: stored[STORAGE_KEYS.token] || null,
    source: stored[STORAGE_KEYS.tokenSource] || null,
  };
}

export async function saveToken(token, source) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.token]: token || null,
    [STORAGE_KEYS.tokenSource]: source || null,
  });
}

export async function clearToken() {
  await chrome.storage.local.remove([STORAGE_KEYS.token, STORAGE_KEYS.tokenSource]);
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
