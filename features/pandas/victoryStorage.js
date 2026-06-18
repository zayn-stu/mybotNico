const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'victoryPandas.json');

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  cache = readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('[victoryStorage] Error loading data:', err),
  });
  return cache;
}

function saveData(data) {
  try {
    writeJsonFileAtomic(DATA_FILE, data, { ensureDirectory: true });
    cache = data;
  } catch (err) {
    console.error('[victoryStorage] Error saving data:', err);
    throw err;
  }
}

function addVictory(guildId, userId, username) {
  const data = loadData();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = { username, victories: 0 };
  data[guildId][userId].username = username;
  data[guildId][userId].victories = (data[guildId][userId].victories || 0) + 1;
  saveData(data);
  return data[guildId][userId].victories;
}

/**
 * Returns a { userId: victoryCount } map for a guild — used for efficient leaderboard lookups.
 */
function getVictoriesMap(guildId) {
  const data = loadData();
  if (!data[guildId]) return {};
  const map = {};
  for (const [userId, entry] of Object.entries(data[guildId])) {
    map[userId] = entry.victories || 0;
  }
  return map;
}

function getVictoryLeaderboard(guildId, limit = 10) {
  const data = loadData();
  if (!data[guildId]) return [];

  const entries = Object.entries(data[guildId])
    .map(([userId, entry]) => ({ userId, username: entry.username, victories: entry.victories || 0 }))
    .filter(e => e.victories > 0)
    .sort((a, b) => b.victories - a.victories)
    .slice(0, limit);

  return entries;
}

module.exports = { addVictory, getVictoriesMap, getVictoryLeaderboard };
