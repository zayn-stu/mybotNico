const PENDING_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

// Map of "guildId-userId" -> { emojiName, pandaAmount, expiresAt }
const pending = new Map();

function addPendingReaction(guildId, userId, emojiName, pandaAmount, source) {
  const key = `${guildId}-${userId}`;
  pending.set(key, {
    emojiName,
    pandaAmount,
    source: source || 'unknown',
    expiresAt: Date.now() + PENDING_TIMEOUT_MS,
  });
}

/**
 * Checks if a user has a pending reaction. If so, removes it and returns the info.
 * Returns null if nothing pending or if it expired.
 */
function checkAndConsume(guildId, userId) {
  const key = `${guildId}-${userId}`;
  const entry = pending.get(key);
  if (!entry) return null;
  pending.delete(key);
  if (Date.now() > entry.expiresAt) return null;
  return { emojiName: entry.emojiName, pandaAmount: entry.pandaAmount, source: entry.source };
}

module.exports = { addPendingReaction, checkAndConsume };
