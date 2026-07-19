const { migrateDisplayNamesWithGuilds } = require('../../features/pandas/storage');
const { cacheGuildInvites } = require('../../utils/inviteTracker');
const { initPandaLogger } = require('../../features/pandas/logger');
const { startGiveawayScheduler } = require('../../features/giveaways/lifecycle');
const { logVoiceDependencyReport, restoreVoiceConnections } = require('../../features/voice/connection');
const { ensureVerificationMessage } = require('../../features/verification/ready');
const {
  initializeVoiceTracking,
  resyncVoiceTracking,
  checkAndAwardVoice,
} = require('./voiceStateUpdate');

async function handleReady(context) {
  const { client, trackedGuilds, voiceCheckIntervalMs, voiceResyncIntervalMs } = context;

  console.log(`✅ Bot is online as ${client.user.tag}`);
  logVoiceDependencyReport();
  initPandaLogger(client);
  await restoreVoiceConnections(client);

  // Migrate display names with guild context (fetches actual server nicknames)
  await migrateDisplayNamesWithGuilds(client);

  // Cache invites for all tracked guilds
  for (const guildId of trackedGuilds) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await cacheGuildInvites(guild);
  }

  try {
    await ensureVerificationMessage(context);
  } catch (err) {
    console.error('[verification] Failed to prepare verification prompt:', err);
  }

  // Initialize voice activity tracking from existing voice channels
  initializeVoiceTracking(context);

  // Start giveaway auto-end scheduler (30s interval, immediate first tick)
  startGiveawayScheduler(client);

  // Start periodic voice reward check
  setInterval(() => checkAndAwardVoice(context), voiceCheckIntervalMs);

  // Start periodic resync (safety check against event misses)
  setInterval(() => resyncVoiceTracking(context), voiceResyncIntervalMs);
}

module.exports = { handleReady };
