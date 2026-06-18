const { getUserRoles, updateRole } = require('./storage');
const {
  botCanManageRoles,
  userCanManageRoles,
  canModifyMember,
  isMention,
  parseMention,
  getTargetMember,
} = require('./permissions');

async function set(message, args) {
  if (!botCanManageRoles(message.guild)) {
    return message.reply('❌ Bot lacks ManageRoles permission.');
  }

  if (args.length > 0 && isMention(args[0])) {
    return setForUser(message, args);
  }

  return message.reply('Use `!role menu` to create or edit your role.');
}

async function setForUser(message, args) {
  if (!userCanManageRoles(message.member)) {
    return message.reply('❌ You need the Manage Roles permission to unassign roles from others.');
  }

  const targetUserId = parseMention(args.shift());
  const targetMember = await getTargetMember(message.guild, targetUserId);
  if (!targetMember) return message.reply('❌ User not found.');

  if (!canModifyMember(message.member, targetMember)) {
    return message.reply('❌ You cannot modify roles for someone with equal or higher rank than you.');
  }

  if (args.length === 1 && args[0].toLowerCase() === 'none') {
    const targetUserRoles = getUserRoles(message.guild.id, targetUserId);
    if (targetUserRoles.length === 0) {
      return message.reply(`❌ ${targetMember.user.tag} doesn't have a custom role.`);
    }
    const roleData = targetUserRoles[targetUserRoles.length - 1];
    const role = message.guild.roles.cache.get(roleData.roleId);
    try {
      if (role) await targetMember.roles.remove(role);
      updateRole(message.guild.id, roleData.roleId, { creatorId: null });
      return message.reply(`✅ Unassigned role **${roleData.name}** from ${targetMember.user.tag}. Role is now unowned.`);
    } catch {
      return message.reply('❌ Failed to unassign role.');
    }
  }

  return message.reply('Usage: `!role set @user none`. Use `!role menu @user` to assign or edit roles.');
}

module.exports = { set, setForUser };
