const { handleInviteCreate, handleInviteDelete } = require('../utils/inviteTracker');
const { handleReady } = require('./events/ready');
const { handleGuildMemberRemove } = require('./events/guildMemberRemove');
const { handleGuildMemberAdd } = require('./events/guildMemberAdd');
const { handleGuildMemberUpdate } = require('./events/guildMemberUpdate');
const { handleRoleDeleteEvent } = require('./events/roleDelete');
const { handleInteractionCreate } = require('./events/interactionCreate');
const { handleMessageCreate } = require('./events/messageCreate');
const { handleVoiceStateUpdate } = require('./events/voiceStateUpdate');
const { handleMessageReactionAdd } = require('./events/messageReactionAdd');
const { handleMessageReactionRemove } = require('./events/messageReactionRemove');

function createRuntimeContext(client) {
  const socialsGuildId = process.env.SOCIALS_GUILD_ID || '';
  const degeneracyGuildId = process.env.DEGENERACY_GUILD_ID || '';

  return {
    client,
    prefix: ['nico', 'n', '!'],
    pandaEmojiName: process.env.PANDA_EMOJI_NAME || 'SN_RooHappi',
    pirateEmojiName: 'RooPirateCap',
    bumpCapPerDay: 5,
    pirateChanceTop5: 0.005,
    pirateChanceRest: 0.05,
    voiceMinutesPerPanda: 60,
    voiceCheckIntervalMs: 60_000,
    voiceResyncIntervalMs: 10 * 60 * 1000,
    voiceActivityTracker: new Map(),
    pirateMessageCounter: new Map(),
    socialsGuildId,
    degeneracyGuildId,
    disboardBotId: '302050872383242240',
    trackedGuilds: [socialsGuildId, degeneracyGuildId].filter(Boolean),
  };
}

function registerEvents(client) {
  const context = createRuntimeContext(client);

  client.once('ready', async () => handleReady(context));
  client.on('inviteCreate', (invite) => handleInviteCreate(invite));
  client.on('inviteDelete', (invite) => handleInviteDelete(invite));
  client.on('guildMemberRemove', async (member) => handleGuildMemberRemove(member, context));
  client.on('guildMemberAdd', async (member) => handleGuildMemberAdd(member, context));
  client.on('guildMemberUpdate', (oldMember, newMember) => handleGuildMemberUpdate(oldMember, newMember));
  client.on('roleDelete', async (role) => handleRoleDeleteEvent(role, context));
  client.on('interactionCreate', async (interaction) => handleInteractionCreate(interaction));
  client.on('messageCreate', async (message) => handleMessageCreate(message, context));
  client.on('voiceStateUpdate', (oldState, newState) => handleVoiceStateUpdate(oldState, newState, context));
  client.on('messageReactionAdd', async (reaction, user) => handleMessageReactionAdd(reaction, user, context));
  client.on('messageReactionRemove', async (reaction, user) => handleMessageReactionRemove(reaction, user));

  return context;
}

module.exports = { registerEvents, createRuntimeContext };
