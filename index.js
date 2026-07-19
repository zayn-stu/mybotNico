require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands } = require('./handlers/commandHandler');
const { registerEvents } = require('./bot/registerEvents');
const { flushAllWrites } = require('./shared/jsonStore');

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

client.login(process.env.DISCORD_TOKEN);

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
