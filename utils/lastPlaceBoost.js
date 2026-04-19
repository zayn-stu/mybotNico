const { getLeaderboard, addPanda } = require('./pandaStorage');

/**
 * When a top-3 player earns a panda, award +1 to the player in 10th place.
 * Only fires when there are at least 10 players on the leaderboard.
 *
 * @param {string} guildId
 * @param {string} awardedUserId - The user who just earned a panda
 * @param {Function} logFn - logPandaAward callback: (guildId, userId, username, amount, source) => void
 */
function checkLastPlaceBoost(guildId, awardedUserId, logFn) {
  try {
    // Get the full leaderboard to find everyone outside the top 10
    const fullBoard = getLeaderboard(guildId, Infinity);
    if (fullBoard.length < 10) return; // Not enough players for the top-10 to even exist

    // Check if the awarded user is in the top 3
    const awardedRank = fullBoard.findIndex(e => e.userId === awardedUserId);
    if (awardedRank < 0 || awardedRank >= 3) return; // Not top 3

    // Eligible: anyone ranked 11th or lower (outside the visible leaderboard)
    const eligible = fullBoard.slice(10).filter(e => e.userId !== awardedUserId);
    if (eligible.length === 0) return;

    const recipient = eligible[Math.floor(Math.random() * eligible.length)];
    addPanda(guildId, recipient.userId, recipient.username, 1);
    if (logFn) logFn(guildId, recipient.userId, recipient.username, 1, 'boost');
  } catch (err) {
    console.error('[lastPlaceBoost] Error:', err);
  }
}

module.exports = { checkLastPlaceBoost };
