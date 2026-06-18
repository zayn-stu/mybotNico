const partnerConfig = require('../../data/partnerChannels.json');
const adSubmission = require('./adSubmissionStorage');
const broadcastHistory = require('./broadcastHistory');
const {
  getAttachmentUrls,
  getBroadcastMessagesFromResults,
} = require('./broadcastFormat');
const { fetchAllAdsMessages } = require('./adsSource');

// Fast path for owner review DMs. JSON storage remains the source of truth after restarts.
const pendingAdMessages = new Map();
const processingAdUUIDs = new Set();
const AD_EMOJI_APPROVE = '✅';
const AD_EMOJI_REJECT = '❌';

// Rate limit for show ads: userId -> [timestamp, timestamp, ...]
const showAdsUsage = new Map();
const SHOW_ADS_MAX = 3;
const SHOW_ADS_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getOwnerIDs() {
  const raw = process.env.BOT_OWNER_IDS || '';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

function isOwner(userID) {
  return getOwnerIDs().includes(userID);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function addReviewReactions(message) {
  await message.react(AD_EMOJI_APPROVE);
  await wait(1000);
  await message.react(AD_EMOJI_REJECT);
}

function buildAdBroadcastResultMessage(uuid, results) {
  const successCount = results.filter(r => r.success).length;
  let resultMsg = `✅ **Ad Approved & Broadcasted** (\`${uuid}\`)\n\n`;
  resultMsg += `**Broadcast Results:** ${successCount}/${results.length} channels\n`;
  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    resultMsg += '\n**Failures:**\n';
    for (const f of failures) {
      resultMsg += `❌ ${f.name} — ${f.error}\n`;
    }
  }
  return resultMsg;
}

async function handleShowAds(message, client) {
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

  let adsMessages;
  try {
    adsMessages = await fetchAllAdsMessages(client);
  } catch (err) {
    console.error('[showAds] Failed to fetch ads source messages:', err.message);
    await message.reply('❌ Ads are temporarily unavailable. Please try again later.');
    return;
  }

  if (!adsMessages.length) {
    await message.reply('ℹ️ No ads are currently available.');
    return;
  }

  let sentCount = 0;

  // Send each ad-channel message as a separate DM (oldest -> newest)
  for (const adMessage of adsMessages) {
    try {
      const files = [...adMessage.attachments.values()].map(a => a.url);
      const hasContent = Boolean(adMessage.content && adMessage.content.trim().length > 0);
      const hasEmbeds = adMessage.embeds.length > 0;
      const hasFiles = files.length > 0;

      if (!hasContent && !hasEmbeds && !hasFiles) continue;

      await message.author.send({
        content: hasContent ? adMessage.content : undefined,
        embeds: hasEmbeds ? adMessage.embeds : undefined,
        files: hasFiles ? files : undefined
      });
      sentCount++;
    } catch (err) {
      console.error(`[showAds] Failed to send ad message ${adMessage.id}:`, err.message);
    }
  }

  if (sentCount === 0) {
    await message.reply('ℹ️ No sendable ads were found in the ads channel.');
    return;
  }

  await message.author.send("Now use `submit` to submit your ad. Don't send the ad in the same message, you'll get a chance to send it after.");
}

async function handleSubmitCommand(message, client) {
  const userID = message.author.id;

  // ——— Guard: Already has a pending ad ———
  if (adSubmission.hasPendingAdByUser(userID)) {
    await message.reply('⏳ You already have a submission under review. Please wait for a decision before submitting another.');
    return;
  }

  const ownerIDs = getOwnerIDs();
  if (ownerIDs.length === 0) {
    await message.reply('❌ Ad review is currently unavailable. Please try again later.');
    return;
  }

  await message.reply('Send your ad after this message. (You have 60 seconds.)');

  try {
    const responses = await message.channel.awaitMessages({
      filter: m => m.author.id === userID,
      max: 1,
      time: 60000
    });

    const response = responses.first();

    if (!response) {
      await message.reply('⏳ Ad submission timed out. Send `submit` again when you\'re ready.');
      return;
    }

    // Capture content and attachments from the response message
    const adContent = response.content || '';
    const attachments = [...response.attachments.values()];

    // Don't allow empty submissions
    if (!adContent.trim() && attachments.length === 0) {
      await message.reply('❌ Your ad appears to be empty. Send `submit` to start over with content or an attachment.');
      return;
    }

    const ad = adSubmission.createAd(userID, adContent, attachments);
    const attUrls = getAttachmentUrls(attachments);
    const reviewMessages = [];

    // Forward the submission to all bot owners with reaction buttons.
    for (const ownerID of ownerIDs) {
      let forwarded;
      try {
        const ownerUser = await client.users.fetch(ownerID);
        if (!ownerUser) {
          throw new Error('Owner user not found');
        }

        let ownerMsg = `📩 **New Ad Submission**\n`;
        ownerMsg += `**From:** <@${userID}>\n`;
        ownerMsg += `**UUID:** \`${ad.uuid}\`\n`;
        if (adContent.trim()) {
          ownerMsg += `**Content:**\n${adContent}\n`;
        }

        forwarded = await ownerUser.send({
          content: ownerMsg,
          files: attUrls.length > 0 ? attUrls : undefined
        });

        await addReviewReactions(forwarded);

        const review = {
          ownerID,
          channelID: forwarded.channelId || forwarded.channel?.id,
          messageID: forwarded.id
        };
        reviewMessages.push(review);
        pendingAdMessages.set(forwarded.id, { uuid: ad.uuid });
      } catch (dmErr) {
        console.error(`[submit] Failed to forward submission to owner ${ownerID}:`, dmErr.message);
        if (forwarded) {
          pendingAdMessages.delete(forwarded.id);
          await forwarded.delete().catch(() => {});
        }
      }
    }

    if (reviewMessages.length === 0) {
      adSubmission.removePendingAd(ad.uuid);
      await message.reply('❌ I could not deliver your submission for review. Please try again later.');
      return;
    }

    adSubmission.setReviewMessages(ad.uuid, reviewMessages);

    await message.reply('✅ Your ad has been submitted for review. You\'ll be notified once a decision is made.');
  } catch (err) {
    // Timeout throws on its own, but catch any other unexpected errors
    if (err.message && err.message.includes('time')) {
      await message.reply('⏳ Ad submission timed out. Send `submit` again when you\'re ready.');
      return;
    }
    console.error('[submit] Unexpected error:', err.message);
    await message.reply('❌ Something went wrong. Please try `submit` again.');
  }
}

async function handlePendingAdsCommand(message, client) {
  const ads = adSubmission.getPendingAds();

  if (ads.length === 0) {
    await message.reply('📋 No pending ad submissions.');
    return;
  }

  const lines = ads.map((ad, i) => {
    const date = new Date(ad.createdAt).toLocaleString();
    const preview = ad.content
      ? ad.content.substring(0, 80).replace(/\n/g, ' ')
      : '(attachment only)';
    return `${i + 1}. \`${ad.uuid}\` — <@${ad.submitterUserID}> — "${preview}" — ${date}`;
  });

  const chunks = [];
  let current = `**Pending Ads (${ads.length}):**\n\n`;
  for (const line of lines) {
    if ((current + line).length > 1900) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  chunks.push(current);

  for (const chunk of chunks) {
    await message.author.send(chunk);
  }
}

async function handleCancelAdCommand(message, client, args) {
  if (args.length === 0) {
    await message.reply('Usage: cancelad {UUID}');
    return;
  }

  const uuid = args[0];

  const existing = adSubmission.getPendingAdByUUID(uuid);
  if (!existing) {
    await message.reply(`❌ No pending ad found with UUID \`${uuid}\`.`);
    return;
  }

  // Try to DM the submitter that their ad was cancelled
  try {
    const submitter = await client.users.fetch(existing.submitterUserID);
    if (submitter) {
      await submitter.send('❌ Your ad submission has been cancelled by the owner without a decision.');
    }
  } catch {
    // DM may fail (user closed DMs, etc.) — still cancel the ad
  }

  adSubmission.removePendingAd(uuid);
  await message.reply(`✅ Ad \`${uuid}\` (by <@${existing.submitterUserID}>) has been cancelled.`);
}

async function handleAdReaction(reaction, user, client) {
  if (user.bot) return false;

  try {
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    console.error('[submit] Failed to fetch partial reaction/message:', err.message);
    return false;
  }

  // Only process tracked messages in DM channels
  const channel = reaction.message.channel;
  if (!channel?.isDMBased?.()) return false;

  // Only BOT_OWNER_IDS can trigger approve/reject via reactions
  if (!isOwner(user.id)) return false;

  const emoji = reaction.emoji.name;
  const isApproval = emoji === AD_EMOJI_APPROVE;
  const isRejection = emoji === AD_EMOJI_REJECT;

  if (!isApproval && !isRejection) return false;

  const messageID = reaction.message.id;
  const channelID = reaction.message.channelId || channel.id;
  const cachedReview = pendingAdMessages.get(messageID);
  let ad = cachedReview?.uuid ? adSubmission.getPendingAdByUUID(cachedReview.uuid) : null;
  if (!ad) {
    ad = adSubmission.getPendingAdByReviewMessage(messageID, channelID);
  }

  if (!ad) {
    pendingAdMessages.delete(messageID);
    return false;
  }

  const uuid = ad.uuid;
  if (processingAdUUIDs.has(uuid)) return true;
  processingAdUUIDs.add(uuid);

  try {
    // Re-read before processing in case another reaction/cancel handled it first.
    ad = adSubmission.getPendingAdByUUID(uuid);
    if (!ad) {
      pendingAdMessages.delete(messageID);
      await reaction.message.react('⚠️').catch(() => {});
      return true;
    }

    const { submitterUserID, content } = ad;
    const attachmentUrls = getAttachmentUrls(ad.attachments);

  if (isApproval) {
    // DM the submitter
    try {
      const submitter = await client.users.fetch(submitterUserID);
      if (submitter) {
        await submitter.send('✅ Your ad has been **approved** and broadcasted to all partner servers!');
      }
    } catch {
      // DM may fail
    }

    // Broadcast to all partner channels using existing logic
    const broadcastContent = content || '(ad with attachments)';
    const broadcastPromises = partnerConfig.channels.map(async (partner) => {
      const serverName = partner.name;
      let channelName = 'Unknown Channel';
      try {
        const channel = await client.channels.fetch(partner.channelId);
        if (!channel) {
          return { name: serverName, success: false, error: 'Channel not found' };
        }
        if (channel.name) channelName = channel.name;
        const sentMessage = await channel.send({
          content: broadcastContent,
          files: attachmentUrls.length > 0 ? attachmentUrls : undefined
        });
        return {
          name: serverName,
          serverId: partner.serverId,
          channelName,
          channelId: partner.channelId,
          success: true,
          sentMessage
        };
      } catch (err) {
        return {
          name: serverName,
          serverId: partner.serverId,
          channelName,
          channelId: partner.channelId,
          success: false,
          error: err.message
        };
      }
    });

    const results = await Promise.all(broadcastPromises);
    broadcastHistory.recordBroadcast({
      source: 'approved_ad',
      authorID: submitterUserID,
      content: broadcastContent,
      attachments: attachmentUrls,
      messages: getBroadcastMessagesFromResults(results)
    });

    await reaction.message.reply(buildAdBroadcastResultMessage(uuid, results)).catch(() => {});
    adSubmission.removePendingAd(uuid);
  } else {
    // Rejection
    // DM the submitter
    try {
      const submitter = await client.users.fetch(submitterUserID);
      if (submitter) {
        await submitter.send('❌ Your ad has been **rejected** and will not be broadcasted.');
      }
    } catch {
      // DM may fail
    }

    await reaction.message.reply(`❌ **Ad Rejected** (\`${uuid}\`)`).catch(() => {});
    adSubmission.removePendingAd(uuid);
  }

  // Clean up tracking
    for (const review of ad.reviewMessages) {
      pendingAdMessages.delete(review.messageID);
    }
    pendingAdMessages.delete(messageID);
    return true;
  } finally {
    processingAdUUIDs.delete(uuid);
  }
}

module.exports = {
  handleShowAds,
  handleSubmitCommand,
  handlePendingAdsCommand,
  handleCancelAdCommand,
  handleAdReaction,
  buildAdBroadcastResultMessage,
};
