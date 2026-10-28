import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants.js';

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
  settings.budgetWarnPercent = clampInt(settings.budgetWarnPercent, 1, 100, DEFAULT_SETTINGS.budgetWarnPercent);
  settings.lowBalanceThreshold = clampNumber(settings.lowBalanceThreshold, 0, 1e9, DEFAULT_SETTINGS.lowBalanceThreshold);
  settings.dailyBudget = clampNumber(settings.dailyBudget, 0, 1e9, DEFAULT_SETTINGS.dailyBudget);
  settings.showDecimals = settings.showDecimals !== false;
  settings.budgetNotifications = settings.budgetNotifications !== false;
  settings.badgeApiKeys = normaliseKeyList(settings.badgeApiKeys);
  settings.selectedApiKeys = normaliseKeyList(settings.selectedApiKeys);
  settings.keyBudgets = normaliseKeyBudgets(settings.keyBudgets);

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
    lastError: stored[STORAGE_KEYS.lastError] || null,
  };
}

export async function saveSnapshot(snapshot, lastError = null) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.snapshot]: snapshot,
    [STORAGE_KEYS.lastError]: lastError,
  });
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
