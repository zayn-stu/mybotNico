module.exports = {
  name: 'help',
  description: 'Shows all available commands',
  execute(message, args) {
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === 'admin') {
      return message.reply(
        '**Admin Commands** (Manage Roles permission):\n\n' +
        '**Role Management:**\n' +
        '`!role menu create` - Create an unowned role\n' +
        '`!role menu @user` - Assign or edit a user role\n' +
        '`!role set @user none` - Unassign role from user (keeps role)\n' +
        '`!role delete {role}` - Delete any role\n' +
        '`!role sync` - Sync tracked color roles from Discord\n' +
        '`!role cleanup` - Delete orphaned color roles\n\n' +
        '**Moderation Commands:**\n' +
        '`!purge {count}` - Delete the last {count} messages (1-100)\n\n' +
        '**Owner Commands:**\n' +
        '`!reset pandas` - Reset panda leaderboard data\n' +
        '`!record on` / `!record off` - Start or stop screen recording\n\n' +
        '**Note:** Admins cannot modify roles belonging to higher-ranked users.'
      );
    }

    message.reply(
      '**Available Commands:**\n\n' +
      '**!ping** - Check bot responsiveness\n' +
      '**!role** - Manage custom color roles\n' +
      '  • `!role help` - See all role commands\n\n' +
      '**!panda** - Panda collection system\n' +
      '  • `!panda help` - See all panda commands\n\n' +
      '**Voice**\n' +
      '  • `!join` - Join your current voice channel\n' +
      '  • `!join <voice_channel_id>` - Join a specific voice channel\n' +
      '  • `!leave` - Leave voice chat\n' +
      '  • `!record` - Show screen recording status\n' +
      '  • `!clip [note]` - Save a screen clip from the active recording\n\n' +
      '**Nico\'s Cave** - Dungeon raid game\n' +
      '  • `!play` - Run a dungeon raid\n' +
      '  • `!store` - Buy gear\n' +
      '  • `!profile` - View stats and equipped gear\n' +
      '  • `!inventory` - Equip, unequip, and sell items\n\n' +
      '**!imitate** @user {message} - Send a message as another user\n\n' +
      '**!help admin** - See admin-only commands\n'
    );
  }
};
