// Small DOM-free helpers shared by the popup, options page and service worker.

export const CURRENCY_SYMBOL = { USD: '$', CNY: '¥', EUR: '€' };

export function currencySymbol(currency) {
  return CURRENCY_SYMBOL[currency] || (currency ? `${currency} ` : '');
}

/** 0.01234 -> "0.0123", 1.5 -> "1.50" */
export function formatMoney(value, currency, { decimals = true } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const symbol = currencySymbol(currency);
  const abs = Math.abs(amount);
  const digits = !decimals ? 0 : abs !== 0 && abs < 0.1 ? 4 : 2;
  return `${symbol}${amount.toFixed(digits)}`;
}

/** 12345 -> "12,345", 1234567 -> "1.23M" */
export function formatTokens(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(2)}B`;
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(2)}M`;
  if (tokens >= 1e4) return `${(tokens / 1e3).toFixed(1)}K`;
  return Math.round(tokens).toLocaleString('en-US');
}

/** Text used on the toolbar badge — must stay really short. */
export function formatBadgeValue(metric, value, { currency = 'USD', format = 'auto' } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';

  const wantsTokens = format === 'tokens' || (format === 'auto' && metric === 'todayTokens');

  if (wantsTokens) {
    if (numeric >= 1e6) return `${(numeric / 1e6).toFixed(1)}M`;
    if (numeric >= 1e5) return `${Math.round(numeric / 1e3)}K`;
    if (numeric >= 1e4) return `${(numeric / 1e3).toFixed(1)}K`;
    return String(Math.round(numeric));
  }

  const abs = Math.abs(numeric);
  if (abs >= 1000) return `${Math.round(numeric / 100) / 10}K`.replace('.0', '');
  if (abs >= 100) return numeric.toFixed(0);
  if (abs >= 10) return numeric.toFixed(1).replace(/\.0$/, '');
  if (abs === 0) return '0';
  if (abs >= 1) return numeric.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  if (abs >= 0.1) return numeric.toFixed(2);
  return numeric.toFixed(3);
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function localDayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Day key (`YYYY-MM-DD`) for a unix timestamp in a given UTC-offset.
 * The shifted value must be read with the UTC getters: building a `Date` and
 * calling `localDayKey` would re-apply the machine's timezone and shift a day.
 */
export function dayKeyFromUnix(seconds, timezoneOffsetSeconds = -new Date().getTimezoneOffset() * 60) {
  const shifted = new Date((Number(seconds) + timezoneOffsetSeconds) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Unwrap `{ code, data: { biz_code, biz_data } }` envelopes. */
export function unwrapEnvelope(payload, label) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(`${label}: empty response`, 'parse');
  }
  const code = payload.code;
  if (typeof code === 'number' && code !== 0) {
    throw new ApiError(
      `${label}: code ${code} ${payload.msg ? `(${payload.msg})` : ''}`.trim(),
      isAuthCode(code) ? 'auth' : 'api',
      code,
    );
  }
  const body = payload.data;
  if (!body || typeof body !== 'object') {
    throw new ApiError(`${label}: missing data`, 'parse');
  }
  const bizCode = body.biz_code;
  if (typeof bizCode === 'number' && bizCode !== 0) {
    throw new ApiError(
      `${label}: biz_code ${bizCode} ${body.biz_msg ? `(${body.biz_msg})` : ''}`.trim(),
      isAuthCode(bizCode) ? 'auth' : 'api',
      bizCode,
    );
  }
  return body.biz_data;
}

export function isAuthCode(code) {
  return code === 40001 || code === 40002 || code === 40003 || code === 401;
}

export class ApiError extends Error {
  constructor(message, kind = 'api', code = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // auth | network | api | parse
    this.code = code;
  }
}

/** Values in the usage payloads are strings, numbers, or `null`. */
export function toNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && 'value' in value) return toNumber(value.value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `api_key` may be a plain string or `{ name, tracking_id }`. */
export function normaliseApiKeyIdentity(raw) {
  if (!raw) return { id: 'unknown', name: 'Unknown key' };
  if (typeof raw === 'string') return { id: raw, name: raw };
  const trackingId = String(raw.tracking_id || '').trim();
  const name = String(raw.name || '').trim();
  const id = trackingId || name || 'unknown';
  return { id, name: name || trackingId || 'Unknown key' };
}
