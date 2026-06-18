const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAttachmentUrls,
  formatBroadcastPreview,
  formatDeleteResult,
  getBroadcastMessagesFromResults,
  queryMatchesCandidate,
  groupFallbackCandidates,
} = require('../features/partners/broadcastFormat');

test('getAttachmentUrls accepts strings and Discord attachment-like objects', () => {
  assert.deepEqual(getAttachmentUrls([
    'https://example.test/a.png',
    { url: 'https://example.test/b.png' },
    { attachment: 'https://example.test/c.png' },
    { name: 'missing-url' },
    null,
  ]), [
    'https://example.test/a.png',
    'https://example.test/b.png',
    'https://example.test/c.png',
  ]);
});

test('formatBroadcastPreview preserves broadcast summary fields', () => {
  const preview = formatBroadcastPreview({
    id: 'abc',
    source: 'direct',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: 'Hello partner servers',
    attachments: [{ url: 'https://example.test/file.png' }],
    messages: [
      { serverName: 'Server A', channelName: 'ads' },
      { serverName: 'Server B', channelName: 'partners' },
    ],
  });

  assert.match(preview, /\*\*Broadcast:\*\* `abc`/);
  assert.match(preview, /\*\*Source:\*\* direct/);
  assert.match(preview, /\*\*Messages:\*\* 2/);
  assert.match(preview, /\*\*Attachments:\*\* 1/);
  assert.match(preview, /Server A \(#ads\)/);
});

test('formatDeleteResult includes deletion counts and capped failure details', () => {
  const failed = Array.from({ length: 12 }, (_, index) => ({
    serverName: `Server ${index + 1}`,
    channelName: 'ads',
    error: 'Missing permissions',
  }));

  const result = formatDeleteResult({
    deleted: 3,
    total: 15,
    alreadyMissing: 2,
    failed,
  });

  assert.match(result, /\*\*Delete Results:\*\* 3\/15 deleted, 2 already missing, 12 failed/);
  assert.match(result, /Server 10/);
  assert.doesNotMatch(result, /Server 11/);
  assert.match(result, /\.\.\.and 2 more failures/);
});

test('getBroadcastMessagesFromResults keeps only successful sent messages', () => {
  assert.deepEqual(getBroadcastMessagesFromResults([
    {
      success: true,
      name: 'Server A',
      serverId: 'guild-1',
      channelName: 'ads',
      channelId: 'channel-1',
      sentMessage: { id: 'message-1' },
    },
    {
      success: false,
      name: 'Server B',
      error: 'no channel',
    },
  ]), [{
    serverId: 'guild-1',
    serverName: 'Server A',
    channelId: 'channel-1',
    channelName: 'ads',
    messageId: 'message-1',
  }]);
});

test('queryMatchesCandidate requires every search token to be present', () => {
  const candidate = {
    id: 'fallback-1',
    source: 'live_scan',
    content: 'Join our creative community',
    attachments: [{ name: 'banner.png', url: 'https://example.test/banner.png' }],
    messages: [{ serverName: 'Art Hub', channelName: 'partners', serverId: '1', channelId: '2', messageId: '3' }],
  };

  assert.equal(queryMatchesCandidate(candidate, 'creative banner art'), true);
  assert.equal(queryMatchesCandidate(candidate, 'creative missing'), false);
  assert.equal(queryMatchesCandidate(candidate, '   '), false);
});

test('groupFallbackCandidates merges close matches with the same content and attachments', () => {
  const base = {
    source: 'live_scan',
    isFallback: true,
    content: 'Same ad',
    attachments: [{ name: 'a.png', url: 'https://example.test/a.png' }],
  };
  const grouped = groupFallbackCandidates([
    {
      ...base,
      id: 'fallback-m1',
      createdAt: '2026-01-01T00:00:00.000Z',
      messages: [{ messageId: 'm1', serverName: 'A', channelName: 'ads' }],
    },
    {
      ...base,
      id: 'fallback-m2',
      createdAt: '2026-01-01T00:10:00.000Z',
      messages: [{ messageId: 'm2', serverName: 'B', channelName: 'ads' }],
    },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, 'fallback-m1');
  assert.equal(grouped[0].messages.length, 2);
  assert.equal(grouped[0].createdAt, '2026-01-01T00:10:00.000Z');
});
