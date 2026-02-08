module.exports = {
  name: 'help',
  description: 'Shows all available commands',
  execute(message, args) {
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === 'admin') {
      return message.reply(
        '**Admin Commands** (Manage Roles permission):\n\n' +
        '**Role Management:**\n' +
        '`!role create {name} {color}` - Create unowned role\n' +
        '`!role create {name} {color1} {color2}` - Create unowned gradient role\n' +
        '`!role set @user {name} {color}` - Create/assign role to user\n' +
        '`!role set @user {name} {color1} {color2}` - Gradient for user\n' +
        '`!role set @user {existing role}` - Assign existing unowned role\n' +
        '`!role set @user none` - Unassign role from user (keeps role)\n' +
        '`!role delete {role}` - Delete any role\n' +
        '`!role edit name {role} to {new name}` - Rename any role\n' +
        '`!role edit color {role} {color}` - Change any role\'s color\n' +
        '`!role edit color {role} {color1} {color2}` - Gradient for any role\n\n' +
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
      '**!imitate** @user {message} - Send a message as another user\n\n' +
      '**!help admin** - See admin-only commands\n'
    );
  }
};
