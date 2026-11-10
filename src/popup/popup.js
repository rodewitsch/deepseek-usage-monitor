import { SERIES_COLORS, POPUP_SECTION_IDS, STATUS_PAGE_URL, USAGE_PAGE_URL } from '../lib/constants.js';
import { evaluateBudgets } from '../lib/budget.js';
import { exportFileName, historyToCsv, historyToJson } from '../lib/exporter.js';
import { projectToday } from '../lib/forecast.js';
import { currencySymbol, formatMoney, formatRelativeTime, formatTokens, localDayKey } from '../lib/format.js';
import {
  compareMonths,
  compareToday,
  dailyAverage,
  estimateDepletion,
  firstRecordedDay,
  shiftDayKey,
  sortedDays,
} from '../lib/history.js';
import { applyDocumentLanguage, localizeDocument, t } from '../lib/i18n.js';
import { ensureCatalog } from '../lib/locales.js';
import { modelLabel } from '../lib/models.js';
import { scrapeFromPage } from '../lib/scrape.js';
import { getKeyRegistry, getSettings, getSnapshot, saveSettings, saveSnapshot } from '../lib/settings.js';

const el = (id) => document.getElementById(id);

const ui = {
  refresh: el('refresh'),
  updated: el('updated'),
  error: el('error'),
  errorText: el('error-text'),
  errorFix: el('error-fix'),
  status: el('status'),
  statusIcon: el('status-icon'),
  statusText: el('status-text'),
  balance: el('balance'),
  balanceDetail: el('balance-detail'),
  todayCost: el('today-cost'),
  todayTokens: el('today-tokens'),
  chart: el('chart'),
  chartTotal: el('chart-total'),
  chartLegend: el('chart-legend'),
  models: el('models'),
  modelsTotal: el('models-total'),
  modelList: el('model-list'),
  cacheNote: el('cache-note'),
  forecast: el('forecast'),
  forecastValue: el('forecast-value'),
  forecastNote: el('forecast-note'),
  compare: el('compare'),
  compareTodayDelta: el('compare-today-delta'),
  compareTodayNote: el('compare-today-note'),
  compareMonthDelta: el('compare-month-delta'),
  compareMonthNote: el('compare-month-note'),
  depletionRow: el('depletion-row'),
  depletionValue: el('depletion-value'),
  depletionNote: el('depletion-note'),
  historyRange: el('history-range'),
  exportCsv: el('export-csv'),
  exportJson: el('export-json'),
  exportNote: el('export-note'),
  budgets: el('budgets'),
  budgetList: el('budget-list'),
  keySelected: el('key-selected'),
  keyClear: el('key-clear'),
  keyList: el('key-list'),
  keyEmpty: el('key-empty'),
  openUsage: el('open-usage'),
  openOptions: el('open-options'),
  layout: el('layout'),
};

let settings = null;
/** Day-by-day ledger built from the API (`snapshot.ledger`) — never stored. */
let history = null;
let keyRegistry = null;

init();

async function init() {
  // `t()` renders templates itself because Chrome drops the space that
  // follows a substituted value, so the catalog must be registered before the
  // first label is written.
  ensureCatalog();
  applyDocumentLanguage();
  localizeDocument();
  ui.openUsage.href = USAGE_PAGE_URL;
  ui.status.href = STATUS_PAGE_URL;
  ui.refresh.addEventListener('click', () => refresh(true));
  ui.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.errorFix.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.exportCsv.addEventListener('click', () => exportHistory('csv'));
  ui.exportJson.addEventListener('click', () => exportHistory('json'));

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
    if (changes.apiKeyRegistry) keyRegistry = changes.apiKeyRegistry.newValue || null;
    if (
      changes.settings ||
      changes.usageSnapshot ||
      changes.apiKeyRegistry ||
      changes.lastError
    ) {
      render();
    }
    else if (changes.serviceStatus) renderServiceStatus(changes.serviceStatus.newValue);
  });


  // Ask the service worker for the current status so the indicator appears
  // immediately, even when the usage snapshot is still fresh.
  chrome.runtime.sendMessage({ type: 'dsum:status' }).catch(() => {});

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
    //    API is unavailable, and renews an expired WAF token if a tab exists).
    await chrome.runtime.sendMessage({ type: 'dsum:refresh' });
  } catch {
    // Service worker may be asleep — it wakes up for the message anyway.
  } finally {
    ui.refresh.classList.remove('is-busy');
    await render();
  }
  if (interactive) ui.updated.textContent = t('statusUpdated', [formatRelativeTime(Date.now())]);
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
  history = snapshot?.ledger || null;
  if (!keyRegistry) keyRegistry = await getKeyRegistry();
  const selected = selectedKeys(snapshot?.usage, settings);

  applyLayout(settings);
  renderStatus(snapshot, lastError);
  await renderServiceStatus();
  renderSummary(snapshot, selected);
  renderBudgets(snapshot, settings, selected.map((key) => key.id));
  renderChart(snapshot, settings, selected);
  renderModels(snapshot);
  renderForecast(snapshot, settings);
  renderCompare(snapshot, settings);
  renderKeys(snapshot, settings, selected);
  renderExport(snapshot);
}

/** Per-model spend for the aggregation window, plus the prompt-cache savings. */
function renderModels(snapshot) {
  const usage = snapshot?.usage;
  const stats = usage?.models;
  const models = Array.isArray(stats?.models) ? stats.models : [];
  const currency = usage?.currency || 'USD';

  ui.modelList.replaceChildren();
  ui.cacheNote.hidden = true;
  ui.cacheNote.textContent = '';
  ui.models.hidden = models.length === 0;
  ui.modelsTotal.textContent = '';
  if (!models.length) return;

  const total = models.reduce((sum, entry) => sum + entry.cost, 0) || 1;
  ui.modelsTotal.textContent = formatMoney(total, currency, { decimals: settings.showDecimals });

  for (const entry of models) {
    const item = document.createElement('li');
    item.className = 'model-item';

    const head = document.createElement('div');
    head.className = 'model-item__head';

    const name = document.createElement('span');
    name.className = 'model-item__name';
    name.textContent = modelLabel(entry.model);

    const cost = document.createElement('span');
    cost.className = 'model-item__cost';
    cost.textContent = formatMoney(entry.cost, currency, { decimals: settings.showDecimals });

    const meta = document.createElement('span');
    meta.className = 'model-item__meta';
    meta.textContent = t('modelMeta', [
      formatTokens(entry.tokens),
      String(Math.round((entry.cost / total) * 100)),
    ]);

    head.append(name, cost);

    const track = document.createElement('div');
    track.className = 'model-item__track';
    const fill = document.createElement('div');
    fill.className = 'model-item__fill';
    fill.style.width = `${Math.max(1, Math.round((entry.cost / total) * 100))}%`;
    track.append(fill);

    item.append(head, track, meta);
    ui.modelList.append(item);
  }

  const cache = stats?.cache;
  if (cache && cache.promptTokens > 0) {
    ui.cacheNote.hidden = false;
    ui.cacheNote.textContent = t('cacheNote', [
      String(Math.round(cache.hitRate * 100)),
      formatMoney(cache.saved, currency, { decimals: settings.showDecimals }),
    ]);
  }
}

/** Projected spend for the whole day, from the pace so far today. */
function renderForecast(snapshot, currentSettings) {
  const usage = snapshot?.usage;
  const todayCost = Number(usage?.todayCost) || 0;
  if (!usage || !snapshot?.todayKey || snapshot.todayKey !== localDayKey() || todayCost <= 0) {
    ui.forecast.hidden = true;
    return;
  }

  const forecast = projectToday(todayCost, new Date(), {
    windowCost: usage.priorDaysCost ?? Math.max(0, (usage.windowCost || 0) - todayCost),
    windowDays: currentSettings.windowDays,
  });
  if (forecast.tooEarly) {
    ui.forecast.hidden = true;
    return;
  }

  ui.forecast.hidden = false;
  ui.forecastValue.textContent = formatMoney(forecast.projected, usage.currency, {
    decimals: settings.showDecimals,
  });

  const notes = [
    t('forecastRemaining', [formatMoney(Math.max(0, forecast.projected - todayCost), usage.currency)]),
  ];
  if (forecast.baseline > 0 && forecast.ratio > 0) {
    notes.push(t('forecastVsAverage', [`${Math.round(forecast.ratio * 100)}%`]));
  }
  ui.forecastNote.textContent = notes.join(' · ');
}

/**
 * Today vs. yesterday and this month vs. the previous one, both from the
 * API-built ledger, plus the "balance runs out on …" estimate. The whole block
 * hides when the ledger has nothing to compare.
 */
function renderCompare(snapshot, currentSettings) {
  const usage = snapshot?.usage;
  const todayKey = localDayKey();
  const days = sortedDays(history || {});
  const currency = history?.currency || usage?.currency || 'USD';
  const money = (value) => formatMoney(value, currency, { decimals: currentSettings.showDecimals });

  ui.compare.hidden = true;
  ui.historyRange.textContent = '';
  ui.depletionRow.hidden = true;
  if (!days.length) return;

  const today = compareToday(usage, history, todayKey);
  const months = compareMonths(history, todayKey);

  const showToday = today.comparable;
  const showMonth = currentSettings.showMonthComparison && months.comparable;
  const depletion = currentSettings.showDepletion
    ? estimateDepletion(snapshot?.balance?.total, averageForDepletion(currentSettings, todayKey), todayKey)
    : null;

  if (!showToday && !showMonth && !depletion) return;

  ui.compare.hidden = false;
  ui.historyRange.textContent = t('historyRange', [
    firstRecordedDay(history) || '—',
    String(days.length),
  ]).trim();

  // Today vs. yesterday.
  ui.compareTodayDelta.closest('.compare__item').hidden = !showToday;
  if (showToday) {
    setDelta(ui.compareTodayDelta, today.todayCost, today.yesterday, money);
    // No baseline (yesterday spent nothing) → nothing to compare against, so
    // the "(±0%)"/"(—)" tail would only be noise.
    const change = today.ratio ? signedPercent(today.ratio) : '';
    ui.compareTodayNote.textContent = t('compareTodayNote', [
      `${money(today.yesterday)} → ${money(today.todayCost)}`,
      change || '—',
    ]).trim();
  }

  // This month (so far) vs. the same days of the previous month — comparing a
  // partial month with a whole month would always look like a drop.
  ui.compareMonthDelta.closest('.compare__item').hidden = !showMonth;
  if (showMonth) {
    setDelta(ui.compareMonthDelta, months.sameDaysCurrent, months.sameDaysPrevious, money);
    ui.compareMonthNote.textContent = t('compareMonthNote', [
      `${money(months.sameDaysPrevious)} → ${money(months.sameDaysCurrent)}`,
      String(Number(todayKey.slice(8, 10))),
      signedPercent(months.sameDaysRatio),
    ]).trim();
  }

  // Balance depletion. A date is not "bad news" on its own: red only when it
  // is imminent (≤ 3 days), muted otherwise. `is-up` is the red modifier here.
  if (depletion) {
    ui.depletionRow.hidden = false;
    ui.depletionValue.textContent = depletion.depleted
      ? t('depletionNow')
      : formatDate(depletion.runsOutOn);
    ui.depletionValue.classList.remove('is-up', 'is-down', 'is-flat');
    ui.depletionValue.classList.add(depletion.daysLeft <= 3 ? 'is-up' : 'is-flat');
    ui.depletionNote.textContent = t('depletionNote', [
      String(depletion.daysLeft),
      money(depletion.perDay),
    ]).trim();
  }
}

/** Average daily spend over the configured depletion window (0 = whole ledger). */
function averageForDepletion(currentSettings, todayKey) {
  const windowDays = Number(currentSettings.depletionWindowDays) || 0;
  const from = windowDays > 0 ? shiftDayKey(todayKey, -windowDays) : null;
  return dailyAverage(history, { from, to: shiftDayKey(todayKey, -1) }).average;
}

/** Colours the delta red for growth, green for a drop, muted for no change. */
function setDelta(node, current, previous, money) {
  const diff = (Number(current) || 0) - (Number(previous) || 0);
  node.classList.remove('is-up', 'is-down', 'is-flat');
  if (!previous) {
    node.classList.add('is-flat');
    node.textContent = money(current);
    return;
  }
  node.classList.add(diff > 0 ? 'is-up' : diff < 0 ? 'is-down' : 'is-flat');
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  node.textContent = `${sign}${money(Math.abs(diff))}`;
}

/** `1.25` → "+25%", `0.6` → "−40%", no change → "±0%". */
function signedPercent(ratio) {
  const percent = Math.round((Number(ratio) - 1) * 100);
  if (!Number.isFinite(percent) || percent === 0) return '±0%';
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`;
}

/** `2026-11-24` → a locale-agnostic short date (`24 Nov 2026`). */
function formatDate(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  try {
    return date.toLocaleDateString(chrome.i18n.getUILanguage(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dayKey;
  }
}

/** How many days of the ledger the export buttons can offer. */
function renderExport(snapshot) {
  const days = sortedDays(history || {}).length;
  ui.exportNote.textContent = days
    ? t('exportNote', [String(days)])
    : t('exportEmpty');
  ui.exportCsv.disabled = days === 0 && !snapshot?.usage;
  ui.exportJson.disabled = ui.exportCsv.disabled;
}

/** Downloads the history as CSV or JSON through a temporary blob URL. */
async function exportHistory(format) {
  const { snapshot } = await getSnapshot();
  const ledger = snapshot?.ledger || null;
  const todayKey = localDayKey();
  const payload =
    format === 'csv'
      ? historyToCsv(ledger, { usage: snapshot?.usage, todayKey })
      : historyToJson(ledger, { usage: snapshot?.usage, balance: snapshot?.balance, todayKey });
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';

  const blob = new Blob([payload], { type });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: exportFileName(format, todayKey),
      saveAs: false,
    });
  } catch (error) {
    // `downloads` permission missing or blocked — fall back to an `<a download>`.
    console.warn('[DeepSeek Usage] download failed, using an anchor:', error?.message || error);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFileName(format, todayKey);
    anchor.click();
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/** `{ id: HTMLElement }` — the wrappers that can be reordered and hidden. */
function sectionWrappers() {
  return new Map(
    [...ui.layout.querySelectorAll('.section-wrap')].map((node) => [node.dataset.section, node]),
  );
}

/** Applies the stored order and visibility to the popup sections. */
function applyLayout(currentSettings) {
  const hidden = new Set(currentSettings?.popupHidden || []);
  const order = currentSettings?.popupSections?.length ? currentSettings.popupSections : POPUP_SECTION_IDS;
  const wrappers = sectionWrappers();

  for (const id of order) {
    const node = wrappers.get(id);
    if (!node) continue;
    node.hidden = hidden.has(id);
    ui.layout.append(node);
  }
  // Sections stored before an update still get appended after the known ones.
  for (const [id, node] of wrappers) {
    if (!order.includes(id)) node.hidden = hidden.has(id);
  }
}

function selectedKeys(usage, currentSettings) {
  const ids = currentSettings?.selectedApiKeys || [];
  if (!usage?.keys?.length) return [];
  return ids.map((id) => usage.keys.find((key) => key.id === id || key.name === id)).filter(Boolean);
}

function renderStatus(snapshot, lastError) {
  // A WAF block is not something the user must fix: cached numbers stay on
  // screen and the status line says when they will refresh. Auth problems and
  // real failures still show the banner.
  const isWaf = lastError?.kind === 'waf';
  if (lastError?.message && !isWaf) {
    ui.error.hidden = false;
    ui.errorText.textContent = lastError.message;
    ui.errorFix.hidden = lastError.kind !== 'auth';
  } else {
    ui.error.hidden = true;
  }

  if (!snapshot?.updatedAt) {
    ui.updated.textContent = isWaf ? t('badgeNoData') : t('statusNoData');
    return;
  }
  const ago = formatRelativeTime(snapshot.updatedAt);
  if (isWaf) {
    ui.updated.textContent = t('statusStale', [ago]);
    return;
  }
  const stale = snapshot.todayKey && snapshot.todayKey !== localDayKey();
  ui.updated.textContent = stale ? t('statusYesterday', [ago]) : t('statusUpdated', [ago]);
}

const STATUS_COLORS = {
  operational: '#067647',
  degraded: '#d97706',
  partial_outage: '#d97706',
  full_outage: '#dc2626',
  unknown: '#6b7280',
};

/** Service-status pill from https://status.deepseek.com (stored by the SW). */
async function renderServiceStatus(freshStatus) {
  const status =
    freshStatus ||
    (await chrome.storage.local.get('serviceStatus')).serviceStatus ||
    null;
  if (!status) {
    ui.status.hidden = true;
    return;
  }

  const level = status.level || 'operational';
  const trouble = level !== 'operational';
  ui.status.hidden = false;
  ui.status.classList.toggle('is-trouble', trouble);
  ui.status.dataset.level = level;

  const color = STATUS_COLORS[level] || STATUS_COLORS.unknown;
  ui.statusIcon.innerHTML = trouble
    ? `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
         <circle class="status__pulse" cx="8" cy="8" r="7" fill="none" stroke="${color}" stroke-width="1.5"></circle>
         <circle cx="8" cy="8" r="4.5" fill="${color}"></circle>
       </svg>`
    : `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
         <circle cx="8" cy="8" r="5" fill="${color}"></circle>
       </svg>`;
  ui.statusText.textContent = statusLabel(level);
}

function statusLabel(level) {
  switch (level) {
    case 'operational':
      return t('statusOperational');
    case 'degraded':
      return t('statusDegraded');
    case 'partial_outage':
      return t('statusPartialOutage');
    case 'full_outage':
      return t('statusFullOutage');
    default:
      return t('statusUnknown');
  }
}

function renderSummary(snapshot, selected) {
  const usage = snapshot?.usage;
  const balance = snapshot?.balance;

  if (!usage) {
    ui.balance.textContent = '—';
    ui.balanceDetail.textContent = t('signInPrompt');
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
    ? t('balancePaidBonus', [
        formatMoney(balance.toppedUp, balance.currency, { decimals: settings.showDecimals }),
        formatMoney(balance.granted, balance.currency, { decimals: settings.showDecimals }),
      ])
    : t('balanceUnavailable');

  ui.todayCost.textContent = formatMoney(todayCost, usage.currency, { decimals: settings.showDecimals });
  const scope =
    selected.length === 1
      ? selected[0].name
      : selected.length > 1
        ? t('keysCount', [String(selected.length)])
        : '';
  const tokens = t('tokensCount', [formatTokens(todayTokens)]);
  ui.todayTokens.textContent = scope ? t('tokensScope', [tokens, scope]) : tokens;
}

/** One progress bar per active budget: the account plus each selected key. */
function renderBudgets(snapshot, currentSettings, selectedIds) {
  const usage = snapshot?.usage;
  const budgets = evaluateBudgets(usage, currentSettings, selectedIds);
  const rows = [];

  if (budgets.account.status !== 'off') {
    const scope =
      selectedIds.length === 1
        ? t('budgetForSelection', [budgets.keys[0]?.name || t('budgetForSelectionFallback')])
        : t('budgetAccount');
    rows.push({ label: t('budgetDailyScope', [scope]), budget: budgets.account });
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
    mark.title = t('budgetWarnMark', [String(warnMark)]);
    mark.style.left = `${warnMark}%`;
    track.append(fill, mark);

    const detail = document.createElement('span');
    detail.className = 'budget__detail';
    detail.textContent =
      budget.status === 'over'
        ? t('budgetSpentOver', [money(budget.spent), money(budget.remaining)])
        : t('budgetSpentLeft', [money(budget.spent), money(budget.remaining), money(budget.budget)]);

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
    empty.textContent = t('chartEmpty');
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
    : [
        {
          id: 'account',
          name: t('chartSeriesAllKeys'),
          color: null,
          values: daily.map((day) => Number(day.cost) || 0),
        },
      ];

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

    const lines = [t('chartTooltipDay', [day.date, formatMoney(totals[index], currency)])];
    if (series.length > 1) {
      for (const entry of series) {
        const value = entry.values[offset + index] || 0;
        if (value > 0) lines.push(`${entry.name}: ${formatMoney(value, currency)}`);
      }
    } else {
      lines.push(t('tokensCount', [formatTokens(day.tokens)]));
    }
    column.title = lines.join('\n');
    column.append(stack);
    ui.chart.append(column);
  });

  const total = totals.reduce((sum, value) => sum + value, 0);
  ui.chartTotal.textContent = t('chartTotal', [formatMoney(total, currency), String(days.length)]);

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
  const todayKey = localDayKey();

  ui.keySelected.textContent = selectedIds.size ? t('keysCountSelected', [String(selectedIds.size)]) : '';
  ui.keyClear.hidden = selectedIds.size === 0;

  ui.keyList.replaceChildren();
  if (!keys.length) {
    ui.keyEmpty.hidden = false;
    return;
  }
  ui.keyEmpty.hidden = true;

  keys.forEach((key, index) => {
    const isSelected = selectedIds.has(key.id);
    // "Idle" uses the stored registry, not just the current window: a key that
    // disappeared from the API payload entirely is the most idle of all.
    const idleDays = idleDaysFor(key.id, currentSettings, snapshot, todayKey);
    const item = document.createElement('li');
    item.className = `key-item${isSelected ? ' is-selected' : ''}${idleDays > 0 ? ' is-idle' : ''}`;
    item.dataset.keyId = key.id;
    item.title = isSelected ? t('keyRemoveFromChart') : t('keyPlot');

    const marker = document.createElement('span');
    marker.className = 'key-item__marker';
    if (isSelected) {
      const index2 = selected.findIndex((entry) => entry.id === key.id);
      marker.style.background = SERIES_COLORS[index2 % SERIES_COLORS.length];
    }

    const name = document.createElement('span');
    name.className = 'key-item__name';
    name.textContent = key.name;

    if (idleDays > 0) {
      const idle = document.createElement('span');
      idle.className = 'key-item__badge';
      idle.textContent = t('keyIdleBadge', [String(idleDays)]);
      idle.title = t('keyIdleTitle', [String(idleDays)]);
      name.append(' ', idle);
    }

    const meta = document.createElement('span');
    meta.className = 'key-item__meta';
    const budget = Number(currentSettings.keyBudgets?.[key.id]) || 0;
    const today = formatMoney(key.todayCost, usage.currency, { decimals: currentSettings.showDecimals });
    meta.textContent =
      budget > 0
        ? t('keyTodayMetaBudget', [
            today,
            formatMoney(budget, usage.currency, { decimals: currentSettings.showDecimals }),
          ])
        : t('keyTodayMeta', [today]);

    const cost = document.createElement('span');
    cost.className = 'key-item__cost';
    cost.textContent = formatMoney(key.windowCost, usage.currency, {
      decimals: currentSettings.showDecimals,
    });

    // A key without spend in the window gets a dimmed amount instead of the
    // same bold `$0.00` as a key that actually costs money.
    if (!(Number(key.windowCost) > 0)) item.classList.add('is-zero');

    item.append(marker, name, meta, cost);
    ui.keyList.append(item);
  });
}

/**
 * How many days a key has been idle, or 0 when it is active enough (or when
 * the highlight is switched off). Uses the registry first, then the current
 * payload's `lastUsedDay`, so the badge appears even before a full history.
 */
function idleDaysFor(keyId, currentSettings, snapshot, todayKey) {
  if (!currentSettings.inactiveKeyHighlight) return 0;
  const threshold = Number(currentSettings.inactiveKeyDays) || 0;
  if (!(threshold > 0)) return 0;

  const key = snapshot?.usage?.keys?.find((entry) => entry.id === keyId);
  const lastUsed = keyRegistry?.[keyId]?.lastUsedDay || key?.lastUsedDay || null;
  if (!lastUsed) return 0;

  // Spend today means the key is obviously alive, whatever the registry says.
  if ((Number(key?.todayCost) || 0) > 0) return 0;

  const days = dayDistance(lastUsed, todayKey);
  return days >= threshold ? days : 0;
}

/** Whole days between two `YYYY-MM-DD` keys (UTC math, no DST surprises). */
function dayDistance(fromDay, toDay) {
  const toMs = (day) => {
    const [year, month, dayOfMonth] = String(day).split('-').map(Number);
    return Date.UTC(year, month - 1, dayOfMonth);
  };
  return Math.round((toMs(toDay) - toMs(fromDay)) / 86400000);
}
