import { USAGE_PAGE_URL } from '../lib/constants.js';
import { evaluateBudget } from '../lib/budget.js';
import { currencySymbol, formatMoney, formatRelativeTime, formatTokens, localDayKey } from '../lib/format.js';
import { scrapeFromPage } from '../lib/scrape.js';
import { getSettings, getSnapshot, saveSettings, saveSnapshot } from '../lib/settings.js';

const el = (id) => document.getElementById(id);

const ui = {
  refresh: el('refresh'),
  updated: el('updated'),
  error: el('error'),
  errorText: el('error-text'),
  errorFix: el('error-fix'),
  balance: el('balance'),
  balanceDetail: el('balance-detail'),
  todayCost: el('today-cost'),
  todayTokens: el('today-tokens'),
  chart: el('chart'),
  chartTotal: el('chart-total'),
  budget: el('budget'),
  budgetPercent: el('budget-percent'),
  budgetFill: el('budget-fill'),
  budgetWarnMark: el('budget-warnmark'),
  budgetDetail: el('budget-detail'),
  keyFilter: el('key-filter'),
  keyList: el('key-list'),
  keyEmpty: el('key-empty'),
  openUsage: el('open-usage'),
  openOptions: el('open-options'),
};

let settings = null;

init();

async function init() {
  ui.openUsage.href = USAGE_PAGE_URL;
  ui.refresh.addEventListener('click', () => refresh(true));
  ui.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.errorFix.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.keyFilter.addEventListener('change', async () => {
    await saveSettings({ focusApiKey: ui.keyFilter.value || null });
    await render();
  });
  ui.keyList.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-key-id]');
    if (!item) return;
    const id = item.dataset.keyId;
    await saveSettings({ focusApiKey: settings.focusApiKey === id ? null : id });
    await render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings || changes.usageSnapshot || changes.lastError) render();
  });

  await render();
  const { snapshot, lastError } = await getSnapshot();
  const isStale = !snapshot?.updatedAt || Date.now() - snapshot.updatedAt > 5 * 60000;
  if (isStale) refresh(false);
  else if (lastError) ui.refresh.classList.remove('is-busy');
}

async function refresh(interactive) {
  ui.refresh.classList.add('is-busy');
  try {
    // 1. Fast path — if a console page happens to be open, read balance and
    //    period totals from its DOM. This never opens a tab.
    const scraped = await scrapeFromPage();
    if (scraped.ok) await applyScrapedSnapshot(scraped.data);

    // 2. Per-day / per-key numbers only exist in the console API, so always
    //    ask the service worker for them (it reuses the scraped values when the
    //    API is unavailable).
    await chrome.runtime.sendMessage({ type: 'dsum:refresh' });
  } catch {
    // Service worker may be asleep — it wakes up for the message anyway.
  } finally {
    ui.refresh.classList.remove('is-busy');
    await render();
  }
  if (interactive) ui.updated.textContent = `Updated ${formatRelativeTime(Date.now())}`;
}

/** Merges the scraped page numbers into the stored snapshot. */
async function applyScrapedSnapshot(page) {
  const { snapshot } = await getSnapshot();
  const next = {
    ...(snapshot || {}),
    updatedAt: page.capturedAt,
    todayKey: snapshot?.todayKey || localDayKey(),
    scraped: true,
    balance: {
      currency: page.currency,
      total: page.balance,
      toppedUp: page.toppedUp ?? 0,
      granted: page.granted ?? 0,
      isAvailable: page.balance > 0,
    },
    usage: {
      ...(snapshot?.usage || {}),
      currency: page.windowCurrency || page.currency,
      windowCost: page.windowCost ?? snapshot?.usage?.windowCost ?? 0,
      windowTokens: page.tokens ?? snapshot?.usage?.windowTokens ?? 0,
      requests: page.requests ?? null,
      source: 'page',
    },
  };
  await saveSnapshot(next, null);
}

async function render() {
  settings = await getSettings();
  const { snapshot, lastError } = await getSnapshot();

  renderStatus(snapshot, lastError);
  renderSummary(snapshot);
  renderBudget(snapshot, settings);
  renderChart(snapshot, settings);
  renderKeys(snapshot, settings);
}

/** Spend-today progress against the optional daily budget. */
function renderBudget(snapshot, currentSettings) {
  const usage = snapshot?.usage;
  const budget = evaluateBudget(usage?.todayCost, currentSettings);

  if (budget.status === 'off' || !usage) {
    ui.budget.hidden = true;
    return;
  }

  const currency = usage.currency || 'USD';
  const shown = Math.min(100, Math.max(0, budget.percent));
  ui.budget.hidden = false;
  ui.budgetPercent.textContent = `${Math.round(budget.percent)}%`;
  ui.budgetPercent.style.color = budget.color;
  ui.budgetFill.style.width = `${shown}%`;
  ui.budgetFill.style.background = budget.color;
  ui.budgetWarnMark.style.left = `${Math.min(99, Number(currentSettings.budgetWarnPercent) || 90)}%`;

  // Budget figures stay at 2 decimals: "$0.0700 left" reads badly.
  const money = (value) => `${currencySymbol(currency)}${Math.abs(Number(value) || 0).toFixed(2)}`;
  const state =
    budget.status === 'over'
      ? `Over by ${money(budget.remaining)}`
      : `${money(budget.remaining)} left of ${money(budget.budget)}`;  ui.budgetDetail.textContent = `${money(budget.spent)} · ${state}`;
}

function renderStatus(snapshot, lastError) {
  if (lastError?.message) {
    ui.error.hidden = false;
    ui.errorText.textContent = lastError.message;
    ui.errorFix.hidden = lastError.kind !== 'auth';
  } else {
    ui.error.hidden = true;
  }

  if (!snapshot?.updatedAt) {
    ui.updated.textContent = 'No data yet';
    return;
  }
  const stale = snapshot.todayKey && snapshot.todayKey !== localDayKey();
  ui.updated.textContent = `Updated ${formatRelativeTime(snapshot.updatedAt)}${stale ? ' · yesterday' : ''}`;
}

function renderSummary(snapshot) {
  const usage = snapshot?.usage;
  const balance = snapshot?.balance;

  if (!usage) {
    ui.balance.textContent = '—';
    ui.balanceDetail.textContent = 'Sign in on platform.deepseek.com';
    ui.todayCost.textContent = '—';
    ui.todayTokens.textContent = '—';
    return;
  }

  const key = settings.focusApiKey
    ? usage.keys.find((item) => item.id === settings.focusApiKey || item.name === settings.focusApiKey)
    : null;

  const todayCost = key ? key.todayCost : usage.todayCost;
  const todayTokens = key ? key.todayTokens : usage.todayTokens;

  ui.balance.textContent = balance ? formatMoney(balance.total, balance.currency, { decimals: settings.showDecimals }) : '—';
  ui.balanceDetail.textContent = balance
    ? `paid ${formatMoney(balance.toppedUp, balance.currency, { decimals: settings.showDecimals })} · bonus ${formatMoney(
        balance.granted,
        balance.currency,
        { decimals: settings.showDecimals },
      )}`
    : 'Balance unavailable';

  ui.todayCost.textContent = formatMoney(todayCost, usage.currency, { decimals: settings.showDecimals });
  ui.todayTokens.textContent = `${formatTokens(todayTokens)} tokens${key ? ` · ${key.name}` : ''}`;
}

function renderChart(snapshot, currentSettings) {
  const daily = snapshot?.usage?.daily || [];
  ui.chart.replaceChildren();
  ui.chartTotal.textContent = '';
  if (!daily.length) {
    const empty = document.createElement('span');
    empty.className = 'chart-empty';
    empty.textContent = 'No usage in this period';
    ui.chart.append(empty);
    return;
  }

  const days = daily.slice(-currentSettings.windowDays);
  const max = Math.max(...days.map((day) => day.cost), 0.0001);
  const today = localDayKey();

  for (const day of days) {
    const bar = document.createElement('div');
    const ratio = day.cost / max;
    bar.className = `bar${day.cost === 0 ? ' bar--empty' : ''}${day.date === today ? ' bar--today' : ''}`;
    bar.style.height = `${Math.max(2, Math.round(ratio * 100))}%`;
    bar.title = `${day.date}: ${formatMoney(day.cost, snapshot.usage.currency)} · ${formatTokens(day.tokens)} tokens`;
    ui.chart.append(bar);
  }

  const total = days.reduce((sum, day) => sum + day.cost, 0);
  ui.chartTotal.textContent = `${formatMoney(total, snapshot.usage.currency)} in ${days.length}d`;
}

function renderKeys(snapshot, currentSettings) {
  const usage = snapshot?.usage;
  const keys = usage?.keys || [];

  ui.keyFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All keys';
  ui.keyFilter.append(allOption);
  for (const key of keys) {
    const option = document.createElement('option');
    option.value = key.id;
    option.textContent = key.name;
    ui.keyFilter.append(option);
  }
  const currentFocus =
    keys.find((key) => key.id === currentSettings.focusApiKey || key.name === currentSettings.focusApiKey)?.id || '';
  ui.keyFilter.value = currentFocus;

  ui.keyList.replaceChildren();
  if (!keys.length) {
    ui.keyEmpty.hidden = false;
    return;
  }
  ui.keyEmpty.hidden = true;

  for (const key of keys) {
    const item = document.createElement('li');
    item.className = `key-item${currentFocus === key.id ? ' is-selected' : ''}`;
    item.dataset.keyId = key.id;

    const name = document.createElement('span');
    name.className = 'key-item__name';
    name.textContent = key.name;

    const meta = document.createElement('span');
    meta.className = 'key-item__meta';
    meta.textContent = `today ${formatMoney(key.todayCost, usage.currency)}`;

    const cost = document.createElement('span');
    cost.className = 'key-item__cost';
    cost.textContent = formatMoney(key.windowCost, usage.currency);

    item.append(name, meta, cost);
    ui.keyList.append(item);
  }
}
