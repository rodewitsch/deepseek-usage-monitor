import { ApiError } from './format.js';
import { withWafRetry } from './waf.js';

const REQUEST_TIMEOUT = 20000;

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
 * Same as {@link requestJson}, but transparently refreshes the AWS WAF
 * challenge cookies and retries once when the request is intercepted.
 */
export function requestPlatformJson(url, token) {
  return withWafRetry(() => requestJson(url, token));
}
