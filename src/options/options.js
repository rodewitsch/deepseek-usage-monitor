import { computeBadge } from '../lib/badge.js';
import { evaluateBudget } from '../lib/budget.js';
import { PLATFORM_ORIGIN } from '../lib/constants.js';
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
  badgeKey: { input: el('badge-key'), setting: 'badgeApiKey' },
  badgeFormat: { input: el('badge-format'), setting: 'badgeFormat' },
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

let currentSettings = null;
let currentSnapshot = null;

init();

async function init() {
  currentSettings = await getSettings();
  currentSnapshot = (await getSnapshot()).snapshot;
  fillKeyOptions(currentSnapshot);
  applySettings(currentSettings);
  updatePreview();
  await updateSessionStatus();

  for (const { input, setting } of Object.values(fields)) {
    input.addEventListener('change', onFieldChange(setting, input));
    if (input.type === 'number') input.addEventListener('input', onFieldChange(setting, input));
  }

  el('re-detect').addEventListener('click', async () => {
    sessionStatus.textContent = 'Detecting…';
    await discoverPlatformToken({ force: true });
    await updateSessionStatus();
    await chrome.runtime.sendMessage({ type: 'dsum:refresh', forceToken: true }).catch(() => {});
    currentSnapshot = (await getSnapshot()).snapshot;
    fillKeyOptions(currentSnapshot);
  });

  el('open-platform').addEventListener('click', () => {
    chrome.tabs.create({ url: `${PLATFORM_ORIGIN}/usage` });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.usageSnapshot) return;
    currentSnapshot = changes.usageSnapshot.newValue || null;
    fillKeyOptions(currentSnapshot);
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

function applySettings(settings) {
  fields.badgeMetric.input.value = settings.badgeMetric;
  fields.badgeFormat.input.value = settings.badgeFormat;
  fields.refreshMinutes.input.value = settings.refreshMinutes;
  fields.windowDays.input.value = settings.windowDays;
  fields.lowBalance.input.value = settings.lowBalanceThreshold;
  fields.dailyBudget.input.value = settings.dailyBudget || '';
  fields.budgetWarnPercent.input.value = settings.budgetWarnPercent;
  fields.budgetNotifications.input.checked = settings.budgetNotifications;
  fields.showDecimals.input.checked = settings.showDecimals;

  const target = settings.badgeApiKey || '';
  const select = fields.badgeKey.input;
  const hasOption = [...select.options].some((option) => option.value === target);
  select.value = hasOption ? target : '';
}

function fillKeyOptions(snapshot) {
  const keys = snapshot?.usage?.keys || [];
  const select = fields.badgeKey.input;
  const previous = select.value;
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All API keys';
  select.append(all);

  for (const key of keys) {
    const option = document.createElement('option');
    option.value = key.id;
    option.textContent = key.name;
    select.append(option);
  }

  const preferred = currentSettings?.badgeApiKey || previous;
  select.value = keys.some((key) => key.id === preferred) ? preferred : '';
}

function updatePreview() {
  if (!currentSnapshot) {
    preview.textContent = '—';
    previewTitle.textContent = 'No data yet — refresh the popup once.';
    return;
  }
  const badge = computeBadge(currentSnapshot, currentSettings);
  preview.textContent = badge.text || '—';
  preview.style.background = badge.color;
  previewTitle.textContent = badge.title;

  const budget = evaluateBudget(currentSnapshot?.usage?.todayCost, currentSettings);
  if (budget.status === 'off') {
    previewBudget.textContent = 'No daily budget set — the badge stays grey/green-neutral.';
    previewBudget.style.color = '';
  } else {
    previewBudget.textContent = `Today ${Math.round(budget.percent)}% of budget (${budget.status})`;
    previewBudget.style.color = budget.color;
  }
}

async function updateSessionStatus() {
  const { token, source } = await getTokenInfo();
  sessionStatus.classList.toggle('is-error', !token);
  sessionStatus.textContent = token
    ? `Session detected (${describeSource(source)}).`
    : 'No session found. Open platform.deepseek.com, sign in, then press "Re-detect session".';
}

function describeSource(source) {
  if (!source) return 'unknown source';
  if (source.startsWith('cookie:')) return `cookie ${source.slice(7)}`;
  if (source === 'page') return 'page storage';
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
