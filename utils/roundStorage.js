const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/roundHistory.json');

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(DATA_FILE)) { cache = {}; return cache; }
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return cache;
  } catch (err) {
    console.error('[roundStorage] Error loading data:', err);
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
    console.error('[roundStorage] Error saving data:', err);
    throw err;
  }
}

/**
 * Returns the next round number for a guild (1-based).
 */
function getNextRoundNumber(guildId) {
  const data = loadData();
  if (!data[guildId]) return 1;
  return Object.keys(data[guildId]).length + 1;
}

/**
 * Saves a completed round's snapshot.
 * @param {string} guildId
 * @param {number} roundNumber
 * @param {string} winnerId
 * @param {string} winnerUsername
 * @param {Array}  leaderboardSnapshot  - array of { userId, username, count }
 */
function saveRound(guildId, roundNumber, winnerId, winnerUsername, leaderboardSnapshot) {
  const data = loadData();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][roundNumber] = {
    roundNumber,
    endedAt: new Date().toISOString(),
    winner: { userId: winnerId, username: winnerUsername },
    leaderboard: leaderboardSnapshot,
  };
  saveData(data);
}

/**
 * Returns a specific round's data for a guild, or null if not found.
 */
function getRound(guildId, roundNumber) {
  const data = loadData();
  return data[guildId]?.[roundNumber] ?? null;
}

module.exports = { getNextRoundNumber, saveRound, getRound };
