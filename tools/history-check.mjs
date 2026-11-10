// Sanity checks for the ledger maths: day / month comparisons, the depletion
// estimate, the API-chunk merge and the CSV/JSON exporters.
// No DOM, no chrome.* — plain module calls.
import assert from 'node:assert/strict';
import {
  compareMonths,
  compareToday,
  dailyAverage,
  estimateDepletion,
  monthStart,
  shiftDayKey,
  sumHistoryCost,
} from '../src/lib/history.js';
import { fetchLedger, mergeCostPayload, MAX_WINDOW_DAYS } from '../src/lib/ledger.js';
import { exportFileName, historyToCsv, historyToJson, keysToCsv } from '../src/lib/exporter.js';

// --- day arithmetic -------------------------------------------------------
assert.equal(shiftDayKey('2026-11-01', -1), '2026-10-31');
assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
assert.equal(shiftDayKey('2024-03-01', -1), '2024-02-29'); // leap year
assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01');
assert.equal(monthStart('2026-11-04', 0), '2026-11-01');
assert.equal(monthStart('2026-11-04', 1), '2026-10-01');
assert.equal(monthStart('2026-01-15', 1), '2025-12-01');

// --- ledger merge ---------------------------------------------------------
// Mirrors the real payload: several (api_key, model) series in one currency
// block, all of which must be summed. Buckets are NOT deduplicated by time.
const TZ = 10800;
const at = (dayKey) => Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / 1000) - TZ;

const payload = {
  code: 0,
  data: {
    biz_code: 0,
    biz_data: {
      data: [
        {
          currency: 'USD',
          series: [
            {
              api_key: { tracking_id: 'k1', name: 'one' },
              model: 'deepseek-chat',
              buckets: [
                { time: at('2026-11-02'), cost: '1.5' },
                { time: at('2026-11-03'), cost: '2' },
                { time: at('2026-11-04'), cost: '0' }, // zero days are ignored
              ],
            },
            {
              api_key: { tracking_id: 'k1', name: 'one' },
              model: 'deepseek-reasoner',
              buckets: [
                { time: at('2026-11-02'), cost: '0.5' }, // same day, other model
                { time: at('2026-11-04'), cost: '4' },
              ],
            },
            {
              api_key: { tracking_id: 'k2', name: 'two' },
              model: 'deepseek-chat',
              buckets: [{ time: at('2026-11-04'), cost: '1' }],
            },
          ],
        },
        {
          // A second currency block must be ignored, not mixed in.
          currency: 'CNY',
          series: [
            {
              api_key: { tracking_id: 'k1', name: 'one' },
              model: 'deepseek-chat',
              buckets: [{ time: at('2026-11-04'), cost: '999' }],
            },
          ],
        },
      ],
    },
  },
};

const ledger = { currency: null, days: {}, keys: {} };
mergeCostPayload(ledger, payload, TZ);

assert.equal(ledger.currency, 'USD', 'first currency wins');
assert.equal(ledger.days['2026-11-02'].cost, 2, 'two models on one day are summed');
assert.equal(ledger.days['2026-11-04'].cost, 5, 'per-key series are summed, CNY ignored');
assert.equal(ledger.days['2026-11-03'].cost, 2);
assert.equal(ledger.keys.k1['2026-11-02'], 2);
assert.equal(ledger.keys.k2['2026-11-04'], 1);

// The merge is additive by design: chunks never overlap, so nothing dedupes.
const twice = { currency: null, days: {}, keys: {} };
mergeCostPayload(twice, payload, TZ);
mergeCostPayload(twice, payload, TZ);
assert.equal(twice.days['2026-11-04'].cost, 10, 'merge is additive (chunks never overlap)');

// --- chunking contract ----------------------------------------------------
assert.equal(MAX_WINDOW_DAYS, 31, 'the console rejects windows longer than 31 days');

// `fetchLedger` must stay within the limit for every chunk it asks for.
const requested = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const params = new URL(url).searchParams;
  requested.push({ start: Number(params.get('start')), end: Number(params.get('end')) });
  return {
    status: 200,
    ok: true,
    text: async () => JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { data: [] } } }),
  };
};
try {
  await fetchLedger('token', { days: 120, todayKey: '2026-11-10' });
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(requested.length, 4, '120 days → 4 chunks of 30');
for (const { start, end } of requested) {
  const span = (end - start) / 86400;
  assert.ok(span <= MAX_WINDOW_DAYS, `chunk span ${span} exceeds the console limit`);
  assert.ok(span > 1, 'each chunk is a real range');
}
// Newest chunk first, so a deep failure cannot hide recent data.
assert.ok(requested[0].end > requested[3].end, 'chunks are walked from newest to oldest');

// --- aggregates -----------------------------------------------------------
const sample = {
  currency: 'USD',
  days: {
    '2026-10-31': { cost: 10, tokens: 1 },
    '2026-11-01': { cost: 5, tokens: 1 },
    '2026-11-02': { cost: 0, tokens: 0 },
    '2026-11-03': { cost: 15, tokens: 1 },
    '2026-11-04': { cost: 10, tokens: 1 },
  },
};
assert.equal(sumHistoryCost(sample, { from: '2026-11-01', to: '2026-11-04' }), 30);
assert.equal(dailyAverage(sample).days, 5);
assert.equal(dailyAverage(sample).average, 8); // 40 / 5, quiet day counts
assert.equal(dailyAverage(sample, { from: '2026-11-01' }).average, 7.5);
assert.equal(dailyAverage(sample).spendDays, 4);

// --- comparisons ----------------------------------------------------------
const months = compareMonths(sample, '2026-11-04');
assert.equal(months.current, 30);
assert.equal(months.previous, 10);
assert.equal(months.sameDaysUntil, '2026-10-04');
assert.equal(months.sameDaysPrevious, 0, 'no spend in Oct 1..4');
assert.equal(months.sameDaysComparable, false);

const march = compareMonths(
  {
    currency: 'USD',
    days: { '2026-02-01': { cost: 4 }, '2026-03-01': { cost: 8 }, '2026-03-02': { cost: 8 } },
  },
  '2026-03-02',
);
assert.equal(march.sameDaysUntil, '2026-02-02');
assert.equal(march.sameDaysRatio, 4);

const today = compareToday({ todayCost: 10 }, sample, '2026-11-04');
assert.equal(today.yesterday, 15);
assert.equal(today.delta, -5);
assert.equal(today.comparable, true);

// No yesterday → not comparable instead of a bogus 100 % drop.
const noYesterday = compareToday({ todayCost: 10 }, { days: {} }, '2026-11-04');
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
const exportHistoryData = {
  currency: 'USD',
  days: { '2026-11-03': { cost: 1.5, tokens: 10 }, '2026-11-04': { cost: 2, tokens: 20 } },
  keys: { k1: { '2026-11-03': 1.5, '2026-11-04': 2 } },
};
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

console.log('ledger/export checks passed');
