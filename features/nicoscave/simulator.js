const { loadBalance } = require('./balance');
const { buyItem, ensurePlayer, runRaid } = require('./service');

function affordableStoreItems(player, balance) {
  return balance.storeItems.filter(item => (player.coins || 0) >= (item.buyPrice || 0));
}

function hasGearItem(player, itemId) {
  return Object.values(player.inventory?.gear || {}).some(gear => gear.itemId === itemId);
}

function greedyBuyMissingGear(user, balance, storage, now, idFactory) {
  let player = ensurePlayer(user, { balance, storage, now, idFactory });
  const purchases = [];

  while (true) {
    const next = affordableStoreItems(player, balance).find(item => !hasGearItem(player, item.id));
    if (!next) break;
    const result = buyItem(user, next.id, { balance, storage, now, idFactory });
    if (!result.ok) break;
    purchases.push(next.id);
    player = result.player;
  }

  return purchases;
}

function simulateDays({
  user = { id: 'sim-user', username: 'Simulator' },
  days = 7,
  raidsPerDay = 10,
  balance = loadBalance(),
  storage,
  rng = () => 0.5,
  idFactory,
  startDate = new Date('2026-05-13T09:00:00.000Z'),
} = {}) {
  if (!storage) throw new Error('simulateDays requires an explicit storage instance');

  const summaries = [];
  for (let day = 0; day < days; day += 1) {
    const now = new Date(startDate.getTime() + (day * 24 * 60 * 60 * 1000));
    let raids = 0;
    let lastResult = null;
    for (let i = 0; i < raidsPerDay; i += 1) {
      const result = runRaid(user, { balance, storage, now, rng, idFactory });
      if (!result.ok) break;
      raids += 1;
      lastResult = result;
    }

    const purchases = greedyBuyMissingGear(user, balance, storage, now, idFactory);
    const player = ensurePlayer(user, { balance, storage, now, idFactory });
    summaries.push({
      day: day + 1,
      raids,
      coins: player.coins,
      level: player.level,
      xp: player.xp,
      unlockedDepth: player.unlockedDepth,
      purchases,
      lastCompletion: lastResult?.completion || null,
      materials: { ...player.inventory.materials },
    });
  }

  return summaries;
}

module.exports = { simulateDays };
