const { getVictoryLeaderboard } = require('../utils/victoryStorage');
const { startTimer, endTimer } = require('../utils/perfMetrics');
const { getDisplayName } = require('../utils/memberDisplayNames');

const VICTORY_EMOJI_NAME = 'SN_VictoryPanda';

module.exports = {
  name: 'vpanda',
  description: 'View the victory panda leaderboard',
  async execute(message, args) {
    const vpandaStartTime = startTimer();
    const subcommand = args[0]?.toLowerCase();

    if (subcommand && subcommand !== 'list') {
      return message.reply('Usage: `!vpanda list`');
    }

    const victoryEmojiObj = message.guild.emojis.cache.find(e => e.name === VICTORY_EMOJI_NAME);
    const emojiStr = victoryEmojiObj ? victoryEmojiObj.toString() : '🏆';

    const leaderboard = getVictoryLeaderboard(message.guild.id, 10);

    if (leaderboard.length === 0) {
      return message.reply(`${emojiStr} No victory pandas have been awarded yet!`);
    }

    let response = `${emojiStr} **Victory Panda Leaderboard** ${emojiStr}\n\n`;

    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const member = message.guild.members.cache.get(entry.userId);
      const displayName = getDisplayName(message.guild.id, entry.userId, member, entry.username, entry.displayName);
      response += `${i + 1}. ${displayName} — ${emojiStr.repeat(entry.victories)}\n`;
    }

    const vpandaDuration = endTimer(vpandaStartTime);
    response += `\n_⏱️ Response time: ${vpandaDuration}ms_`;

    message.reply(response);
  }
};
