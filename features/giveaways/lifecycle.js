const { EmbedBuilder } = require('discord.js');
const { getAllActiveGiveaways, markGiveawayEnded } = require('./storage');

/**
 * In-memory lock set to prevent concurrent processing of the same giveaway.
 * Keys are strings: "{guildId}:{giveawayMessageId}"
 */
const processingLocks = new Set();

/**
 * Start the giveaway auto-end scheduler.
 * Runs every 30 seconds. First tick fires immediately on call.
 * @param {import('discord.js').Client} client
 */
function startGiveawayScheduler(client) {
  const TICK_INTERVAL_MS = 30_000;

  async function tick() {
    try {
      const activeGiveaways = getAllActiveGiveaways();
      const now = Date.now();

      const expired = activeGiveaways.filter(ga => ga.endAtMs <= now);

      for (const giveaway of expired) {
        const lockKey = `${giveaway.guildId}:${giveaway.giveawayMessageId}`;

        // If locked, skip
        if (processingLocks.has(lockKey)) continue;

        // Lock immediately
        processingLocks.add(lockKey);

        try {
          await endGiveaway(client, giveaway);
        } catch (err) {
          console.error(`[giveaway] Error ending giveaway ${giveaway.id}:`, err);
        } finally {
          // Always release lock
          processingLocks.delete(lockKey);
        }
      }
    } catch (err) {
      console.error('[giveaway] Scheduler tick error:', err);
    }
  }

  // Fire immediately on startup to catch any that expired while offline
  tick().catch(err => console.error('[giveaway] Initial tick failed:', err));

  // Then every 30 seconds
  const interval = setInterval(tick, TICK_INTERVAL_MS);
  return interval;
}

/**
 * End a single giveaway: draw winners, edit message, persist.
 * @param {import('discord.js').Client} client
 * @param {Object} giveaway - Giveaway object from getAllActiveGiveaways
 */
async function endGiveaway(client, giveaway) {
  const guild = client.guilds.cache.get(giveaway.guildId);
  if (!guild) {
    console.warn(`[giveaway] Guild ${giveaway.guildId} not cached — skipping giveaway ${giveaway.id}`);
    return;
  }

  const channel = guild.channels.cache.get(giveaway.channelId);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[giveaway] Channel ${giveaway.channelId} not found or not text-based — skipping giveaway ${giveaway.id}`);
    return;
  }

  // Fetch the giveaway message
  let giveawayMessage;
  try {
    giveawayMessage = await channel.messages.fetch(giveaway.giveawayMessageId);
  } catch (err) {
    console.warn(`[giveaway] Message ${giveaway.giveawayMessageId} not found — skipping giveaway ${giveaway.id} (status will remain active until cleanup)`);
    return;
  }

  // Fetch 🎉 reaction users
  const reaction = giveawayMessage.reactions.cache.get('🎉');
  if (!reaction) {
    // No reactions at all — end with no winners
    await finishGiveaway({
      client,
      guild,
      giveaway,
      giveawayMessage,
      winnerUserIds: [],
    });
    return;
  }

  // Fetch all users who reacted with 🎉
  let reactionUsers;
  try {
    reactionUsers = await reaction.users.fetch();
  } catch (err) {
    console.error(`[giveaway] Failed to fetch reaction users for giveaway ${giveaway.id}:`, err);
    return;
  }

  // Filter out bots
  const entrants = reactionUsers.filter(u => !u.bot);

  if (entrants.size === 0) {
    await finishGiveaway({
      client,
      guild,
      giveaway,
      giveawayMessage,
      winnerUserIds: [],
    });
    return;
  }

  // Fetch member for each entrant, re-validate allowRoleIds
  const eligibleMembers = [];

  for (const [userId, user] of entrants) {
    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch (err) {
      // Member left the guild
      continue;
    }

    if (!member) continue;

    // Check role eligibility
    if (giveaway.allowRoleIds && giveaway.allowRoleIds.length > 0) {
      const hasEligibleRole = giveaway.allowRoleIds.some(roleId =>
        member.roles.cache.has(roleId)
      );
      if (!hasEligibleRole) continue;
    }

    eligibleMembers.push({ userId, member });
  }

  // Dedupe by userId (should already be unique from reaction.users, but be safe)
  const uniqueEligible = [];
  const seenIds = new Set();
  for (const entry of eligibleMembers) {
    if (!seenIds.has(entry.userId)) {
      seenIds.add(entry.userId);
      uniqueEligible.push(entry);
    }
  }

  // Pick winners
  let winnerUserIds;
  if (uniqueEligible.length === 0) {
    winnerUserIds = [];
  } else if (uniqueEligible.length <= giveaway.winnerCount) {
    // Fewer eligible entrants than winner count — all eligible win
    winnerUserIds = uniqueEligible.map(e => e.userId);
  } else {
    // Randomly pick winnerCount winners
    const shuffled = [...uniqueEligible].sort(() => Math.random() - 0.5);
    winnerUserIds = shuffled.slice(0, giveaway.winnerCount).map(e => e.userId);
  }

  await finishGiveaway({
    client,
    guild,
    giveaway,
    giveawayMessage,
    winnerUserIds,
  });
}

/**
 * Finalize the giveaway: edit the message and persist.
 * @param {Object} params
 * @param {import('discord.js').Client} params.client
 * @param {import('discord.js').Guild} params.guild
 * @param {Object} params.giveaway
 * @param {import('discord.js').Message} params.giveawayMessage
 * @param {string[]} params.winnerUserIds
 */
async function finishGiveaway({ guild, giveaway, giveawayMessage, winnerUserIds }) {
  const endedAtMs = Date.now();

  // Build ended embed
  const endUnixSeconds = Math.floor(giveaway.endAtMs / 1000);

  const endedEmbed = new EmbedBuilder()
    .setTitle('🎉 Giveaway Ended')
    .setColor(0x808080)
    .addFields(
      { name: 'Prize', value: giveaway.prize, inline: false },
      { name: 'Winners', value: winnerUserIds.length > 0
        ? winnerUserIds.map(id => `<@${id}>`).join(', ')
        : 'No valid entrants',
        inline: false
      },
      { name: 'Total Entrants', value: `${winnerUserIds.length > 0 ? 'N/A' : '0'}`, inline: true },
      { name: 'Ended', value: `<t:${endUnixSeconds}:R>`, inline: true }
    )
    .setFooter({ text: 'Giveaway has ended' });

  // Edit the giveaway message
  try {
    await giveawayMessage.edit({ embeds: [endedEmbed] });
  } catch (err) {
    console.error(`[giveaway] Failed to edit ended giveaway message ${giveaway.giveawayMessageId}:`, err);
  }

  // If there are winners, send a congratulatory message
  if (winnerUserIds.length > 0) {
    try {
      await giveawayMessage.reply({
        content: `🎉 Congratulations ${winnerUserIds.map(id => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`,
      });
    } catch (err) {
      console.error(`[giveaway] Failed to send winner message for giveaway ${giveaway.id}:`, err);
    }
  } else {
    try {
      await giveawayMessage.reply({
        content: '😞 No eligible entrants — no winners this time.',
      });
    } catch (err) {
      console.error(`[giveaway] Failed to send no-winners message for giveaway ${giveaway.id}:`, err);
    }
  }

  // Persist ended state
  markGiveawayEnded(guild.id, giveaway.id, endedAtMs, winnerUserIds);

  console.log(`[giveaway] Ended giveaway ${giveaway.id} in guild ${guild.id} — ${winnerUserIds.length} winner(s)`);
}

module.exports = { startGiveawayScheduler };
