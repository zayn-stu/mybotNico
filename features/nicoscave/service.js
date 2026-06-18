const crypto = require('crypto');
const { loadBalance, getDepth, getNextDepth } = require('./balance');
const storage = require('./storage');
const {
  getDayKey,
  getPlayerStats,
  calculateCompletion,
  calculateRewards,
  rollDrops,
  mergeDrops,
  applyXp,
  chooseFlavor,
} = require('./engine');

function createGearId() {
  return `g_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function getUsername(user) {
  return user?.username || user?.tag || 'Unknown';
}

function createGearCopy(item, now = new Date(), idFactory = createGearId) {
  return {
    id: idFactory(),
    itemId: item.id,
    slot: item.slot,
    acquiredAt: now.toISOString(),
    sellValue: item.sellValue || 0,
  };
}

function createStarterPlayer(user, balance = loadBalance(), now = new Date(), idFactory = createGearId) {
  const gear = {};
  const equipped = {};

  for (const item of balance.starterItems) {
    const copy = createGearCopy(item, now, idFactory);
    gear[copy.id] = copy;
    equipped[item.slot] = copy.id;
  }

  return {
    userId: user.id,
    username: getUsername(user),
    coins: 0,
    level: 1,
    xp: 0,
    unlockedDepth: 1,
    equipped,
    inventory: {
      gear,
      materials: {},
    },
    raids: {
      dayKey: getDayKey(now, balance.progression.timezone),
      used: 0,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function ensurePlayer(user, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  const idFactory = options.idFactory || createGearId;
  let player = store.getPlayer(user.id);

  if (!player) {
    player = createStarterPlayer(user, balance, now, idFactory);
    store.savePlayer(user.id, player);
    return player;
  }

  player.username = getUsername(user);
  player.inventory ||= {};
  player.inventory.gear ||= {};
  player.inventory.materials ||= {};
  player.equipped ||= {};
  player.raids ||= {
    dayKey: getDayKey(now, balance.progression.timezone),
    used: 0,
  };
  player = resetDailyRaidsIfNeeded(player, balance, now);
  player.updatedAt = now.toISOString();
  store.savePlayer(user.id, player);
  return player;
}

function resetDailyRaidsIfNeeded(player, balance, now) {
  const dayKey = getDayKey(now, balance.progression.timezone);
  if (player.raids?.dayKey === dayKey) return player;
  return {
    ...player,
    raids: {
      dayKey,
      used: 0,
    },
  };
}

function addMaterials(player, drops) {
  const updated = {
    ...player,
    inventory: {
      ...player.inventory,
      materials: { ...player.inventory.materials },
    },
  };

  for (const drop of drops) {
    updated.inventory.materials[drop.itemId] = (updated.inventory.materials[drop.itemId] || 0) + drop.quantity;
  }

  return updated;
}

function runRaid(user, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  const rng = options.rng || Math.random;
  let player = ensurePlayer(user, { balance, storage: store, now, idFactory: options.idFactory });
  player = resetDailyRaidsIfNeeded(player, balance, now);

  const dailyLimit = balance.progression.dailyRaidLimit || 10;
  if ((player.raids?.used || 0) >= dailyLimit) {
    store.savePlayer(user.id, player);
    return {
      ok: false,
      reason: 'daily_limit',
      player,
      raidsRemaining: 0,
    };
  }

  const depth = getDepth(balance, player.unlockedDepth);
  const stats = getPlayerStats(player, balance);
  const completionResult = calculateCompletion(stats, depth, balance.progression, rng);
  const rewards = calculateRewards(depth, completionResult.completion);
  const drops = mergeDrops(rollDrops(depth, completionResult.completion, rng));
  const previousLevel = player.level;
  const nextDepth = getNextDepth(balance, player.unlockedDepth);
  const unlockedNextDepth = completionResult.completion >= 70 && Boolean(nextDepth);

  player = {
    ...player,
    coins: (player.coins || 0) + rewards.coins,
    raids: {
      ...player.raids,
      used: (player.raids?.used || 0) + 1,
    },
    unlockedDepth: unlockedNextDepth ? nextDepth.id : player.unlockedDepth,
    updatedAt: now.toISOString(),
  };
  player = addMaterials(player, drops);
  player = applyXp(player, rewards.xp, balance.progression);
  store.savePlayer(user.id, player);

  return {
    ok: true,
    player,
    depth,
    stats,
    completion: completionResult.completion,
    ratios: completionResult.ratios,
    rewards,
    drops,
    flavor: chooseFlavor(balance, completionResult.completion, rng),
    previousLevel,
    leveledUp: player.level > previousLevel,
    unlockedNextDepth,
    raidsRemaining: Math.max(0, dailyLimit - player.raids.used),
  };
}

function buyItem(user, itemId, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  const idFactory = options.idFactory || createGearId;
  const item = balance.items[itemId];
  let player = ensurePlayer(user, { balance, storage: store, now, idFactory });

  if (!item || item.type !== 'gear' || !item.store) {
    return { ok: false, reason: 'not_for_sale', player, item: null };
  }

  if ((player.coins || 0) < item.buyPrice) {
    return { ok: false, reason: 'not_enough_coins', player, item };
  }

  const copy = createGearCopy(item, now, idFactory);
  player = {
    ...player,
    coins: player.coins - item.buyPrice,
    inventory: {
      ...player.inventory,
      gear: {
        ...player.inventory.gear,
        [copy.id]: copy,
      },
    },
    updatedAt: now.toISOString(),
  };
  store.savePlayer(user.id, player);
  return { ok: true, player, item, gear: copy };
}

function equipGear(user, gearId, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  let player = ensurePlayer(user, { balance, storage: store, now, idFactory: options.idFactory });
  const gear = player.inventory.gear[gearId];
  if (!gear) return { ok: false, reason: 'missing_gear', player };

  const item = balance.items[gear.itemId];
  if (!item || item.type !== 'gear') return { ok: false, reason: 'invalid_gear', player };

  player = {
    ...player,
    equipped: {
      ...player.equipped,
      [item.slot]: gearId,
    },
    updatedAt: now.toISOString(),
  };
  store.savePlayer(user.id, player);
  return { ok: true, player, item, gear };
}

function unequipSlot(user, slot, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  let player = ensurePlayer(user, { balance, storage: store, now, idFactory: options.idFactory });
  if (!['weapon', 'tool'].includes(slot)) return { ok: false, reason: 'invalid_slot', player };

  player = {
    ...player,
    equipped: {
      ...player.equipped,
      [slot]: null,
    },
    updatedAt: now.toISOString(),
  };
  store.savePlayer(user.id, player);
  return { ok: true, player, slot };
}

function sellGear(user, gearId, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  let player = ensurePlayer(user, { balance, storage: store, now, idFactory: options.idFactory });
  const gear = player.inventory.gear[gearId];
  if (!gear) return { ok: false, reason: 'missing_gear', player };
  if (player.equipped?.[gear.slot] === gearId) return { ok: false, reason: 'equipped', player, gear };

  const item = balance.items[gear.itemId];
  const gearMap = { ...player.inventory.gear };
  delete gearMap[gearId];
  player = {
    ...player,
    coins: (player.coins || 0) + (gear.sellValue || item?.sellValue || 0),
    inventory: {
      ...player.inventory,
      gear: gearMap,
    },
    updatedAt: now.toISOString(),
  };
  store.savePlayer(user.id, player);
  return { ok: true, player, item, gear, coins: gear.sellValue || item?.sellValue || 0 };
}

function sellMaterial(user, itemId, quantity = 1, options = {}) {
  const balance = options.balance || loadBalance();
  const store = options.storage || storage;
  const now = options.now || new Date();
  let player = ensurePlayer(user, { balance, storage: store, now, idFactory: options.idFactory });
  const item = balance.items[itemId];
  const current = player.inventory.materials[itemId] || 0;

  if (!item || item.type !== 'material') return { ok: false, reason: 'invalid_material', player };
  if (current < quantity) return { ok: false, reason: 'not_enough_material', player, item };

  const materials = { ...player.inventory.materials };
  materials[itemId] = current - quantity;
  if (materials[itemId] <= 0) delete materials[itemId];

  const coins = (item.sellValue || 0) * quantity;
  player = {
    ...player,
    coins: (player.coins || 0) + coins,
    inventory: {
      ...player.inventory,
      materials,
    },
    updatedAt: now.toISOString(),
  };
  store.savePlayer(user.id, player);
  return { ok: true, player, item, quantity, coins };
}

module.exports = {
  createGearId,
  createStarterPlayer,
  ensurePlayer,
  resetDailyRaidsIfNeeded,
  runRaid,
  buyItem,
  equipGear,
  unequipSlot,
  sellGear,
  sellMaterial,
};
