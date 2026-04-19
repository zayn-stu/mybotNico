const ownerIds = (process.env.BOT_OWNER_IDS || '').split(',').map(id => id.trim());
const PERISHED_OWNER_ID = '1358808133543264306';

module.exports = {
  name: 'ping',
  description: 'Replies with Pong!',
  execute(message) {
    if (ownerIds.includes(message.author.id)) {
      message.reply('Yes father?');
    } else if (message.author.id === PERISHED_OWNER_ID) {
      message.reply("yeah yeah i'm alive king");
    } else {
      message.reply('what the fuck do you want?');
    }
  }
};
