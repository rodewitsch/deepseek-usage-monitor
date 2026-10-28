import { computeBadge } from './lib/badge.js';
import { budgetNoticeKey, evaluateBudgets } from './lib/budget.js';
import { WAF_COOKIE_NAMES } from './lib/constants.js';
import { t } from './lib/i18n.js';
import { refreshUsage } from './lib/refresh.js';
import { refreshFromPage } from './lib/scrape.js';
import { getSettings, getSnapshot } from './lib/settings.js';
import { delay } from './lib/waf.js';

const ALARM_NAME = 'dsum-refresh';
/** How long a reloaded console page gets to renew the WAF token. */
const WAF_RENEW_WAIT = 6000;
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

// A console page changed or finished loading → its DOM has fresh numbers (and
// its challenge usually just renewed the WAF token). Debounced so a reload does
// not trigger three refresh rounds.
let tabRefreshTimer = null;
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url?.includes('platform.deepseek.com')) return;
  clearTimeout(tabRefreshTimer);
  // Let the React app render before scraping.
  tabRefreshTimer = setTimeout(() => {
    void refreshAndPaint({ forceToken: true });
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

/**
 * The WAF token is renewed by the platform page itself. When the browser stores
 * a new one, the API becomes reachable again — so retry immediately instead of
 * waiting for the next alarm. Debounced: the page often writes several cookies.
 */
let wafRenewTimer = null;
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed || !cookie?.domain?.includes('deepseek.com')) return;
  if (!WAF_COOKIE_NAMES.includes(cookie.name)) return;

  clearTimeout(wafRenewTimer);
  wafRenewTimer = setTimeout(() => {
    void refreshAndPaint();
  }, 2000);
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

    // 1. An open console tab is the cheapest source: its page has already
    //    passed the WAF challenge, so its DOM needs no API call at all.
    const scraped = await refreshFromPage();
    if (scraped.snapshot) {
      await paintBadge(computeBadge(withErrorKind(scraped.snapshot, null), settings));
      // Per-day and per-key figures exist only in the API — keep trying for
      // them in the background when the scrape looked complete.
    }

    // 2. Ask the console API. The WAF token comes from the browser's cookies
    //    and renews on normal visits; no tab is ever opened here.
    const result = await refreshUsage({ forceToken });

    if (!result.lastError) {
      await paintBadge(computeBadge(withErrorKind(result.snapshot, null), settings));
      await notifyBudget(result.snapshot, settings);
      return result;
    }

    // 3. WAF block → renew the token by reloading a console tab the user
    //    already has open (never creating one), then try once more.
    if (result.lastError.kind === 'waf') {
      const reloaded = await reloadConsoleTab();
      if (reloaded) {
        await delay(WAF_RENEW_WAIT);
        const retried = await refreshUsage({ forceToken: true });
        if (!retried.lastError) {
          await paintBadge(computeBadge(withErrorKind(retried.snapshot, null), settings));
          await notifyBudget(retried.snapshot, settings);
          return retried;
        }
      }
    }

    // 4. API still unavailable → keep whatever the page gave us and report a
    //    WAF block as "cached", not as an error the user has to fix.
    const effective = result.lastError.kind === 'waf' ? null : result.lastError;
    const snapshot = scraped.snapshot || result.snapshot;
    await paintBadge(computeBadge(withErrorKind(snapshot, effective), settings));
    return { snapshot, lastError: effective, cached: Boolean(scraped.snapshot) };
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

/**
 * Reloads an already-open console tab so its JavaScript challenge renews the
 * WAF token. Returns `false` when no console tab exists — the extension never
 * creates one.
 */
async function reloadConsoleTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://platform.deepseek.com/*' });
    const tab = tabs.find((entry) => entry.url?.includes('/usage')) || tabs[0];
    if (!tab?.id) return false;
    await chrome.tabs.reload(tab.id, { bypassCache: false });
    return true;
  } catch {
    return false;
  }
}

async function updateBadge() {
  const [{ snapshot, lastError }, settings] = await Promise.all([getSnapshot(), getSettings()]);
  await paintBadge(computeBadge(withErrorKind(snapshot, lastError), settings));
}

/**
 * Desktop notification when today's spend crosses a budget threshold.
 * Fires once per day and per budget scope (account, or one API key) for the
 * warn level and once for the over level.
 */
async function notifyBudget(snapshot, settings) {
  if (!settings.budgetNotifications) return;

  const keyIds =
    settings.badgeMetric === 'balance'
      ? []
      : Array.isArray(settings.badgeApiKeys)
        ? settings.badgeApiKeys
        : [];
  const budgets = evaluateBudgets(snapshot?.usage, settings, keyIds);

  const scopes = [];
  if (budgets.account.status === 'warn' || budgets.account.status === 'over') {
    scopes.push({ scope: 'account', budget: budgets.account, suffix: '' });
  }
  for (const budget of budgets.keys) {
    if (budget.status === 'warn' || budget.status === 'over') {
      scopes.push({ scope: `key:${budget.id}`, budget, suffix: t('notifyForKey', [budget.name]) });
    }
  }
  if (!scopes.length) return;

  const dayKey = snapshot?.todayKey || new Date().toISOString().slice(0, 10);
  const { notified = [] } = await chrome.storage.local.get('notified');
  const currency = snapshot?.usage?.currency || 'USD';
  const money = (value) => `${currency} ${Number(value).toFixed(2)}`;
  const added = [];

  for (const { scope, budget, suffix } of scopes) {
    const key = budgetNoticeKey(scope, budget.status, dayKey);
    if (notified.includes(key)) continue;
    added.push(key);

    const title =
      budget.status === 'over' ? t('notifyTitleOver', [suffix]) : t('notifyTitleWarn', [suffix]);
    const message =
      budget.status === 'over'
        ? t('notifyMessageOver', [
            money(budget.spent),
            money(budget.budget),
            String(Math.round(budget.percent)),
          ])
        : t('notifyMessageWarn', [
            money(budget.spent),
            money(budget.budget),
            String(Math.round(budget.percent)),
            money(budget.remaining),
          ]);

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
  }

  if (!added.length) return;

  // Keep only today's markers so the list does not grow forever.
  const kept = notified.filter((entry) => entry.startsWith(dayKey));
  await chrome.storage.local.set({ notified: [...kept, ...added] });
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
  await chrome.action.setTitle({ title: badge?.title || t('actionTitle') });
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

