const { loadBalance } = require('./balance');
const { ensurePlayer, runRaid } = require('./service');
const {
  buildInventoryView,
  buildProfileView,
  buildRaidResult,
  buildStoreView,
} = require('./render');

async function executePlay(message) {
  const balance = loadBalance();
  const result = runRaid(message.author, { balance });
  return message.reply(buildRaidResult(result, balance));
}

async function executeStore(message) {
  const balance = loadBalance();
  const player = ensurePlayer(message.author, { balance });
  return message.reply(buildStoreView(message.author.id, player, balance, 0));
}

async function executeProfile(message) {
  const balance = loadBalance();
  const player = ensurePlayer(message.author, { balance });
  return message.reply(buildProfileView(message.author.id, player, balance));
}

async function executeInventory(message) {
  const balance = loadBalance();
  const player = ensurePlayer(message.author, { balance });
  return message.reply(buildInventoryView(message.author.id, player, balance, 0));
}

module.exports = {
  executePlay,
  executeStore,
  executeProfile,
  executeInventory,
};
