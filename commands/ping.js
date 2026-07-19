const ownerIds = (process.env.BOT_OWNER_IDS || '').split(',').map(id => id.trim());
const DEGENERACY_OWNER_ID = '1358808133543264306';
const PRINCESS_ID = '1363912627398508695';

module.exports = {
  name: 'ping',
  description: 'Replies with Pong!',
  execute(message) {
    if (ownerIds.includes(message.author.id)) {
      message.reply('Yes father?');
    } else if (message.author.id === DEGENERACY_OWNER_ID) {
      message.reply("yeah yeah i'm alive king");
    } else if (message.author.id === PRINCESS_ID) {
      message.reply('Yes princess?');
    } else {
      message.reply('what the fuck do you want?');
    }
  }
};
