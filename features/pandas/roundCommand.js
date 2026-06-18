const { getRound, getNextRoundNumber } = require('./roundStorage');

const VICTORY_EMOJI_NAME = 'SN_VictoryPanda';

module.exports = {
  name: 'round',
  description: 'View a past round result by number',
  async execute(message, args) {
    if (!args[0]) {
      const currentRound = getNextRoundNumber(message.guild.id);
      const latestCompleted = currentRound - 1;
      if (latestCompleted < 1) {
        return message.reply('No rounds have been completed yet. Usage: `!round <number>`');
      }
      return message.reply(`Usage: \`!round <number>\` — Rounds 1–${latestCompleted} are available.`);
    }

    const roundNumber = parseInt(args[0], 10);
    if (isNaN(roundNumber) || roundNumber < 1) {
      return message.reply('❌ Please provide a valid round number. Usage: `!round <number>`');
    }

    const round = getRound(message.guild.id, roundNumber);
    if (!round) {
      return message.reply(`❌ Round ${roundNumber} has no recorded data.`);
    }

    const victoryEmoji = message.guild.emojis.cache.find(e => e.name === VICTORY_EMOJI_NAME);
    const emojiStr = victoryEmoji ? victoryEmoji.toString() : '🏆';

    const date = new Date(round.endedAt).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });

    let response = `${emojiStr} **Round ${roundNumber} Results** — ${date}\n`;
    response += `**Winner:** <@${round.winner.userId}>\n\n`;
    response += `**Leaderboard snapshot:**\n`;

    const top = round.leaderboard.slice(0, 10);
    top.forEach((entry, i) => {
      response += `${i + 1}. ${entry.username} — ${entry.count}\n`;
    });

    message.reply(response);
  }
};
