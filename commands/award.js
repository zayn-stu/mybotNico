const { getLeaderboard, resetRoundData } = require('../utils/pandaStorage');
const { resetAllPandaRuntimeState } = require('../utils/pandaRuntime');
const { getNextRoundNumber, saveRound } = require('../utils/roundStorage');
const { addVictory } = require('../utils/victoryStorage');

const VICTORY_EMOJI_NAME = 'SN_VictoryPanda';

function getOwnerIds() {
  return (process.env.BOT_OWNER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

module.exports = {
  name: 'award',
  description: 'Owner-only: award a victory panda, snapshot the round, and reset counts',
  async execute(message, args) {
    if (!getOwnerIds().includes(message.author.id)) {
      return message.reply('❌ You are not authorized to use this command.');
    }

    if (!args[0]) {
      return message.reply('Usage: `!award @user`');
    }

    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    if (!mentionMatch) {
      return message.reply('Usage: `!award @user`');
    }

    const winnerId = mentionMatch[1];
    const guildId = message.guild.id;

    // Require at least one non-zero panda entry in this guild
    const leaderboard = getLeaderboard(guildId, 100, { includeLeft: true });
    const hasActivity = leaderboard.some(e => e.count > 0);
    if (!hasActivity) {
      return message.reply('❌ No pandas have been collected yet this round. Cannot award.');
    }

    let winner;
    try {
      winner = await message.guild.members.fetch(winnerId);
    } catch {
      return message.reply("❌ That member wasn't found in this server.");
    }

    if (winner.user.bot) {
      return message.reply("❌ You can't award a bot.");
    }

    // Snapshot leaderboard before reset
    const roundNumber = getNextRoundNumber(guildId);
    const snapshot = leaderboard.map(e => ({ userId: e.userId, username: e.username, count: e.count }));

    // Award victory badge (persists across rounds)
    addVictory(guildId, winnerId, winner.user.username);

    // Save round history
    saveRound(guildId, roundNumber, winnerId, winner.user.username, snapshot);

    // Clear round panda counts, preserve victories
    resetRoundData(guildId);
    resetAllPandaRuntimeState();

    const victoryEmoji = message.guild.emojis.cache.find(e => e.name === VICTORY_EMOJI_NAME);
    const emojiStr = victoryEmoji ? victoryEmoji.toString() : '🏆';

    await message.channel.send(
      `${emojiStr} **Round ${roundNumber} over!** Congratulations to <@${winnerId}> for winning this round! ${emojiStr}\nPanda counts have been reset. Good luck in Round ${roundNumber + 1}!`
    );

    console.log(`[award] Round ${roundNumber} ended. Winner: ${winner.user.tag} (${winnerId}) in guild ${guildId}`);
  }
};
