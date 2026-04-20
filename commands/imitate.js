// Cooldown: userId -> timestamp of last use
const cooldowns = new Map();
const COOLDOWN_MS = 10_000; // 10 seconds

module.exports = {
  name: 'imitate',
  description: 'Imitate another user by sending a message with their profile picture and nickname',
  usage: '!imitate @user {message}',
  async execute(message, args) {
    // Permission guard: require Manage Messages to use this command
    const { PermissionFlagsBits } = require('discord.js');
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('❌ You need the Manage Messages permission to use this command.');
    }

    // Cooldown check
    const now = Date.now();
    const lastUsed = cooldowns.get(message.author.id) || 0;
    const remaining = COOLDOWN_MS - (now - lastUsed);
    if (remaining > 0) {
      return message.reply(`⏳ Please wait ${(remaining / 1000).toFixed(1)}s before using this again.`);
    }
    cooldowns.set(message.author.id, now);

    // Get the mentioned member (not just user, so we can get server nickname)
    const targetMember = message.mentions.members.first();

    if (!targetMember) {
      return message.reply('Please mention a user to imitate! Usage: `!imitate @user {message}`');
    }

    // Get the message content (everything after the user mention)
    const messageContent = args.slice(1).join(' ');

    if (!messageContent || messageContent.trim() === '') {
      return message.reply('Please provide a message to send! Usage: `!imitate @user {message}`');
    }

    try {
      // Delete the original command message FIRST for speed
      await message.delete();

      // Use the member's display name (nickname if set, otherwise username)
      const displayName = targetMember.displayName;
      const avatarURL = targetMember.user.displayAvatarURL({ dynamic: true });

      // Create a webhook in the current channel
      const webhook = await message.channel.createWebhook({
        name: displayName,
        avatar: avatarURL,
      });

      // Send the message using the webhook
      await webhook.send({
        content: messageContent,
        username: displayName,
        avatarURL: avatarURL,
      });

      // Delete the webhook to keep things clean
      await webhook.delete();

    } catch (error) {
      console.error('Error in imitate command:', error);
      // Can't reply to deleted message, so just log it
      if (error.code !== 10008) { // Unknown Message error
        console.error('Failed to execute imitate command');
      }
    }
  }
};
