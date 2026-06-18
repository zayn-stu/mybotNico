const path = require('path');
const { readJsonFile, writeJsonFile } = require('../../shared/jsonStore');

const MANAGERS_PATH = path.join(__dirname, '..', '..', 'data', 'partnerManagers.json');

function readManagers() {
  const parsed = readJsonFile(MANAGERS_PATH, {});
  return (parsed && parsed.managers) || [];
}

function writeManagers(managers) {
  writeJsonFile(MANAGERS_PATH, { managers });
}

function getManagerByUserID(userID) {
  const managers = readManagers();
  return managers.find(m => m.userID === userID) || null;
}

function isPartnerManager(userID) {
  return getManagerByUserID(userID) !== null;
}

function addManager(userID, serverName) {
  const managers = readManagers();
  managers.push({
    userID,
    serverName,
    addedAt: new Date().toISOString()
  });
  writeManagers(managers);
}

function removeManager(userID) {
  const managers = readManagers();
  const filtered = managers.filter(m => m.userID !== userID);
  writeManagers(filtered);
  return filtered.length !== managers.length;
}

function listManagers() {
  return readManagers();
}

module.exports = {
  isPartnerManager,
  getManagerByUserID,
  addManager,
  removeManager,
  listManagers
};
