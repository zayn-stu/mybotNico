const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { updateDraft } = require('./setupCache');

async function execute(message, args) {
  if (!message.guild) {
    return message.reply('❌ This command can only be used in a server channel.');
  }

  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
      !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return message.reply('❌ You need the Manage Server permission to use this command.');
  }

  const subcommand = args[0]?.toLowerCase();

  if (subcommand !== 'setup') {
    return message.reply('Usage: `!giveaway setup`');
  }

  updateDraft(message.guild.id, message.author.id, { commandMessageId: message.id });

  const setupButton = new ButtonBuilder()
    .setCustomId('giveaway_setup_open')
    .setLabel('Setup')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder()
    .addComponents(setupButton);

  try {
    await message.reply({
      components: [row],
    });
  } catch (err) {
    console.error('Error sending giveaway setup message:', err);
    return message.reply('❌ Failed to send setup panel.');
  }
}

module.exports = { execute };
