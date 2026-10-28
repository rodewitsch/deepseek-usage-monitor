import { computeBadge } from './lib/badge.js';
import { budgetNoticeKey, evaluateBudget } from './lib/budget.js';
import { refreshUsage } from './lib/refresh.js';
import { refreshFromPage } from './lib/scrape.js';
import { getSettings, getSnapshot } from './lib/settings.js';

const ALARM_NAME = 'dsum-refresh';
let refreshing = null;

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleAlarm();
  await updateBadge();
  await refreshAndPaint();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await updateBadge();
  // A console tab restored by the browser already has the numbers — read them.
  await refreshAndPaint();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await refreshAndPaint();
});

// A console page changed or finished loading → its DOM has fresh numbers.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url?.includes('platform.deepseek.com')) return;
  // Let the React app render before scraping.
  setTimeout(() => {
    void refreshAndPaint();
  }, 1500);
});

// Paint immediately when the user changes settings.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    await scheduleAlarm();
    await updateBadge();
  }
  // NOTE: usageSnapshot changes are painted by refreshAndPaint() itself, which
  // also knows the error kind. Painting here would race and drop that info.
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'dsum:refresh') {
    refreshAndPaint({ forceToken: Boolean(message.forceToken) })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true; // async response
  }
  return false;
});

async function refreshAndPaint({ forceToken = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const settings = await getSettings();

    // The DOM only has balance + period totals. Per-day and per-key figures
    // exist exclusively in the console API. No tab is ever opened here: the
    // WAF token comes from the browser's cookies and renews on normal visits.
    const result = await refreshUsage({ forceToken });

    if (!result.lastError) {
      await paintBadge(computeBadge(withErrorKind(result.snapshot, null), settings));
      await notifyBudget(result.snapshot, settings);
      return result;
    }

    // API unavailable → at least keep the balance/period totals from the page.
    const scraped = await refreshFromPage();
    const snapshot = scraped.snapshot || result.snapshot;
    await paintBadge(computeBadge(withErrorKind(snapshot, result.lastError), settings));
    return { snapshot, lastError: result.lastError };
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function updateBadge() {
  const [{ snapshot, lastError }, settings] = await Promise.all([getSnapshot(), getSettings()]);
  await paintBadge(computeBadge(withErrorKind(snapshot, lastError), settings));
}

/**
 * Desktop notification when today's spend crosses the daily budget thresholds.
 * Fires once per day for the warn level and once for the over level.
 */
async function notifyBudget(snapshot, settings) {
  if (!settings.budgetNotifications) return;
  const todayCost = snapshot?.usage?.todayCost;
  const budget = evaluateBudget(todayCost, settings);
  if (budget.status === 'off' || budget.status === 'ok') return;

  const dayKey = snapshot?.todayKey || new Date().toISOString().slice(0, 10);
  const key = budgetNoticeKey(budget.status, dayKey);
  const { notified = [] } = await chrome.storage.local.get('notified');
  if (notified.includes(key)) return;

  const currency = snapshot?.usage?.currency || 'USD';
  const money = (value) => `${currency} ${value.toFixed(2)}`;
  const title = budget.status === 'over' ? 'Daily budget exceeded' : 'Daily budget almost used up';
  const message =
    budget.status === 'over'
      ? `Spent ${money(budget.spent)} of ${money(budget.budget)} today (${Math.round(budget.percent)}%)`
      : `Spent ${money(budget.spent)} of ${money(budget.budget)} today (${Math.round(budget.percent)}%), ${money(
          budget.remaining,
        )} left`;

  try {
    await chrome.notifications.create(key, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: budget.status === 'over' ? 2 : 1,
    });
  } catch (error) {
    console.warn('[DeepSeek Usage] notification failed:', error.message);
  }

  // Keep only today's markers so the list does not grow forever.
  const kept = notified.filter((entry) => entry.startsWith(dayKey));
  await chrome.storage.local.set({ notified: [...kept, key] });
}

function withErrorKind(snapshot, lastError) {
  return { ...(snapshot || {}), lastErrorKind: lastError?.kind || null };
}

async function paintBadge(badge) {
  const text = badge?.text ? String(badge.text).slice(0, 5) : '';
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: badge.color || '#4b5563' });
  }
  await chrome.action.setTitle({ title: badge?.title || 'DeepSeek Usage Monitor' });
}

async function scheduleAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  if (settings.refreshMinutes > 0) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: settings.refreshMinutes,
      delayInMinutes: 1,
    });
  }
}

// A page load on the platform usually means a fresh login → refresh soon.
chrome.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab?.url?.startsWith('https://platform.deepseek.com/')) return;
    refreshAndPaint({ forceToken: true });
  },
);
