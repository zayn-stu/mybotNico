const DEFAULT_ADS_SOURCE_GUILD_ID = '694912331267964961';
const DEFAULT_ADS_SOURCE_CHANNEL_ID = '1495529613181452308';

function getAdsSourceConfig() {
  return {
    guildId: process.env.SOCIALS_GUILD_ID || DEFAULT_ADS_SOURCE_GUILD_ID,
    channelId: process.env.SOCIALS_GUILD_SERVER_ADS_CHANNEL_ID || DEFAULT_ADS_SOURCE_CHANNEL_ID
  };
}

async function fetchAllAdsMessages(client) {
  const { guildId, channelId } = getAdsSourceConfig();

  if (!channelId) {
    throw new Error('SOCIALS_GUILD_SERVER_ADS_CHANNEL_ID is not configured');
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    channel = null;
  }

  // Fallback path for cases where direct channel fetch fails due cache/access state.
  if (!channel && guildId) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
  }

  if (!channel || !channel.isTextBased() || !channel.messages?.fetch) {
    throw new Error(`Ads source channel not accessible/text-based (guildId=${guildId}, channelId=${channelId})`);
  }

  if (guildId && channel.guildId && channel.guildId !== guildId) {
    throw new Error(`Ads source channel is in unexpected guild (expected=${guildId}, actual=${channel.guildId})`);
  }

  const allMessages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;

    allMessages.push(...batch.values());

    if (batch.size < 100) break;
    before = batch.last().id;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return allMessages;
}

module.exports = {
  getAdsSourceConfig,
  fetchAllAdsMessages,
};
