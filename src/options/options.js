import { computeBadge } from '../lib/badge.js';
import { evaluateBudgets } from '../lib/budget.js';
import { PLATFORM_ORIGIN } from '../lib/constants.js';
import { formatMoney } from '../lib/format.js';
import { applyDocumentLanguage, localizeDocument, t } from '../lib/i18n.js';
import { getSettings, getSnapshot, getTokenInfo, saveSettings } from '../lib/settings.js';
import { discoverPlatformToken } from '../lib/token.js';

const el = (id) => document.getElementById(id);

/**
 * Form field → settings key. The DOM id is not the storage key, so the mapping
 * has to be explicit (this is what used to silently save `badgeKey` instead of
 * `badgeApiKey`, which made "Measure for" never stick).
 */
const fields = {
  badgeMetric: { input: el('badge-metric'), setting: 'badgeMetric' },
  refreshMinutes: { input: el('refresh-minutes'), setting: 'refreshMinutes' },
  windowDays: { input: el('window-days'), setting: 'windowDays' },
  lowBalance: { input: el('low-balance'), setting: 'lowBalanceThreshold' },
  dailyBudget: { input: el('daily-budget'), setting: 'dailyBudget' },
  budgetWarnPercent: { input: el('budget-warn-percent'), setting: 'budgetWarnPercent' },
  budgetNotifications: { input: el('budget-notifications'), setting: 'budgetNotifications' },
  showDecimals: { input: el('show-decimals'), setting: 'showDecimals' },
};

const preview = el('badge-preview');
const previewTitle = el('badge-preview-title');
const previewBudget = el('badge-preview-budget');
const sessionStatus = el('session-status');
const saved = el('saved');
const badgeKeys = el('badge-keys');
const badgeKeyField = el('badge-key-field');
const badgeKeysHint = el('badge-keys-hint');
const keyBudgets = el('key-budgets');
const keyBudgetsEmpty = el('key-budgets-empty');

let currentSettings = null;
let currentSnapshot = null;

init();

async function init() {
  applyDocumentLanguage();
  localizeDocument();
  currentSettings = await getSettings();
  currentSnapshot = (await getSnapshot()).snapshot;
  renderBadgeKeys();
  renderKeyBudgets();
  applySettings(currentSettings);
  updatePreview();
  await updateSessionStatus();

  for (const { input, setting } of Object.values(fields)) {
    input.addEventListener('change', onFieldChange(setting, input));
    if (input.type === 'number') input.addEventListener('input', onFieldChange(setting, input));
  }

  badgeKeys.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-key-id]');
    if (!chip) return;
    await toggleBadgeKey(chip.dataset.keyId);
  });

  // `change` on the list (not per input) keeps a single listener across re-renders.
  keyBudgets.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-budget-key]');
    if (!input) return;
    const id = input.dataset.budgetKey;
    const value = input.value === '' ? 0 : Number(input.value);
    const next = { ...(currentSettings.keyBudgets || {}) };
    if (value > 0) next[id] = value;
    else delete next[id];
    currentSettings = await saveSettings({ keyBudgets: next });
    renderKeyBudgets();
    updatePreview();
    flashSaved();
  });

  el('re-detect').addEventListener('click', async () => {
    sessionStatus.textContent = t('sessionDetecting');
    await discoverPlatformToken({ force: true });
    await updateSessionStatus();
    await chrome.runtime.sendMessage({ type: 'dsum:refresh', forceToken: true }).catch(() => {});
    currentSnapshot = (await getSnapshot()).snapshot;
    renderKeyBudgets();
    updatePreview();
  });

  el('open-platform').addEventListener('click', () => {
    chrome.tabs.create({ url: `${PLATFORM_ORIGIN}/usage` });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.usageSnapshot) return;
    currentSnapshot = changes.usageSnapshot.newValue || null;
    renderKeyBudgets();
    updatePreview();
  });
}

function onFieldChange(setting, input) {
  return async () => {
    let value;
    if (input.type === 'checkbox') value = input.checked;
    else if (input.type === 'number') value = input.value === '' ? null : Number(input.value);
    else value = input.value;

    currentSettings = await saveSettings({ [setting]: value });
    applySettings(currentSettings);
    updatePreview();
    flashSaved();
  };
}

async function toggleBadgeKey(id) {
  const current = currentSettings.badgeApiKeys || [];
  const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
  currentSettings = await saveSettings({ badgeApiKeys: next });
  renderBadgeKeys();
  applyMetricVisibility(currentSettings);
  updatePreview();
  flashSaved();
}

function applySettings(settings) {
  fields.badgeMetric.input.value = settings.badgeMetric;
  fields.refreshMinutes.input.value = settings.refreshMinutes;
  fields.windowDays.input.value = settings.windowDays;
  fields.lowBalance.input.value = settings.lowBalanceThreshold;
  fields.dailyBudget.input.value = settings.dailyBudget || '';
  fields.budgetWarnPercent.input.value = settings.budgetWarnPercent;
  fields.budgetNotifications.input.checked = settings.budgetNotifications;
  fields.showDecimals.input.checked = settings.showDecimals;
  applyMetricVisibility(settings);
}

/** The wallet balance is account-wide: the key picker does not apply to it. */
function applyMetricVisibility(settings) {
  const isBalance = settings.badgeMetric === 'balance';
  badgeKeyField.hidden = isBalance;
  badgeKeysHint.hidden = isBalance || (settings.badgeApiKeys || []).length > 0;
}

function usageKeys() {
  return currentSnapshot?.usage?.keys || [];
}

function renderBadgeKeys() {
  const keys = usageKeys();
  const selected = new Set(currentSettings?.badgeApiKeys || []);
  badgeKeys.replaceChildren();

  if (!keys.length) {
    const hint = document.createElement('span');
    hint.className = 'muted';
    hint.textContent = t('noApiKeysYet');
    badgeKeys.append(hint);
    return;
  }

  for (const key of keys) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${selected.has(key.id) ? ' is-on' : ''}`;
    chip.dataset.keyId = key.id;
    chip.textContent = key.name;
    chip.title = selected.has(key.id) ? t('chipRemoveFromBadge') : t('chipMeasureForKey');
    badgeKeys.append(chip);
  }
}

function renderKeyBudgets() {
  const keys = usageKeys();
  const currency = currentSnapshot?.usage?.currency || 'USD';
  const decimals = currentSettings?.showDecimals !== false;
  const amounts = currentSettings?.keyBudgets || {};

  keyBudgets.replaceChildren();
  keyBudgetsEmpty.hidden = keys.length > 0;

  for (const key of keys) {
    const row = document.createElement('div');
    row.className = 'key-budget';

    const name = document.createElement('span');
    name.className = 'key-budget__name';
    name.textContent = key.name;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = t('keyBudgetOff');
    input.value = amounts[key.id] ? String(amounts[key.id]) : '';
    input.dataset.budgetKey = key.id;
    input.setAttribute('aria-label', t('keyBudgetAria', [key.name]));

    const meta = document.createElement('span');
    meta.className = 'key-budget__meta';
    meta.textContent = t('keyTodayMeta', [formatMoney(key.todayCost, currency, { decimals })]);

    row.append(name, input, meta);
    keyBudgets.append(row);
  }
}

function updatePreview() {
  if (!currentSnapshot) {
    preview.textContent = '—';
    previewTitle.textContent = t('previewNoData');
    return;
  }
  const badge = computeBadge(currentSnapshot, currentSettings);
  preview.textContent = badge.text || '—';
  preview.style.background = badge.color;
  previewTitle.textContent = badge.title;

  const budgets = evaluateBudgets(
    currentSnapshot?.usage,
    currentSettings,
    currentSettings?.badgeMetric === 'balance' ? [] : currentSettings?.badgeApiKeys || [],
  );
  if (budgets.worst.status === 'off') {
    previewBudget.textContent = t('previewNoBudget');
    previewBudget.style.color = '';
    return;
  }
  previewBudget.textContent = t('previewClosestBudget', [
    String(Math.round(budgets.worst.percent)),
    budgets.worst.status,
  ]);
  previewBudget.style.color = budgets.worst.color;
}

async function updateSessionStatus() {
  const { token, source } = await getTokenInfo();
  sessionStatus.classList.toggle('is-error', !token);
  sessionStatus.textContent = token
    ? t('sessionDetected', [describeSource(source)])
    : t('sessionMissing');
}

function describeSource(source) {
  if (!source) return t('sourceUnknown');
  if (source.startsWith('cookie:')) return t('sourceCookie', [source.slice(7)]);
  if (source === 'page') return t('sourcePage');
  return source;
}

let savedTimer = null;
function flashSaved() {
  saved.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    saved.hidden = true;
  }, 1400);
}
