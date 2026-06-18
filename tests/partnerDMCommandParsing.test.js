const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeDMCommand } = require('../features/partners/handler');

test('normalizeDMCommand removes optional bang prefix', () => {
  assert.equal(normalizeDMCommand('show ads'), 'show ads');
  assert.equal(normalizeDMCommand('  !show ads  '), 'show ads');
  assert.equal(normalizeDMCommand('submit'), 'submit');
  assert.equal(normalizeDMCommand('!submit'), 'submit');
});
