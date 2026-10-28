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

  const page = result.data;
  const snapshot = {
    ...(previous.snapshot || {}),
    updatedAt: page.capturedAt,
    todayKey: previous.snapshot?.todayKey || null,
    tokenSource: tokenInfo.source || 'page-scrape',
    scraped: true,
    balance: {
      currency: page.currency,
      total: page.balance,
      toppedUp: page.toppedUp ?? 0,
      granted: page.granted ?? 0,
      isAvailable: page.balance > 0,
    },
    usage: {
      ...(previous.snapshot?.usage || {}),
      currency: page.windowCurrency || page.currency,
      windowCost: page.windowCost ?? previous.snapshot?.usage?.windowCost ?? 0,
      windowTokens: page.tokens ?? previous.snapshot?.usage?.windowTokens ?? 0,
      todayCost: page.todayCost ?? previous.snapshot?.usage?.todayCost ?? 0,
      todayTokens: page.todayTokens ?? previous.snapshot?.usage?.todayTokens ?? 0,
      requests: page.requests ?? null,
      source: 'page',
    },
  };

  // Keep any existing error visible: a partial scrape must not hide the fact
  // that the per-key figures could not be fetched.
  await saveSnapshot(snapshot, previous.lastError);
  return { snapshot, lastError: previous.lastError, tabId: result.tabId };
}
