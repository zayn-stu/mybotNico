const { removeRole } = require('./storage');
const { clearSavedRoleById } = require('../../utils/memberRoleMemory');

/**
 * Handles the roleDelete Discord event.
 * If the deleted role was a color role (between the two separator roles),
 * removes it from the DB and clears any leave-memory entries pointing to it.
 */
async function handleRoleDelete(role) {
  try {
    const guild = role.guild;

    // Check if this was a color role using position bounds
    // Note: after deletion the role is still in the partial cache with its last known position
    const colorSepId = process.env.COLOR_SEPARATOR_ROLE_ID;
    const botsSepId = process.env.BOTS_SEPARATOR_ROLE_ID;

    const colorSep = colorSepId ? guild.roles.cache.get(colorSepId) : null;
    const botsSep = botsSepId ? guild.roles.cache.get(botsSepId) : null;

    const topPosition = colorSep ? colorSep.position : Infinity;
    const bottomPosition = botsSep ? botsSep.position : -1;

    // role.position is still available on the deleted role object
    const wasColorRole = role.position < topPosition && role.position > bottomPosition;

    if (!wasColorRole) return;

    console.log(`[roleDelete] Color role deleted: ${role.name} (${role.id})`);

    // Remove from DB
    removeRole(guild.id, role.id);

    // Clear any leave-memory entries pointing to this role
    clearSavedRoleById(guild.id, role.id);

    console.log(`[roleDelete] Cleaned up DB and memory for role ${role.id}`);
  } catch (err) {
    console.error('[roleDelete] Error handling role deletion:', err);
  }
}

module.exports = { handleRoleDelete };
