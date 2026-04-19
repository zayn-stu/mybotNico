const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/bumpTracking.json');

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(DATA_FILE)) { cache = {}; return cache; }
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return cache;
  } catch (err) {
    console.error('[bumpTracking] Error loading data:', err);
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
    console.error('[bumpTracking] Error saving data:', err);
  }
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
