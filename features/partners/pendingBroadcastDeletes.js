const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const PENDING_PATH = path.join(__dirname, '..', '..', 'data', 'pendingBroadcastDeletes.json');
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function generateID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function readRaw() {
  const parsed = readJsonFile(PENDING_PATH, {});
  return parsed && Array.isArray(parsed.pending) ? parsed.pending : [];
}

function writeRaw(pending) {
  writeJsonFileAtomic(PENDING_PATH, { pending });
}

function cleanupExpired(pending = readRaw()) {
  const now = Date.now();
  const active = pending.filter(entry => new Date(entry.expiresAt).getTime() > now);
  if (active.length !== pending.length) writeRaw(active);
  return active;
}

function createPendingDelete(input) {
  const pending = cleanupExpired();
  const entry = {
    id: generateID(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    ...input
  };
  pending.push(entry);
  writeRaw(pending);
  return entry;
}

function getByMessage(messageID, channelID) {
  return cleanupExpired().find(entry => {
    return entry.messageID === messageID && (!channelID || entry.channelID === channelID);
  }) || null;
}

function updatePendingDelete(id, patch) {
  const pending = cleanupExpired();
  const index = pending.findIndex(entry => entry.id === id);
  if (index === -1) return null;
  pending[index] = { ...pending[index], ...patch };
  writeRaw(pending);
  return pending[index];
}

function removePendingDelete(id) {
  const pending = cleanupExpired();
  const filtered = pending.filter(entry => entry.id !== id);
  if (filtered.length === pending.length) return false;
  writeRaw(filtered);
  return true;
}

module.exports = {
  createPendingDelete,
  getByMessage,
  updatePendingDelete,
  removePendingDelete,
  cleanupExpired
};
