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
  /** API key ids the toolbar badge is measured for (empty = whole account). */
  badgeApiKeys: [],
  /** API key ids selected in the popup chart/budget (empty = whole account). */
  selectedApiKeys: [],
  /** Refresh interval in minutes (0 disables the background alarm). */
  refreshMinutes: 15,
  /** Show cents/tokens decimals on the popup cards. */
  showDecimals: true,
  /** Colour the badge red when the balance is below this value. */
  lowBalanceThreshold: 1,
  /** Daily spend budget for the whole account. 0 disables it. */
  dailyBudget: 0,
  /** Per-key daily budgets: `{ [apiKeyId]: budget }`. */
  keyBudgets: {},
  /** Ratio of the budget at which the badge turns orange (percent). */
  budgetWarnPercent: 90,
  /** Desktop notification when a budget is nearly used up or exceeded. */
  budgetNotifications: true,
  /** Rolling window used to aggregate spend, in days. */
  windowDays: 30,
};

/** Distinct colours for plotting several API keys on one chart. */
export const SERIES_COLORS = [
  '#4d6bfe',
  '#d97706',
  '#067647',
  '#9333ea',
  '#0891b2',
  '#be123c',
  '#65a30d',
  '#475569',
];

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
