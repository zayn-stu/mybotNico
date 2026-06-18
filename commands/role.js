const { set, setForUser } = require('../features/roles/unassignCommand');
const { deleteRole } = require('../features/roles/deleteCommand');
const { info } = require('../features/roles/infoCommand');
const { sync, cleanup } = require('../features/roles/maintenanceCommands');
const { menu } = require('../features/roles/menuBuilder');

const subcommands = {
  set,
  setForUser,
  delete: deleteRole,
  info,
  sync,
  cleanup,
  menu,

  async help(message) {
    return message.reply(
      '**Role Commands:**\n' +
      '`!role delete` — Delete your custom role\n' +
      '`!role delete "name"` — Delete a specific role (admin)\n' +
      '`!role menu` — Edit your role (interactive modal)\n' +
      '`!role menu create` — Create an unowned role (admin interactive modal)\n' +
      '`!role menu @user` — Assign or edit a user\'s role (admin interactive modal)\n' +
      '`!role info` — Show your role details\n' +
      '`!role info "name"` — Show a specific role\'s details\n' +
      '`!role set @user none` — Unassign role from user (admin)\n' +
      '`!role sync` — Sync DB with Discord role state (admin)\n' +
      '`!role cleanup` — Delete orphaned color roles (admin)\n' +
      '**Colors:** Hex (#FF5733 or FF5733) or names (red, blue, purple, etc.)\n' +
      '**Note:** Gradient colors must be different.'
    );
  },
};

module.exports = {
  name: 'role',
  description: 'Manage custom color roles',
  async execute(message, args) {
    const subcommand = args.shift()?.toLowerCase() || 'help';
    const handler = subcommands[subcommand];

    if (handler) {
      await handler(message, args);
    } else {
      message.reply(`Unknown subcommand \`${subcommand}\`. Use \`!role help\` for commands.`);
    }
  },
};
