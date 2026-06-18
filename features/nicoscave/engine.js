function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundToNearest(value, nearest) {
  if (!nearest) return Math.round(value);
  return Math.round(value / nearest) * nearest;
}

function getDayKey(date = new Date(), timezone = 'Europe/Istanbul') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getHpForLevel(level, progression) {
  const hpConfig = progression.hp || {};
  const override = hpConfig.overrides?.[String(level)];
  if (Number.isFinite(override)) return override;

  const safeLevel = Math.max(1, level);
  const levelOffset = safeLevel - 1;
  const base = hpConfig.base ?? 100;
  const linear = hpConfig.linear ?? 16;
  const powerMultiplier = hpConfig.powerMultiplier ?? 3;
  const power = hpConfig.power ?? 1.3;

  return base + Math.floor((linear * levelOffset) + (powerMultiplier * Math.pow(levelOffset, power)));
}

function getXpForNextLevel(level, progression) {
  const xpConfig = progression.xp || {};
  const base = xpConfig.base ?? 70;
  const power = xpConfig.power ?? 1.45;
  const roundTo = xpConfig.roundTo ?? 5;
  return roundToNearest(base * Math.pow(Math.max(1, level), power), roundTo);
}

function applyXp(player, gainedXp, progression) {
  const levelCap = progression.levelCap ?? 20;
  const updated = {
    ...player,
    xp: (player.xp || 0) + gainedXp,
    level: player.level || 1,
  };

  while (updated.level < levelCap) {
    const needed = getXpForNextLevel(updated.level, progression);
    if (updated.xp < needed) break;
    updated.xp -= needed;
    updated.level += 1;
  }

  return updated;
}

function getPlayerStats(player, balance) {
  const gear = player.inventory?.gear || {};
  const weapon = gear[player.equipped?.weapon] || null;
  const tool = gear[player.equipped?.tool] || null;
  const weaponItem = weapon ? balance.items[weapon.itemId] : null;
  const toolItem = tool ? balance.items[tool.itemId] : null;

  return {
    attack: weaponItem?.stats?.attack || 0,
    mining: toolItem?.stats?.mining || 0,
    hp: getHpForLevel(player.level || 1, balance.progression),
    weapon,
    tool,
    weaponItem,
    toolItem,
  };
}

function calculateCompletion(stats, depth, progression, rng = Math.random) {
  const config = progression.completion || {};
  const weights = config.weights || { attack: 0.5, hp: 0.3, mining: 0.2 };
  const ratioCap = config.ratioCap ?? 1.25;
  const minCompletion = config.minCompletion ?? 5;
  const jitterPercent = config.jitterPercent ?? 5;
  const required = depth.requiredStats;

  const attackRatio = clamp((stats.attack || 0) / required.attack, 0, ratioCap);
  const hpRatio = clamp((stats.hp || 0) / required.hp, 0, ratioCap);
  const miningRatio = clamp((stats.mining || 0) / required.mining, 0, ratioCap);

  const weightedRatio =
    (attackRatio * weights.attack) +
    (hpRatio * weights.hp) +
    (miningRatio * weights.mining);

  const jitter = ((rng() * 2) - 1) * jitterPercent;
  const completion = clamp(Math.round((weightedRatio * 100) + jitter), minCompletion, 100);

  return {
    completion,
    ratios: {
      attack: attackRatio,
      hp: hpRatio,
      mining: miningRatio,
    },
    jitter,
  };
}

function getRewardMultiplier(completion) {
  if (completion >= 90) return 3;
  if (completion >= 70) return 2;
  return 1;
}

function getDropRollCount(completion) {
  if (completion >= 90) return 3;
  if (completion >= 70) return 2;
  return 1;
}

function chooseWeighted(entries, rng = Math.random) {
  const totalWeight = entries.reduce((total, entry) => total + Math.max(0, entry.weight || 0), 0);
  if (totalWeight <= 0) return entries[0] || null;

  let roll = rng() * totalWeight;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight || 0);
    if (roll <= 0) return entry;
  }

  return entries[entries.length - 1] || null;
}

function randomInt(min, max, rng = Math.random) {
  const safeMin = Math.ceil(min);
  const safeMax = Math.floor(max);
  return Math.floor(rng() * (safeMax - safeMin + 1)) + safeMin;
}

function rollDrops(depth, completion, rng = Math.random) {
  const drops = depth.drops || [];
  if (drops.length === 0) return [];

  const rollCount = getDropRollCount(completion);
  const results = [];
  for (let i = 0; i < rollCount; i += 1) {
    const selected = chooseWeighted(drops, rng);
    if (!selected) continue;
    results.push({
      itemId: selected.itemId,
      quantity: randomInt(selected.min || 1, selected.max || 1, rng),
    });
  }

  return results;
}

function mergeDrops(drops) {
  const merged = {};
  for (const drop of drops) {
    merged[drop.itemId] = (merged[drop.itemId] || 0) + drop.quantity;
  }
  return Object.entries(merged).map(([itemId, quantity]) => ({ itemId, quantity }));
}

function calculateRewards(depth, completion) {
  const multiplier = getRewardMultiplier(completion);
  const completionFactor = Math.max(0.25, completion / 100);
  return {
    multiplier,
    coins: Math.floor((depth.baseRewards.coins || 0) * completionFactor * multiplier),
    xp: Math.floor((depth.baseRewards.xp || 0) * completionFactor * multiplier),
  };
}

function chooseFlavor(balance, completion, rng = Math.random) {
  const flavor = balance.flavor || {};
  const pool = [
    ...(flavor.raid || []),
    ...(completion >= 90 ? flavor.great || [] : completion >= 70 ? flavor.good || [] : flavor.low || []),
  ];
  if (pool.length === 0) return 'The cave has been raided.';
  return pool[Math.floor(rng() * pool.length)];
}

module.exports = {
  clamp,
  roundToNearest,
  getDayKey,
  getHpForLevel,
  getXpForNextLevel,
  applyXp,
  getPlayerStats,
  calculateCompletion,
  getRewardMultiplier,
  getDropRollCount,
  rollDrops,
  mergeDrops,
  calculateRewards,
  chooseFlavor,
};
