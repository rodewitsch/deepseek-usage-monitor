import { getSnapshot, getTokenInfo, saveSnapshot } from './settings.js';
import { PLATFORM_ORIGIN } from './constants.js';

/**
 * Reads the console numbers from an already-open `platform.deepseek.com` tab.
 * No API request, no WAF challenge, and — deliberately — no tab is ever opened:
 * if no console tab exists the scraper simply reports `no-usage-tab`.
 */

/** @returns {Promise<{ok: boolean, data?: object, reason?: string, tabId?: number}>} */
export async function scrapeFromPage() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: `${PLATFORM_ORIGIN}/*` });
  } catch {
    tabs = [];
  }

  // Prefer the usage page, then anything else on the platform.
  const ordered = [...tabs].sort((a, b) => rank(b) - rank(a));
  for (const tab of ordered) {
    const result = await readTab(tab.id);
    if (result.ok) return { ...result, tabId: tab.id };
  }

  return { ok: false, reason: 'no-usage-tab' };
}

function rank(tab) {
  if (tab?.url?.includes('/usage')) return 2;
  return 1;
}

async function readTab(tabId) {
  if (!tabId) return { ok: false, reason: 'no-tab' };
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'dsum:scrape-page' });
    return response || { ok: false, reason: 'no-response' };
  } catch {
    // Content script missing (tab predates the install) — inject and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        // Order matters: the parser defines `globalThis.DSUMScraper`.
        files: ['src/content/page-scraper.js', 'src/content/usage-scraper.js'],
      });
      const response = await chrome.tabs.sendMessage(tabId, { type: 'dsum:scrape-page' });
      return response || { ok: false, reason: 'no-response' };
    } catch (error) {
      return { ok: false, reason: error?.message || 'inject-failed' };
    }
  }
}

/**
 * Scrapes the page and stores a snapshot in the same shape the API path uses,
 * so the popup/badge code does not care where the numbers came from.
 */
export async function refreshFromPage() {
  const [result, tokenInfo, previous] = await Promise.all([
    scrapeFromPage(),
    getTokenInfo(),
    getSnapshot(),
  ]);

  if (!result.ok) {
    return { snapshot: previous.snapshot, lastError: null, skipped: result.reason };
  }

  const snapshot = mergeScrapedSnapshot(result.data, previous.snapshot, {
    tokenSource: tokenInfo.source || 'page-scrape',
  });

  // Keep any existing error visible: a partial scrape must not hide the fact
  // that the per-key figures could not be fetched. Only the API path decides
  // when an error is resolved — see `refreshAndPaint()`.
  await saveSnapshot(snapshot, previous.lastError);
  return { snapshot, lastError: previous.lastError, tabId: result.tabId };
}

/**
 * Folds a scraped page object into the stored snapshot.
 *
 * Shared by the service worker and the popup — the popup used to keep its own
 * copy of this merge, which silently dropped `todayCost`/`todayTokens` and left
 * the "Spent today" card at the zero written by a failed API refresh.
 *
 * `todayCost` is only present when the console renders a "today" row, so when
 * it is missing the previous value is kept but flagged `todayUnknown`: the UI
 * shows "—" instead of a number that may belong to another day.
 */
export function mergeScrapedSnapshot(page, previousSnapshot, { tokenSource = 'page-scrape' } = {}) {
  const previousUsage = previousSnapshot?.usage || {};
  const hasToday = Number.isFinite(Number(page.todayCost));
  const hasTodayTokens = Number.isFinite(Number(page.todayTokens));

  return {
    ...(previousSnapshot || {}),
    updatedAt: page.capturedAt,
    todayKey: previousSnapshot?.todayKey || null,
    tokenSource,
    scraped: true,
    stale: false,
    balance: {
      currency: page.currency,
      total: page.balance,
      toppedUp: page.toppedUp ?? 0,
      granted: page.granted ?? 0,
      isAvailable: page.balance > 0,
    },
    usage: {
      ...previousUsage,
      currency: page.windowCurrency || page.currency,
      windowCost: page.windowCost ?? previousUsage.windowCost ?? 0,
      windowTokens: page.tokens ?? previousUsage.windowTokens ?? 0,
      todayCost: hasToday ? Number(page.todayCost) : (previousUsage.todayCost ?? null),
      todayTokens: hasTodayTokens ? Number(page.todayTokens) : (previousUsage.todayTokens ?? null),
      todayUnknown: !hasToday,
      requests: page.requests ?? null,
      source: 'page',
    },
  };
}
