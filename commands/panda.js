const { getPandaCount, getLeaderboard } = require('../utils/pandaStorage');

const PANDA_EMOJI_NAME = 'SN_RooHappi';

function getPandaEmoji(guild) {
  const emoji = guild.emojis.cache.find(e => e.name === PANDA_EMOJI_NAME);
  return emoji ? emoji.toString() : '🐼'; // Fallback to regular panda if custom emoji not found
}

const subcommands = {
  async me(message) {
    const count = getPandaCount(message.guild.id, message.author.id);
    const plural = count === 1 ? 'Panda' : 'Pandas';
    const pandaEmoji = getPandaEmoji(message.guild);
    message.reply(`${pandaEmoji} <@${message.author.id}> has ${count} ${plural}`);
  },

  async list(message) {
    const leaderboard = getLeaderboard(message.guild.id, 10);
    const pandaEmoji = getPandaEmoji(message.guild);

    if (leaderboard.length === 0) {
      return message.reply('No pandas have been collected yet!');
    }

    let response = `${pandaEmoji} **Leaderboard** ${pandaEmoji}\n\n`;

    for (let index = 0; index < leaderboard.length; index++) {
      const entry = leaderboard[index];
      try {
        const member = await message.guild.members.fetch(entry.userId);
        const displayName = member.displayName || entry.username || 'Unknown User';
        response += `${index + 1}. ${displayName} - ${entry.count}\n`;
      } catch (err) {
        // User might have left the server
        response += `${index + 1}. ${entry.username || 'Unknown User'} - ${entry.count}\n`;
      }
    }

    message.reply(response);
  },

  async help(message) {
    message.reply(
      '**Panda Commands:**\n' +
      '`!panda` or `!panda me` - Check your panda count\n' +
      '`!panda list` - View the top 10 leaderboard\n\n'
    );
  }
};

module.exports = {
  name: 'panda',
  description: 'View panda collection stats',
  async execute(message, args) {
    const subcommand = args[0]?.toLowerCase() || 'me';

    if (!subcommands[subcommand]) {
      return message.reply(`Unknown subcommand. Use \`!panda help\` for commands.`);
    }

    await subcommands[subcommand](message, args.slice(1));
  }
};
