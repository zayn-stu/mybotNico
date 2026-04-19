const FLUSH_INTERVAL_MS = 3_000; // 3 seconds
const MAX_BATCH_SIZE = 10;
const LOG_CHANNEL_ID = '1492278017248985229';

let buffer = [];
let client = null;
let flushTimer = null;

/**
 * Initialize the logger with the Discord client. Must be called once on startup.
 */
function initPandaLogger(discordClient) {
  client = discordClient;
  flushTimer = setInterval(flushLogs, FLUSH_INTERVAL_MS);
}

/**
 * Queue a panda award log entry for batched delivery.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} username
 * @param {number} amount
 * @param {string} source - e.g. "bump", "chat", "voice", "pirate", "10th-boost", "invite"
 */
function logPandaAward(guildId, userId, username, amount, source) {
  if (!client) return;
  const guild = client.guilds.cache.get(guildId);
  const guildName = guild?.name ?? guildId;

  const preferredEmojiName = source === 'pirate' ? 'RooPirateCap' : 'SN_RooHappi';
  const emoji = guild?.emojis.cache.find(e => e.name.toLowerCase() === preferredEmojiName.toLowerCase())
    ?? guild?.emojis.cache.find(e => e.name.toLowerCase() === 'sn_roohappi');
  const emojiStr = emoji ? `<:${emoji.name}:${emoji.id}>` : '🐼';

  buffer.push(`${emojiStr} [${guildName}] +${amount} to ${username} (${source})`);
  if (buffer.length >= MAX_BATCH_SIZE) flushLogs();
}

async function flushLogs() {
  if (buffer.length === 0) return;
  const lines = buffer.splice(0); // drain
  const message = lines.join('\n');

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (channel) {
      await channel.send(message);
    } else {
      console.warn('[pandaLogger] Log channel not found — falling back to console');
      console.log(message);
    }
  } catch (err) {
    console.warn('[pandaLogger] Failed to send to log channel — falling back to console');
    console.log(message);
  }
}

/**
 * Flush remaining logs (call before process exit if needed).
 */
async function shutdownLogger() {
  if (flushTimer) clearInterval(flushTimer);
  await flushLogs();
}

module.exports = { initPandaLogger, logPandaAward, shutdownLogger };
