const { addPanda } = require('../../features/pandas/storage');
const { isEligibleForAward, awardVoicePanda } = require('../../features/pandas/voiceRewardTracking');
const { addPendingReaction } = require('../../features/pandas/pendingReactions');
const { checkLastPlaceBoost } = require('../../features/pandas/lastPlaceBoost');
const { logPandaAward } = require('../../features/pandas/logger');
const pandaChannels = require('../../data/pandaChannels.json');

function initializeVoiceTracking(context) {
  const { client, voiceActivityTracker } = context;

  for (const guildId of Object.keys(pandaChannels)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const activeMembers = new Set();
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      for (const member of channel.members.values()) {
        if (!member.user.bot) activeMembers.add(member.id);
      }
    }
    voiceActivityTracker.set(guildId, activeMembers);
  }
  console.log(`[voice] Initialized tracking for ${voiceActivityTracker.size} guilds`);
}

function resyncVoiceTracking(context) {
  const { client, voiceActivityTracker } = context;

  console.log('[voice] Resyncing active voice members...');
  for (const guildId of Object.keys(pandaChannels)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const actualMembers = new Set();
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      for (const member of channel.members.values()) {
        if (!member.user.bot) actualMembers.add(member.id);
      }
    }
    voiceActivityTracker.set(guildId, actualMembers);
  }
}

function handleVoiceStateUpdate(oldState, newState, context) {
  const { voiceActivityTracker } = context;
  const guildId = newState.guild.id;
  if (!pandaChannels[guildId]) return;

  const userId = newState.member?.id;
  if (!userId || newState.member?.user?.bot) return;

  if (!voiceActivityTracker.has(guildId)) {
    voiceActivityTracker.set(guildId, new Set());
  }

  // User joined voice
  if (!oldState.channelId && newState.channelId) {
    voiceActivityTracker.get(guildId).add(userId);
  }

  // User left voice
  if (oldState.channelId && !newState.channelId) {
    voiceActivityTracker.get(guildId).delete(userId);
  }
}

async function checkAndAwardVoice(context) {
  const {
    client,
    voiceActivityTracker,
    voiceMinutesPerPanda,
    pandaEmojiName,
  } = context;

  const awardsByGuild = {}; // guildId -> Array<{userId, username, displayName, member}>

  // Collect all eligible awards
  for (const [guildId, activeUserIds] of voiceActivityTracker.entries()) {
    awardsByGuild[guildId] = [];
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    for (const userId of activeUserIds) {
      // Check eligibility first (fast, no DB hit)
      if (!isEligibleForAward(guildId, userId, voiceMinutesPerPanda)) continue;

      // Award the panda (updates lastAwardedAt, respects daily cap)
      const awarded = awardVoicePanda(guildId, userId);
      if (!awarded) continue;

      // Fetch member for username/displayName
      const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;

      awardsByGuild[guildId].push({
        userId,
        username: member.user.username,
        displayName: member.displayName || member.user.username,
        member
      });
    }
  }

  // Process awards and boosts per guild
  for (const [guildId, awards] of Object.entries(awardsByGuild)) {
    if (awards.length === 0) continue;

    // Batch add all pandas
    for (const award of awards) {
      addPanda(guildId, award.userId, award.username, 1, award.displayName);
      addPendingReaction(guildId, award.userId, pandaEmojiName, 1, 'voice');
      logPandaAward(guildId, award.userId, award.username, 1, 'voice');
    }

    // Batch check last place boosts
    for (const award of awards) {
      checkLastPlaceBoost(guildId, award.userId, logPandaAward);
    }

    console.log(`[voice] Awarded ${awards.length} panda(s) in guild ${guildId}`);
  }
}

module.exports = {
  initializeVoiceTracking,
  resyncVoiceTracking,
  handleVoiceStateUpdate,
  checkAndAwardVoice,
};
