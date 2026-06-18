/**
 * Simple in-memory cache for temporary color selections during role editing.
 * Stores user color choices while they interact with the role menu.
 */

const colorCache = new Map();

function makeKey(guildId, userId, contextUserId = userId) {
  return `${guildId}-${userId}-${contextUserId}`;
}

/**
 * Store color selections for a user.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} primaryColor - hex color
 * @param {string|null} secondaryColor - hex color or null
 */
function setColors(guildId, userId, primaryColor, secondaryColor = null, contextUserId = userId) {
  const key = makeKey(guildId, userId, contextUserId);
  const current = colorCache.get(key) || {};
  colorCache.set(key, { ...current, primaryColor, secondaryColor });
}

function setSelectedRole(guildId, userId, selectedRoleId = null, contextUserId = userId) {
  const key = makeKey(guildId, userId, contextUserId);
  const current = colorCache.get(key) || {};
  colorCache.set(key, { ...current, selectedRoleId });
}

/**
 * Get and remove color selections for a user (one-time use).
 * @param {string} guildId
 * @param {string} userId
 * @returns {{primaryColor, secondaryColor} | null}
 */
function getColorsAndClear(guildId, userId, contextUserId = userId) {
  const key = makeKey(guildId, userId, contextUserId);
  const entry = colorCache.get(key);
  if (entry) colorCache.delete(key);
  return entry || null;
}

/**
 * Get current color selections without removing (for display).
 * @param {string} guildId
 * @param {string} userId
 * @returns {{primaryColor, secondaryColor} | null}
 */
function getColors(guildId, userId, contextUserId = userId) {
  const key = makeKey(guildId, userId, contextUserId);
  return colorCache.get(key) || null;
}

module.exports = { setColors, setSelectedRole, getColorsAndClear, getColors };
