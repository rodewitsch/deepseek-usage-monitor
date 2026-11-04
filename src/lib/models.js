import { toNumber } from './format.js';

/**
 * Model breakdown and prompt-cache statistics.
 *
 * The console already returns one series per `(api_key, model)`, both for
 * `amount` (tokens) and for `cost` (money). This module folds those series into
 * a flat per-model list so the popup can show "which model costs the most" and
 * "how much the prompt cache saved".
 *
 * `PROMPT_CACHE_HIT_TOKEN` is billed at 1/10 of a normal prompt token, so a
 * cache hit saves ~90% of the price that token would otherwise cost.
 */

const CACHE_HIT_FIELD = /CACHE_HIT/i;
const CACHE_MISS_FIELD = /CACHE_MISS|PROMPT_TOKEN/i;
export const CACHE_SAVING_RATIO = 0.9;

/** Canonical labels for the models we know about. */
const KNOWN_MODELS = {
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'deepseek-coder': 'DeepSeek Coder',
};

export function modelLabel(model) {
  const id = String(model || 'unknown');
  return KNOWN_MODELS[id] || id;
}

function emptyModel(model) {
  return {
    model,
    cost: 0,
    costToday: 0,
    tokens: 0,
    tokensToday: 0,
    cacheHit: 0,
    cacheMiss: 0,
  };
}

function ensure(map, model) {
  const id = String(model || 'unknown');
  if (!map.has(id)) map.set(id, emptyModel(id));
  return map.get(id);
}

/** Splits one usage object into total tokens and cache hit/miss tokens. */
export function readTokenFields(usage) {
  let tokens = 0;
  let cacheHit = 0;
  let cacheMiss = 0;

  for (const [type, value] of Object.entries(usage || {})) {
    const name = String(type).toUpperCase();
    if (name === 'REQUEST') continue;
    const amount = toNumber(value);
    tokens += amount;
    if (CACHE_HIT_FIELD.test(name)) cacheHit += amount;
    else if (CACHE_MISS_FIELD.test(name)) cacheMiss += amount;
  }
  return { tokens, cacheHit, cacheMiss };
}

/**
 * Folds the per-(key, model) series of all four usage payloads into one list.
 *
 * @param {object} args
 * @param {any[]} args.amounts       series from the multi-day amount payload
 * @param {any[]} args.costs         series from the multi-day cost payload
 * @param {any[]} args.todayAmounts  series from the hourly amount payload
 * @param {any[]} args.todayCosts    series from the hourly cost payload
 * @param {(seconds:number)=>string} args.dayOf unix ts → `YYYY-MM-DD`
 * @param {string} args.todayKey     today's day key
 * @param {string} args.currency     currency whose cost blocks are used
 */
export function buildModelStats({
  amounts = [],
  costs = [],
  todayAmounts = [],
  todayCosts = [],
  dayOf,
  todayKey,
  currency = 'USD',
} = {}) {
  const models = new Map();

  for (const series of amounts) {
    const entry = ensure(models, series?.model);
    for (const bucket of Array.isArray(series?.buckets) ? series.buckets : []) {
      const fields = readTokenFields(bucket.usage);
      entry.tokens += fields.tokens;
      entry.cacheHit += fields.cacheHit;
      entry.cacheMiss += fields.cacheMiss;
    }
  }

  for (const series of costs) {
    const entry = ensure(models, series?.model);
    for (const bucket of Array.isArray(series?.buckets) ? series.buckets : []) {
      entry.cost += toNumber(bucket.cost);
    }
  }

  // The hourly payloads only refresh today's figures — the daily rollup covers
  // complete days.
  for (const series of todayAmounts) {
    const entry = ensure(models, series?.model);
    for (const bucket of Array.isArray(series?.buckets) ? series.buckets : []) {
      entry.tokensToday += readTokenFields(bucket.usage).tokens;
    }
  }

  for (const series of todayCosts) {
    const entry = ensure(models, series?.model);
    for (const bucket of Array.isArray(series?.buckets) ? series.buckets : []) {
      const day = typeof dayOf === 'function' ? dayOf(bucket.time) : todayKey;
      if (day !== todayKey) continue;
      entry.costToday += toNumber(bucket.cost);
    }
  }

  const list = [...models.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

  // A cache hit is billed at 1/10 of a miss, so the avoided cost is 9/10 of the
  // price those hit tokens would have had at the miss rate. The miss price is
  // derived from the real spend, so no price table (which may change) is needed.
  const totalHit = list.reduce((sum, entry) => sum + entry.cacheHit, 0);
  const totalMiss = list.reduce((sum, entry) => sum + entry.cacheMiss, 0);
  const totalCost = list.reduce((sum, entry) => sum + entry.cost, 0);
  const promptTokens = totalHit + totalMiss;
  const hitRate = promptTokens > 0 ? totalHit / promptTokens : 0;
  const missPrice = promptTokens > 0 ? totalCost / promptTokens : 0;
  const saved = totalHit * missPrice * CACHE_SAVING_RATIO;

  return {
    models: list,
    cache: { hitTokens: totalHit, missTokens: totalMiss, promptTokens, hitRate, saved, currency },
    /** Model with the highest spend — the headline of the section. */
    top: list[0] || null,
  };
}
