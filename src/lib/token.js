import { PLATFORM_ORIGIN, TOKEN_COOKIE_NAMES } from './constants.js';
import { getTokenInfo, saveToken } from './settings.js';

/**
 * The DeepSeek console stores its session token in a cookie and/or in
 * localStorage of the platform origin. Extensions cannot read another
 * origin's localStorage directly, so we ask a content script in the page.
 */

export async function discoverPlatformToken({ force = false } = {}) {
  const existing = await getTokenInfo();
  if (existing.token && !force) return existing;

  // The page is the authoritative source: `localStorage.userToken`.
  const fromPage = await readTokenFromPage();
  if (fromPage) {
    await saveToken(fromPage.token, 'page');
    return { token: fromPage.token, source: fromPage.source };
  }

  // Cookies are only a fallback — this origin also stores WAF cookies.
  const fromCookies = await readTokenFromCookies();
  if (fromCookies) {
    await saveToken(fromCookies.token, 'cookie');
    return { token: fromCookies.token, source: fromCookies.source };
  }

  return { token: existing.token || null, source: existing.source || null };
}

export async function readTokenFromCookies() {
  let cookies = [];
  try {
    cookies = await chrome.cookies.getAll({ domain: 'deepseek.com' });
  } catch {
    cookies = [];
  }

  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));
  for (const name of TOKEN_COOKIE_NAMES) {
    const cookie = byName.get(name);
    if (cookie && looksLikeToken(cookie.value)) {
      return { token: decodeCookieValue(cookie.value), source: `cookie:${name}` };
    }
  }

  // Fall back to any long-lived cookie that looks like a JWT / opaque token.
  const candidate = cookies
    .filter((cookie) => /token|auth|session|jwt/i.test(cookie.name))
    .find((cookie) => looksLikeToken(cookie.value));
  if (candidate) {
    return { token: decodeCookieValue(candidate.value), source: `cookie:${candidate.name}` };
  }

  return null;
}

async function readTokenFromPage() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: `${PLATFORM_ORIGIN}/*` });
  } catch {
    return null;
  }

  for (const tab of tabs) {
    if (!tab?.id) continue;
    const token = await readTokenFromTab(tab.id);
    if (token) return { token, source: 'page' };
  }
  return null;
}

async function readTokenFromTab(tabId) {
  // The content scripts may not be injected yet (tab was open before install /
  // before the reload), so try once, inject, then try again.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'dsum:read-token' });
      if (response?.token && looksLikeToken(response.token)) return response.token;
      if (attempt === 0) return null; // script answered, there is just no token
    } catch {
      if (attempt === 1) return null;
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/token-bridge.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/token-relay.js'] });
    } catch {
      return null;
    }
  }
  return null;
}

function decodeCookieValue(raw) {
  let value = raw || '';
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Rejects everything that is clearly not a session token: WAF cookies,
 * analytics ids, UUIDs, timestamps and JSON blobs are the usual false
 * positives here (`aws-waf-token`, `smidV2`, `__tea_cache_*`).
 */
function looksLikeToken(value) {
  const token = String(value || '').trim();
  if (token.length < 24) return false;
  if (/^(true|false|null|undefined)$/i.test(token)) return false;
  if (/^[\d.,\s]+$/.test(token)) return false;
  if (token.startsWith('{') || token.startsWith('[')) return false;
  if (/^[0-9a-f-]{36}$/i.test(token)) return false;
  if (/^[-\d:T.]+Z?$/.test(token)) return false;
  return true;
}
