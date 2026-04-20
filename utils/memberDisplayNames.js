/**
 * In-memory cache for member display names (server nicknames or usernames).
 * Updates on guildMemberUpdate events.
 * Falls back to stored displayName in pandas.json, then Discord.js cache, then stored username.
 */

const memberDisplayNameCache = new Map(); // guildId -> (userId -> displayName)

/**
 * Update the cached display name for a member.
 * Called when a member updates their nickname.
 */
function updateDisplayName(guildId, userId, displayName) {
  if (!memberDisplayNameCache.has(guildId)) {
    memberDisplayNameCache.set(guildId, new Map());
  }
  memberDisplayNameCache.get(guildId).set(userId, displayName);
}

/**
 * Get a member's display name with fallback chain:
 * 1. Local cache (nickname updated via guildMemberUpdate)
 * 2. Stored displayName in pandas.json (persistent across restarts)
 * 3. Discord.js in-memory cache (safe if bot crashed)
 * 4. Stored username (fallback)
 *
 * @param {string} guildId
 * @param {string} userId
 * @param {Member} fallbackMember - Discord.js member object (can be null)
 * @param {string} fallbackUsername - username from stored data
 * @param {string} storedDisplayName - displayName from pandas.json
 */
function getDisplayName(guildId, userId, fallbackMember, fallbackUsername, storedDisplayName) {
  // Priority 1: Local cache (most up-to-date from nickname changes)
  const cached = memberDisplayNameCache.get(guildId)?.get(userId);
  if (cached) return cached;

  // Priority 2: Stored displayName in pandas.json (persistent)
  if (storedDisplayName) {
    // Update cache while we have it for next time
    updateDisplayName(guildId, userId, storedDisplayName);
    return storedDisplayName;
  }

  // Priority 3: Discord.js in-memory cache (populated naturally)
  if (fallbackMember) {
    const displayName = fallbackMember.displayName || fallbackMember.user.username;
    // Update cache while we have it for next time
    updateDisplayName(guildId, userId, displayName);
    return displayName;
  }

  // Priority 4: Stored username (always available)
  return fallbackUsername || 'Unknown User';
}

module.exports = {
  updateDisplayName,
  getDisplayName
};
