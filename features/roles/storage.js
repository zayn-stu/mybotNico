const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const ROLES_FILE = path.join(__dirname, '..', '..', 'data', 'roles.json');

// In-memory cache to avoid reading from disk on every operation
let rolesCache = null;

function loadRoles() {
  if (rolesCache !== null) return rolesCache;
  rolesCache = readJsonFile(ROLES_FILE, {});
  return rolesCache;
}

function saveRoles(data) {
  try {
    writeJsonFileAtomic(ROLES_FILE, data, { ensureDirectory: true });
    rolesCache = data;
  } catch (err) {
    console.error('Error saving roles data:', err);
    throw err;
  }
}

/**
 * Returns the position boundaries for color roles.
 * Color roles are those with position strictly between the bots separator (bottom)
 * and the color separator (top).
 */
function getColorRoleBounds(guild) {
  const colorSepId = process.env.COLOR_SEPARATOR_ROLE_ID;
  const botsSepId = process.env.BOTS_SEPARATOR_ROLE_ID;

  const colorSep = colorSepId ? guild.roles.cache.get(colorSepId) : null;
  const botsSep = botsSepId ? guild.roles.cache.get(botsSepId) : null;

  return {
    topPosition: colorSep ? colorSep.position : Infinity,
    bottomPosition: botsSep ? botsSep.position : -1,
  };
}

/**
 * Returns true if a role is a color role (between the two separator roles).
 */
function isColorRole(role, guild) {
  const { topPosition, bottomPosition } = getColorRoleBounds(guild);
  return role.position < topPosition && role.position > bottomPosition;
}

/**
 * Syncs the DB with the actual Discord state for a guild.
 * - Removes DB entries for roles that no longer exist in Discord.
 * - Removes DB entries for roles that are no longer in the color role range.
 * - Adds/updates DB entries for roles in the color role range that aren't in the DB.
 * - Determines ownership from actual Discord member role assignments.
 * - Auto-deletes roles whose owner has left the server (no members have the role).
 *
 * Returns the updated guild roles map.
 */
async function syncColorRoles(guild) {
  const roles = loadRoles();
  if (!roles[guild.id]) roles[guild.id] = {};

  const { topPosition, bottomPosition } = getColorRoleBounds(guild);

  // Fetch all members to get accurate role assignments
  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    console.error('[roleStorage] Failed to fetch members for sync:', err);
    members = guild.members.cache;
  }

  // Build a map of roleId -> first memberId who has it (for ownership detection)
  const roleOwnerMap = new Map();
  for (const [memberId, member] of members) {
    for (const [roleId] of member.roles.cache) {
      if (!roleOwnerMap.has(roleId)) {
        roleOwnerMap.set(roleId, memberId);
      }
    }
  }

  // Get all actual color roles from Discord
  const discordColorRoles = guild.roles.cache.filter(
    r => r.position < topPosition && r.position > bottomPosition
  );

  // Remove DB entries for roles that no longer exist or are out of range
  for (const roleId of Object.keys(roles[guild.id])) {
    if (!discordColorRoles.has(roleId)) {
      delete roles[guild.id][roleId];
    }
  }

  // Add/update DB entries for Discord color roles
  for (const [roleId, role] of discordColorRoles) {
    if (!roles[guild.id][roleId]) {
      // New role not in DB — add it with detected owner
      const ownerId = roleOwnerMap.get(roleId) || null;
      roles[guild.id][roleId] = {
        name: role.name,
        color: role.hexColor !== '#000000' ? role.hexColor.toUpperCase() : '#000001',
      };
      if (ownerId) roles[guild.id][roleId].creatorId = ownerId;
    } else {
      // Existing entry — update name from Discord (source of truth)
      roles[guild.id][roleId].name = role.name;

      // If the stored owner is no longer in the guild, update ownership from Discord
      const storedOwnerId = roles[guild.id][roleId].creatorId;
      if (storedOwnerId && !members.has(storedOwnerId)) {
        // Owner left — check if anyone else has the role
        const currentOwner = roleOwnerMap.get(roleId);
        if (currentOwner) {
          roles[guild.id][roleId].creatorId = currentOwner;
        } else {
          delete roles[guild.id][roleId].creatorId;
        }
      }
    }
  }

  saveRoles(roles);
  return roles[guild.id];
}

/**
 * Auto-deletes color roles in a guild that have no members assigned to them
 * (i.e., the owner left and no one else has the role).
 * Returns an array of deleted role names.
 */
async function cleanupOrphanedRoles(guild) {
  const roles = loadRoles();
  if (!roles[guild.id]) return [];

  const { topPosition, bottomPosition } = getColorRoleBounds(guild);
  const deleted = [];

  let members;
  try {
    members = await guild.members.fetch();
  } catch {
    members = guild.members.cache;
  }

  // Build set of roleIds that at least one member has
  const assignedRoleIds = new Set();
  for (const [, member] of members) {
    for (const [roleId] of member.roles.cache) {
      assignedRoleIds.add(roleId);
    }
  }

  for (const [roleId, data] of Object.entries(roles[guild.id])) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    // Only process color roles
    if (role.position >= topPosition || role.position <= bottomPosition) continue;

    // If no member has this role, delete it
    if (!assignedRoleIds.has(roleId)) {
      try {
        await role.delete('Auto-cleanup: no members assigned to this color role');
        delete roles[guild.id][roleId];
        deleted.push(data.name || role.name);
        console.log(`[roleStorage] Auto-deleted orphaned role: ${data.name || role.name} (${roleId})`);
      } catch (err) {
        console.error(`[roleStorage] Failed to delete orphaned role ${roleId}:`, err);
      }
    }
  }

  if (deleted.length > 0) saveRoles(roles);
  return deleted;
}

function getUserRoles(guildId, userId) {
  const roles = loadRoles();
  const guildRoles = roles[guildId] || {};
  return Object.entries(guildRoles)
    .filter(([_, data]) => data.creatorId === userId)
    .map(([roleId, data]) => ({ roleId, ...data }));
}

function getGuildRoles(guildId) {
  const roles = loadRoles();
  return roles[guildId] || {};
}

function addRole(guildId, roleId, creatorId, name, color, color2 = null) {
  const roles = loadRoles();
  if (!roles[guildId]) roles[guildId] = {};
  const roleData = { name, color };
  if (creatorId) roleData.creatorId = creatorId;
  if (color2) roleData.color2 = color2;
  roles[guildId][roleId] = roleData;
  saveRoles(roles);
}

function removeRole(guildId, roleId) {
  const roles = loadRoles();
  if (roles[guildId]) {
    delete roles[guildId][roleId];
    saveRoles(roles);
  }
}

function updateRole(guildId, roleId, updates) {
  const roles = loadRoles();
  if (roles[guildId]?.[roleId]) {
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        delete roles[guildId][roleId][key];
      } else {
        roles[guildId][roleId][key] = value;
      }
    }
    saveRoles(roles);
  }
}

function findRoleByName(guildId, name) {
  const roles = loadRoles();
  const guildRoles = roles[guildId] || {};
  return Object.entries(guildRoles).find(([_, data]) =>
    data.name?.toLowerCase() === name.toLowerCase()
  );
}

module.exports = {
  getUserRoles,
  getGuildRoles,
  addRole,
  removeRole,
  updateRole,
  findRoleByName,
  syncColorRoles,
  cleanupOrphanedRoles,
  isColorRole,
};
