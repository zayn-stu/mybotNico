require('dotenv').config();
const { Client, GatewayIntentBits, Partials, MessageType } = require('discord.js');
const { loadCommands, handleCommand } = require('./handlers/commandHandler');
const { handleMemberLeave } = require('./handlers/memberLeaveHandler');
const { handleRoleDelete } = require('./handlers/roleDeleteHandler');
const { addPanda, deductPandas, restoreMember, getLeaderboard } = require('./utils/pandaStorage');
const { registerMessageAndCheckAward } = require('./utils/pandaRuntime');
const { handlePartnerDM } = require('./handlers/partnerHandler');
const { getSavedColorRole, clearSavedColorRole } = require('./utils/memberRoleMemory');
const { cacheGuildInvites, handleInviteCreate, handleInviteDelete, detectInviter, recordInviteReward, getDeductionInfo, removeRewardEntry } = require('./utils/inviteTracker');
const { addPendingReaction, checkAndConsume } = require('./utils/pendingReactions');
const { getTodayBumpCount, incrementBumpCount } = require('./utils/bumpTracking');
const { awardVoicePandas } = require('./utils/voiceRewardTracking');
const { checkLastPlaceBoost } = require('./utils/lastPlaceBoost');
const { initPandaLogger, logPandaAward } = require('./utils/pandaLogger');
const pandaChannels = require('./data/pandaChannels.json');

const PREFIX = '!';
const PANDA_EMOJI_NAME = process.env.PANDA_EMOJI_NAME || 'SN_RooHappi';
const PIRATE_EMOJI_NAME = 'RooPirateCap';
const BUMP_CAP_PER_DAY = 5;
const PIRATE_CHANCE_TOP5 = 0.005;
const PIRATE_CHANCE_REST = 0.05;
const VOICE_MINUTES_PER_PANDA = 60;

// In-memory voice join timestamps: "guildId-userId" -> Date.now()
const voiceJoinTimes = new Map();
// Per-guild message counter for pirate bounty spacing (rolls every 3rd message)
const pirateMessageCounter = new Map();
const SOCIALS_GUILD_ID = process.env.SOCIALS_GUILD_ID || '';
const PERISHED_GUILD_ID = process.env.PERISHED_GUILD_ID || '';
const DEJAVU_GUILD_ID = process.env.DEJAVU_GUILD_ID || '';
const DISBOARD_BOT_ID = '302050872383242240';

// Guilds with bump + invite rewards active
const TRACKED_GUILDS = [SOCIALS_GUILD_ID, PERISHED_GUILD_ID, DEJAVU_GUILD_ID].filter(Boolean);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel]
});

console.log('Loading commands...');
loadCommands(client);

client.once('ready', async () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  initPandaLogger(client);

  // Cache invites for all tracked guilds
  for (const guildId of TRACKED_GUILDS) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await cacheGuildInvites(guild);
  }
});

// ─── Invite events ────────────────────────────────────────────────────────────
client.on('inviteCreate', (invite) => handleInviteCreate(invite));
client.on('inviteDelete', (invite) => handleInviteDelete(invite));

// ─── Member leave ─────────────────────────────────────────────────────────────
client.on('guildMemberRemove', async (member) => {
  // Deduct invite pandas if member leaves within 30 days (all tracked guilds)
  if (TRACKED_GUILDS.includes(member.guild.id)) {
    const deductInfo = getDeductionInfo(member.guild.id, member.user.id);
    if (deductInfo) {
      deductPandas(member.guild.id, deductInfo.inviterId, 3);
      removeRewardEntry(member.guild.id, member.user.id);
      logPandaAward(member.guild.id, deductInfo.inviterId, deductInfo.inviterId, -3, 'invite-leave');
      console.log(`[invite] ${member.user.tag} left within 30 days — deducted 3 pandas from ${deductInfo.inviterId}`);
    }
  }

  // Leave logging — Socials only
  if (member.guild.id === SOCIALS_GUILD_ID) {
    await handleMemberLeave(member);
  }
});

// ─── Member join — invite detection + data restore ────────────────────────────
client.on('guildMemberAdd', async (member) => {
  console.log(`[memberAdd] ${member.user.tag} joined ${member.guild.name} (${member.guild.id}). Tracked: ${TRACKED_GUILDS.includes(member.guild.id)}. TRACKED_GUILDS: [${TRACKED_GUILDS.join(', ')}]`);

  // Invite tracking — all tracked guilds
  if (TRACKED_GUILDS.includes(member.guild.id)) {
    try {
      const inviteInfo = await detectInviter(member);
      if (inviteInfo) {
        // Resolve inviter username from cache
        const inviterMember = member.guild.members.cache.get(inviteInfo.inviterId);
        const inviterUsername = inviterMember?.user?.username ?? inviteInfo.inviterId;
        addPanda(member.guild.id, inviteInfo.inviterId, inviterUsername, 3);
        recordInviteReward(member.guild.id, member.user.id, inviteInfo.inviterId);
        addPendingReaction(member.guild.id, inviteInfo.inviterId, PANDA_EMOJI_NAME, 3, 'invite');
        logPandaAward(member.guild.id, inviteInfo.inviterId, inviterUsername, 3, 'invite');
        checkLastPlaceBoost(member.guild.id, inviteInfo.inviterId, logPandaAward);
        console.log(`[invite] ${member.user.tag} joined via invite by ${inviterUsername} (${inviteInfo.inviterId}) in ${member.guild.name} — awarded 3 pandas + queued reaction`);
      } else {
        console.log(`[invite] ${member.user.tag} joined ${member.guild.name} — no inviter detected (vanity URL, uncached invite, or no permission)`);
      }
    } catch (err) {
      console.error('[invite] Error processing invite reward:', err);
    }

    // Restore panda leaderboard entry (clear the left flag)
    try {
      const restored = restoreMember(member.guild.id, member.user.id);
      if (restored) console.log(`[rejoin] Restored panda entry for ${member.user.id}`);
    } catch (err) {
      console.error('[rejoin] Error restoring panda entry:', err);
    }
  }

  // Socials-specific: restore color role
  if (member.guild.id === SOCIALS_GUILD_ID) {
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
});

// ─── Role deleted in Discord — auto-cleanup DB ────────────────────────────────
client.on('roleDelete', async (role) => {
  if (role.guild.id !== SOCIALS_GUILD_ID) return;
  await handleRoleDelete(role);
});

// ─── Messages ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  // ─── System join message — react with welcome emoji (Socials only) ───────────
  if (message.guild?.id === SOCIALS_GUILD_ID && message.type === MessageType.GuildMemberJoin) {
    const pandaEmoji = message.guild.emojis.cache.find(e => e.name === PANDA_EMOJI_NAME);
    if (pandaEmoji) await message.react(pandaEmoji).catch(() => {});
    return;
  }

  // ─── Disboard bump reward (all tracked guilds) ──────────────────────────────
  if (
    message.author.id === DISBOARD_BOT_ID &&
    TRACKED_GUILDS.includes(message.guild?.id) &&
    message.embeds[0]?.description?.includes('Bump done!')
  ) {
    const bumper = message.interaction?.user;
    if (bumper) {
      try {
        // Daily bump cap check
        if (getTodayBumpCount(message.guild.id, bumper.id) >= BUMP_CAP_PER_DAY) {
          console.log(`[bump] ${bumper.username} (${bumper.id}) hit daily bump cap (${BUMP_CAP_PER_DAY}) — skipped`);
        } else {
          incrementBumpCount(message.guild.id, bumper.id);
          addPanda(message.guild.id, bumper.id, bumper.username);
          addPendingReaction(message.guild.id, bumper.id, PANDA_EMOJI_NAME, 1, 'bump');
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

    if (message.guild.id === SOCIALS_GUILD_ID && pandaResult.countedMessage) {
      const username = message.author.username;
      console.log(`(${username}) sent message ${pandaResult.messageCount}/${pandaResult.threshold}`);
    }

    if (pandaResult.awarded) {
      try {
        addPanda(message.guild.id, message.author.id, message.author.username);
        logPandaAward(message.guild.id, message.author.id, message.author.username, 1, 'chat');
        checkLastPlaceBoost(message.guild.id, message.author.id, logPandaAward);

        const pandaEmoji = message.guild.emojis.cache.find(emoji => emoji.name === PANDA_EMOJI_NAME);
        if (pandaEmoji) {
          await message.react(pandaEmoji);
        } else {
          console.warn(`Emoji ${PANDA_EMOJI_NAME} not found in guild`);
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
        const chance = (authorRank >= 0 && authorRank < 5) ? PIRATE_CHANCE_TOP5 : PIRATE_CHANCE_REST;

        if (Math.random() < chance) {
          const pirateAmount = Math.random() < 0.5 ? 2 : 3;
          addPanda(message.guild.id, message.author.id, message.author.username, pirateAmount);
          logPandaAward(message.guild.id, message.author.id, message.author.username, pirateAmount, 'pirate');
          checkLastPlaceBoost(message.guild.id, message.author.id, logPandaAward);

          const pirateEmoji = message.guild.emojis.cache.find(e => e.name.toLowerCase() === PIRATE_EMOJI_NAME.toLowerCase());
          if (pirateEmoji) await message.react(pirateEmoji).catch(() => {});
          console.log(`[pirate] ${message.author.username} won ${pirateAmount} pandas (rank ${authorRank >= 0 ? authorRank + 1 : 'unranked'}, ${(chance * 100).toFixed(0)}% chance)`);
        }
      }
    } catch (err) {
      console.error('[pirate] Error in pirate bounty roll:', err);
    }
  }

  handleCommand(message, PREFIX);
});

// ─── Voice activity reward ────────────────────────────────────────────────────
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = newState.guild.id;
  if (!pandaChannels[guildId]) return; // Only guilds with panda channels
  const userId = newState.member?.id;
  if (!userId || newState.member?.user?.bot) return;

  const key = `${guildId}-${userId}`;

  // User joined or switched to a voice channel
  if (!oldState.channelId && newState.channelId) {
    voiceJoinTimes.set(key, Date.now());
  }

  // User left voice entirely
  if (oldState.channelId && !newState.channelId) {
    const joinTime = voiceJoinTimes.get(key);
    voiceJoinTimes.delete(key);
    if (!joinTime) return;

    const minutes = (Date.now() - joinTime) / 60_000;
    const earned = Math.floor(minutes / VOICE_MINUTES_PER_PANDA);
    if (earned <= 0) return;

    const actual = awardVoicePandas(guildId, userId, earned);
    if (actual > 0) {
      const username = newState.member?.user?.username ?? userId;
      addPanda(guildId, userId, username, actual);
      addPendingReaction(guildId, userId, PANDA_EMOJI_NAME, actual, 'voice');
      logPandaAward(guildId, userId, username, actual, 'voice');
      checkLastPlaceBoost(guildId, userId, logPandaAward);
      console.log(`[voice] Awarded ${actual} panda(s) to ${username} (${userId}) for ${Math.floor(minutes)} min in voice`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
