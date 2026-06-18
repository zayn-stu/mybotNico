const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAdBroadcastResultMessage } = require('../features/partners/adSubmissionFlow');

test('buildAdBroadcastResultMessage reports all successful ad broadcasts', () => {
  const message = buildAdBroadcastResultMessage('ad-1', [
    { name: 'Server A', success: true },
    { name: 'Server B', success: true },
  ]);

  assert.match(message, /✅ \*\*Ad Approved & Broadcasted\*\* \(`ad-1`\)/);
  assert.match(message, /\*\*Broadcast Results:\*\* 2\/2 channels/);
  assert.doesNotMatch(message, /\*\*Failures:\*\*/);
});

test('buildAdBroadcastResultMessage includes failed ad broadcasts', () => {
  const message = buildAdBroadcastResultMessage('ad-2', [
    { name: 'Server A', success: true },
    { name: 'Server B', success: false, error: 'Missing permissions' },
  ]);

  assert.match(message, /\*\*Broadcast Results:\*\* 1\/2 channels/);
  assert.match(message, /\*\*Failures:\*\*/);
  assert.match(message, /❌ Server B — Missing permissions/);
});
