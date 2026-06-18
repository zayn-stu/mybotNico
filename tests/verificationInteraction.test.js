const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionFlagsBits } = require('discord.js');

const {
  REVIEW_ACCEPT_BUTTON_PREFIX,
  REVIEW_DENY_BUTTON_PREFIX,
} = require('../features/verification/constants');
const {
  getPendingVerification,
  getSubmission,
  resetVerificationCacheForTests,
  setVerificationDataFileForTests,
  upsertPendingVerification,
  upsertSubmission,
} = require('../features/verification/storage');
const {
  buildVerificationModal,
  buildReviewEmbed,
  canReviewVerifications,
  getQuestionsForSource,
  handleVerificationInteraction,
} = require('../features/verification/interactionHandler');

const TEST_GUILD_ID = 'socials-guild';
const TEST_USER_ID = 'user-1';

async function withVerificationState(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-state-'));
  const originalSocialsGuildId = process.env.SOCIALS_GUILD_ID;

  process.env.SOCIALS_GUILD_ID = TEST_GUILD_ID;
  setVerificationDataFileForTests(path.join(dir, 'verification.json'));

  try {
    return await fn();
  } finally {
    setVerificationDataFileForTests(null);
    resetVerificationCacheForTests();
    if (originalSocialsGuildId === undefined) {
      delete process.env.SOCIALS_GUILD_ID;
    } else {
      process.env.SOCIALS_GUILD_ID = originalSocialsGuildId;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function permissions(...allowedFlags) {
  return {
    has: flag => allowedFlags.includes(flag),
  };
}

function makeReviewInteraction({
  action = 'accept',
  submissionUserId = TEST_USER_ID,
  staffPermissions = [PermissionFlagsBits.BanMembers],
  botPermissions = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.BanMembers],
  memberFetchResult = null,
  memberFetchThrows = false,
  role = { id: '694921356206145728' },
} = {}) {
  const calls = {
    deferred: false,
    editReplies: [],
    replies: [],
    roleAdds: [],
    bans: [],
    messageEdits: [],
  };

  const member = memberFetchResult || {
    roles: {
      add: async (addedRole, reason) => calls.roleAdds.push({ role: addedRole, reason }),
    },
  };

  return {
    calls,
    interaction: {
      customId: `${action === 'accept' ? REVIEW_ACCEPT_BUTTON_PREFIX : REVIEW_DENY_BUTTON_PREFIX}${submissionUserId}`,
      user: { id: 'staff-1', tag: 'Staff#0001' },
      member: { permissions: permissions(...staffPermissions) },
      guild: {
        id: TEST_GUILD_ID,
        roles: { cache: new Map([[role.id, role]]) },
        members: {
          me: { permissions: permissions(...botPermissions) },
          fetch: async () => {
            if (memberFetchThrows) throw new Error('missing member');
            return member;
          },
          ban: async (userId, options) => calls.bans.push({ userId, options }),
        },
      },
      message: {
        edit: async payload => calls.messageEdits.push(payload),
      },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: async payload => calls.replies.push(payload),
      deferReply: async () => { calls.deferred = true; },
      editReply: async content => calls.editReplies.push(content),
    },
  };
}

test('getQuestionsForSource returns source-specific modal questions', () => {
  assert.deepEqual(
    getQuestionsForSource('new_master').map(question => question.label),
    ['Which server did you join from?']
  );
  assert.deepEqual(
    getQuestionsForSource('old_master').map(question => question.label),
    ['Which server did you join from?']
  );
  assert.deepEqual(
    getQuestionsForSource('vanity').map(question => question.label),
    ['Who invited you?']
  );
  assert.deepEqual(
    getQuestionsForSource('disboard').map(question => question.label),
    ['How did you find us?']
  );
  assert.deepEqual(
    getQuestionsForSource('unknown').map(question => question.label),
    ['Who invited you to the server?']
  );
});

test('buildVerificationModal uses the selected source questions', () => {
  const modal = buildVerificationModal(TEST_USER_ID, 'vanity').toJSON();

  assert.equal(modal.custom_id, `verification:modal:${TEST_USER_ID}`);
  assert.equal(modal.components.length, 1);
  assert.deepEqual(
    modal.components.map(row => row.components[0].label),
    ['Who invited you?']
  );
});

test('canReviewVerifications allows Ban Members or Moderate Members', () => {
  assert.equal(canReviewVerifications({ permissions: permissions(PermissionFlagsBits.BanMembers) }), true);
  assert.equal(canReviewVerifications({ permissions: permissions(PermissionFlagsBits.ModerateMembers) }), true);
  assert.equal(canReviewVerifications({ permissions: permissions(PermissionFlagsBits.ManageRoles) }), false);
});

test('buildReviewEmbed only shows the invite source label to staff', () => {
  const embed = buildReviewEmbed(
    { id: TEST_USER_ID },
    {
      source: 'new_master',
      joinedAt: Date.now(),
      accountCreatedAt: Date.now(),
      confidence: 'low',
      inviteCode: 'MZrBqxqbgB',
      inviterId: 'inviter-1',
      detectionReason: 'button_without_join_record',
    },
    [{ question: 'Which server did you join from?', answer: 'Example' }]
  ).toJSON();

  const fields = embed.fields;
  const inviteSource = fields.find(field => field.name === 'Invite Source');

  assert.equal(inviteSource.value, 'Master invite');
  assert.equal(fields.some(field => field.name === 'Invite Details'), false);
  assert.equal(JSON.stringify(fields).includes('Confidence'), false);
  assert.equal(JSON.stringify(fields).includes('MZrBqxqbgB'), false);
  assert.equal(JSON.stringify(fields).includes('button_without_join_record'), false);
});

test('accept review adds member role and closes pending verification', async () => {
  await withVerificationState(async () => {
    upsertPendingVerification(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending' });
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending', answers: [] });
    const { interaction, calls } = makeReviewInteraction();

    await handleVerificationInteraction(interaction);

    assert.equal(calls.deferred, true);
    assert.equal(calls.roleAdds.length, 1);
    assert.equal(calls.messageEdits.length, 1);
    assert.equal(getPendingVerification(TEST_GUILD_ID, TEST_USER_ID), null);
    assert.equal(getSubmission(TEST_GUILD_ID, TEST_USER_ID).status, 'accepted');
    assert.match(calls.editReplies.at(-1), /Accepted/);
  });
});

test('deny review bans member and closes pending verification', async () => {
  await withVerificationState(async () => {
    upsertPendingVerification(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending' });
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending', answers: [] });
    const { interaction, calls } = makeReviewInteraction({ action: 'deny' });

    await handleVerificationInteraction(interaction);

    assert.equal(calls.deferred, true);
    assert.deepEqual(calls.bans.map(call => call.userId), [TEST_USER_ID]);
    assert.equal(calls.messageEdits.length, 1);
    assert.equal(getPendingVerification(TEST_GUILD_ID, TEST_USER_ID), null);
    assert.equal(getSubmission(TEST_GUILD_ID, TEST_USER_ID).status, 'denied');
    assert.match(calls.editReplies.at(-1), /Denied and banned/);
  });
});

test('duplicate modal submissions are blocked while review is pending', async () => {
  await withVerificationState(async () => {
    upsertPendingVerification(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending' });
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending', answers: [] });
    const replies = [];
    const interaction = {
      customId: `verification:modal:${TEST_USER_ID}`,
      user: { id: TEST_USER_ID },
      guild: { id: TEST_GUILD_ID },
      isButton: () => false,
      isModalSubmit: () => true,
      reply: async payload => replies.push(payload),
    };

    await handleVerificationInteraction(interaction);

    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /already have a verification submission/);
  });
});

test('fresh pending rejoin can verify even with an older accepted submission', async () => {
  await withVerificationState(async () => {
    upsertPendingVerification(TEST_GUILD_ID, TEST_USER_ID, {
      status: 'pending',
      source: 'unknown',
    });
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'accepted', answers: [] });
    const replies = [];
    const modals = [];
    const interaction = {
      customId: 'verification:start',
      user: { id: TEST_USER_ID },
      member: { joinedTimestamp: Date.now() },
      guild: { id: TEST_GUILD_ID },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: async payload => replies.push(payload),
      showModal: async modal => modals.push(modal),
    };

    await handleVerificationInteraction(interaction);

    assert.equal(replies.length, 0);
    assert.equal(modals.length, 1);
  });
});

test('accepted history without current member role can verify again', async () => {
  await withVerificationState(async () => {
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'accepted', answers: [] });
    const replies = [];
    const modals = [];
    const interaction = {
      customId: 'verification:start',
      user: { id: TEST_USER_ID, createdTimestamp: Date.now() },
      member: {
        joinedTimestamp: Date.now(),
        roles: { cache: new Map() },
      },
      guild: { id: TEST_GUILD_ID },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: async payload => replies.push(payload),
      showModal: async modal => modals.push(modal),
    };

    await handleVerificationInteraction(interaction);

    assert.equal(replies.length, 0);
    assert.equal(modals.length, 1);
    assert.equal(getPendingVerification(TEST_GUILD_ID, TEST_USER_ID).status, 'pending');
  });
});

test('stale pending invite detection times out and opens verification modal', async () => {
  await withVerificationState(async () => {
    upsertPendingVerification(TEST_GUILD_ID, TEST_USER_ID, {
      status: 'pending',
      source: 'unknown',
      detectionReason: 'pending_invite_detection',
    });
    const replies = [];
    const modals = [];
    const interaction = {
      customId: 'verification:start',
      user: { id: TEST_USER_ID },
      member: { joinedTimestamp: Date.now() },
      guild: { id: TEST_GUILD_ID },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: async payload => replies.push(payload),
      showModal: async modal => modals.push(modal),
    };

    await handleVerificationInteraction(interaction);

    const pending = getPendingVerification(TEST_GUILD_ID, TEST_USER_ID);
    assert.equal(replies.length, 0);
    assert.equal(modals.length, 1);
    assert.equal(pending.detectionReason, 'invite_detection_timeout');
  });
});

test('accepted history with current member role remains blocked', async () => {
  await withVerificationState(async () => {
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'accepted', answers: [] });
    const replies = [];
    const modals = [];
    const interaction = {
      customId: 'verification:start',
      user: { id: TEST_USER_ID },
      member: {
        roles: { cache: new Map([['694921356206145728', {}]]) },
      },
      guild: { id: TEST_GUILD_ID },
      isButton: () => true,
      isModalSubmit: () => false,
      reply: async payload => replies.push(payload),
      showModal: async modal => modals.push(modal),
    };

    await handleVerificationInteraction(interaction);

    assert.equal(modals.length, 0);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /already been accepted/);
  });
});

test('review button fails safely if member already left', async () => {
  await withVerificationState(async () => {
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'review_pending', answers: [] });
    const { interaction, calls } = makeReviewInteraction({ memberFetchThrows: true });

    await handleVerificationInteraction(interaction);

    assert.equal(calls.roleAdds.length, 0);
    assert.equal(getSubmission(TEST_GUILD_ID, TEST_USER_ID).status, 'review_pending');
    assert.match(calls.editReplies.at(-1), /no longer in the server/);
  });
});

test('review button fails safely if verification was already processed', async () => {
  await withVerificationState(async () => {
    upsertSubmission(TEST_GUILD_ID, TEST_USER_ID, { status: 'accepted', answers: [] });
    const { interaction, calls } = makeReviewInteraction();

    await handleVerificationInteraction(interaction);

    assert.equal(calls.roleAdds.length, 0);
    assert.match(calls.editReplies.at(-1), /not pending review/);
  });
});
