const { getUserRoles, removeRole, findRoleByName } = require('./storage');
const {
  botCanManageRoles,
  userCanManageRoles,
  canModifyMember,
  getTargetMember,
} = require('./permissions');

async function deleteRole(message, args) {
  if (!botCanManageRoles(message.guild)) {
    return message.reply('❌ Bot lacks ManageRoles permission.');
  }

  let roleData;

  if (args.length > 0) {
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to delete other users\' roles.');
    }

    const targetRoleName = args.join(' ');
    const found = findRoleByName(message.guild.id, targetRoleName);
    if (!found) return message.reply(`❌ Role "${targetRoleName}" not found.`);

    const [roleId, data] = found;
    roleData = { roleId, ...data };

    if (roleData.creatorId && roleData.creatorId !== message.author.id) {
      const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
      if (roleOwner && !canModifyMember(message.member, roleOwner)) {
        return message.reply('❌ You cannot delete roles belonging to someone with equal or higher rank than you.');
      }
    }
  } else {
    const userRoles = getUserRoles(message.guild.id, message.author.id);
    if (userRoles.length === 0) {
      return message.reply('❌ You have no custom roles to delete.');
    }
    roleData = userRoles[userRoles.length - 1];
  }

  const role = message.guild.roles.cache.get(roleData.roleId);

  try {
    if (role) await role.delete(`Deleted by ${message.author.tag}`);
    removeRole(message.guild.id, roleData.roleId);
    return message.reply(`✅ Deleted role **${roleData.name}**`);
  } catch (err) {
    console.error('[role delete] Error:', err);
    return message.reply(`❌ Failed to delete role: ${err.message}`);
  }
}

module.exports = { deleteRole };
