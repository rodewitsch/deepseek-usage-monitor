// Sanity checks for the Milestone 3 alert rules — pure functions, no chrome.*.
import assert from 'node:assert/strict';
import {
  alertNoticeKey,
  detectSpikes,
  forecastBudgetBreach,
  trackKeys,
} from '../src/lib/alerts.js';

// --- pace alert -----------------------------------------------------------
// 12h in, $5 of a $10 budget → $10 projected: exactly at budget, not over.
const noon = new Date(2026, 10, 6, 12, 0, 0);
const settings = { dailyBudget: 10, budgetWarnPercent: 90, windowDays: 30, keyBudgets: {} };
const usage = { todayCost: 5, currency: 'USD', priorDaysCost: 100, keys: [] };

assert.equal(forecastBudgetBreach(usage, settings, [], noon), null, 'exactly at budget is not a breach');

// $6 at noon → $12 projected: over a $10 budget.
const breach = forecastBudgetBreach({ ...usage, todayCost: 6 }, settings, [], noon);
assert.equal(breach.scope, 'account');
assert.equal(Math.round(breach.projected), 12);
assert.equal(Math.round(breach.overBy), 2);
assert.equal(Math.round(breach.percent), 120);

// Already over the budget → handled by the existing "over" notification.
assert.equal(forecastBudgetBreach({ ...usage, todayCost: 11 }, settings, [], noon), null);

// No budget configured → nothing to forecast against.
assert.equal(forecastBudgetBreach({ ...usage, todayCost: 6 }, { ...settings, dailyBudget: 0 }, [], noon), null);

// Too early in the day → a projection would be nonsense.
assert.equal(
  forecastBudgetBreach({ ...usage, todayCost: 0.2 }, settings, [], new Date(2026, 10, 6, 0, 10)),
  null,
);

// A single selected key with its own budget is more precise than the account.
const keyUsage = {
  todayCost: 6,
  currency: 'USD',
  priorDaysCost: 100,
  keys: [{ id: 'k1', name: 'Prod', todayCost: 6, lastUsedDay: '2026-11-06' }],
};
const keySettings = { ...settings, keyBudgets: { k1: 8 } };
const keyBreach = forecastBudgetBreach(keyUsage, keySettings, ['k1'], noon);
assert.equal(keyBreach.scope, 'key:k1');
assert.equal(keyBreach.name, 'Prod');
assert.equal(keyBreach.budget, 8);

// --- spike detection ------------------------------------------------------
const history = {
  days: {
    '2026-11-01': { cost: 1 },
    '2026-11-02': { cost: 1 },
    '2026-11-03': { cost: 1 },
    '2026-11-04': { cost: 1 },
  },
  keys: {
    k1: { '2026-11-01': 1, '2026-11-02': 1, '2026-11-03': 1 },
  },
};

// $4 today vs. a $1 average = 4x → spike.
const spike = detectSpikes(history, { todayCost: 4, keys: [] }, '2026-11-05');
assert.ok(spike.account);
assert.equal(spike.account.ratio, 4);
assert.equal(spike.account.average, 1);

// 3x is the default threshold; 2x is not a spike.
assert.equal(detectSpikes(history, { todayCost: 2, keys: [] }, '2026-11-05').account, null);

// A tiny absolute amount is never a spike, however many times the average.
assert.equal(
  detectSpikes({ days: { '2026-11-01': { cost: 0.001 }, '2026-11-02': { cost: 0.001 }, '2026-11-03': { cost: 0.001 } } }, { todayCost: 0.1, keys: [] }, '2026-11-05').account,
  null,
);

// Too little history → no baseline, no alert.
assert.equal(detectSpikes({ days: { '2026-11-04': { cost: 1 } } }, { todayCost: 9, keys: [] }, '2026-11-05').account, null);

// Today must NOT be part of the baseline (it would dilute its own spike).
const todayIncluded = detectSpikes(
  { days: { ...history.days, '2026-11-05': { cost: 4 } } },
  { todayCost: 4, keys: [] },
  '2026-11-05',
);
assert.equal(todayIncluded.account.average, 1, 'today is excluded from the average');

// Per-key spike uses that key's own history.
const keySpike = detectSpikes(history, {
  todayCost: 0,
  keys: [{ id: 'k1', name: 'Prod', todayCost: 5, lastUsedDay: '2026-11-05' }],
}, '2026-11-05');
assert.equal(keySpike.keys.length, 1);
assert.equal(keySpike.keys[0].scope, 'key:k1');

// A key with no history is skipped (a new key is a different alert).
const noHistory = detectSpikes(history, {
  todayCost: 0,
  keys: [{ id: 'new', name: 'New', todayCost: 50, lastUsedDay: '2026-11-05' }],
}, '2026-11-05');
assert.equal(noHistory.keys.length, 0);

// --- key lifecycle --------------------------------------------------------
const firstRun = trackKeys({}, { keys: [{ id: 'k1', name: 'Prod', lastUsedDay: '2026-11-06' }] }, '2026-11-06');
assert.equal(firstRun.registry.k1.firstSeen, '2026-11-06');
assert.equal(firstRun.registry.k1.lastUsedDay, '2026-11-06');

// A key that has never been used keeps `lastUsedDay` null (not "inactive yet").
const unused = trackKeys({}, { keys: [{ id: 'k2', name: 'Spare', lastUsedDay: null }] }, '2026-11-06', {
  inactiveDays: 7,
});
assert.equal(unused.registry.k2.lastUsedDay, null);
assert.equal(unused.inactiveKeys.length, 0, 'a never-used key is not "inactive"');

// New key detection: k3 is unknown to the registry.
const detected = trackKeys(
  { k1: { name: 'Prod', firstSeen: '2026-11-01', lastSeen: '2026-11-05', lastUsedDay: '2026-11-05' } },
  { keys: [{ id: 'k1', name: 'Prod', lastUsedDay: '2026-11-06' }, { id: 'k3', name: 'Leaked', lastUsedDay: '2026-11-06' }] },
  '2026-11-06',
);
assert.deepEqual(detected.newKeys.map((key) => key.id), ['k3']);
assert.equal(detected.registry.k1.firstSeen, '2026-11-01', 'firstSeen is preserved');

// Inactive: last used 20 days ago with a 14-day threshold.
const idle = trackKeys(
  { k1: { name: 'Old', firstSeen: '2026-10-01', lastSeen: '2026-10-17', lastUsedDay: '2026-10-17' } },
  { keys: [{ id: 'k1', name: 'Old', lastUsedDay: '2026-10-17' }] },
  '2026-11-06',
  { inactiveDays: 14 },
);
assert.equal(idle.inactiveKeys.length, 1);
assert.equal(idle.inactiveKeys[0].days, 20);

// Just inside the threshold → no alert.
const fresh = trackKeys({}, { keys: [{ id: 'k1', name: 'Old', lastUsedDay: '2026-10-30' }] }, '2026-11-06', {
  inactiveDays: 14,
});
assert.equal(fresh.inactiveKeys.length, 0);

// A key that disappears from the window stays in the registry, so it is not
// announced as "new" when it comes back.
const vanished = trackKeys(
  { k1: { name: 'Prod', firstSeen: '2026-11-01', lastSeen: '2026-11-05', lastUsedDay: '2026-11-05' } },
  { keys: [] },
  '2026-11-06',
);
assert.ok(vanished.registry.k1, 'vanished keys are kept');
assert.equal(vanished.newKeys.length, 0);

const cameBack = trackKeys(vanished.registry, { keys: [{ id: 'k1', name: 'Prod', lastUsedDay: '2026-11-07' }] }, '2026-11-07');
assert.equal(cameBack.newKeys.length, 0, 'a returning key is not "new"');

// --- notice markers -------------------------------------------------------
assert.equal(alertNoticeKey('2026-11-06', 'pace', 'account'), '2026-11-06:pace:account');
assert.equal(alertNoticeKey('2026-11-06', 'spike', 'key:k1'), '2026-11-06:spike:key:k1');

console.log('alerts checks passed');
