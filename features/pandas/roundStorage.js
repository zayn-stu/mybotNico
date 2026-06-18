const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'roundHistory.json');

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  cache = readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('[roundStorage] Error loading data:', err),
  });
  return cache;
}

function saveData(data) {
  try {
    writeJsonFileAtomic(DATA_FILE, data, { ensureDirectory: true });
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
