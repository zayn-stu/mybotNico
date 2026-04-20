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
    // Simple migration: fill in missing displayNames with usernames (detailed migration happens on bot ready)
    for (const guildId in pandaCache) {
      for (const userId in pandaCache[guildId]) {
        const entry = pandaCache[guildId][userId];
        if (entry && typeof entry === 'object' && !entry.displayName && entry.username) {
          entry.displayName = entry.username;
        }
      }
    }
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

function addPanda(guildId, userId, username, amount = 1, displayName = null) {
  const data = loadData();

  if (!data[guildId]) {
    data[guildId] = {};
  }

  if (!data[guildId][userId]) {
    data[guildId][userId] = {
      username: username,
      displayName: displayName || username,
      count: 0
    };
  }

  data[guildId][userId].count += amount;
  data[guildId][userId].username = username; // Update username in case it changed
  if (displayName) {
    data[guildId][userId].displayName = displayName; // Update display name if provided
  }

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

/**
 * Update a member's display name in the panda data.
 * Called when a member changes their nickname (guildMemberUpdate event).
 */
function updateMemberDisplayName(guildId, userId, displayName) {
  const data = loadData();
  if (data[guildId]?.[userId]) {
    data[guildId][userId].displayName = displayName;
    saveData(data);
  }
}

/**
 * Run migration with guild context to backfill displayNames with actual server nicknames.
 * Fetches leaderboard members from Discord to populate nicknames.
 * Call this after bot is ready and has guild caches populated.
 */
async function migrateDisplayNamesWithGuilds(client) {
  const data = loadData();
  let needsSave = false;
  
  for (const guildId in data) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    
    // Collect all userIds that need display names
    const userIds = Object.keys(data[guildId] || {});
    
    // Fetch them all from Discord
    if (userIds.length > 0) {
      try {
        const members = await guild.members.fetch({ user: userIds });
        for (const userId in data[guildId]) {
          const entry = data[guildId][userId];
          if (entry && typeof entry === 'object' && (!entry.displayName || entry.displayName === entry.username)) {
            const member = members.get(userId);
            if (member) {
              entry.displayName = member.displayName || member.user.username;
              needsSave = true;
            }
          }
        }
      } catch (err) {
        console.warn(`[pandaStorage] Could not fetch members for guild ${guildId}:`, err.message);
      }
    }
  }
  
  if (needsSave) {
    try {
      const tempFile = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
      fs.renameSync(tempFile, DATA_FILE);
      pandaCache = data;
      console.log('[pandaStorage] Migrated displayNames with fetched guild nicknames');
    } catch (err) {
      console.error('[pandaStorage] Failed to save migration:', err);
    }
  }
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
  updateMemberDisplayName,
  migrateDisplayNamesWithGuilds,
};
