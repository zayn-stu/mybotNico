const { updateMemberDisplayName } = require('../../features/pandas/storage');
const { updateDisplayName } = require('../../features/pandas/memberDisplayNames');

function handleGuildMemberUpdate(oldMember, newMember) {
  if (oldMember.displayName !== newMember.displayName) {
    updateDisplayName(newMember.guild.id, newMember.id, newMember.displayName);
    updateMemberDisplayName(newMember.guild.id, newMember.id, newMember.displayName);
  }
}

module.exports = { handleGuildMemberUpdate };
