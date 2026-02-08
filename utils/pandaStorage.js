const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/pandas.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading panda data:', err);
    return {};
  }
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving panda data:', err);
  }
}

function addPanda(guildId, userId, username) {
  const data = loadData();
  
  if (!data[guildId]) {
    data[guildId] = {};
  }
  
  if (!data[guildId][userId]) {
    data[guildId][userId] = {
      username: username,
      count: 0
    };
  }
  
  data[guildId][userId].count += 1;
  data[guildId][userId].username = username; // Update username in case it changed
  
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

function getLeaderboard(guildId, limit = 10) {
  const data = loadData();
  if (!data[guildId]) {
    return [];
  }
  
  const entries = Object.entries(data[guildId]).map(([userId, userData]) => ({
    userId,
    username: userData.username,
    count: userData.count
  }));
  
  // Sort by count descending
  entries.sort((a, b) => b.count - a.count);
  
  return entries.slice(0, limit);
}

function getTotalPandas(guildId) {
  const data = loadData();
  if (!data[guildId]) {
    return 0;
  }
  
  return Object.values(data[guildId]).reduce((sum, userData) => sum + userData.count, 0);
}

module.exports = {
  addPanda,
  getPandaCount,
  getLeaderboard,
  getTotalPandas
};
