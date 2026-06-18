const partnerConfig = require('../../data/partnerChannels.json');
const { startTimer, endTimer } = require('../../utils/perfMetrics');
const broadcastHistory = require('./broadcastHistory');
const { getBroadcastMessagesFromResults } = require('./broadcastFormat');

function getOwnerIDs() {
  const raw = process.env.BOT_OWNER_IDS || '';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

function buildDirectBroadcastConfirmation(results, wasSanitized, broadcastDuration, fetchTimes, sendTimes) {
  const successCount = results.filter(r => r.success).length;
  const avgFetchTime = fetchTimes.length > 0
    ? (fetchTimes.reduce((a, b) => a + b, 0) / fetchTimes.length).toFixed(2)
    : '0.00';
  const avgSendTime = sendTimes.length > 0
    ? (sendTimes.reduce((a, b) => a + b, 0) / sendTimes.length).toFixed(2)
    : '0.00';

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

  confirmationMsg += `\n**Total:** ${successCount}/${results.length} channels`;
  confirmationMsg += `\n⏱️ ${broadcastDuration}ms | fetch avg: ${avgFetchTime}ms | send avg: ${avgSendTime}ms`;
  return confirmationMsg;
}

async function handleDirectBroadcast(message, client, content, wasSanitized) {
  const results = [];
  const broadcastStartTime = startTimer();

  // Send to all partner channels in parallel
  const channelPromises = partnerConfig.channels.map(async (partner) => {
    const serverName = partner.name;
    let channelName = 'Unknown Channel';
    let fetchDuration = 0;
    let sendDuration = 0;

    try {
      // Time the fetch operation
      const fetchStartTime = startTimer();
      const channel = await client.channels.fetch(partner.channelId);
      fetchDuration = parseFloat(endTimer(fetchStartTime));

      if (!channel) {
        return {
          result: {
            name: serverName,
            channelName,
            success: false,
            error: 'Channel not found'
          },
          fetchDuration,
          sendDuration
        };
      }

      if (channel.name) channelName = channel.name;

      // Time the send operation
      const sendStartTime = startTimer();
      const sentMessage = await channel.send(content);
      sendDuration = parseFloat(endTimer(sendStartTime));

      return {
        result: {
          name: serverName,
          serverId: partner.serverId,
          channelName,
          channelId: partner.channelId,
          success: true,
          sentMessage
        },
        fetchDuration,
        sendDuration
      };
    } catch (err) {
      return {
        result: {
          name: serverName,
          serverId: partner.serverId,
          channelName,
          channelId: partner.channelId,
          success: false,
          error: err.message
        },
        fetchDuration,
        sendDuration
      };
    }
  });

  // Wait for all broadcasts to complete
  const broadcasts = await Promise.all(channelPromises);

  // Extract results and timing data
  const fetchTimes = [];
  const sendTimes = [];
  broadcasts.forEach(broadcast => {
    results.push(broadcast.result);
    if (broadcast.fetchDuration > 0) fetchTimes.push(broadcast.fetchDuration);
    if (broadcast.sendDuration > 0) sendTimes.push(broadcast.sendDuration);
  });

  // Forward successful sends to all bot owners
  const ownerIDs = getOwnerIDs();
  const successfulResults = broadcasts.filter(b => b.result.success);
  const successfulBroadcastResults = successfulResults.map(b => b.result);

  broadcastHistory.recordBroadcast({
    source: 'direct',
    authorID: message.author.id,
    content,
    attachments: [],
    messages: getBroadcastMessagesFromResults(successfulBroadcastResults)
  });

  console.log(`[DIRECT BROADCAST FORWARD] ownerIDs: ${ownerIDs.join(', ')}, successfulResults: ${successfulResults.length}`);

  if (successfulResults.length > 0 && ownerIDs.length > 0) {
    for (const ownerID of ownerIDs) {
      try {
        console.log(`[DIRECT BROADCAST FORWARD] Attempting to forward to owner ${ownerID}`);
        const owner = await client.users.fetch(ownerID);
        if (owner) {
          console.log(`[DIRECT BROADCAST FORWARD] Fetched owner user, creating DM channel`);
          // Create/fetch DM channel with owner
          const dmChannel = await owner.createDM();
          console.log(`[DIRECT BROADCAST FORWARD] DM channel created: ${dmChannel.id}`);
          console.log(`[DIRECT BROADCAST FORWARD] Now forwarding ${successfulResults.length} messages`);

          // Forward each message to DM channel
          for (let i = 0; i < successfulResults.length; i++) {
            const result = successfulResults[i];
            console.log(`[DIRECT BROADCAST FORWARD] Processing result ${i + 1}/${successfulResults.length}`);
            console.log(`[DIRECT BROADCAST FORWARD] Channel: ${result.result.name}, has sentMessage: ${!!result.result.sentMessage}, messageId: ${result.result.sentMessage?.id}`);
            try {
              console.log(`[DIRECT BROADCAST FORWARD] Forwarding message ${i + 1}/${successfulResults.length}`);
              const forwarded = await result.result.sentMessage.forward(dmChannel);
              console.log(`[DIRECT BROADCAST FORWARD] Successfully forwarded message ${i + 1}, new messageId: ${forwarded.id}`);
            } catch (forwardErr) {
              console.error(`[DIRECT BROADCAST FORWARD] Failed to forward message ${i + 1} from ${result.result.name}:`, forwardErr.message);
              console.error(`[DIRECT BROADCAST FORWARD] Full error:`, forwardErr);
            }
          }
        }
      } catch (err) {
        console.error(`[DIRECT BROADCAST FORWARD] Error in owner DM loop:`, err.message);
      }
    }
  } else {
    console.log(`[DIRECT BROADCAST FORWARD] Skipping forwarding - successfulResults: ${successfulResults.length}, ownerIDs: ${ownerIDs.length}`);
  }

  // Build confirmation message
  const broadcastDuration = endTimer(broadcastStartTime);
  const confirmationMsg = buildDirectBroadcastConfirmation(
    results,
    wasSanitized,
    broadcastDuration,
    fetchTimes,
    sendTimes
  );

  // Send confirmation back to user
  await message.reply(confirmationMsg);
}

module.exports = {
  handleDirectBroadcast,
  buildDirectBroadcastConfirmation,
};
