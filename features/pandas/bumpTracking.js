const path = require('path');
const { readJsonFile, writeJsonFileDebounced } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'bumpTracking.json');

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  cache = readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('[bumpTracking] Error loading data:', err),
  });
  return cache;
}

function saveData(data) {
  cache = data;
  writeJsonFileDebounced(DATA_FILE, data, { ensureDirectory: true });
}

function getTodayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getTodayBumpCount(guildId, userId) {
  const data = loadData();
  const entry = data[guildId]?.[userId];
  if (!entry || entry.date !== getTodayUTC()) return 0;
  return entry.count;
}

function incrementBumpCount(guildId, userId) {
  const data = loadData();
  const today = getTodayUTC();
  if (!data[guildId]) data[guildId] = {};
  const entry = data[guildId][userId];
  if (!entry || entry.date !== today) {
    data[guildId][userId] = { date: today, count: 1 };
  } else {
    entry.count += 1;
  }
  saveData(data);
}

module.exports = { getTodayBumpCount, incrementBumpCount };
