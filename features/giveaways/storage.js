const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'giveaways.json');

// In-memory cache to avoid reading from disk on every operation
let giveawayCache = null;

function loadData() {
  if (giveawayCache !== null) return giveawayCache;
  giveawayCache = readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('Error loading giveaway data:', err),
  });
  return giveawayCache;
}

function saveData(data) {
  try {
    writeJsonFileAtomic(DATA_FILE, data, { ensureDirectory: true });
    giveawayCache = data;
  } catch (err) {
    console.error('Error saving giveaway data:', err);
    throw err;
  }
}

/**
 * Get all giveaways for a guild.
 * @param {string} guildId
 * @returns {Object} Map of giveawayId -> giveaway data
 */
function getGuildGiveaways(guildId) {
  const data = loadData();
  return data[guildId] || {};
}

/**
 * Get a specific giveaway by ID.
 * @param {string} guildId
 * @param {string} giveawayId
 * @returns {Object|null}
 */
function getGiveaway(guildId, giveawayId) {
  const data = loadData();
  return data[guildId]?.[giveawayId] || null;
}

/**
 * Insert or update a giveaway (used for initial creation).
 * @param {string} guildId
 * @param {string} giveawayId
 * @param {Object} giveawayData - Should include: prize, winnerCount, endAtMs, allowRoleIds, setupMessageId, channelId, status
 */
function upsertGiveaway(guildId, giveawayId, giveawayData) {
  const data = loadData();
  if (!data[guildId]) {
    data[guildId] = {};
  }
  data[guildId][giveawayId] = giveawayData;
  saveData(data);
}

/**
 * Update specific fields of an existing giveaway.
 * @param {string} guildId
 * @param {string} giveawayId
 * @param {Object} updates - Fields to update
 */
function updateGiveaway(guildId, giveawayId, updates) {
  const data = loadData();
  if (!data[guildId]?.[giveawayId]) return null;
  data[guildId][giveawayId] = { ...data[guildId][giveawayId], ...updates };
  saveData(data);
  return data[guildId][giveawayId];
}

/**
 * Get all active (non-ended) giveaways for a guild.
 * @param {string} guildId
 * @returns {Array} Array of giveaway objects with their IDs
 */
function getActiveGiveaways(guildId) {
  const giveaways = getGuildGiveaways(guildId);
  return Object.entries(giveaways)
    .filter(([_, ga]) => ga.status === 'active')
    .map(([id, ga]) => ({ id, ...ga }));
}

/**
 * Get all active giveaways across all guilds.
 * @returns {Array} Array of { id, guildId, ...giveawayData }
 */
function getAllActiveGiveaways() {
  const data = loadData();
  const results = [];
  for (const [guildId, giveaways] of Object.entries(data)) {
    for (const [gaId, ga] of Object.entries(giveaways)) {
      if (ga.status === 'active') {
        results.push({ id: gaId, guildId, ...ga });
      }
    }
  }
  return results;
}

/**
 * Find an active giveaway by its message ID.
 * @param {string} guildId
 * @param {string} messageId
 * @returns {Object|null} Returns giveaway object with id field, or null
 */
function findActiveGiveawayByMessage(guildId, messageId) {
  const giveaways = getGuildGiveaways(guildId);
  const entry = Object.entries(giveaways).find(
    ([_, ga]) => ga.giveawayMessageId === messageId && ga.status === 'active'
  );
  if (!entry) return null;
  const [id, ga] = entry;
  return { id, ...ga };
}

/**
 * Mark a giveaway as ended.
 * @param {string} guildId
 * @param {string} giveawayId
 * @param {number} endedAtMs - Timestamp when giveaway ended
 * @param {string[]} winnerUserIds - Array of user IDs who won
 */
function markGiveawayEnded(guildId, giveawayId, endedAtMs, winnerUserIds = []) {
  return updateGiveaway(guildId, giveawayId, { 
    status: 'ended',
    endedAtMs,
    winnerUserIds
  });
}

module.exports = {
  getGuildGiveaways,
  getGiveaway,
  upsertGiveaway,
  updateGiveaway,
  getActiveGiveaways,
  getAllActiveGiveaways,
  findActiveGiveawayByMessage,
  markGiveawayEnded,
};
