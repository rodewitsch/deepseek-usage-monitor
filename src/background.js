import { alertNoticeKey, detectSpikes, forecastBudgetBreach, trackKeys } from './lib/alerts.js';
import { computeBadge } from './lib/badge.js';
import { budgetNoticeKey, evaluateBudgets } from './lib/budget.js';
import { STORAGE_KEYS, WAF_COOKIE_NAMES } from './lib/constants.js';
import { localDayKey } from './lib/format.js';
import { t } from './lib/i18n.js';
import { refreshUsage } from './lib/refresh.js';
import { refreshFromPage } from './lib/scrape.js';
import {
  getHistory,
  getKeyRegistry,
  getSettings,
  getSnapshot,
  saveKeyRegistry,
} from './lib/settings.js';
import { fetchServiceStatus, statusHasTrouble } from './lib/status.js';
import { delay } from './lib/waf.js';

const ALARM_NAME = 'dsum-refresh';
const STATUS_ALARM_NAME = 'dsum-status';
/** The status page updates itself every ~60 s; 5 min is a good polling rate. */
const STATUS_PERIOD_MINUTES = 5;
/** How long a reloaded console page gets to renew the WAF token. */
const WAF_RENEW_WAIT = 6000;
let refreshing = null;
let statusChecking = null;

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleAlarm();
  await ensureStatusAlarm();
  await updateBadge();
  await refreshAndPaint();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await ensureStatusAlarm();
  await updateBadge();
  // A console tab restored by the browser already has the numbers — read them.
  await refreshAndPaint();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await refreshAndPaint();
  else if (alarm.name === STATUS_ALARM_NAME) await checkStatus();
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
  if (message?.type === 'dsum:status') {
    checkStatus()
      .then((result) => sendResponse({ ok: true, status: result?.ok ? result.status : null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true; // async response
  }
  return false;
});

async function refreshAndPaint({ forceToken = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const settings = await getSettings();

    // The DeepSeek service status is independent of the console session, so it
    // is checked alongside every usage refresh (fire-and-forget).
    void checkStatus();

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
      await afterSuccessfulRefresh(result.snapshot, settings);
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
          await afterSuccessfulRefresh(retried.snapshot, settings);
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
 * Everything that should happen after a refresh that produced real numbers:
 * paint the badge, then run every notification rule. Each rule is independent
 * and swallows its own errors — a failed alert must never fail the refresh.
 */
async function afterSuccessfulRefresh(snapshot, settings) {
  await paintBadge(computeBadge(withErrorKind(snapshot, null), settings));
  await notifyBudget(snapshot, settings);
  await notifyLowBalance(snapshot, settings);
  await notifyPace(snapshot, settings);
  await notifySpikes(snapshot, settings);
  await notifyKeys(snapshot, settings);
}

/**
 * Desktop notification when a budget is nearly used up or exceeded.
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

/**
 * Desktop notification when the wallet balance falls below the configured
 * threshold. Fires once per day.
 */
async function notifyLowBalance(snapshot, settings) {
  if (!settings.lowBalanceNotifications) return;

  const threshold = Number(settings.lowBalanceThreshold) || 0;
  const total = Number(snapshot?.balance?.total);
  if (!(threshold > 0) || !Number.isFinite(total) || total >= threshold) return;

  const dayKey = snapshot?.todayKey || new Date().toISOString().slice(0, 10);
  const marker = `${dayKey}:low-balance`;
  const { notified = [] } = await chrome.storage.local.get('notified');
  if (notified.includes(marker)) return;

  const currency = snapshot.balance.currency || 'USD';
  try {
    await chrome.notifications.create(marker, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('notifyLowBalanceTitle'),
      message: t('notifyLowBalanceMessage', [
        `${currency} ${total.toFixed(2)}`,
        `${currency} ${threshold.toFixed(2)}`,
      ]),
      priority: 2,
    });
  } catch (error) {
    console.warn('[DeepSeek Usage] notification failed:', error.message);
    return;
  }

  const kept = notified.filter((entry) => entry.startsWith(dayKey));
  await chrome.storage.local.set({ notified: [...kept, marker] });
}

/**
 * Pace alert: the day is still under its budget, but at the current rate it
 * will be over before midnight. Fires once per day and per scope.
 */
async function notifyPace(snapshot, settings) {
  if (!settings.paceAlerts) return;

  const keyIds =
    settings.badgeMetric === 'balance'
      ? []
      : Array.isArray(settings.badgeApiKeys)
        ? settings.badgeApiKeys
        : [];
  const breach = forecastBudgetBreach(snapshot?.usage, settings, keyIds, new Date());
  if (!breach) return;

  const dayKey = snapshot?.todayKey || localDayKey();
  const marker = alertNoticeKey(dayKey, 'pace', breach.scope);
  if (!(await claimNotice(marker, dayKey))) return;

  const currency = snapshot?.usage?.currency || 'USD';
  const money = (value) => `${currency} ${Number(value).toFixed(2)}`;
  const suffix = breach.name ? t('notifyForKey', [breach.name]) : '';

  await safeNotify(marker, {
    title: t('notifyPaceTitle', [suffix]),
    message: t('notifyPaceMessage', [
      money(breach.spent),
      money(breach.budget),
      money(breach.projected),
      String(Math.round(breach.percent)),
      String(Math.max(1, Math.round(breach.hoursLeft))),
    ]),
    priority: 1,
  });
}

/**
 * Spike alert: today (or one key) is several times its own rolling average.
 * Today is excluded from the baseline, so the alert does not dilute itself.
 */
async function notifySpikes(snapshot, settings) {
  if (!settings.spikeAlerts) return;

  const history = await getHistory();
  const dayKey = snapshot?.todayKey || localDayKey();
  const spikes = detectSpikes(history, snapshot?.usage, dayKey, {
    ratio: settings.spikeRatio,
  });

  const currency = snapshot?.usage?.currency || 'USD';
  const money = (value) => `${currency} ${Number(value).toFixed(2)}`;
  const found = [];
  if (spikes.account) found.push(spikes.account);
  found.push(...spikes.keys);

  for (const spike of found) {
    const marker = alertNoticeKey(dayKey, 'spike', spike.scope);
    if (!(await claimNotice(marker, dayKey))) continue;
    const suffix = spike.name ? t('notifyForKey', [spike.name]) : '';
    await safeNotify(marker, {
      title: t('notifySpikeTitle', [suffix]),
      message: t('notifySpikeMessage', [
        money(spike.spent),
        `${spike.ratio.toFixed(1)}x`,
        money(spike.average),
      ]),
      priority: 2,
    });
  }
}

/**
 * Key lifecycle alerts: a brand-new API key, or a key that has been idle for
 * longer than the configured number of days (paid-for but unused).
 */
async function notifyKeys(snapshot, settings) {
  const usage = snapshot?.usage;
  if (!usage) return;

  const dayKey = snapshot?.todayKey || localDayKey();
  const known = await getKeyRegistry();
  // A first ever refresh must not announce every existing key as "new".
  const firstRun = Object.keys(known).length === 0;

  const result = trackKeys(known, usage, dayKey, {
    inactiveDays: Number(settings.inactiveKeyDays) || 0,
    newKeys: !firstRun && settings.newKeyAlerts,
  });

  await saveKeyRegistry(result.registry);

  for (const key of result.newKeys) {
    const marker = alertNoticeKey(dayKey, 'new-key', key.id);
    if (!(await claimNotice(marker, dayKey))) continue;
    await safeNotify(marker, {
      title: t('notifyNewKeyTitle'),
      message: t('notifyNewKeyMessage', [key.name]),
      priority: 1,
    });
  }

  // Inactive keys are reported at most once per day each, and only when the
  // user asked for the alert (inactiveKeyDays > 0).
  for (const key of result.inactiveKeys) {
    const marker = alertNoticeKey(dayKey, 'inactive-key', key.id);
    if (!(await claimNotice(marker, dayKey))) continue;
    await safeNotify(marker, {
      title: t('notifyInactiveKeyTitle'),
      message: t('notifyInactiveKeyMessage', [key.name, String(key.days)]),
      priority: 0,
    });
  }
}

/**
 * Atomically-ish claims a notification marker for the day. Returns false when
 * the same marker was already used, so a rule cannot notify twice for one day.
 * Old markers are dropped on every write to keep the list short.
 */
async function claimNotice(marker, dayKey) {
  const { notified = [] } = await chrome.storage.local.get('notified');
  if (notified.includes(marker)) return false;
  const kept = notified.filter((entry) => entry.startsWith(dayKey));
  await chrome.storage.local.set({ notified: [...kept, marker] });
  return true;
}

/** Creates a notification, swallowing failures (a missing icon, a rate cap…). */
async function safeNotify(id, { title, message, priority = 1 }) {
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority,
    });
  } catch (error) {
    console.warn('[DeepSeek Usage] notification failed:', error?.message || error);
  }
}

/**
 * Fetches the DeepSeek service status and notifies on state transitions.
 * Failure keeps the previous status; notification dedup is per incident id.
 */
async function checkStatus() {
  if (statusChecking) return statusChecking;
  statusChecking = (async () => {
    const settings = await getSettings();
    const result = await fetchServiceStatus();
    if (!result.ok) return result;

    const current = result.status;
    const previous =
      (await chrome.storage.local.get(STORAGE_KEYS.status))[STORAGE_KEYS.status] || null;
    await chrome.storage.local.set({ [STORAGE_KEYS.status]: current });

    if (settings.statusNotifications) await notifyStatus(previous, current);
    return result;
  })();
  try {
    return await statusChecking;
  } finally {
    statusChecking = null;
  }
}

/** One notification per new incident, plus one on recovery. */
async function notifyStatus(previous, current) {
  const prevTrouble = hasIssues(previous);
  const currTrouble = hasIssues(current);
  const iconUrl = chrome.runtime.getURL('icons/icon128.png');

  if (prevTrouble && !currTrouble) {
    try {
      await chrome.notifications.create('dsum-status-recovered', {
        type: 'basic',
        iconUrl,
        title: t('notifyStatusRecoveredTitle'),
        message: t('notifyStatusRecoveredMessage'),
        priority: 0,
      });
    } catch (error) {
      console.warn('[DeepSeek Usage] notification failed:', error.message);
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.statusNotified]: { ids: [] } });
    return;
  }

  const { ids = [] } = await chrome.storage.local.get(STORAGE_KEYS.statusNotified);
  const known = new Set(ids);
  const added = [];

  for (const incident of current?.incidents || []) {
    if (known.has(incident.id)) continue;
    known.add(incident.id);
    added.push(incident.id);

    const title =
      incident.kind === 'maintenance'
        ? t('notifyStatusMaintenanceTitle')
        : t('notifyStatusTitle');
    try {
      await chrome.notifications.create(`dsum-status-${incident.id}`, {
        type: 'basic',
        iconUrl,
        title,
        message: incident.summary || incident.title,
        priority: 2,
      });
    } catch (error) {
      console.warn('[DeepSeek Usage] notification failed:', error.message);
    }
  }

  if (added.length) {
    await chrome.storage.local.set({ [STORAGE_KEYS.statusNotified]: { ids: [...known].slice(-50) } });
  }
}

/** True when the status page reports an active incident or an outage. */
function hasIssues(status) {
  if (!status) return false;
  return statusHasTrouble(status) || Boolean(status.incidents?.length);
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

/**
 * The status alarm runs independently of the usage refresh: it must survive an
 * unpacked-extension reload (which fires neither `onInstalled` nor `onStartup`).
 * It is re-created when missing, not on every worker start, so waking the
 * worker does not keep postponing it.
 */
async function ensureStatusAlarm() {
  try {
    const existing = await chrome.alarms.get(STATUS_ALARM_NAME);
    if (!existing) {
      chrome.alarms.create(STATUS_ALARM_NAME, {
        periodInMinutes: STATUS_PERIOD_MINUTES,
        delayInMinutes: 1,
      });
    }
  } catch {
    // alarms API unavailable — the popup-triggered check still works.
  }
}

// Re-create the status alarm as soon as the worker starts.
void ensureStatusAlarm();

