const { MessageType } = require('discord.js');
const { handleCommand } = require('../../handlers/commandHandler');
const { addPanda, getLeaderboard } = require('../../features/pandas/storage');
const { registerMessageAndCheckAward } = require('../../features/pandas/runtime');
const { handlePartnerDM } = require('../../features/partners/handler');
const { addPendingReaction, checkAndConsume } = require('../../features/pandas/pendingReactions');
const { getTodayBumpCount, incrementBumpCount } = require('../../features/pandas/bumpTracking');
const { checkLastPlaceBoost } = require('../../features/pandas/lastPlaceBoost');
const { logPandaAward } = require('../../features/pandas/logger');
const pandaChannels = require('../../data/pandaChannels.json');

async function handleMessageCreate(message, context) {
  const {
    client,
    prefix,
    pandaEmojiName,
    pirateEmojiName,
    bumpCapPerDay,
    pirateChanceTop5,
    pirateChanceRest,
    pirateMessageCounter,
    socialsGuildId,
    trackedGuilds,
    disboardBotId,
  } = context;

  // ─── System join message — react with welcome emoji (Socials only) ───────────
  if (message.guild?.id === socialsGuildId && message.type === MessageType.GuildMemberJoin) {
    const pandaEmoji = message.guild.emojis.cache.find(e => e.name === pandaEmojiName);
    if (pandaEmoji) await message.react(pandaEmoji).catch(() => { });
    return;
  }

  // ─── Disboard bump reward (all tracked guilds) ──────────────────────────────
  if (
    message.author.id === disboardBotId &&
    trackedGuilds.includes(message.guild?.id) &&
    message.embeds[0]?.description?.includes('Bump done!')
  ) {
    const bumper = message.interaction?.user;
    if (bumper) {
      try {
        // Daily bump cap check
        if (getTodayBumpCount(message.guild.id, bumper.id) >= bumpCapPerDay) {
          console.log(`[bump] ${bumper.username} (${bumper.id}) hit daily bump cap (${bumpCapPerDay}) — skipped`);
        } else {
          incrementBumpCount(message.guild.id, bumper.id);
          const bumperMember = message.guild.members.cache.get(bumper.id);
          const bumperDisplayName = bumperMember?.displayName || bumper.username;
          addPanda(message.guild.id, bumper.id, bumper.username, 1, bumperDisplayName);
          addPendingReaction(message.guild.id, bumper.id, pandaEmojiName, 1, 'bump');
          logPandaAward(message.guild.id, bumper.id, bumper.username, 1, 'bump');
          checkLastPlaceBoost(message.guild.id, bumper.id, logPandaAward);
          console.log(`[bump] Awarded panda to ${bumper.username} (${bumper.id}), queued reaction`);
        }
      } catch (err) {
        console.error('[bump] Error awarding bump panda:', err);
      }
    }
    return;
  }

  if (message.author.bot) return;

  // Handle DM messages for partnership broadcasts / !show ads
  if (!message.guild) {
    await handlePartnerDM(message, client);
    return;
  }

  // ─── Consume pending reaction (react to next message from rewarded user) ────
  const pendingInfo = checkAndConsume(message.guild.id, message.author.id);
  if (pendingInfo) {
    try {
      const pandaEmoji = message.guild.emojis.cache.find(e => e.name === pendingInfo.emojiName);
      if (pandaEmoji) {
        await message.react(pandaEmoji).catch(err => {
          console.error(`[pendingReaction] Failed to react in #${message.channel.name} (${message.guild.name}):`, err.message);
        });
        console.log(`[pendingReaction] Reacted on message by ${message.author.tag} in ${message.guild.name} (source: ${pendingInfo.source})`);
      } else {
        console.warn(`[pendingReaction] Emoji '${pendingInfo.emojiName}' not found in ${message.guild.name} — reaction skipped`);
      }
    } catch (err) {
      console.error('[pendingReaction] Unexpected error:', err);
    }
  }

  // Handle panda system for general channel
  const pandaChannelId = pandaChannels[message.guild.id];
  if (pandaChannelId && message.channel.id === pandaChannelId) {
    const pandaResult = registerMessageAndCheckAward(message.guild.id, message.author.id);

    if (message.guild.id === socialsGuildId && pandaResult.countedMessage) {
      const username = message.author.username;
      console.log(`(${username}) sent message ${pandaResult.messageCount}/${pandaResult.threshold}`);
    }

    if (pandaResult.awarded) {
      try {
        const authorMember = message.guild.members.cache.get(message.author.id);
        const authorDisplayName = authorMember?.displayName || message.author.username;
        addPanda(message.guild.id, message.author.id, message.author.username, 1, authorDisplayName);
        logPandaAward(message.guild.id, message.author.id, message.author.username, 1, 'chat');
        checkLastPlaceBoost(message.guild.id, message.author.id, logPandaAward);

        const pandaEmoji = message.guild.emojis.cache.find(emoji => emoji.name === pandaEmojiName);
        if (pandaEmoji) {
          await message.react(pandaEmoji);
        } else {
          console.warn(`Emoji ${pandaEmojiName} not found in guild`);
        }
      } catch (err) {
        console.error('Error awarding panda:', err);
      }
    }

    // ─── Pirate bounty roll (every 3rd message) ────────────────────────────────
    try {
      const pirateCount = (pirateMessageCounter.get(message.guild.id) || 0) + 1;
      pirateMessageCounter.set(message.guild.id, pirateCount);

      if (pirateCount % 3 === 0) {
        const board = getLeaderboard(message.guild.id, 10);
        const authorRank = board.findIndex(e => e.userId === message.author.id);
        const chance = (authorRank >= 0 && authorRank < 5) ? pirateChanceTop5 : pirateChanceRest;

        if (Math.random() < chance) {
          const pirateAmount = Math.random() < 0.5 ? 2 : 3;
          const pirateMember = message.guild.members.cache.get(message.author.id);
          const pirateDisplayName = pirateMember?.displayName || message.author.username;
          addPanda(message.guild.id, message.author.id, message.author.username, pirateAmount, pirateDisplayName);
          logPandaAward(message.guild.id, message.author.id, message.author.username, pirateAmount, 'pirate');
          checkLastPlaceBoost(message.guild.id, message.author.id, logPandaAward);

          const pirateEmoji = message.guild.emojis.cache.find(e => e.name.toLowerCase() === pirateEmojiName.toLowerCase());
          if (pirateEmoji) await message.react(pirateEmoji).catch(() => { });
          console.log(`[pirate] ${message.author.username} won ${pirateAmount} pandas (rank ${authorRank >= 0 ? authorRank + 1 : 'unranked'}, ${(chance * 100).toFixed(0)}% chance)`);
        }
      }
    } catch (err) {
      console.error('[pirate] Error in pirate bounty roll:', err);
    }
  }

  await handleCommand(message, prefix);
}

module.exports = { handleMessageCreate };
