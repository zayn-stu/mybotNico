const { resetAllPandas } = require('./storage');
const { resetAllPandaRuntimeState } = require('./runtime');

function getOwnerIds() {
  const rawOwnerIds = process.env.BOT_OWNER_IDS || '';
  return rawOwnerIds
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

module.exports = {
  name: 'reset',
  description: 'Owner-only reset commands',
  async execute(message, args) {
    const ownerIds = getOwnerIds();

    if (!ownerIds.includes(message.author.id)) {
      return message.reply('❌ You are not authorized to use this command.');
    }

    const target = args[0]?.toLowerCase();

    if (target !== 'pandas') {
      return message.reply('Usage: `!reset pandas`');
    }

    try {
      resetAllPandas();
      resetAllPandaRuntimeState();
      return message.reply('✅ Panda leaderboard has been reset.');
    } catch (err) {
      console.error('Error resetting panda data:', err);
      return message.reply('❌ Failed to reset panda data.');
    }
  }
};
