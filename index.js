require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands, handleCommand } = require('./handlers/commandHandler');
const { addPanda } = require('./utils/pandaStorage');
const { handlePartnerDM } = require('./handlers/partnerHandler');

const PREFIX = '!';
const GENERAL_CHANNEL_ID = '1158086152805425162';
const PANDA_EMOJI_NAME = 'SN_RooHappi';
const PANDA_THRESHOLD_MIN = 30; // Minimum messages for panda award
const PANDA_THRESHOLD_MAX = 40; // Maximum messages for panda award

// Helper function to get random threshold
function getRandomPandaThreshold() {
  return Math.floor(Math.random() * (PANDA_THRESHOLD_MAX - PANDA_THRESHOLD_MIN + 1)) + PANDA_THRESHOLD_MIN;
}

// Message counter for panda system
let messageCount = 0;
let lastUserId = null;
let currentPandaThreshold = getRandomPandaThreshold(); // Random threshold for next panda

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel] // Required for DM support
});

console.log('Loading commands...');
loadCommands(client);

client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Handle DM messages for partnership broadcasts
  if (!message.guild) {
    await handlePartnerDM(message, client);
    return;
  }
  
  // Handle panda system for general channel
  if (message.channel.id === GENERAL_CHANNEL_ID) {
    // Only count if it's a different user than the last one
    if (message.author.id !== lastUserId) {
      messageCount++;
      lastUserId = message.author.id;
    }
    
    if (messageCount >= currentPandaThreshold) {
      messageCount = 0; // Reset counter
      lastUserId = null; // Reset last user
      currentPandaThreshold = getRandomPandaThreshold(); // Set new random threshold
      
      try {
        // Add panda to user
        const newCount = addPanda(message.guild.id, message.author.id, message.author.username);
        
        // React with panda emoji
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
  }
  
  handleCommand(message, PREFIX);
});

client.login(process.env.DISCORD_TOKEN);
