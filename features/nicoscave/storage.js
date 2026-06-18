const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'nicosCavePlayers.json');

function createNicosCaveStorage(filePath = DATA_FILE) {
  let cache = null;

  function loadData() {
    if (cache !== null) return cache;
    cache = readJsonFile(filePath, {}, {
      onError: err => console.error('[nicoscave] Error loading player data:', err),
    });
    return cache;
  }

  function saveData(data) {
    writeJsonFileAtomic(filePath, data, { ensureDirectory: true });
    cache = data;
  }

  function getPlayer(userId) {
    return loadData()[userId] || null;
  }

  function savePlayer(userId, player) {
    const data = loadData();
    data[userId] = player;
    saveData(data);
    return player;
  }

  function resetCache() {
    cache = null;
  }

  return {
    loadData,
    saveData,
    getPlayer,
    savePlayer,
    resetCache,
  };
}

const defaultStorage = createNicosCaveStorage();

module.exports = {
  DATA_FILE,
  createNicosCaveStorage,
  getPlayer: defaultStorage.getPlayer,
  savePlayer: defaultStorage.savePlayer,
  resetCache: defaultStorage.resetCache,
};
