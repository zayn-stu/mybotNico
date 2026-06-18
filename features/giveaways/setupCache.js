/**
 * In-memory cache for giveaway setup drafts per user.
 * Stores temporary state while user is configuring a giveaway.
 */

const setupCache = new Map();

/**
 * Create or get a draft setup entry for a user.
 * @param {string} guildId
 * @param {string} userId
 * @returns {Object} Draft object: { prize, winnerCount, durationRaw, endAtMs, allowRoleIds, setupMessageId, channelId }
 */
function getOrCreateDraft(guildId, userId) {
  const key = `${guildId}-${userId}`;
  if (!setupCache.has(key)) {
    setupCache.set(key, {
      prize: null,
      winnerCount: null,
      durationRaw: null,
      endAtMs: null,
      allowRoleIds: [],
      setupMessageId: null,
      channelId: null,
    });
  }
  return setupCache.get(key);
}

/**
 * Update specific fields in a draft.
 * @param {string} guildId
 * @param {string} userId
 * @param {Object} updates - Fields to update
 */
function updateDraft(guildId, userId, updates) {
  const draft = getOrCreateDraft(guildId, userId);
  Object.assign(draft, updates);
}

/**
 * Get current draft without creating if missing.
 * @param {string} guildId
 * @param {string} userId
 * @returns {Object|null}
 */
function getDraft(guildId, userId) {
  const key = `${guildId}-${userId}`;
  return setupCache.get(key) || null;
}

/**
 * Get and remove draft (one-time use for final submission).
 * @param {string} guildId
 * @param {string} userId
 * @returns {Object|null}
 */
function getDraftAndClear(guildId, userId) {
  const key = `${guildId}-${userId}`;
  const draft = setupCache.get(key);
  if (draft) setupCache.delete(key);
  return draft || null;
}

/**
 * Clear draft for a user.
 * @param {string} guildId
 * @param {string} userId
 */
function clearDraft(guildId, userId) {
  const key = `${guildId}-${userId}`;
  setupCache.delete(key);
}

/**
 * Add a role ID to the allowRoleIds array (no duplicates).
 * @param {string} guildId
 * @param {string} userId
 * @param {string} roleId
 */
function addRoleId(guildId, userId, roleId) {
  const draft = getOrCreateDraft(guildId, userId);
  if (!draft.allowRoleIds.includes(roleId)) {
    draft.allowRoleIds.push(roleId);
  }
}

/**
 * Remove a role ID from the allowRoleIds array.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} roleId
 */
function removeRoleId(guildId, userId, roleId) {
  const draft = getOrCreateDraft(guildId, userId);
  draft.allowRoleIds = draft.allowRoleIds.filter(id => id !== roleId);
}

module.exports = {
  getOrCreateDraft,
  updateDraft,
  getDraft,
  getDraftAndClear,
  clearDraft,
  addRoleId,
  removeRoleId,
};
