const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'voiceRewardTracking.json');
const MAX_VOICE_PANDAS_PER_DAY = 3;

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  cache = readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('[voiceRewardTracking] Error loading data:', err),
  });
  return cache;
}

function saveData(data) {
  try {
    writeJsonFileAtomic(DATA_FILE, data, { ensureDirectory: true });
    cache = data;
  } catch (err) {
    console.error('[voiceRewardTracking] Error saving data:', err);
  }
}

function getTodayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns how many voice pandas the user has already earned today.
 */
function getTodayVoiceCount(guildId, userId) {
  const data = loadData();
  const entry = data[guildId]?.[userId];
  if (!entry || entry.date !== getTodayUTC()) return 0;
  return entry.count;
}

/**
 * Check if a user is eligible for a voice panda award right now.
 * Returns true if they haven't been awarded in the last VOICE_MINUTES_PER_PANDA minutes.
 * @param {string} guildId
 * @param {string} userId
 * @param {number} voiceMinutesPerPanda - How many minutes must pass between awards
 * @returns {boolean}
 */
function isEligibleForAward(guildId, userId, voiceMinutesPerPanda) {
  const data = loadData();
  const entry = data[guildId]?.[userId];
  if (!entry || entry.date !== getTodayUTC()) return true; // New user today or new day

  const lastAwarded = entry.lastAwardedAt;
  if (!lastAwarded) return true; // Never awarded before

  const elapsedMs = Date.now() - lastAwarded;
  const elapsedMinutes = elapsedMs / 60_000;
  return elapsedMinutes >= voiceMinutesPerPanda;
}

/**
 * Awards 1 voice panda if eligible (respects daily cap).
 * Updates lastAwardedAt timestamp.
 * @returns {boolean} True if panda was awarded, false otherwise.
 */
function awardVoicePanda(guildId, userId) {
  const data = loadData();
  const today = getTodayUTC();
  if (!data[guildId]) data[guildId] = {};

  const entry = data[guildId][userId];
  const currentCount = (entry && entry.date === today) ? entry.count : 0;

  if (currentCount >= MAX_VOICE_PANDAS_PER_DAY) return false; // Hit daily cap

  const now = Date.now();
  data[guildId][userId] = { 
    date: today, 
    count: currentCount + 1,
    lastAwardedAt: now
  };
  saveData(data);
  return true;
}

module.exports = { getTodayVoiceCount, isEligibleForAward, awardVoicePanda };
