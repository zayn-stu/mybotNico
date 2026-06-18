const { handleAdReaction, handleBroadcastDeleteReaction } = require('../../features/partners/handler');
const { findActiveGiveawayByMessage } = require('../../features/giveaways/storage');

async function handleMessageReactionAdd(reaction, user, context) {
  const { client } = context;

  // Ignore bots
  if (user.bot) return;

  // Check ad approve/reject reactions first (handles ✅ and ❌ on owner DM messages)
  await handleAdReaction(reaction, user, client);
  await handleBroadcastDeleteReaction(reaction, user, client);

  // Ignore non-🎉 reactions for giveaway processing
  if (reaction.emoji.name !== '🎉') return;

  try {
    // Find active giveaway by message ID
    const giveaway = findActiveGiveawayByMessage(reaction.message.guildId, reaction.message.id);
    if (!giveaway) return;

    // Fetch member to check roles
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    // Check eligibility: member must have at least one allowed role
    const hasEligibleRole = giveaway.allowRoleIds.length === 0 || 
      giveaway.allowRoleIds.some(roleId => member.roles.cache.has(roleId));

    if (!hasEligibleRole) {
      // Remove ineligible reaction
      await reaction.users.remove(user.id).catch(() => null);

      // Build role list for DM
      const roleNames = giveaway.allowRoleIds
        .map(roleId => {
          const role = reaction.message.guild.roles.cache.get(roleId);
          return role ? `@${role.name}` : `Unknown Role (${roleId})`;
        })
        .join(', ');

      // Attempt to DM user
      try {
        await user.send(
          `❌ You don't have the required role(s) to enter this giveaway.\n\n` +
          `**Required Roles:** ${roleNames}\n\n` +
          `To enter, you need at least one of these roles.`
        );
      } catch (dmErr) {
        // DM failed silently
        console.log(`[giveaway] Could not DM ${user.tag} about ineligibility (DMs closed)`);
      }

      console.log(`[giveaway] Removed ineligible reaction from ${user.tag} on giveaway ${giveaway.id}`);
    }
  } catch (err) {
    console.error('[giveaway] Error handling reaction add:', err);
  }
}

module.exports = { handleMessageReactionAdd };
