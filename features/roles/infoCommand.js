const { getUserRoles, findRoleByName } = require('./storage');

async function info(message, args) {
  const name = args.join(' ');
  let roleId, data;

  if (!name) {
    const userRoles = getUserRoles(message.guild.id, message.author.id);
    if (userRoles.length === 0) {
      return message.reply('❌ You have no custom role. Use `!role info "name"` to look up other roles.');
    }
    const roleData = userRoles[userRoles.length - 1];
    roleId = roleData.roleId;
    data = roleData;
  } else {
    const found = findRoleByName(message.guild.id, name);
    if (!found) return message.reply('❌ Role not found.');
    [roleId, data] = found;
  }

  const role = message.guild.roles.cache.get(roleId);
  const creator = data.creatorId
    ? await message.guild.members.fetch(data.creatorId).catch(() => null)
    : null;

  const colorDisplay = data.color2
    ? `\`${data.color}\` → \`${data.color2}\` (gradient)`
    : `\`${data.color}\``;

  return message.reply(
    `**Role Info: ${data.name}**\n` +
    `Color: ${colorDisplay}\n` +
    `Members: ${role?.members.size ?? 0}\n` +
    `Owner: ${creator?.user.tag ?? 'Unassigned'}`
  );
}

module.exports = { info };
