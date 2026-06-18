const assert = require('node:assert/strict');
const test = require('node:test');

const { parseColor } = require('../features/roles/colors');

test('parseColor resolves known color names', () => {
  assert.equal(parseColor('red'), '#FF0000');
  assert.equal(parseColor('grey'), '#808080');
});

test('parseColor accepts hex values with or without hash', () => {
  assert.equal(parseColor('#abcdef'), '#abcdef');
  assert.equal(parseColor('ABCDEF'), '#ABCDEF');
});

test('parseColor rejects invalid color values', () => {
  assert.equal(parseColor('not-a-color'), null);
  assert.equal(parseColor('#12345'), null);
  assert.equal(parseColor('1234567'), null);
});
