const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/voiceRewardTracking.json');
const MAX_VOICE_PANDAS_PER_DAY = 3;

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(DATA_FILE)) { cache = {}; return cache; }
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return cache;
  } catch (err) {
    console.error('[voiceRewardTracking] Error loading data:', err);
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
 * Awards voice pandas up to the daily cap.
 * @returns {number} The number of pandas actually awarded (may be 0 if capped).
 */
function awardVoicePandas(guildId, userId, earned) {
  const data = loadData();
  const today = getTodayUTC();
  if (!data[guildId]) data[guildId] = {};

  const entry = data[guildId][userId];
  const currentCount = (entry && entry.date === today) ? entry.count : 0;
  const remaining = Math.max(0, MAX_VOICE_PANDAS_PER_DAY - currentCount);
  const actual = Math.min(earned, remaining);

  if (actual <= 0) return 0;

  data[guildId][userId] = { date: today, count: currentCount + actual };
  saveData(data);
  return actual;
}

module.exports = { getTodayVoiceCount, awardVoicePandas };
