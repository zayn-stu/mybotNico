const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/pandas.json');

// In-memory cache to avoid reading from disk on every operation
let pandaCache = null;

function loadData() {
  if (pandaCache !== null) return pandaCache;
  try {
    if (!fs.existsSync(DATA_FILE)) {
      pandaCache = {};
      return pandaCache;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    pandaCache = JSON.parse(raw);
    return pandaCache;
  } catch (err) {
    console.error('Error loading panda data:', err);
    pandaCache = {};
    return pandaCache;
  }
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write atomically to reduce risk of partial/corrupt JSON.
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
    pandaCache = data;
  } catch (err) {
    console.error('Error saving panda data:', err);
    throw err;
  }
}

function addPanda(guildId, userId, username, amount = 1) {
  const data = loadData();

  if (!data[guildId]) {
    data[guildId] = {};
  }

  if (!data[guildId][userId]) {
    data[guildId][userId] = {
      username: username,
      count: 0
    };
  }

  data[guildId][userId].count += amount;
  data[guildId][userId].username = username; // Update username in case it changed

  // If they were marked as left (e.g. rejoined and got a panda), clear the flag
  if (data[guildId][userId].left) {
    delete data[guildId][userId].left;
  }

  saveData(data);
  return data[guildId][userId].count;
}

function deductPandas(guildId, userId, amount) {
  const data = loadData();
  if (!data[guildId]?.[userId]) return 0;
  data[guildId][userId].count = Math.max(0, data[guildId][userId].count - amount);
  saveData(data);
  return data[guildId][userId].count;
}

function getPandaCount(guildId, userId) {
  const data = loadData();
  if (!data[guildId] || !data[guildId][userId]) {
    return 0;
  }
  return data[guildId][userId].count;
}

/**
 * Marks a member's panda entry as left (hides from leaderboard).
 * Data is preserved so it can be restored if they rejoin.
 */
function markMemberLeft(guildId, userId) {
  const data = loadData();
  if (data[guildId]?.[userId]) {
    data[guildId][userId].left = true;
    saveData(data);
    console.log(`[pandaStorage] Marked ${userId} as left in guild ${guildId}`);
  }
}

/**
 * Restores a member's panda entry when they rejoin (clears the left flag).
 */
function restoreMember(guildId, userId) {
  const data = loadData();
  if (data[guildId]?.[userId]?.left) {
    delete data[guildId][userId].left;
    saveData(data);
    console.log(`[pandaStorage] Restored ${userId} in guild ${guildId} (rejoined)`);
    return true;
  }
  return false;
}

/**
 * Returns the leaderboard for a guild.
 * @param {string} guildId
 * @param {number} limit
 * @param {object} options
 * @param {boolean} options.includeLeft - include members who have left (default false)
 */
function getLeaderboard(guildId, limit = 10, { includeLeft = false } = {}) {
  const data = loadData();
  if (!data[guildId]) {
    return [];
  }

  const entries = Object.entries(data[guildId])
    .filter(([_, userData]) => (includeLeft || !userData.left) && userData.count > 0)
    .map(([userId, userData]) => ({
      userId,
      username: userData.username,
      count: userData.count,
    }));

  // Sort by count descending
  entries.sort((a, b) => b.count - a.count);

  return entries.slice(0, limit);
}

// ─── Staff hide/show toggle ───────────────────────────────────────────────────

// In-memory toggle per guild (resets on bot restart — intentional, simple)
const staffHiddenMap = new Map();

/**
 * Returns whether staff are currently hidden on the leaderboard for a guild.
 * @param {string} guildId
 * @returns {boolean}
 */
function getStaffHidden(guildId) {
  return staffHiddenMap.get(guildId) ?? false;
}

/**
 * Sets the staff hidden state for a guild.
 * @param {string} guildId
 * @param {boolean} hidden
 */
function setStaffHidden(guildId, hidden) {
  staffHiddenMap.set(guildId, hidden);
}

/**
 * Resets all panda counts for a guild — deletes all user entries entirely.
 * Victories are stored separately in victoryPandas.json and are unaffected.
 */
function resetRoundData(guildId) {
  const data = loadData();
  if (!data[guildId]) return;
  data[guildId] = {};
  saveData(data);
}

function resetAllPandas() {
  saveData({});
}

module.exports = {
  addPanda,
  deductPandas,
  getPandaCount,
  getLeaderboard,
  resetAllPandas,
  resetRoundData,
  markMemberLeft,
  restoreMember,
  getStaffHidden,
  setStaffHidden,
};
