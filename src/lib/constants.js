// Shared constants and defaults.

export const PLATFORM_ORIGIN = 'https://platform.deepseek.com';
export const USAGE_PAGE_URL = `${PLATFORM_ORIGIN}/usage`;

export const ENDPOINTS = {
  userSummary: `${PLATFORM_ORIGIN}/api/v0/users/get_user_summary`,
  usageAmountByKey: `${PLATFORM_ORIGIN}/api/v0/usage/by_api_key/amount`,
  usageCostByKey: `${PLATFORM_ORIGIN}/api/v0/usage/by_api_key/cost`,
};

/** Cookie names that the DeepSeek console may use for its session token. */
export const TOKEN_COOKIE_NAMES = [
  'intercom-session',
  'userToken',
  'token',
  'access_token',
  'sessionToken',
  'session',
  'auth_token',
  'ds_session_id',
  '__Secure-next-auth.session-token',
];

/**
 * AWS WAF token-challenge cookies. The console API answers `202 text/html`
 * instead of JSON until the browser holds a valid challenge token.
 * `smidV2` is issued alongside the WAF token by the same challenge.
 */
export const WAF_COOKIE_NAMES = ['aws-waf-token', 'smidV2'];

export const DEFAULT_SETTINGS = {
  /** What the toolbar badge shows. */
  badgeMetric: 'todayCost',
  /** auto | money | tokens */
  badgeFormat: 'auto',
  /** null = all keys, otherwise an API key tracking id (or name). */
  badgeApiKey: null,
  /** Which API key the popup focuses on: null = all keys. */
  focusApiKey: null,
  /** Refresh interval in minutes (0 disables the background alarm). */
  refreshMinutes: 15,
  /** Show cents/tokens decimals on the popup cards. */
  showDecimals: true,
  /** Colour the badge red when the balance is below this value. */
  lowBalanceThreshold: 1,
  /** Daily spend budget. 0 disables budget colouring and alerts. */
  dailyBudget: 0,
  /** Ratio of the budget at which the badge turns orange (percent). */
  budgetWarnPercent: 90,
  /** Desktop notification when the budget is used up. */
  budgetNotifications: true,
  /** Rolling window used to aggregate spend, in days. */
  windowDays: 30,
};

/** Badge colours shared by the toolbar badge and the popup progress bar. */
export const BUDGET_COLORS = {
  ok: '#067647',
  warn: '#d97706',
  over: '#dc2626',
  neutral: '#4b5563',
  balance: '#2563eb',
};

export const STORAGE_KEYS = {
  settings: 'settings',
  token: 'platformToken',
  tokenSource: 'platformTokenSource',
  snapshot: 'usageSnapshot',
  lastError: 'lastError',
};
