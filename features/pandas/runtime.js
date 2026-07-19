const path = require('path');
const { readJsonFile, writeJsonFileDebounced } = require('../../shared/jsonStore');

const PANDA_THRESHOLD_MIN = 30;
const PANDA_THRESHOLD_MAX = 40;

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'pandaRuntimeState.json');

// Each guild gets its own panda counter state.
const guildStates = new Map();

function getRandomPandaThreshold() {
  return Math.floor(Math.random() * (PANDA_THRESHOLD_MAX - PANDA_THRESHOLD_MIN + 1)) + PANDA_THRESHOLD_MIN;
}

function loadPersistedState() {
  const data = readJsonFile(STATE_FILE, undefined, {
    onError: err => console.warn('[pandaRuntime] Could not load persisted state:', err.message),
  });
  if (data === undefined) return;
  try {
    for (const [guildId, state] of Object.entries(data)) {
      guildStates.set(guildId, state);
    }
  } catch (err) {
    console.warn('[pandaRuntime] Could not load persisted state:', err.message);
  }
}

function savePersistedState() {
  const data = {};
  for (const [guildId, state] of guildStates.entries()) {
    data[guildId] = state;
  }
  writeJsonFileDebounced(STATE_FILE, data);
}

// Load state from disk on startup
loadPersistedState();

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      messageCount: 0,
      lastUserId: null,
      currentPandaThreshold: getRandomPandaThreshold()
    });
  }

  return guildStates.get(guildId);
}

function registerMessageAndCheckAward(guildId, userId) {
  const state = getGuildState(guildId);
  const countedMessage = userId !== state.lastUserId;
  const threshold = state.currentPandaThreshold;

  // Only count if it's a different user than the previous message.
  if (countedMessage) {
    state.messageCount += 1;
    state.lastUserId = userId;
  }

  const messageCount = state.messageCount;
  const messagesLeft = Math.max(0, threshold - state.messageCount);
  const awarded = state.messageCount >= threshold;

  if (awarded) {
    state.messageCount = 0;
    state.lastUserId = null;
    state.currentPandaThreshold = getRandomPandaThreshold();
  }

  // Persist state after every counted message or award
  if (countedMessage || awarded) {
    savePersistedState();
  }

  return {
    awarded,
    messageCount,
    threshold,
    messagesLeft,
    countedMessage
  };
}

function resetAllPandaRuntimeState() {
  guildStates.clear();
  savePersistedState();
}

module.exports = {
  registerMessageAndCheckAward,
  resetAllPandaRuntimeState
};
