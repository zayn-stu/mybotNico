const fs = require('fs');
const path = require('path');
const partnerConfig = require('../data/partnerChannels.json');

// Store last sent message IDs for each channel (for deletion feature)
const lastSentMessages = {};

// Rate limit for !show ads: userId -> [timestamp, timestamp, ...]
const showAdsUsage = new Map();
const SHOW_ADS_MAX = 3;
const SHOW_ADS_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Checks if a user shares at least one guild with the bot (from the 6 partner servers).
 */
async function hasSharedGuild(client, userId) {
  for (const partner of partnerConfig.channels) {
    const guild = client.guilds.cache.get(partner.serverId);
    if (!guild) continue;
    try {
      await guild.members.fetch(userId);
      return true;
    } catch { continue; }
  }
  return false;
}

/**
 * Handles the !show ads command in DMs.
 */
async function handleShowAds(message, client) {
  // Check mutual server
  const shared = await hasSharedGuild(client, message.author.id);
  if (!shared) {
    await message.reply('❌ You must be in one of our servers to use this.');
    return;
  }

  // Rate limit
  const now = Date.now();
  const usage = (showAdsUsage.get(message.author.id) || []).filter(t => now - t < SHOW_ADS_WINDOW_MS);
  if (usage.length >= SHOW_ADS_MAX) {
    const oldest = usage[0];
    const resetIn = Math.ceil((oldest + SHOW_ADS_WINDOW_MS - now) / 60000);
    await message.reply(`⏳ You can only use this ${SHOW_ADS_MAX} times per hour. Try again in ~${resetIn} min.`);
    return;
  }
  usage.push(now);
  showAdsUsage.set(message.author.id, usage);

  // Send each ad as a separate message
  for (const partner of partnerConfig.channels) {
    if (!partner.adFile) continue;
    try {
      const adPath = path.join(__dirname, '../data/ads', partner.adFile);
      const adText = fs.readFileSync(adPath, 'utf-8');
      await message.author.send(adText);
    } catch (err) {
      console.error(`[showAds] Failed to send ad for ${partner.name}:`, err.message);
    }
  }
}

/**
 * Handles DM messages: !show ads for anyone, broadcast for owner.
 */
async function handlePartnerDM(message, client) {
  if (message.guild) return false;
  if (message.author.bot) return false;

  // !show ads — available to anyone with a mutual server
  if (message.content.trim().toLowerCase() === '!show ads') {
    await handleShowAds(message, client);
    return true;
  }

  // Everything below is owner-only broadcast
  const authorizedUserId = process.env.PARTNER_AUTHORIZED_USER_ID;
  if (!authorizedUserId || message.author.id !== authorizedUserId) return false;

  // Strip @everyone and @here to prevent mass pings in partner servers
  const rawContent = message.content;
  const content = rawContent.replace(/@everyone/gi, 'everyone').replace(/@here/gi, 'here');
  const wasSanitized = content !== rawContent;

  // Don't process empty messages
  if (!content || content.trim().length === 0) {
    await message.reply('❌ Cannot broadcast an empty message.');
    return true;
  }

  // Handle "Delete last" command
  if (rawContent.toLowerCase() === 'delete last') {
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
  if (wasSanitized) {
    confirmationMsg += '⚠️ `@everyone` / `@here` was removed from your message before broadcasting.\n\n';
  }
  
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
