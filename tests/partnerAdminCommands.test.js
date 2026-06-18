const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidUserID } = require('../features/partners/adminCommands');

test('isValidUserID accepts 17-19 digit Discord snowflakes', () => {
  assert.equal(isValidUserID('12345678901234567'), true);
  assert.equal(isValidUserID('123456789012345678'), true);
  assert.equal(isValidUserID('1234567890123456789'), true);
});

test('isValidUserID rejects malformed user IDs', () => {
  assert.equal(isValidUserID('1234567890123456'), false);
  assert.equal(isValidUserID('12345678901234567890'), false);
  assert.equal(isValidUserID('12345abc901234567'), false);
  assert.equal(isValidUserID(''), false);
});
