import { ApiError } from './format.js';
import { withWafRetry } from './waf.js';

const REQUEST_TIMEOUT = 20000;
/** How long a WAF-blocked request waits for a token renewal before giving up. */
const WAF_RETRY_DELAY = 1500;

/**
 * Requests the DeepSeek console API.
 *
 * Important details verified against the live console:
 *  - `credentials: 'include'` is REQUIRED. The console sits behind AWS WAF and
 *    a request without the `aws-waf-token`/`smidV2` cookies gets `202 text/html`
 *    instead of JSON.
 *  - The session token comes from `localStorage.userToken` (`{"value":"..."}`)
 *    and is passed as `Authorization: Bearer <token>`.
 */
export async function requestJson(url, token, { platform = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (platform) {
    headers['x-client-platform'] = 'web';
    headers['x-client-version'] = '1.0.0';
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error?.name === 'AbortError' ? 'Request timed out' : `Network error: ${error.message}`,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ApiError('Session expired — open platform.deepseek.com and sign in again', 'auth', response.status);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    // 202 + HTML is the WAF interstitial, not an expired session.
    if (response.status === 202) {
      throw new ApiError('Blocked by DeepSeek WAF', 'waf', response.status);
    }
    throw new ApiError(
      `Unexpected ${response.status} ${response.statusText || ''} response (not JSON)`.trim(),
      'parse',
      response.status,
    );
  }
}

/**
 * Same as {@link requestJson}, but retries once after a short pause when the
 * request is intercepted by the AWS WAF challenge — a token renewal that is
 * already in flight then gets a chance to land before the error is reported.
 */
export async function requestPlatformJson(url, token) {
  try {
    return await withWafRetry(() => requestJson(url, token));
  } catch (error) {
    if (!error?.message?.startsWith('DeepSeek WAF') && !error?.message?.startsWith('Blocked by DeepSeek WAF')) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, WAF_RETRY_DELAY));
    return withWafRetry(() => requestJson(url, token));
  }
}
