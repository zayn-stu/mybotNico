const fs = require('fs');
const path = require('path');

const ROLES_FILE = path.join(__dirname, '..', 'data', 'roles.json');

function loadRoles() {
  try {
    return JSON.parse(fs.readFileSync(ROLES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveRoles(data) {
  fs.writeFileSync(ROLES_FILE, JSON.stringify(data, null, 2));
}

function getUserRoles(guildId, userId) {
  const roles = loadRoles();
  const guildRoles = roles[guildId] || {};
  return Object.entries(guildRoles)
    .filter(([_, data]) => data.creatorId === userId)
    .map(([roleId, data]) => ({ roleId, ...data }));
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

function getRoleById(guildId, roleId) {
  const roles = loadRoles();
  const data = roles[guildId]?.[roleId];
  return data ? { roleId, ...data } : null;
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
    // Handle deletions (null values) and updates
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
    data.name.toLowerCase() === name.toLowerCase()
  );
}

module.exports = { loadRoles, saveRoles, getUserRoles, addRole, removeRole, updateRole, findRoleByName, getRoleById };
