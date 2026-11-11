import { USAGE_PAGE_URL, WAF_COOKIE_NAMES } from './constants.js';
import { ApiError } from './format.js';

/**
 * The console sits behind an AWS WAF token challenge: without a valid
 * `aws-waf-token` cookie the API answers `202 text/html` instead of JSON.
 *
 * Verified facts:
 *  - a `Cookie:` header set from JS is dropped by the browser, so a token
 *    cannot be forged; only real browser cookies work (`credentials: 'include'`);
 *  - the token is (re)minted by the challenge script running in a real document
 *    on `platform.deepseek.com` — an offscreen document or an extension iframe
 *    gets a partitioned cookie jar and cannot see the session at all;
 *  - AWS's challenge immunity defaults to ~5 minutes, so a token kept from a
 *    visit an hour ago is rejected.
 *
 * Therefore the only renewal mechanism is a page load on the real origin. The
 * extension prefers a tab the user already has open (passive, see
 * `background.js`) and, when the user opts in to `wafTabRenew`, briefly opens
 * one in the background via {@link ensureWafToken}.
 */

/** Reads the WAF cookies for the platform origin. */
export async function readWafCookies() {
  try {
    const all = await chrome.cookies.getAll({ domain: 'deepseek.com' });
    return all.filter((cookie) => WAF_COOKIE_NAMES.includes(cookie.name));
  } catch {
    return [];
  }
}

/** True when a WAF cookie exists and is not about to expire. */
export async function hasFreshWafCookies() {
  const cookies = await readWafCookies();
  if (!cookies.length) return false;

  const primary = cookies.find((cookie) => cookie.name === 'aws-waf-token') || cookies[0];
  if (primary.session) return Boolean(primary.value);

  const expiryMs = primary.expirationDate ? primary.expirationDate * 1000 : 0;
  if (!expiryMs) return Boolean(primary.value);
  return expiryMs - Date.now() > 0;
}

/**
 * Tabs opened by {@link ensureWafToken}. `background.js` listens to
 * `tabs.onUpdated` and would otherwise treat them as a user visit and schedule
 * another refresh — an endless create/refresh loop.
 */
const renewTabs = new Set();

/** True (once) when `tabId` is a renewal tab the caller must ignore. */
export function consumedRenewTab(tabId) {
  if (!renewTabs.has(tabId)) return false;
  renewTabs.delete(tabId);
  return true;
}

let renewal = null;

/**
 * Loads `platform.deepseek.com` in an inactive tab so the WAF challenge runs
 * and writes a fresh `aws-waf-token` into the shared cookie jar.
 *
 * Always resolves to a boolean and always closes the tab it opened. Concurrent
 * callers share one tab (the service worker can run an alarm refresh and a
 * cookie-triggered refresh at the same time).
 *
 * @param {{timeoutMs?: number, waitMs?: number}} [options]
 *   `waitMs` = extra settle time after the cookie appears (the page usually
 *   writes several cookies), `timeoutMs` = give-up time for the tab load.
 * @returns {Promise<boolean>} true when a WAF cookie was written
 */
export function ensureWafToken({ timeoutMs = 10000, waitMs = 1500 } = {}) {
  if (renewal) return renewal;

  const run = (async () => {
    let tabId = null;
    try {
      const beforeExpiry = newestExpiry(await readWafCookies());

      const tab = await chrome.tabs.create({ url: USAGE_PAGE_URL, active: false });
      tabId = tab?.id ?? null;
      if (!tabId) return false;
      renewTabs.add(tabId);

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await delay(500);
        const cookies = await readWafCookies();
        if (cookies.length && newestExpiry(cookies) > beforeExpiry) {
          await delay(waitMs);
          return true;
        }
      }
      // The cookie may have already been renewed by someone else while the tab
      // was loading — that is just as good.
      return (await hasFreshWafCookies()) && newestExpiry(await readWafCookies()) > beforeExpiry;
    } catch {
      return false;
    } finally {
      if (tabId) {
        renewTabs.delete(tabId);
        await chrome.tabs.remove(tabId).catch(() => {});
      }
    }
  })();

  renewal = run.finally(() => {
    renewal = null;
  });
  return renewal;
}

/** Latest `expirationDate` (ms) among the cookies; 0 for session cookies. */
function newestExpiry(cookies) {
  return cookies.reduce((latest, cookie) => {
    const expiry = cookie.expirationDate ? cookie.expirationDate * 1000 : 0;
    return Math.max(latest, expiry);
  }, 0);
}

/**
 * Human-readable state for the popup / diagnostics.
 * `state`: valid | stale | missing | unknown
 */
export async function describeWafState() {
  const cookies = await readWafCookies();
  if (!cookies.length) {
    return { state: 'missing', detail: 'no aws-waf-token cookie' };
  }

  const fresh = await hasFreshWafCookies();
  const primary = cookies.find((cookie) => cookie.name === 'aws-waf-token') || cookies[0];
  const expiry = primary.session
    ? 'session cookie'
    : primary.expirationDate
      ? new Date(primary.expirationDate * 1000).toLocaleTimeString()
      : 'unknown expiry';

  return {
    state: fresh ? 'valid' : 'stale',
    detail: `${primary.name} expires ${expiry}`,
  };
}

/**
 * Runs a request and, when the WAF blocks it, throws a helpful error instead of
 * silently opening a tab. The caller decides what to show the user.
 * `retryDelayMs` gives a token renewal that is already in flight a moment to
 * land before the request is repeated.
 */
export async function withWafRetry(request, { retryDelayMs = 0 } = {}) {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'waf') throw error;

    const state = await describeWafState();
    throw new ApiError(
      state.state === 'missing' || state.state === 'stale'
        ? 'DeepSeek WAF token expired. Open platform.deepseek.com once — it renews automatically.'
        : 'Blocked by DeepSeek WAF. Open platform.deepseek.com once to renew the token.',
      'waf',
      202,
    );
  }
}

/** True when the error is a WAF block that a page visit would cure. */
export function isWafError(error) {
  return error instanceof ApiError && error.kind === 'waf';
}

/** Resolves after `ms`; used to let a token renewal finish. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
