const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DEFAULT_DATA_FILE = path.join(__dirname, '..', '..', 'data', 'verification.json');
let dataFile = DEFAULT_DATA_FILE;

let verificationCache = null;

function defaultState() {
  return {
    meta: {},
    pending: {},
    submissions: {},
  };
}

function loadState() {
  if (verificationCache !== null) return verificationCache;
  const state = readJsonFile(dataFile, defaultState, {
    onError: err => console.error('[verification] Error loading state:', err),
  });
  verificationCache = normalizeState(state);
  return verificationCache;
}

function normalizeState(state) {
  return {
    meta: state?.meta && typeof state.meta === 'object' ? state.meta : {},
    pending: state?.pending && typeof state.pending === 'object' ? state.pending : {},
    submissions: state?.submissions && typeof state.submissions === 'object' ? state.submissions : {},
  };
}

function saveState(state) {
  const normalized = normalizeState(state);
  writeJsonFileAtomic(dataFile, normalized, { ensureDirectory: true });
  verificationCache = normalized;
}

function guildKey(guildId) {
  return String(guildId);
}

function memberKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getGuildMeta(guildId) {
  const state = loadState();
  return state.meta[guildKey(guildId)] || {};
}

function updateGuildMeta(guildId, updates) {
  const state = loadState();
  const key = guildKey(guildId);
  state.meta[key] = {
    ...(state.meta[key] || {}),
    ...updates,
    updatedAt: Date.now(),
  };
  saveState(state);
  return state.meta[key];
}

function getVerifyMessageId(guildId) {
  return getGuildMeta(guildId).verifyMessageId || null;
}

function setVerifyMessageId(guildId, channelId, messageId) {
  return updateGuildMeta(guildId, {
    verifyChannelId: channelId,
    verifyMessageId: messageId,
  });
}

function upsertPendingVerification(guildId, userId, record) {
  const state = loadState();
  const key = memberKey(guildId, userId);
  state.pending[key] = {
    ...(state.pending[key] || {}),
    ...record,
    guildId,
    userId,
    status: record.status || state.pending[key]?.status || 'pending',
    updatedAt: Date.now(),
  };
  saveState(state);
  return state.pending[key];
}

function getPendingVerification(guildId, userId) {
  const state = loadState();
  return state.pending[memberKey(guildId, userId)] || null;
}

function removePendingVerification(guildId, userId) {
  const state = loadState();
  const key = memberKey(guildId, userId);
  const existing = state.pending[key] || null;
  delete state.pending[key];
  saveState(state);
  return existing;
}

function upsertSubmission(guildId, userId, submission) {
  const state = loadState();
  const key = memberKey(guildId, userId);
  state.submissions[key] = {
    ...(state.submissions[key] || {}),
    ...submission,
    guildId,
    userId,
    updatedAt: Date.now(),
  };
  saveState(state);
  return state.submissions[key];
}

function getSubmission(guildId, userId) {
  const state = loadState();
  return state.submissions[memberKey(guildId, userId)] || null;
}

function resetVerificationCacheForTests() {
  verificationCache = null;
}

function setVerificationDataFileForTests(filePath) {
  dataFile = filePath || DEFAULT_DATA_FILE;
  verificationCache = null;
}

module.exports = {
  DATA_FILE: DEFAULT_DATA_FILE,
  loadState,
  saveState,
  getGuildMeta,
  updateGuildMeta,
  getVerifyMessageId,
  setVerifyMessageId,
  upsertPendingVerification,
  getPendingVerification,
  removePendingVerification,
  upsertSubmission,
  getSubmission,
  resetVerificationCacheForTests,
  setVerificationDataFileForTests,
};
