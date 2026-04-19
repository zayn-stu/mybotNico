const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'memberRoles.json');

let memoryCache = null;

function loadMemory() {
  if (memoryCache !== null) return memoryCache;
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      memoryCache = {};
      return memoryCache;
    }
    memoryCache = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    return memoryCache;
  } catch {
    memoryCache = {};
    return memoryCache;
  }
}

function saveMemory(data) {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tempFile = `${MEMORY_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, MEMORY_FILE);
    memoryCache = data;
  } catch (err) {
    console.error('Error saving member role memory:', err);
  }
}

/**
 * Saves the color role ID for a member when they leave.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} roleId
 */
function saveColorRoleForMember(guildId, userId, roleId) {
  const memory = loadMemory();
  if (!memory[guildId]) memory[guildId] = {};
  memory[guildId][userId] = roleId;
  saveMemory(memory);
}

/**
 * Retrieves the saved color role ID for a member (if any).
 * @param {string} guildId
 * @param {string} userId
 * @returns {string|null}
 */
function getSavedColorRole(guildId, userId) {
  const memory = loadMemory();
  return memory[guildId]?.[userId] || null;
}

/**
 * Clears the saved color role for a member (e.g. after successful re-assignment).
 * @param {string} guildId
 * @param {string} userId
 */
function clearSavedColorRole(guildId, userId) {
  const memory = loadMemory();
  if (memory[guildId]?.[userId]) {
    delete memory[guildId][userId];
    saveMemory(memory);
  }
}

/**
 * Removes all saved entries pointing to a specific roleId across all users in a guild.
 * Called when a role is deleted so stale references are cleaned up.
 * @param {string} guildId
 * @param {string} roleId
 */
function clearSavedRoleById(guildId, roleId) {
  const memory = loadMemory();
  if (!memory[guildId]) return;
  let changed = false;
  for (const [userId, savedRoleId] of Object.entries(memory[guildId])) {
    if (savedRoleId === roleId) {
      delete memory[guildId][userId];
      changed = true;
    }
  }
  if (changed) saveMemory(memory);
}

module.exports = {
  saveColorRoleForMember,
  getSavedColorRole,
  clearSavedColorRole,
  clearSavedRoleById,
};
