// Sanity checks for the Milestone 2 helpers: history accumulation, month /
// today comparisons, the depletion estimate and the CSV/JSON exporters.
// No DOM, no chrome.* — plain module calls.
import assert from 'node:assert/strict';
import {
  compareMonths,
  compareToday,
  dailyAverage,
  emptyHistory,
  estimateDepletion,
  mergeUsageIntoHistory,
  monthStart,
  normaliseHistory,
  shiftDayKey,
  sumHistoryCost,
} from '../src/lib/history.js';
import { exportFileName, historyToCsv, historyToJson, keysToCsv } from '../src/lib/exporter.js';

// --- day arithmetic -------------------------------------------------------
assert.equal(shiftDayKey('2026-11-01', -1), '2026-10-31');
assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
assert.equal(shiftDayKey('2024-03-01', -1), '2024-02-29'); // leap year
assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01');
assert.equal(monthStart('2026-11-04', 0), '2026-11-01');
assert.equal(monthStart('2026-11-04', 1), '2026-10-01');
assert.equal(monthStart('2026-01-15', 1), '2025-12-01');

// --- history merge --------------------------------------------------------
let history = emptyHistory();

const usageDay1 = {
  currency: 'USD',
  daily: [
    { date: '2026-11-02', cost: 2, tokens: 100 },
    { date: '2026-11-03', cost: 3, tokens: 200 },
    { date: '2026-11-04', cost: 4, tokens: 300 },
  ],
  keys: [{ id: 'k1', dailyCost: { '2026-11-02': 2, '2026-11-04': 1 } }],
};

let merged = mergeUsageIntoHistory(history, usageDay1, { todayKey: '2026-11-04', now: 1000 });
assert.equal(merged.changed, true);
assert.equal(merged.firstDay, '2026-11-02');
history = merged.history;
assert.equal(Object.keys(history.days).length, 3);
assert.equal(history.days['2026-11-03'].cost, 3);

// Re-merging the same payload changes nothing (no duplicate writes).
const again = mergeUsageIntoHistory(history, usageDay1, { todayKey: '2026-11-04' });
assert.equal(again.changed, false);

// Later refreshes overwrite a known day (the API is the source of truth) and
// add new ones; days that leave the API window must SURVIVE.
const usageDay2 = {
  currency: 'USD',
  daily: [{ date: '2026-11-04', cost: 6, tokens: 450 }],
  keys: [],
};
merged = mergeUsageIntoHistory(history, usageDay2, { todayKey: '2026-11-05' });
history = merged.history;
assert.equal(history.days['2026-11-04'].cost, 6, 'today is refreshed');
assert.equal(history.days['2026-11-02'].cost, 2, 'old days are kept');

// Untrusted (scraped) numbers may not overwrite known days.
const scraped = { currency: 'USD', daily: [{ date: '2026-11-04', cost: 99 }], keys: [] };
history = mergeUsageIntoHistory(history, scraped, { todayKey: '2026-11-04', trusted: false }).history;
assert.equal(history.days['2026-11-04'].cost, 6, 'scraped value ignored for a known day');

// A currency switch drops the old amounts instead of mixing currencies.
history = mergeUsageIntoHistory(history, { currency: 'CNY', daily: [], keys: [] }).history;
assert.equal(Object.keys(history.days).length, 0);
assert.equal(history.currency, 'CNY');

// --- aggregates -----------------------------------------------------------
const sample = normaliseHistory({
  currency: 'USD',
  days: {
    '2026-10-31': { cost: 10, tokens: 1 },
    '2026-11-01': { cost: 5, tokens: 1 },
    '2026-11-02': { cost: 0, tokens: 0 },
    '2026-11-03': { cost: 15, tokens: 1 },
    '2026-11-04': { cost: 10, tokens: 1 },
  },
});
assert.equal(sumHistoryCost(sample, { from: '2026-11-01', to: '2026-11-04' }), 30);
assert.equal(dailyAverage(sample).days, 5);
assert.equal(dailyAverage(sample).average, 8); // 40 / 5, quiet day counts
assert.equal(dailyAverage(sample, { from: '2026-11-01' }).average, 7.5);
assert.equal(dailyAverage(sample).spendDays, 4);

// --- comparisons ----------------------------------------------------------
// 2026-11-04: this month 30 over 4 days; October 1..4 had 10 on the 31st only
// → the same-days slice is null, the full month is 10.
const months = compareMonths(sample, '2026-11-04');
assert.equal(months.current, 30);
assert.equal(months.previous, 10);
assert.equal(months.sameDaysUntil, '2026-10-04');
assert.equal(months.sameDaysPrevious, 0, 'no spend in Oct 1..4');
assert.equal(months.sameDaysComparable, false);

// A month boundary: on the 3rd of a 31-day month, no overflow into next month.
const march = compareMonths(
  normaliseHistory({
    currency: 'USD',
    days: { '2026-02-01': { cost: 4 }, '2026-03-01': { cost: 8 }, '2026-03-02': { cost: 8 } },
  }),
  '2026-03-02',
);
assert.equal(march.sameDaysUntil, '2026-02-02');
assert.equal(march.sameDaysRatio, 4);

const today = compareToday({ todayCost: 10 }, sample, '2026-11-04');
assert.equal(today.yesterday, 15);
assert.equal(today.delta, -5);
assert.equal(today.comparable, true);

// No yesterday → not comparable instead of a bogus 100 % drop.
const noYesterday = compareToday({ todayCost: 10 }, emptyHistory(), '2026-11-04');
assert.equal(noYesterday.comparable, false);
assert.equal(noYesterday.yesterday, null);

// --- depletion ------------------------------------------------------------
const depletion = estimateDepletion(100, 8, '2026-11-04');
assert.equal(depletion.daysLeft, 12);
assert.equal(depletion.runsOutOn, '2026-11-16');
assert.equal(depletion.depleted, false);
assert.equal(estimateDepletion(0, 8, '2026-11-04').depleted, true);
assert.equal(estimateDepletion(100, 0, '2026-11-04'), null, 'no average → no estimate');

// --- export ---------------------------------------------------------------
const exportHistoryData = normaliseHistory({
  currency: 'USD',
  days: { '2026-11-03': { cost: 1.5, tokens: 10 }, '2026-11-04': { cost: 2, tokens: 20 } },
  keys: { k1: { '2026-11-03': 1.5, '2026-11-04': 2 } },
});
const exportUsage = {
  currency: 'USD',
  windowCost: 3.5,
  windowTokens: 30,
  windowStart: '2026-10-05T00:00:00.000Z',
  windowEnd: '2026-11-05T00:00:00.000Z',
  models: {
    models: [
      { model: 'deepseek-chat', cost: 1, costToday: 2, tokens: 10, tokensToday: 20 },
      { model: 'deepseek-reasoner', cost: 2, costToday: 0, tokens: 5, tokensToday: 0 },
    ],
    cache: { hitRate: 0.5, saved: 0.1 },
  },
  keys: [{ id: 'k1', name: 'Key one', todayCost: 2, windowCost: 3.5, tokens: 30, lastUsedDay: '2026-11-04' }],
};

const csv = historyToCsv(exportHistoryData, { usage: exportUsage, todayKey: '2026-11-04' });
const lines = csv.trim().split('\r\n');
assert.equal(
  lines[0],
  'date,cost_USD,tokens,keys_USD,deepseek-chat_cost_USD,deepseek-chat_tokens,deepseek-reasoner_cost_USD,deepseek-reasoner_tokens',
);
assert.equal(lines[1], '2026-11-03,1.5,10,1.5,,,,', 'older days keep day totals, no model split');
assert.equal(lines[2], '2026-11-04,2,20,2,2,20,0,0');

const json = JSON.parse(historyToJson(exportHistoryData, { usage: exportUsage, todayKey: '2026-11-04', exportedAt: 0 }));
assert.equal(json.currency, 'USD');
assert.equal(json.history.firstDay, '2026-11-03');
assert.equal(json.history.days[1].keys, 2);
assert.equal(json.models.length, 2);
assert.equal(json.window.cost, 3.5);

// CSV quoting must survive a comma or a quote in a key name.
const quoted = keysToCsv({ currency: 'USD', keys: [{ id: 'k', name: 'a,"b"', todayCost: 1, windowCost: 1 }] });
assert.ok(quoted.includes('"a,""b"""'), quoted);

assert.equal(exportFileName('csv', '2026-11-04'), 'deepseek-usage-2026-11-04.csv');

console.log('history/export checks passed');
