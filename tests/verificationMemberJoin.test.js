const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getPendingVerification,
  resetVerificationCacheForTests,
  setVerificationDataFileForTests,
} = require('../features/verification/storage');
const {
  resetInviteCachesForTests,
  setInviteSnapshotFileForTests,
  setInviteCachesForTests,
} = require('../utils/inviteTracker');
const { handleGuildMemberAdd } = require('../bot/events/guildMemberAdd');

const TEST_GUILD_ID = 'socials-guild';
const TEST_USER_ID = 'user-join';

async function withVerificationState(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-join-'));
  setVerificationDataFileForTests(path.join(dir, 'verification.json'));
  setInviteSnapshotFileForTests(path.join(dir, 'inviteSnapshots.json'));

  try {
    return await fn();
  } finally {
    setVerificationDataFileForTests(null);
    setInviteSnapshotFileForTests(null);
    resetVerificationCacheForTests();
    resetInviteCachesForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeMember(invitesFetch = async () => []) {
  return {
    joinedTimestamp: 1780688747544,
    user: {
      id: TEST_USER_ID,
      tag: 'JoinUser#0001',
      createdTimestamp: 1756798671692,
    },
    guild: {
      id: TEST_GUILD_ID,
      name: 'Socials',
      members: { cache: new Map() },
      roles: { cache: new Map() },
      invites: {
        fetch: invitesFetch,
      },
      fetchVanityData: async () => null,
    },
  };
}

test('Socials member join stores pending verification before invite tracking is required', async () => {
  await withVerificationState(async () => {
    const originalError = console.error;
    console.error = () => {};

    try {
      await handleGuildMemberAdd(makeMember(), {
        trackedGuilds: [],
        socialsGuildId: TEST_GUILD_ID,
        pandaEmojiName: 'panda',
      });
    } finally {
      console.error = originalError;
    }

    const pending = getPendingVerification(TEST_GUILD_ID, TEST_USER_ID);
    assert.equal(pending.userId, TEST_USER_ID);
    assert.equal(pending.status, 'pending');
  });
});

test('Socials member join enriches verification source even if guild is not tracked for rewards', async () => {
  await withVerificationState(async () => {
    setInviteCachesForTests(TEST_GUILD_ID, new Map([
      ['MZrBqxqbgB', {
        code: 'MZrBqxqbgB',
        uses: 10,
        inviterId: 'inviter-1',
        inviterBot: false,
      }],
    ]));

    const currentInvites = [
      {
        code: 'MZrBqxqbgB',
        uses: 11,
        inviter: { id: 'inviter-1', bot: false },
      },
    ];

    await handleGuildMemberAdd(makeMember(async () => currentInvites), {
      trackedGuilds: [],
      socialsGuildId: TEST_GUILD_ID,
      pandaEmojiName: 'panda',
    });

    const pending = getPendingVerification(TEST_GUILD_ID, TEST_USER_ID);
    assert.equal(pending.source, 'new_master');
    assert.equal(pending.inviteCode, 'MZrBqxqbgB');
  });
});

test('Socials member join clears pending invite detection if invite fetch hangs', async () => {
  await withVerificationState(async () => {
    await handleGuildMemberAdd(makeMember(() => new Promise(() => {})), {
      trackedGuilds: [],
      socialsGuildId: TEST_GUILD_ID,
      pandaEmojiName: 'panda',
    });

    const pending = getPendingVerification(TEST_GUILD_ID, TEST_USER_ID);
    assert.equal(pending.source, 'unknown');
    assert.equal(pending.detectionReason, 'missing_cache');
  });
});

test('Socials member join detects master invite even if vanity fetch hangs', async () => {
  await withVerificationState(async () => {
    setInviteCachesForTests(TEST_GUILD_ID, new Map([
      ['MZrBqxqbgB', {
        code: 'MZrBqxqbgB',
        uses: 7,
        inviterId: 'inviter-1',
        inviterBot: false,
      }],
    ]));

    const member = makeMember(async () => [
      {
        code: 'MZrBqxqbgB',
        uses: 8,
        inviter: { id: 'inviter-1', bot: false },
      },
    ]);
    member.guild.fetchVanityData = async () => new Promise(() => {});

    await handleGuildMemberAdd(member, {
      trackedGuilds: [],
      socialsGuildId: TEST_GUILD_ID,
      pandaEmojiName: 'panda',
    });

    const pending = getPendingVerification(TEST_GUILD_ID, TEST_USER_ID);
    assert.equal(pending.source, 'new_master');
    assert.equal(pending.inviteCode, 'MZrBqxqbgB');
  });
});
