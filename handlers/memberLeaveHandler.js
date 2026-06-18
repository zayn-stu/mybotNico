const { EmbedBuilder } = require('discord.js');
const { COLOR_NAMES } = require('../features/roles/colors');
const { isColorRole, removeRole } = require('../features/roles/storage');
const { saveColorRoleForMember } = require('../utils/memberRoleMemory');
const { markMemberLeft } = require('../features/pandas/storage');

function getMemberLeaveLogChannelId() {
  return process.env.MEMBER_LEAVE_LOG_CHANNEL_ID || null;
}

function formatDate(date) {
  if (!date) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

/**
 * When a member leaves:
 * 1. Saves their color role ID to memory so it can be re-assigned on rejoin.
 * 2. Deletes the color role from Discord and DB (since no one else has it).
 * 3. Sends a leave log embed.
 */
async function handleMemberLeave(member) {
  const guild = member.guild;

  // --- Color role handling ---
  try {
    // Find any color roles this member had
    const colorRoles = member.roles.cache.filter(r => isColorRole(r, guild));

    for (const [roleId, role] of colorRoles) {
      // Save the role ID to memory for potential rejoin restore
      saveColorRoleForMember(guild.id, member.user.id, roleId);
      console.log(`[leave] Saved color role ${roleId} for ${member.user.id}`);

      // Check if anyone else has this role
      const otherMembers = guild.members.cache.filter(
        m => m.id !== member.user.id && m.roles.cache.has(roleId)
      );

      if (otherMembers.size === 0) {
        // No one else has this role — delete it
        try {
          await role.delete(`Owner ${member.user.tag} left the server`);
          removeRole(guild.id, roleId);
          console.log(`[leave] Deleted orphaned color role ${role.name} (${roleId})`);
        } catch (err) {
          console.error(`[leave] Failed to delete color role ${roleId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[leave] Error handling color roles on member leave:', err);
  }

  // --- Panda: mark member as left (hide from leaderboard, keep data) ---
  try {
    markMemberLeft(guild.id, member.user.id);
  } catch (err) {
    console.error('[leave] Error marking panda left:', err);
  }

  // --- Leave log embed ---
  const leaveLogChannelId = getMemberLeaveLogChannelId();
  if (!leaveLogChannelId) {
    console.warn('[leave-log] No leave log channel ID is configured.');
    return;
  }

  try {
    console.log(`[leave-log] Member removed: ${member.user.username} (${member.user.id}) from guild ${guild.id}`);

    const channel = member.client.channels.cache.get(leaveLogChannelId)
      || await member.client.channels.fetch(leaveLogChannelId).catch((error) => {
        console.error(`[leave-log] Failed to fetch channel ${leaveLogChannelId}:`, error);
        return null;
      });

    if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
      console.warn(`[leave-log] Channel ${leaveLogChannelId} is missing or not sendable.`);
      return;
    }

    if (channel.guild && channel.guild.id !== guild.id) {
      console.warn(
        `[leave-log] Guild mismatch. Member guild: ${guild.id}, channel guild: ${channel.guild.id}.`
      );
      return;
    }

    const leaveEmbed = new EmbedBuilder()
      .setColor(COLOR_NAMES.crimson)
      .setTitle(`@${member.user.username} left`)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription(
        `<@${member.user.id}> has left the server.\n`
        + `Username : ${member.user.username}\n`
        + `User ID : ${member.user.id}\n`
        + `Date joined : ${formatDate(member.joinedAt)}\n`
        + `Account creation date : ${formatDate(member.user.createdAt)}`
      )
      .setTimestamp();

    await channel.send({ embeds: [leaveEmbed] });
    console.log(`[leave-log] Sent leave log for ${member.user.id} to channel ${leaveLogChannelId}`);
  } catch (error) {
    console.error('Error sending member leave log:', error);
  }
}

module.exports = { handleMemberLeave };
