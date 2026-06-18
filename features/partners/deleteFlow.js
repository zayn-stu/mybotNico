const partnerConfig = require('../../data/partnerChannels.json');
const { startTimer, endTimer } = require('../../utils/perfMetrics');
const broadcastHistory = require('./broadcastHistory');
const pendingBroadcastDeletes = require('./pendingBroadcastDeletes');
const {
  truncateText,
  formatBroadcastPreview,
  formatDeleteResult,
  getMessageAttachments,
  queryMatchesCandidate,
  groupFallbackCandidates,
} = require('./broadcastFormat');

const DELETE_PAGE_SIZE = 9;
const FALLBACK_SCAN_LIMIT_PER_CHANNEL = 30;
const DELETE_NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const DELETE_PREV_EMOJI = '◀️';
const DELETE_NEXT_EMOJI = '▶️';
const DELETE_APPROVE_EMOJI = '✅';
const DELETE_REJECT_EMOJI = '❌';

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

async function addDeleteConfirmationReactions(message) {
  await message.react(DELETE_APPROVE_EMOJI);
  await wait(1000);
  await message.react(DELETE_REJECT_EMOJI);
}

function isUnknownMessageError(err) {
  return err?.code === 10008 || err?.rawError?.code === 10008 || String(err?.message || '').includes('Unknown Message');
}

async function deleteBroadcastRecord(broadcast, client) {
  const failed = [];
  let deleted = 0;
  let alreadyMissing = 0;

  await Promise.all(broadcast.messages.map(async (entry) => {
    try {
      const channel = await client.channels.fetch(entry.channelId);
      if (!channel?.messages?.fetch) {
        throw new Error('Channel not found or not text-based');
      }

      let targetMessage;
      try {
        targetMessage = await channel.messages.fetch(entry.messageId);
      } catch (err) {
        if (isUnknownMessageError(err)) {
          alreadyMissing++;
          return;
        }
        throw err;
      }

      await targetMessage.delete();
      deleted++;
    } catch (err) {
      failed.push({
        ...entry,
        lastDeleteAttemptAt: new Date().toISOString(),
        lastDeleteError: err.message || String(err),
        error: err.message || String(err)
      });
    }
  }));

  broadcastHistory.replaceBroadcastMessages(broadcast.id, failed);

  return {
    total: broadcast.messages.length,
    deleted,
    alreadyMissing,
    failed
  };
}

async function deleteFallbackBroadcast(fallbackBroadcast, client) {
  const failed = [];
  let deleted = 0;
  let alreadyMissing = 0;

  await Promise.all((fallbackBroadcast.messages || []).map(async (entry) => {
    try {
      const channel = await client.channels.fetch(entry.channelId);
      if (!channel?.messages?.fetch) {
        throw new Error('Channel not found or not text-based');
      }

      let targetMessage;
      try {
        targetMessage = await channel.messages.fetch(entry.messageId);
      } catch (err) {
        if (isUnknownMessageError(err)) {
          alreadyMissing++;
          return;
        }
        throw err;
      }

      await targetMessage.delete();
      deleted++;
    } catch (err) {
      failed.push({
        ...entry,
        error: err.message || String(err)
      });
    }
  }));

  return {
    total: fallbackBroadcast.messages?.length || 0,
    deleted,
    alreadyMissing,
    failed
  };
}

async function createDeleteConfirmation(ownerUser, broadcast, query = null) {
  const confirmMessage = await ownerUser.send(
    `${formatBroadcastPreview(broadcast)}\n\nIs this the broadcast you wanted to delete?`
  );
  await addDeleteConfirmationReactions(confirmMessage);
  pendingBroadcastDeletes.createPendingDelete({
    type: 'confirm',
    ownerID: ownerUser.id,
    messageID: confirmMessage.id,
    channelID: confirmMessage.channelId || confirmMessage.channel?.id,
    broadcastID: broadcast.id,
    query
  });
}

async function confirmBroadcastDelete(message, broadcast, query = null) {
  await createDeleteConfirmation(message.author, broadcast, query);
}

async function createFallbackDeleteConfirmation(ownerUser, fallbackBroadcast, query = null) {
  const confirmMessage = await ownerUser.send(
    `${formatBroadcastPreview(fallbackBroadcast)}\n\nIs this the broadcast you wanted to delete?`
  );
  await addDeleteConfirmationReactions(confirmMessage);
  pendingBroadcastDeletes.createPendingDelete({
    type: 'confirm',
    source: 'fallback',
    ownerID: ownerUser.id,
    messageID: confirmMessage.id,
    channelID: confirmMessage.channelId || confirmMessage.channel?.id,
    broadcastID: fallbackBroadcast.id,
    fallbackBroadcast,
    query
  });
}

async function confirmFallbackBroadcastDelete(message, fallbackBroadcast, query = null) {
  await createFallbackDeleteConfirmation(message.author, fallbackBroadcast, query);
}

function formatDeleteMatchList(matches, query, page) {
  const totalPages = Math.max(1, Math.ceil(matches.length / DELETE_PAGE_SIZE));
  const pageStart = page * DELETE_PAGE_SIZE;
  const pageMatches = matches.slice(pageStart, pageStart + DELETE_PAGE_SIZE);
  let msg = `**Delete Matches for:** \`${query}\`\n`;
  msg += `Page ${page + 1}/${totalPages}. React with a number to choose a broadcast.\n\n`;

  pageMatches.forEach((broadcast, index) => {
    const date = new Date(broadcast.createdAt).toLocaleString();
    const preview = truncateText(broadcast.content || '(attachment only)', 90);
    const sourceLabel = broadcast.isFallback ? `${broadcast.source} fallback` : broadcast.source;
    msg += `${DELETE_NUMBER_EMOJIS[index]} **${date}** — ${sourceLabel} — ${broadcast.messages.length} messages\n`;
    msg += `   ${preview}\n`;
  });

  if (totalPages > 1) {
    msg += '\nUse ◀️ / ▶️ to change pages.';
  }

  return { msg, pageMatches, totalPages };
}

async function addDeleteListReactions(listMessage, pageMatches, page, totalPages) {
  for (let i = 0; i < pageMatches.length; i++) {
    await listMessage.react(DELETE_NUMBER_EMOJIS[i]);
    await wait(250);
  }
  if (page > 0) {
    await listMessage.react(DELETE_PREV_EMOJI);
    await wait(250);
  }
  if (page < totalPages - 1) {
    await listMessage.react(DELETE_NEXT_EMOJI);
  }
}

async function sendDeleteMatchList(message, matches, query, page = 0) {
  const clampedPage = Math.max(0, Math.min(page, Math.ceil(matches.length / DELETE_PAGE_SIZE) - 1));
  const { msg, pageMatches, totalPages } = formatDeleteMatchList(matches, query, clampedPage);
  const listMessage = await message.author.send(msg);
  await addDeleteListReactions(listMessage, pageMatches, clampedPage, totalPages);
  pendingBroadcastDeletes.createPendingDelete({
    type: 'list',
    source: matches.some(match => match.isFallback) ? 'fallback' : 'history',
    ownerID: message.author.id,
    messageID: listMessage.id,
    channelID: listMessage.channelId || listMessage.channel?.id,
    query,
    page: clampedPage,
    matchIDs: matches.map(match => match.id),
    fallbackMatches: matches.some(match => match.isFallback) ? matches : undefined
  });
}

async function searchLivePartnerMessages(client, query) {
  const candidates = [];

  await Promise.all(partnerConfig.channels.map(async (partner) => {
    const serverName = partner.name;
    let channelName = 'Unknown Channel';

    try {
      const channel = await client.channels.fetch(partner.channelId);
      if (!channel?.messages?.fetch) return;
      if (channel.name) channelName = channel.name;

      const fetched = await channel.messages.fetch({ limit: FALLBACK_SCAN_LIMIT_PER_CHANNEL });
      for (const msg of fetched.values()) {
        if (msg.author?.id !== client.user.id) continue;
        const attachments = getMessageAttachments(msg);
        const candidate = {
          id: `fallback-${msg.id}`,
          source: 'live_scan',
          isFallback: true,
          createdAt: msg.createdAt?.toISOString?.() || new Date(msg.createdTimestamp || Date.now()).toISOString(),
          authorID: msg.author.id,
          content: msg.content || '',
          attachments,
          messages: [{
            serverId: partner.serverId || channel.guildId,
            serverName,
            channelId: partner.channelId,
            channelName,
            messageId: msg.id
          }]
        };

        if (queryMatchesCandidate(candidate, query)) {
          candidates.push(candidate);
        }
      }
    } catch (err) {
      console.error(`[delete fallback] Failed to scan ${partner.name} (${partner.channelId}):`, err.message);
    }
  }));

  candidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return groupFallbackCandidates(candidates);
}

async function handleSmartDeleteCommand(message, client, query) {
  if (!query) {
    await message.reply('Usage: `!delete <search text>`');
    return;
  }

  const matches = broadcastHistory.searchBroadcasts(query);
  if (matches.length === 0) {
    const fallbackMatches = await searchLivePartnerMessages(client, query);
    if (fallbackMatches.length === 0) {
      await message.reply(`❌ No stored broadcasts or recent bot messages matched \`${query}\`.`);
      return;
    }

    await message.reply(`No stored broadcasts matched \`${query}\`. I found ${fallbackMatches.length} recent bot message${fallbackMatches.length !== 1 ? 's' : ''} with the fallback channel scan.`);
    if (fallbackMatches.length === 1) {
      await confirmFallbackBroadcastDelete(message, fallbackMatches[0], query);
      return;
    }

    await sendDeleteMatchList(message, fallbackMatches, query, 0);
    return;
  }

  if (matches.length === 1) {
    await confirmBroadcastDelete(message, matches[0], query);
    return;
  }

  await sendDeleteMatchList(message, matches, query, 0);
}

async function handleDeleteLast(message, client) {
  const deleteStartTime = startTimer();
  const broadcast = broadcastHistory.getLatestBroadcast();
  if (!broadcast) {
    await message.reply('📋 No stored broadcasts to delete.');
    return;
  }

  const result = await deleteBroadcastRecord(broadcast, client);
  const totalDuration = endTimer(deleteStartTime);
  await message.reply(`${formatDeleteResult(result)}\n⏱️ ${totalDuration}ms`);
}

async function handleBroadcastDeleteReaction(reaction, user, client) {
  if (user.bot) return false;

  try {
    if (reaction.partial) reaction = await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    console.error('[delete] Failed to fetch partial reaction/message:', err.message);
    return false;
  }

  const channel = reaction.message.channel;
  if (!channel?.isDMBased?.()) return false;
  if (!isOwner(user.id)) return false;

  const messageID = reaction.message.id;
  const channelID = reaction.message.channelId || channel.id;
  const pending = pendingBroadcastDeletes.getByMessage(messageID, channelID);
  if (!pending || pending.ownerID !== user.id) return false;

  const emoji = reaction.emoji.name;

  if (pending.type === 'list') {
    const matches = pending.source === 'fallback'
      ? (pending.fallbackMatches || [])
      : pending.matchIDs
        .map(id => broadcastHistory.getBroadcastById(id))
        .filter(Boolean);

    if (matches.length === 0) {
      pendingBroadcastDeletes.removePendingDelete(pending.id);
      await reaction.message.reply('❌ These broadcasts are no longer available.');
      return true;
    }

    const totalPages = Math.max(1, Math.ceil(matches.length / DELETE_PAGE_SIZE));
    if (emoji === DELETE_PREV_EMOJI || emoji === DELETE_NEXT_EMOJI) {
      const direction = emoji === DELETE_NEXT_EMOJI ? 1 : -1;
      const nextPage = Math.max(0, Math.min(totalPages - 1, (pending.page || 0) + direction));
      const { msg, pageMatches } = formatDeleteMatchList(matches, pending.query, nextPage);
      await reaction.message.edit(msg).catch(() => {});
      await reaction.message.reactions.removeAll().catch(() => {});
      await addDeleteListReactions(reaction.message, pageMatches, nextPage, totalPages).catch(() => {});
      pendingBroadcastDeletes.updatePendingDelete(pending.id, {
        page: nextPage,
        matchIDs: matches.map(match => match.id),
        fallbackMatches: pending.source === 'fallback' ? matches : pending.fallbackMatches
      });
      return true;
    }

    const choiceIndex = DELETE_NUMBER_EMOJIS.indexOf(emoji);
    if (choiceIndex === -1) return false;

    const selectedIndex = (pending.page || 0) * DELETE_PAGE_SIZE + choiceIndex;
    const broadcast = matches[selectedIndex];
    if (!broadcast) return true;

    pendingBroadcastDeletes.removePendingDelete(pending.id);
    if (pending.source === 'fallback' || broadcast.isFallback) {
      await createFallbackDeleteConfirmation(user, broadcast, pending.query);
    } else {
      await createDeleteConfirmation(user, broadcast, pending.query);
    }
    return true;
  }

  if (pending.type === 'confirm') {
    if (emoji === DELETE_REJECT_EMOJI) {
      pendingBroadcastDeletes.removePendingDelete(pending.id);
      await reaction.message.reply('❌ Broadcast deletion cancelled.').catch(() => {});
      return true;
    }

    if (emoji !== DELETE_APPROVE_EMOJI) return false;

    pendingBroadcastDeletes.removePendingDelete(pending.id);
    if (pending.source === 'fallback') {
      const fallbackBroadcast = pending.fallbackBroadcast;
      if (!fallbackBroadcast) {
        await reaction.message.reply('❌ This fallback delete candidate is no longer available.').catch(() => {});
        return true;
      }

      const deleteStartTime = startTimer();
      const result = await deleteFallbackBroadcast(fallbackBroadcast, client);
      const totalDuration = endTimer(deleteStartTime);
      await reaction.message.reply(`${formatDeleteResult(result)}\n⏱️ ${totalDuration}ms`).catch(() => {});
      return true;
    }

    const broadcast = broadcastHistory.getBroadcastById(pending.broadcastID);
    if (!broadcast) {
      await reaction.message.reply('❌ This broadcast is no longer available in history.').catch(() => {});
      return true;
    }

    const deleteStartTime = startTimer();
    const result = await deleteBroadcastRecord(broadcast, client);
    const totalDuration = endTimer(deleteStartTime);
    await reaction.message.reply(`${formatDeleteResult(result)}\n⏱️ ${totalDuration}ms`).catch(() => {});
    return true;
  }

  return false;
}

module.exports = {
  handleSmartDeleteCommand,
  handleDeleteLast,
  handleBroadcastDeleteReaction,
  formatDeleteMatchList,
};
