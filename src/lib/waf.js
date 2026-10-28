import { WAF_COOKIE_NAMES } from './constants.js';
import { ApiError } from './format.js';

/**
 * The console sits behind an AWS WAF token challenge: without a valid
 * `aws-waf-token` cookie the API answers `202 text/html` instead of JSON.
 *
 * The extension NEVER opens tabs to refresh that token. Verified facts:
 *  - a `Cookie:` header set from JS is dropped by the browser, so a token
 *    cannot be forged; only real browser cookies work (`credentials: 'include'`);
 *  - the token is renewed automatically whenever the user visits
 *    `platform.deepseek.com` (it also lives in that page's document.cookie).
 *
 * So we only *read* the cookie state and report it. The user's normal visits to
 * the console keep it fresh; the extension stays fully hands-off.
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
