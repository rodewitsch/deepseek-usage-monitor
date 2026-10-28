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
  if (!['auto', 'money', 'tokens'].includes(settings.badgeFormat)) {
    settings.badgeFormat = DEFAULT_SETTINGS.badgeFormat;
  }

  settings.refreshMinutes = clampInt(settings.refreshMinutes, 0, 1440, DEFAULT_SETTINGS.refreshMinutes);
  settings.windowDays = clampInt(settings.windowDays, 1, 90, DEFAULT_SETTINGS.windowDays);
  settings.budgetWarnPercent = clampInt(settings.budgetWarnPercent, 1, 100, DEFAULT_SETTINGS.budgetWarnPercent);
  settings.lowBalanceThreshold = clampNumber(settings.lowBalanceThreshold, 0, 1e9, DEFAULT_SETTINGS.lowBalanceThreshold);
  settings.dailyBudget = clampNumber(settings.dailyBudget, 0, 1e9, DEFAULT_SETTINGS.dailyBudget);
  settings.showDecimals = settings.showDecimals !== false;
  settings.budgetNotifications = settings.budgetNotifications !== false;
  settings.badgeApiKey = emptyToNull(settings.badgeApiKey);
  settings.focusApiKey = emptyToNull(settings.focusApiKey);

  return settings;
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

function emptyToNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed === 'all' ? null : trimmed;
}
