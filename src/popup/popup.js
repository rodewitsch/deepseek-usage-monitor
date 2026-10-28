import { SERIES_COLORS, USAGE_PAGE_URL } from '../lib/constants.js';
import { evaluateBudgets } from '../lib/budget.js';
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
  chartLegend: el('chart-legend'),
  budgets: el('budgets'),
  budgetList: el('budget-list'),
  keySelected: el('key-selected'),
  keyClear: el('key-clear'),
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

  ui.keyList.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-key-id]');
    if (!item) return;
    await toggleKey(item.dataset.keyId);
  });
  ui.keyClear.addEventListener('click', async () => {
    await saveSettings({ selectedApiKeys: [] });
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

/** Adds/removes one API key from the selection shared by chart and budget. */
async function toggleKey(id) {
  const current = settings?.selectedApiKeys || [];
  const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
  await saveSettings({ selectedApiKeys: next });
  await render();
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
  const selected = selectedKeys(snapshot?.usage, settings);

  renderStatus(snapshot, lastError);
  renderSummary(snapshot, selected);
  renderBudgets(snapshot, settings, selected.map((key) => key.id));
  renderChart(snapshot, settings, selected);
  renderKeys(snapshot, settings, selected);
}

/** Selected API keys that still exist in the payload. */
function selectedKeys(usage, currentSettings) {
  const ids = currentSettings?.selectedApiKeys || [];
  if (!usage?.keys?.length) return [];
  return ids.map((id) => usage.keys.find((key) => key.id === id || key.name === id)).filter(Boolean);
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

function renderSummary(snapshot, selected) {
  const usage = snapshot?.usage;
  const balance = snapshot?.balance;

  if (!usage) {
    ui.balance.textContent = '—';
    ui.balanceDetail.textContent = 'Sign in on platform.deepseek.com';
    ui.todayCost.textContent = '—';
    ui.todayTokens.textContent = '—';
    return;
  }

  const sum = (field) => selected.reduce((total, key) => total + (Number(key[field]) || 0), 0);
  const todayCost = selected.length ? sum('todayCost') : usage.todayCost;
  const todayTokens = selected.length ? sum('todayTokens') : usage.todayTokens;

  ui.balance.textContent = balance
    ? formatMoney(balance.total, balance.currency, { decimals: settings.showDecimals })
    : '—';
  ui.balanceDetail.textContent = balance
    ? `paid ${formatMoney(balance.toppedUp, balance.currency, { decimals: settings.showDecimals })} · bonus ${formatMoney(
        balance.granted,
        balance.currency,
        { decimals: settings.showDecimals },
      )}`
    : 'Balance unavailable';

  ui.todayCost.textContent = formatMoney(todayCost, usage.currency, { decimals: settings.showDecimals });
  const scope =
    selected.length === 1
      ? selected[0].name
      : selected.length > 1
        ? `${selected.length} keys`
        : '';
  ui.todayTokens.textContent = `${formatTokens(todayTokens)} tokens${scope ? ` · ${scope}` : ''}`;
}

/** One progress bar per active budget: the account plus each selected key. */
function renderBudgets(snapshot, currentSettings, selectedIds) {
  const usage = snapshot?.usage;
  const budgets = evaluateBudgets(usage, currentSettings, selectedIds);
  const rows = [];

  if (budgets.account.status !== 'off') {
    const scope = selectedIds.length === 1 ? `for ${budgets.keys[0]?.name || 'selection'}` : 'account';
    rows.push({ label: `Daily budget · ${scope}`, budget: budgets.account });
  }
  for (const budget of budgets.keys) rows.push({ label: budget.name, budget });

  ui.budgetList.replaceChildren();
  ui.budgets.hidden = rows.length === 0;
  if (!rows.length) return;

  const currency = usage?.currency || 'USD';
  const money = (value) => `${currencySymbol(currency)}${Math.abs(Number(value) || 0).toFixed(2)}`;
  const warnMark = Math.min(99, Number(currentSettings.budgetWarnPercent) || 90);

  for (const row of rows) {
    const { budget } = row;

    const wrapper = document.createElement('div');
    wrapper.className = 'budget';

    const head = document.createElement('div');
    head.className = 'budget__head';
    const label = document.createElement('span');
    label.className = 'budget__label';
    label.textContent = row.label;
    const percent = document.createElement('span');
    percent.className = 'budget__percent';
    percent.style.color = budget.color;
    percent.textContent = `${Math.round(budget.percent)}%`;
    head.append(label, percent);

    const track = document.createElement('div');
    track.className = 'budget__track';
    const fill = document.createElement('div');
    fill.className = 'budget__fill';
    fill.style.width = `${Math.min(100, Math.max(0, budget.percent))}%`;
    fill.style.background = budget.color;
    const mark = document.createElement('div');
    mark.className = 'budget__mark';
    mark.title = `Warn threshold ${warnMark}%`;
    mark.style.left = `${warnMark}%`;
    track.append(fill, mark);

    const detail = document.createElement('span');
    detail.className = 'budget__detail';
    const state =
      budget.status === 'over'
        ? `over by ${money(budget.remaining)}`
        : `${money(budget.remaining)} left of ${money(budget.budget)}`;
    detail.textContent = `${money(budget.spent)} spent · ${state}`;

    wrapper.append(head, track, detail);
    ui.budgetList.append(wrapper);
  }
}

/**
 * Stacked per-day chart. With nothing selected the account total is drawn as a
 * single series; with N selected keys the bars are split into N coloured
 * segments, so each key's contribution stays visible.
 */
function renderChart(snapshot, currentSettings, selected) {
  const usage = snapshot?.usage;
  const daily = usage?.daily || [];
  ui.chart.replaceChildren();
  ui.chartTotal.textContent = '';
  ui.chartLegend.replaceChildren();
  ui.chartLegend.hidden = true;

  if (!daily.length) {
    const empty = document.createElement('span');
    empty.className = 'chart-empty';
    empty.textContent = 'No usage in this period';
    ui.chart.append(empty);
    return;
  }

  const series = selected.length
    ? selected.map((key, index) => ({
        id: key.id,
        name: key.name,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        values: daily.map((day) => Number(key.dailyCost?.[day.date]) || 0),
      }))
    : [{ id: 'account', name: 'All keys', color: null, values: daily.map((day) => Number(day.cost) || 0) }];

  const days = daily.slice(-currentSettings.windowDays);
  const offset = daily.length - days.length;
  const totals = days.map((day, index) =>
    series.reduce((sum, entry) => sum + (entry.values[offset + index] || 0), 0),
  );
  const max = Math.max(...totals, 0.0001);
  const today = localDayKey();
  const currency = usage.currency || 'USD';

  days.forEach((day, index) => {
    const column = document.createElement('div');
    column.className = `chart__column${day.date === today ? ' chart__column--today' : ''}`;

    const stack = document.createElement('div');
    stack.className = 'chart__stack';
    stack.style.height = `${Math.max(2, Math.round((totals[index] / max) * 100))}%`;

    for (const entry of series) {
      const value = entry.values[offset + index] || 0;
      if (totals[index] > 0 && value <= 0) continue;
      const segment = document.createElement('div');
      segment.className = 'chart__segment';
      segment.style.flexGrow = String(totals[index] > 0 ? value : 1);
      if (entry.color) segment.style.background = entry.color;
      stack.append(segment);
    }

    const lines = [`${day.date}: ${formatMoney(totals[index], currency)}`];
    if (series.length > 1) {
      for (const entry of series) {
        const value = entry.values[offset + index] || 0;
        if (value > 0) lines.push(`${entry.name}: ${formatMoney(value, currency)}`);
      }
    } else {
      lines.push(`${formatTokens(day.tokens)} tokens`);
    }
    column.title = lines.join('\n');
    column.append(stack);
    ui.chart.append(column);
  });

  const total = totals.reduce((sum, value) => sum + value, 0);
  ui.chartTotal.textContent = `${formatMoney(total, currency)} in ${days.length}d`;

  if (series.length > 1) {
    ui.chartLegend.hidden = false;
    for (const entry of series) {
      const item = document.createElement('span');
      item.className = 'legend__item';
      const dot = document.createElement('span');
      dot.className = 'legend__dot';
      dot.style.background = entry.color;
      const name = document.createElement('span');
      name.textContent = entry.name;
      item.append(dot, name);
      ui.chartLegend.append(item);
    }
  }
}

function renderKeys(snapshot, currentSettings, selected) {
  const usage = snapshot?.usage;
  const keys = usage?.keys || [];
  const selectedIds = new Set(selected.map((key) => key.id));

  ui.keySelected.textContent = selectedIds.size ? `${selectedIds.size} selected` : '';
  ui.keyClear.hidden = selectedIds.size === 0;

  ui.keyList.replaceChildren();
  if (!keys.length) {
    ui.keyEmpty.hidden = false;
    return;
  }
  ui.keyEmpty.hidden = true;

  keys.forEach((key, index) => {
    const isSelected = selectedIds.has(key.id);
    const item = document.createElement('li');
    item.className = `key-item${isSelected ? ' is-selected' : ''}`;
    item.dataset.keyId = key.id;
    item.title = isSelected ? 'Click to remove from the chart' : 'Click to plot this key';

    const marker = document.createElement('span');
    marker.className = 'key-item__marker';
    if (isSelected) {
      const index2 = selected.findIndex((entry) => entry.id === key.id);
      marker.style.background = SERIES_COLORS[index2 % SERIES_COLORS.length];
    }

    const name = document.createElement('span');
    name.className = 'key-item__name';
    name.textContent = key.name;

    const meta = document.createElement('span');
    meta.className = 'key-item__meta';
    const budget = Number(currentSettings.keyBudgets?.[key.id]) || 0;
    meta.textContent = `today ${formatMoney(key.todayCost, usage.currency)}${
      budget > 0 ? ` / ${formatMoney(budget, usage.currency)}` : ''
    }`;

    const cost = document.createElement('span');
    cost.className = 'key-item__cost';
    cost.textContent = formatMoney(key.windowCost, usage.currency);

    item.append(marker, name, meta, cost);
    ui.keyList.append(item);
  });
}
