const { PermissionFlagsBits } = require('discord.js');

function botCanManageRoles(guild) {
  return guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles);
}

function userCanManageRoles(member) {
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

function canModifyMember(executor, target) {
  return executor.roles.highest.position > target.roles.highest.position;
}

function isMention(str) {
  return /^<@!?\d+>$/.test(str);
}

function parseMention(str) {
  const match = str.match(/^<@!?(\d+)>$/);
  return match ? match[1] : null;
}

async function getTargetMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

module.exports = {
  botCanManageRoles,
  userCanManageRoles,
  canModifyMember,
  isMention,
  parseMention,
  getTargetMember,
};
