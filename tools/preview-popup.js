// Preview harness: renders the popup with a stubbed `chrome.*` and fake data,
// so the Milestone 2 blocks can be eyeballed without loading the extension.
// Served over HTTP (ES modules + file:// do not mix): `npx serve .` then open
// /tools/preview-popup.html. Not shipped (tools/ is excluded from the build).
import { shiftDayKey } from '../src/lib/history.js';
import { localDayKey } from '../src/lib/format.js';

const today = localDayKey();
const days = {};
for (let offset = 40; offset >= 0; offset -= 1) {
  const date = shiftDayKey(today, -offset);
  days[date] = { cost: offset === 0 ? 4.2 : Math.round((2 + (offset % 9) * 0.7) * 100) / 100, tokens: 12000 + offset * 100 };
}
// Previous month deliberately higher, so the comparison has something to say.
for (const date of Object.keys(days)) {
  if (date.slice(0, 7) === shiftDayKey(today, -32).slice(0, 7)) days[date].cost += 1.5;
}

const monthly = Object.entries(days).map(([date, day]) => ({ date, cost: day.cost, tokens: day.tokens }));

const snapshot = {
  updatedAt: Date.now(),
  todayKey: today,
  balance: { currency: 'USD', total: 42.5, toppedUp: 40, granted: 2.5, isAvailable: true },
  usage: {
    currency: 'USD',
    todayCost: 4.2,
    todayTokens: 12300,
    windowCost: 71.5,
    windowTokens: 500000,
    priorDaysCost: 67.3,
    daily: monthly,
    models: {
      models: [
        { model: 'deepseek-chat', cost: 50, costToday: 3.2, tokens: 400000, tokensToday: 9000, cacheHit: 9000, cacheMiss: 1000 },
        { model: 'deepseek-reasoner', cost: 21.5, costToday: 1, tokens: 100000, tokensToday: 3300, cacheHit: 0, cacheMiss: 0 },
      ],
      cache: { hitRate: 0.47, saved: 1.23, promptTokens: 20000, hitTokens: 9400 },
    },
    keys: [
      { id: 'k1', name: 'Production', todayCost: 3.1, windowCost: 50, todayTokens: 9000, windowTokens: 300000, dailyCost: { [today]: 3.1 }, lastUsedDay: today },
      { id: 'k2', name: 'Playground', todayCost: 1.1, windowCost: 21.5, todayTokens: 3300, windowTokens: 200000, dailyCost: { [today]: 1.1 }, lastUsedDay: today },
      { id: 'k3', name: 'Old staging', todayCost: 0, windowCost: 0, todayTokens: 0, windowTokens: 0, dailyCost: {}, lastUsedDay: shiftDayKey(today, -23) },
    ],
    windowStart: new Date().toISOString(),
    windowEnd: new Date().toISOString(),
  },
};

const settings = {
  badgeMetric: 'todayCost',
  refreshMinutes: 15,
  windowDays: 30,
  showDecimals: true,
  dailyBudget: 5,
  keyBudgets: { k1: 3 },
  budgetWarnPercent: 90,
  selectedApiKeys: [],
  popupSections: [],
  popupHidden: [],
  showMonthComparison: true,
  showDepletion: true,
  depletionWindowDays: 30,
};

const storage = {
  settings,
  usageSnapshot: snapshot,
  usageHistory: { currency: 'USD', days, keys: {} },
  apiKeyRegistry: {
    k1: { name: 'Production', firstSeen: shiftDayKey(today, -40), lastSeen: today, lastUsedDay: today },
    k2: { name: 'Playground', firstSeen: shiftDayKey(today, -40), lastSeen: today, lastUsedDay: today },
    k3: { name: 'Old staging', firstSeen: shiftDayKey(today, -40), lastSeen: today, lastUsedDay: shiftDayKey(today, -23) },
  },
};

const messages = JSON.parse(await (await fetch('/_locales/en/messages.json')).text());

window.chrome = {
  i18n: {
    getMessage: (key, substitutions) => {
      const entry = messages[key];
      if (!entry?.message) return key;
      const args = [].concat(substitutions || []);
      // Chrome substitutes `$name$` placeholders, in the order of `placeholders`.
      const names = Object.keys(entry.placeholders || {});
      return entry.message.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g, (match, name) => {
        const index = names.indexOf(name);
        return index >= 0 && index < args.length ? String(args[index]) : match;
      });
    },
    getUILanguage: () => 'en-US',
  },
  storage: {
    local: { get: async (keys) => Object.fromEntries([].concat(keys || Object.keys(storage)).map((k) => [k, storage[k]])), set: async () => {} },
    onChanged: { addListener() {} },
  },
  runtime: { sendMessage: async () => ({}), openOptionsPage() {}, getURL: (p) => p },
  downloads: { download: async () => {} },
};

// Load the real popup script after the shim is in place.
await import('../src/popup/popup.js');
