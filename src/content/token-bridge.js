// Runs in the page's MAIN world so it can read the platform's localStorage.
// It never sends anything anywhere: it only answers the extension's question.
(function () {
  const REQUEST_EVENT = 'dsum:token-request';
  const RESPONSE_EVENT = 'dsum:token-response';

  /**
   * Keys that look token-ish but are definitely NOT the session token, e.g.
   * `aws_waf_token_challenge_attempts`, `awswaf_session_storage`,
   * `awswaf_token_refresh_timestamp`.
   */
  const DENY = /waf|tea_cache|tracking|theme|locale|banner|notice|debug|thumbcache|device|smid|remote_feature|lastSession|currency/i;

  /** Ordered: first match wins. Hard-coded names first, patterns after. */
  const EXACT_KEYS = ['userToken', 'user_token', 'accessToken', 'access_token', 'authToken', 'auth_token', 'token'];

  /** Values that are obviously not a session token. */
  function looksLikeToken(value) {
    if (typeof value !== 'string') return false;
    const token = value.trim();
    if (token.length < 24) return false;
    if (/^(true|false|null|undefined)$/i.test(token)) return false;
    if (/^[\d.,\s]+$/.test(token)) return false;
    // JSON blobs / UUIDs / timestamps are not tokens either.
    if (token.startsWith('{') || token.startsWith('[')) return false;
    if (/^[0-9a-f-]{36}$/i.test(token)) return false;
    if (/^[-\d:T.]+Z?$/.test(token)) return false;
    return true;
  }

  /** `{"value":"...","__version":"0"}` → the inner string. */
  function unpack(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed.startsWith('{')) return stripQuotes(trimmed);
    try {
      const parsed = JSON.parse(trimmed);
      for (const key of ['value', 'token', 'access_token', 'jwt']) {
        if (typeof parsed?.[key] === 'string') return stripQuotes(parsed[key]);
      }
    } catch {
      // Not JSON.
    }
    return null;
  }

  function stripQuotes(value) {
    const trimmed = String(value || '').trim();
    if (trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
    return trimmed;
  }

  function readFromLocalStorage() {
    const store = window.localStorage;

    // 1. Known key names, in priority order.
    for (const key of EXACT_KEYS) {
      const value = unpack(store.getItem(key));
      if (looksLikeToken(value)) return value;
    }

    // 2. Any other token-ish key that is not explicitly denied.
    const fallback = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key || !/token|auth/i.test(key) || DENY.test(key)) continue;
      const value = unpack(store.getItem(key));
      if (looksLikeToken(value)) fallback.push(value);
    }
    return fallback[0] || null;
  }

  function answer() {
    let token = null;
    try {
      token = readFromLocalStorage();
    } catch {
      token = null;
    }
    if (!token) return;
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: { token } }));
  }

  document.addEventListener(REQUEST_EVENT, answer);
})();
