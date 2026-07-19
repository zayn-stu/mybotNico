require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands } = require('./handlers/commandHandler');
const { registerEvents } = require('./bot/registerEvents');
const { flushAllWrites } = require('./shared/jsonStore');

function requireDiscordToken() {
  const rawToken = process.env.DISCORD_TOKEN;
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  const tokenLikeVariables = Object.keys(process.env)
    .filter(name => name.includes('TOKEN'))
    .sort();

  console.log('[startup] Environment check:', {
    railwayService: process.env.RAILWAY_SERVICE_NAME || '(not provided)',
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME || '(not provided)',
    discordTokenStatus: rawToken === undefined ? 'missing' : token ? 'present' : 'empty',
    discordTokenLength: token.length,
    tokenLikeVariables,
  });

  if (!token) {
    throw new Error(
      'DISCORD_TOKEN is missing or empty in this running service. ' +
      'The environment check above identifies the Railway service and environment that were deployed.'
    );
  }

  return token;
}

const discordToken = requireDiscordToken();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

console.log('Loading commands...');
loadCommands(client);
registerEvents(client);

client.login(discordToken);

// Flush any debounced JSON writes before exiting so queued state isn't lost.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal} — flushing pending writes...`);
  try {
    await flushAllWrites();
  } catch (err) {
    console.error('Error flushing writes during shutdown:', err);
  }
  client.destroy();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}
