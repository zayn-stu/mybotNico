const partnerConfig = require('../data/partnerChannels.json');

// Store last sent message IDs for each channel (for deletion feature)
// Structure: { channelId: [messageId1, messageId2, ...] }
const lastSentMessages = {};

/**
 * Handles DM messages for the partnership broadcast feature.
 * Only processes DMs from the authorized user.
 * Broadcasts the message to all configured partner channels.
 */
async function handlePartnerDM(message, client) {
  // Only process DMs (no guild means it's a DM)
  if (message.guild) return false;
  
  // Only process messages from the authorized user
  if (message.author.id !== partnerConfig.authorizedUserId) return false;
  
  // Ignore bot messages
  if (message.author.bot) return false;

  const content = message.content;
  
  // Don't process empty messages
  if (!content || content.trim().length === 0) {
    await message.reply('❌ Cannot broadcast an empty message.');
    return true;
  }

  // Handle "Delete last" command
  if (content.toLowerCase() === 'delete last') {
    await handleDeleteLast(message, client);
    return true;
  }

  const results = [];

  // Send to all partner channels
  for (const partner of partnerConfig.channels) {
    try {
      const channel = await client.channels.fetch(partner.channelId);
      
      if (!channel) {
        results.push({
          name: partner.name,
          success: false,
          error: 'Channel not found'
        });
        continue;
      }

      // Send the message content exactly as received (preserves formatting)
      const sentMessage = await channel.send(content);
      
      // Store message ID for potential deletion (keep last 3 per channel)
      if (!lastSentMessages[partner.channelId]) {
        lastSentMessages[partner.channelId] = [];
      }
      lastSentMessages[partner.channelId].push(sentMessage.id);
      // Keep only the last 3 messages per channel
      if (lastSentMessages[partner.channelId].length > 3) {
        lastSentMessages[partner.channelId].shift();
      }
      
      results.push({
        name: partner.name,
        success: true
      });
    } catch (err) {
      results.push({
        name: partner.name,
        success: false,
        error: err.message
      });
    }
  }

  // Build confirmation message
  let confirmationMsg = '**Partnership Broadcast Results:**\n\n';
  
  for (const result of results) {
    if (result.success) {
      confirmationMsg += `✅ **${result.name}** - Sent successfully\n`;
    } else {
      confirmationMsg += `❌ **${result.name}** - Failed: ${result.error}\n`;
    }
  }

  const successCount = results.filter(r => r.success).length;
  confirmationMsg += `\n**Total:** ${successCount}/${results.length} channels`;

  // Send confirmation back to user
  await message.reply(confirmationMsg);
  
  return true;
}

/**
 * Handles the "Delete last" command.
 * Deletes the last 3 messages the bot sent to each partner channel.
 */
async function handleDeleteLast(message, client) {
  const results = [];
  let totalDeleted = 0;

  for (const partner of partnerConfig.channels) {
    try {
      const channel = await client.channels.fetch(partner.channelId);
      
      if (!channel) {
        results.push({
          name: partner.name,
          success: false,
          deleted: 0,
          error: 'Channel not found'
        });
        continue;
      }

      const messageIds = lastSentMessages[partner.channelId] || [];
      let deletedCount = 0;

      // Delete stored messages
      for (const msgId of messageIds) {
        try {
          const msg = await channel.messages.fetch(msgId);
          await msg.delete();
          deletedCount++;
        } catch (err) {
          // Message may already be deleted or not found
          console.log(`Could not delete message ${msgId}: ${err.message}`);
        }
      }

      // Clear stored messages for this channel
      lastSentMessages[partner.channelId] = [];
      totalDeleted += deletedCount;

      results.push({
        name: partner.name,
        success: true,
        deleted: deletedCount
      });
    } catch (err) {
      results.push({
        name: partner.name,
        success: false,
        deleted: 0,
        error: err.message
      });
    }
  }

  // Send simple confirmation
  await message.reply(`Deleted last messages (${totalDeleted} total)`);
}

module.exports = { handlePartnerDM };
