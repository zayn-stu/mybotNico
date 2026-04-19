const { getVictoryLeaderboard } = require('../utils/victoryStorage');

const VICTORY_EMOJI_NAME = 'SN_VictoryPanda';

module.exports = {
  name: 'vpanda',
  description: 'View the victory panda leaderboard',
  async execute(message, args) {
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
      let displayName = entry.username;

      try {
        const member = await message.guild.members.fetch(entry.userId);
        displayName = member.displayName || entry.username;
      } catch {
        // Member not in server — use stored username
      }

      response += `${i + 1}. ${displayName} — ${emojiStr.repeat(entry.victories)}\n`;
    }

    message.reply(response);
  }
};
