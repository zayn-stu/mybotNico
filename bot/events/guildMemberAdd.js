const { addPanda, restoreMember } = require('../../features/pandas/storage');
const { detectInviter, recordInviteReward } = require('../../utils/inviteTracker');
const { addPendingReaction } = require('../../features/pandas/pendingReactions');
const { checkLastPlaceBoost } = require('../../features/pandas/lastPlaceBoost');
const { logPandaAward } = require('../../features/pandas/logger');
const { getSavedColorRole, clearSavedColorRole } = require('../../utils/memberRoleMemory');
const { recordMemberJoinVerification } = require('../../features/verification/memberJoin');

async function handleGuildMemberAdd(member, context) {
  const { trackedGuilds, socialsGuildId, pandaEmojiName } = context;
  let inviteInfo = null;
  const isTrackedGuild = trackedGuilds.includes(member.guild.id);
  const isSocialsGuild = member.guild.id === socialsGuildId;

  console.log(`[memberAdd] ${member.user.tag} joined ${member.guild.name} (${member.guild.id}). Tracked: ${isTrackedGuild}. TRACKED_GUILDS: [${trackedGuilds.join(', ')}]`);

  if (isSocialsGuild) {
    try {
      recordMemberJoinVerification(member, null, context);
    } catch (err) {
      console.error('[verification] Error creating initial pending verification:', err);
    }
  }

  // Invite tracking — all tracked guilds, plus Socials verification source detection.
  if (isTrackedGuild || isSocialsGuild) {
    try {
      inviteInfo = await detectInviter(member);
      if (isTrackedGuild && inviteInfo?.inviterId) {
        // Resolve inviter username from cache
        const inviterMember = member.guild.members.cache.get(inviteInfo.inviterId);
        const inviterUsername = inviterMember?.user?.username ?? inviteInfo.inviterId;
        const inviterDisplayName = inviterMember?.displayName || inviterUsername;
        addPanda(member.guild.id, inviteInfo.inviterId, inviterUsername, 3, inviterDisplayName);
        recordInviteReward(member.guild.id, member.user.id, inviteInfo.inviterId);
        addPendingReaction(member.guild.id, inviteInfo.inviterId, pandaEmojiName, 3, 'invite');
        logPandaAward(member.guild.id, inviteInfo.inviterId, inviterUsername, 3, 'invite');
        checkLastPlaceBoost(member.guild.id, inviteInfo.inviterId, logPandaAward);
        console.log(`[invite] ${member.user.tag} joined via invite by ${inviterUsername} (${inviteInfo.inviterId}) in ${member.guild.name} — awarded 3 pandas + queued reaction`);
      } else {
        const source = inviteInfo?.source || 'unknown';
        const confidence = inviteInfo?.confidence || 'low';
        console.log(`[invite] ${member.user.tag} joined ${member.guild.name} — no rewardable inviter detected (source: ${source}, confidence: ${confidence})`);
      }
    } catch (err) {
      console.error('[invite] Error processing invite reward:', err);
      inviteInfo = {
        source: 'unknown',
        inviteCode: null,
        inviterId: null,
        confidence: 'low',
        detectionReason: 'invite_detection_error',
      };
    }

    // Restore panda leaderboard entry (clear the left flag)
    try {
      const restored = restoreMember(member.guild.id, member.user.id);
      if (restored) console.log(`[rejoin] Restored panda entry for ${member.user.id}`);
    } catch (err) {
      console.error('[rejoin] Error restoring panda entry:', err);
    }
  }

  if (isSocialsGuild) {
    try {
      if (inviteInfo) recordMemberJoinVerification(member, inviteInfo, context);
    } catch (err) {
      console.error('[verification] Error enriching pending verification:', err);
    }
  }

  // Socials-specific: restore color role
  if (isSocialsGuild) {
    try {
      const savedRoleId = getSavedColorRole(member.guild.id, member.user.id);
      if (savedRoleId) {
        const role = member.guild.roles.cache.get(savedRoleId);
        if (role) {
          await member.roles.add(role, 'Restoring color role after rejoin');
          clearSavedColorRole(member.guild.id, member.user.id);
          console.log(`[rejoin] Restored color role ${role.name} (${savedRoleId}) for ${member.user.id}`);
        } else {
          clearSavedColorRole(member.guild.id, member.user.id);
        }
      }
    } catch (err) {
      console.error('[rejoin] Error restoring color role:', err);
    }
  }
}

module.exports = { handleGuildMemberAdd };
