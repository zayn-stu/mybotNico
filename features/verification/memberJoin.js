const { INVITE_SOURCES } = require('../../utils/inviteTracker');
const { upsertPendingVerification } = require('./storage');

function buildPendingVerificationRecord(member, inviteInfo = null) {
  return {
    guildId: member.guild.id,
    userId: member.user.id,
    joinedAt: member.joinedTimestamp || Date.now(),
    accountCreatedAt: member.user.createdTimestamp || null,
    source: inviteInfo?.source || INVITE_SOURCES.UNKNOWN,
    inviteCode: inviteInfo?.inviteCode || null,
    inviterId: inviteInfo?.inviterId || null,
    confidence: inviteInfo?.confidence || 'low',
    detectionReason: inviteInfo?.detectionReason || 'pending_invite_detection',
    channelId: inviteInfo?.channelId || null,
    maxUses: inviteInfo?.maxUses ?? null,
    temporary: Boolean(inviteInfo?.temporary),
    status: 'pending',
    createdAt: Date.now(),
  };
}

function recordMemberJoinVerification(member, inviteInfo, context) {
  if (!context.socialsGuildId || member.guild.id !== context.socialsGuildId) return null;

  const record = buildPendingVerificationRecord(member, inviteInfo);
  upsertPendingVerification(member.guild.id, member.user.id, record);
  console.log(`[verification] Stored pending verification for ${member.user.id} (${record.source}, ${record.confidence})`);
  return record;
}

module.exports = {
  buildPendingVerificationRecord,
  recordMemberJoinVerification,
};
