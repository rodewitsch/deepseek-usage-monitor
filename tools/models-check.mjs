// Quick sanity check for the model/cache and forecast helpers — no DOM needed.
import assert from 'node:assert/strict';
import { buildModelStats, modelLabel, readTokenFields } from '../src/lib/models.js';
import { projectToday } from '../src/lib/forecast.js';

// Token field splitting.
assert.deepEqual(readTokenFields({ PROMPT_CACHE_HIT_TOKEN: '900', PROMPT_CACHE_MISS_TOKEN: '100', COMPLETION_TOKEN: '50', REQUEST: 3 }), {
  tokens: 1050,
  cacheHit: 900,
  cacheMiss: 100,
});

const stats = buildModelStats({
  amounts: [
    {
      model: 'deepseek-chat',
      buckets: [{ time: 1, usage: { PROMPT_CACHE_HIT_TOKEN: '900', PROMPT_CACHE_MISS_TOKEN: '100' } }],
    },
    { model: 'deepseek-reasoner', buckets: [{ time: 1, usage: { PROMPT_CACHE_MISS_TOKEN: '1000' } }] },
  ],
  costs: [
    { model: 'deepseek-chat', buckets: [{ time: 1, cost: '2' }] },
    { model: 'deepseek-reasoner', buckets: [{ time: 1, cost: '6' }] },
  ],
  todayAmounts: [{ model: 'deepseek-chat', buckets: [{ time: 2, usage: { PROMPT_CACHE_MISS_TOKEN: '10' } }] }],
  todayCosts: [{ model: 'deepseek-chat', buckets: [{ time: 2, cost: '0.5' }] }],
  dayOf: () => '2026-11-04',
  todayKey: '2026-11-04',
  currency: 'USD',
});
assert.equal(stats.models.length, 2);
assert.equal(stats.top.model, 'deepseek-reasoner');
assert.equal(stats.models[0].cost, 6);
assert.equal(stats.models.find((m) => m.model === 'deepseek-chat').costToday, 0.5);
assert.equal(stats.models.find((m) => m.model === 'deepseek-chat').tokensToday, 10);
assert.equal(stats.cache.hitTokens, 900);
assert.equal(stats.cache.promptTokens, 2000);
assert.equal(stats.cache.hitRate, 0.45);
assert.ok(stats.cache.saved > 0);
assert.equal(modelLabel('deepseek-chat'), 'DeepSeek Chat');
assert.equal(modelLabel('deepseek-v9'), 'deepseek-v9');

// Forecast: 12 hours in, $6 spent → $12 projected; average day is $8.
const noon = new Date(2026, 10, 4, 12, 0, 0);
const forecast = projectToday(6, noon, { windowCost: 232, windowDays: 29 });
assert.equal(Math.round(forecast.elapsedHours), 12);
assert.equal(Math.round(forecast.projected), 12);
assert.equal(Math.round(forecast.baseline), 8);
assert.equal(Math.round(forecast.ratio * 100), 150);
assert.equal(forecast.tooEarly, false);

// Before 00:30 there is no meaningful projection.
assert.equal(projectToday(0.01, new Date(2026, 10, 4, 0, 10, 0)).tooEarly, true);

console.log('models/forecast checks passed');
