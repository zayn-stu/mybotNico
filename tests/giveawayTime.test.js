const assert = require('node:assert/strict');
const test = require('node:test');

const { parseDuration } = require('../features/giveaways/time');

test('parseDuration parses common duration units', () => {
  assert.equal(parseDuration('10m'), 10 * 60 * 1000);
  assert.equal(parseDuration('2h'), 2 * 60 * 60 * 1000);
  assert.equal(parseDuration('1d'), 24 * 60 * 60 * 1000);
  assert.equal(parseDuration('1w'), 7 * 24 * 60 * 60 * 1000);
});

test('parseDuration accepts spaces, words, and decimals', () => {
  assert.equal(parseDuration('1.5 hours'), 90 * 60 * 1000);
  assert.equal(parseDuration('30 seconds'), 30 * 1000);
  assert.equal(parseDuration('250 ms'), 250);
});

test('parseDuration rejects invalid durations', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('0m'), null);
  assert.equal(parseDuration('-1h'), null);
  assert.equal(parseDuration('ten minutes'), null);
  assert.equal(parseDuration('5fortnights'), null);
});
