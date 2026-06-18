const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDirectBroadcastConfirmation } = require('../features/partners/directBroadcast');

test('buildDirectBroadcastConfirmation reports success and failure totals', () => {
  const message = buildDirectBroadcastConfirmation([
    { name: 'Server A', success: true },
    { name: 'Server B', success: false, error: 'Missing permissions' },
  ], false, '123.45', [10, 20], [30, 60]);

  assert.match(message, /\*\*Partnership Broadcast Results:\*\*/);
  assert.match(message, /✅ \*\*Server A\*\* - Sent successfully/);
  assert.match(message, /❌ \*\*Server B\*\* - Failed: Missing permissions/);
  assert.match(message, /\*\*Total:\*\* 1\/2 channels/);
  assert.match(message, /123\.45ms \| fetch avg: 15\.00ms \| send avg: 45\.00ms/);
});

test('buildDirectBroadcastConfirmation includes sanitization warning', () => {
  const message = buildDirectBroadcastConfirmation([
    { name: 'Server A', success: true },
  ], true, '1.00', [], []);

  assert.match(message, /`@everyone` \/ `@here` was removed/);
  assert.match(message, /fetch avg: 0\.00ms \| send avg: 0\.00ms/);
});
