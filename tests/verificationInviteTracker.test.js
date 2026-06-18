const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INVITE_SOURCES,
  classifyInviteCode,
  classifyJoinSource,
  normalizeInviteCode,
} = require('../utils/inviteTracker');

test('classifyInviteCode maps known invite codes to verification sources', () => {
  assert.equal(classifyInviteCode('TxWxQWAJbP'), INVITE_SOURCES.OLD_MASTER);
  assert.equal(classifyInviteCode('MZrBqxqbgB'), INVITE_SOURCES.NEW_MASTER);
  assert.equal(classifyInviteCode('uYddrAq9CB'), INVITE_SOURCES.DISBOARD);
});

test('classifyInviteCode treats unfamiliar codes as unknown', () => {
  assert.equal(classifyInviteCode('member-made-code'), INVITE_SOURCES.UNKNOWN);
});

test('classifyInviteCode accepts full Discord invite URLs', () => {
  assert.equal(normalizeInviteCode('https://discord.gg/MZrBqxqbgB'), 'MZrBqxqbgB');
  assert.equal(classifyInviteCode('https://discord.gg/MZrBqxqbgB'), INVITE_SOURCES.NEW_MASTER);
  assert.equal(classifyInviteCode('https://discord.com/invite/TxWxQWAJbP'), INVITE_SOURCES.OLD_MASTER);
});

test('classifyJoinSource detects normal known invite usage', () => {
  const result = classifyJoinSource([
    {
      code: 'MZrBqxqbgB',
      inviterId: 'inviter-1',
      inviterBot: false,
      channelId: 'channel-1',
      maxUses: 0,
      temporary: false,
      deleted: false,
    },
  ], false);

  assert.equal(result.source, INVITE_SOURCES.NEW_MASTER);
  assert.equal(result.inviteCode, 'MZrBqxqbgB');
  assert.equal(result.inviterId, 'inviter-1');
  assert.equal(result.confidence, 'high');
});

test('classifyJoinSource detects vanity usage', () => {
  const result = classifyJoinSource([], true);

  assert.equal(result.source, INVITE_SOURCES.VANITY);
  assert.equal(result.inviteCode, 'SN17');
  assert.equal(result.inviterId, null);
  assert.equal(result.confidence, 'high');
});

test('classifyJoinSource treats missing cache/no changes as unknown low confidence', () => {
  const result = classifyJoinSource([], false);

  assert.equal(result.source, INVITE_SOURCES.UNKNOWN);
  assert.equal(result.confidence, 'low');
  assert.equal(result.detectionReason, 'no_usage_change');
});

test('classifyJoinSource treats ambiguous invite changes as unknown low confidence', () => {
  const result = classifyJoinSource([
    { code: 'MZrBqxqbgB', inviterId: 'a' },
    { code: 'uYddrAq9CB', inviterId: 'b' },
  ], false);

  assert.equal(result.source, INVITE_SOURCES.UNKNOWN);
  assert.equal(result.confidence, 'low');
  assert.equal(result.detectionReason, 'ambiguous_usage_change');
});
