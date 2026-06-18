const { syncColorRoles, cleanupOrphanedRoles } = require('./storage');
const { botCanManageRoles, userCanManageRoles } = require('./permissions');

async function sync(message) {
  if (!userCanManageRoles(message.member)) {
    return message.reply('❌ You need the Manage Roles permission to sync roles.');
  }
  if (!botCanManageRoles(message.guild)) {
    return message.reply('❌ Bot lacks ManageRoles permission.');
  }

  try {
    const guildRoles = await syncColorRoles(message.guild);
    const count = Object.keys(guildRoles).length;
    return message.reply(`✅ Synced color roles. ${count} role(s) now tracked.`);
  } catch (err) {
    console.error('[role sync] Error:', err);
    return message.reply(`❌ Sync failed: ${err.message}`);
  }
}

async function cleanup(message) {
  if (!userCanManageRoles(message.member)) {
    return message.reply('❌ You need the Manage Roles permission to run cleanup.');
  }
  if (!botCanManageRoles(message.guild)) {
    return message.reply('❌ Bot lacks ManageRoles permission.');
  }

  try {
    const deleted = await cleanupOrphanedRoles(message.guild);
    if (deleted.length === 0) {
      return message.reply('✅ No orphaned color roles found.');
    }
    return message.reply(`✅ Deleted ${deleted.length} orphaned role(s): **${deleted.join('**, **')}**`);
  } catch (err) {
    console.error('[role cleanup] Error:', err);
    return message.reply(`❌ Cleanup failed: ${err.message}`);
  }
}

module.exports = { sync, cleanup };
