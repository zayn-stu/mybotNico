const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/victoryPandas.json');

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(DATA_FILE)) { cache = {}; return cache; }
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return cache;
  } catch (err) {
    console.error('[victoryStorage] Error loading data:', err);
    cache = {};
    return cache;
  }
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
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

function getVictories(guildId, userId) {
  const data = loadData();
  return data[guildId]?.[userId]?.victories || 0;
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

module.exports = { addVictory, getVictories, getVictoriesMap, getVictoryLeaderboard };
