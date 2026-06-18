const test = require('node:test');
const assert = require('node:assert/strict');

const { loadBalance, getDepth } = require('../features/nicoscave/balance');
const {
  calculateCompletion,
  getDayKey,
  getHpForLevel,
  getRewardMultiplier,
  getXpForNextLevel,
} = require('../features/nicoscave/engine');

test('completion is deterministic when rng is fixed', () => {
  const balance = loadBalance({ forceReload: true });
  const depth = getDepth(balance, 1);
  const result = calculateCompletion(
    { attack: 5, hp: 100, mining: 4 },
    depth,
    balance.progression,
    () => 0.5
  );

  assert.equal(result.completion, 100);
});

test('reward multiplier thresholds match phase 1 rules', () => {
  assert.equal(getRewardMultiplier(69), 1);
  assert.equal(getRewardMultiplier(70), 2);
  assert.equal(getRewardMultiplier(89), 2);
  assert.equal(getRewardMultiplier(90), 3);
});

test('daily raid key resets on Europe/Istanbul calendar day', () => {
  assert.equal(getDayKey(new Date('2026-05-12T20:59:00.000Z')), '2026-05-12');
  assert.equal(getDayKey(new Date('2026-05-12T21:00:00.000Z')), '2026-05-13');
});

test('hp and xp curves use configured hybrid formula constants', () => {
  const balance = loadBalance();

  assert.equal(getHpForLevel(1, balance.progression), 100);
  assert.equal(getHpForLevel(2, balance.progression), 119);
  assert.equal(getXpForNextLevel(1, balance.progression), 70);
  assert.equal(getXpForNextLevel(2, balance.progression), 190);
});
