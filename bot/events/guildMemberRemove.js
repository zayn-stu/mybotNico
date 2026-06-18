const { deductPandas } = require('../../features/pandas/storage');
const { getDeductionInfo, removeRewardEntry } = require('../../utils/inviteTracker');
const { logPandaAward } = require('../../features/pandas/logger');
const { handleMemberLeave } = require('../../handlers/memberLeaveHandler');

async function handleGuildMemberRemove(member, context) {
  const { trackedGuilds, socialsGuildId } = context;

  // Deduct invite pandas if member leaves within 30 days (all tracked guilds)
  if (trackedGuilds.includes(member.guild.id)) {
    const deductInfo = getDeductionInfo(member.guild.id, member.user.id);
    if (deductInfo) {
      deductPandas(member.guild.id, deductInfo.inviterId, 3);
      removeRewardEntry(member.guild.id, member.user.id);
      logPandaAward(member.guild.id, deductInfo.inviterId, deductInfo.inviterId, -3, 'invite-leave');
      console.log(`[invite] ${member.user.tag} left within 30 days — deducted 3 pandas from ${deductInfo.inviterId}`);
    }
  }

  // Leave logging — Socials only
  if (member.guild.id === socialsGuildId) {
    await handleMemberLeave(member);
  }
}

module.exports = { handleGuildMemberRemove };
