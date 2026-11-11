import { computeBadge } from '../lib/badge.js';
import { evaluateBudgets } from '../lib/budget.js';
import { PLATFORM_ORIGIN, POPUP_SECTION_IDS, POPUP_SECTIONS } from '../lib/constants.js';
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
  depletionWindowDays: { input: el('depletion-window'), setting: 'depletionWindowDays' },
  lowBalance: { input: el('low-balance'), setting: 'lowBalanceThreshold' },
  dailyBudget: { input: el('daily-budget'), setting: 'dailyBudget' },
  budgetWarnPercent: { input: el('budget-warn-percent'), setting: 'budgetWarnPercent' },
  budgetNotifications: { input: el('budget-notifications'), setting: 'budgetNotifications' },
  lowBalanceNotifications: { input: el('low-balance-notifications'), setting: 'lowBalanceNotifications' },
  statusNotifications: { input: el('status-notifications'), setting: 'statusNotifications' },
  paceAlerts: { input: el('pace-alerts'), setting: 'paceAlerts' },
  spikeAlerts: { input: el('spike-alerts'), setting: 'spikeAlerts' },
  spikeRatio: { input: el('spike-ratio'), setting: 'spikeRatio' },
  newKeyAlerts: { input: el('new-key-alerts'), setting: 'newKeyAlerts' },
  inactiveKeyDays: { input: el('inactive-key-days'), setting: 'inactiveKeyDays' },
  inactiveKeyHighlight: { input: el('inactive-key-highlight'), setting: 'inactiveKeyHighlight' },
  showDecimals: { input: el('show-decimals'), setting: 'showDecimals' },
  showMonthComparison: { input: el('show-month-comparison'), setting: 'showMonthComparison' },
  showDepletion: { input: el('show-depletion'), setting: 'showDepletion' },
  wafTabRenew: { input: el('waf-tab-renew'), setting: 'wafTabRenew' },
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
const layoutList = el('layout-list');

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
  renderLayout();
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

  layoutList.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-section-toggle]');
    if (!input) return;
    const id = input.dataset.sectionToggle;
    const hidden = new Set(currentSettings.popupHidden || []);
    if (input.checked) hidden.delete(id);
    else hidden.add(id);
    currentSettings = await saveSettings({ popupHidden: [...hidden] });
    renderLayout();
    flashSaved();
  });

  layoutList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-move]');
    if (!button) return;
    const id = button.dataset.sectionId;
    const order = [...(currentSettings.popupSections || POPUP_SECTION_IDS)];
    const index = order.indexOf(id);
    const delta = button.dataset.move === 'up' ? -1 : 1;
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    currentSettings = await saveSettings({ popupSections: order });
    renderLayout();
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
  fields.depletionWindowDays.input.value = settings.depletionWindowDays;
  fields.lowBalance.input.value = settings.lowBalanceThreshold;
  fields.dailyBudget.input.value = settings.dailyBudget || '';
  fields.budgetWarnPercent.input.value = settings.budgetWarnPercent;
  fields.budgetNotifications.input.checked = settings.budgetNotifications;
  fields.lowBalanceNotifications.input.checked = settings.lowBalanceNotifications;
  fields.statusNotifications.input.checked = settings.statusNotifications;
  fields.paceAlerts.input.checked = settings.paceAlerts;
  fields.spikeAlerts.input.checked = settings.spikeAlerts;
  fields.spikeRatio.input.value = settings.spikeRatio;
  fields.newKeyAlerts.input.checked = settings.newKeyAlerts;
  fields.inactiveKeyDays.input.value = settings.inactiveKeyDays;
  fields.inactiveKeyHighlight.input.checked = settings.inactiveKeyHighlight;
  fields.showDecimals.input.checked = settings.showDecimals;
  fields.showMonthComparison.input.checked = settings.showMonthComparison;
  fields.showDepletion.input.checked = settings.showDepletion;
  fields.wafTabRenew.input.checked = settings.wafTabRenew;
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

/** Popup layout: one row per block with a visibility toggle and move buttons. */
function renderLayout() {
  const order = currentSettings?.popupSections?.length
    ? currentSettings.popupSections
    : POPUP_SECTION_IDS;
  const hidden = new Set(currentSettings?.popupHidden || []);
  const labels = new Map(POPUP_SECTIONS.map((section) => [section.id, section.i18n]));

  layoutList.replaceChildren();

  order.forEach((id, index) => {
    const row = document.createElement('li');
    row.className = 'layout-row';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !hidden.has(id);
    toggle.dataset.sectionToggle = id;

    const name = document.createElement('label');
    name.className = 'layout-row__name';
    name.append(toggle, document.createTextNode(t(labels.get(id) || id)));

    const tools = document.createElement('span');
    tools.className = 'layout-row__tools';

    const up = iconButton('up', id, index === 0, 'moveUp');
    const down = iconButton('down', id, index === order.length - 1, 'moveDown');
    tools.append(up, down);

    row.append(name, tools);
    layoutList.append(row);
  });
}

function iconButton(move, sectionId, disabled, labelKey) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layout-row__move';
  button.dataset.move = move;
  button.dataset.sectionId = sectionId;
  button.disabled = disabled;
  button.title = t(labelKey);
  button.setAttribute('aria-label', t(labelKey));
  button.textContent = move === 'up' ? '↑' : '↓';
  return button;
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
