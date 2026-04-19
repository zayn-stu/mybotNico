const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'purge',
  description: 'Delete the last X messages in the current channel',
  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server channel.');
    }

    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('❌ You need the Manage Messages permission to use this command.');
    }

    const botMember = message.guild.members.me
      || await message.guild.members.fetchMe().catch(() => null);

    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('❌ I need the Manage Messages permission to delete messages.');
    }

    if (args.length !== 1) {
      return message.reply('Usage: `!purge <message_count>`');
    }

    if (!/^\d+$/.test(args[0])) {
      return message.reply('❌ Message count must be a whole number.');
    }

    const count = Number.parseInt(args[0], 10);

    if (count < 1 || count > 100) {
      return message.reply('❌ Message count must be between 1 and 100.');
    }

    try {
      // Delete command message first so count applies to previous messages.
      await message.delete().catch(() => null);

      const deleted = await message.channel.bulkDelete(count, true);
      const confirmation = await message.channel.send(`✅ Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}.`);

      setTimeout(() => {
        confirmation.delete().catch(() => null);
      }, 3000);
    } catch (error) {
      console.error('Purge command error:', error);
      return message.channel.send('❌ Failed to delete messages. Messages older than 14 days cannot be purged.');
    }
  }
};