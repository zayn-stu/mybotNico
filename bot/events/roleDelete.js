const { handleRoleDelete } = require('../../features/roles/roleDeleteHandler');

async function handleRoleDeleteEvent(role, context) {
  if (role.guild.id !== context.socialsGuildId) return;
  await handleRoleDelete(role);
}

module.exports = { handleRoleDeleteEvent };
