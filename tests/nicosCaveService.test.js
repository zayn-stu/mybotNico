const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadBalance } = require('../features/nicoscave/balance');
const { createNicosCaveStorage } = require('../features/nicoscave/storage');
const {
  buyItem,
  ensurePlayer,
  equipGear,
  runRaid,
  sellGear,
  sellMaterial,
  unequipSlot,
} = require('../features/nicoscave/service');
const { simulateDays } = require('../features/nicoscave/simulator');

function withTempStorage(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nicos-cave-'));
  const filePath = path.join(dir, 'players.json');
  const storage = createNicosCaveStorage(filePath);
  try {
    fn(storage);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function idFactory() {
  let count = 0;
  return () => {
    count += 1;
    return `gear_${count}`;
  };
}

const user = { id: 'user-1', username: 'Nico' };
const now = new Date('2026-05-13T09:00:00.000Z');

test('new players get starter gear equipped', () => {
  withTempStorage(storage => {
    const balance = loadBalance({ forceReload: true });
    const player = ensurePlayer(user, { balance, storage, now, idFactory: idFactory() });

    assert.equal(player.level, 1);
    assert.equal(Object.keys(player.inventory.gear).length, 2);
    assert.ok(player.equipped.weapon);
    assert.ok(player.equipped.tool);
  });
});

test('raids consume daily attempts and enforce the daily limit', () => {
  withTempStorage(storage => {
    const balance = loadBalance();
    const ids = idFactory();

    for (let i = 0; i < 10; i += 1) {
      const result = runRaid(user, { balance, storage, now, rng: () => 0.5, idFactory: ids });
      assert.equal(result.ok, true);
    }

    const blocked = runRaid(user, { balance, storage, now, rng: () => 0.5, idFactory: ids });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'daily_limit');
    assert.equal(blocked.raidsRemaining, 0);
  });
});

test('70 percent completion unlocks the next depth', () => {
  withTempStorage(storage => {
    const balance = loadBalance();
    const result = runRaid(user, { balance, storage, now, rng: () => 0.5, idFactory: idFactory() });

    assert.equal(result.completion, 100);
    assert.equal(result.unlockedNextDepth, true);
    assert.equal(result.player.unlockedDepth, 2);
  });
});

test('buying creates unique gear, inventory equip changes active slot, and equipped gear cannot be sold', () => {
  withTempStorage(storage => {
    const balance = loadBalance();
    const ids = idFactory();
    let player = ensurePlayer(user, { balance, storage, now, idFactory: ids });
    storage.savePlayer(user.id, { ...player, coins: 1000 });

    const buy = buyItem(user, 'stone_sword', { balance, storage, now, idFactory: ids });
    assert.equal(buy.ok, true);
    assert.equal(buy.player.coins, 900);

    const equip = equipGear(user, buy.gear.id, { balance, storage, now, idFactory: ids });
    assert.equal(equip.ok, true);
    assert.equal(equip.player.equipped.weapon, buy.gear.id);

    const blockedSell = sellGear(user, buy.gear.id, { balance, storage, now, idFactory: ids });
    assert.equal(blockedSell.ok, false);
    assert.equal(blockedSell.reason, 'equipped');

    const unequip = unequipSlot(user, 'weapon', { balance, storage, now, idFactory: ids });
    assert.equal(unequip.ok, true);

    const sell = sellGear(user, buy.gear.id, { balance, storage, now, idFactory: ids });
    assert.equal(sell.ok, true);
    assert.equal(sell.player.coins, 940);
  });
});

test('material drops stack and can be sold one at a time', () => {
  withTempStorage(storage => {
    const balance = loadBalance();
    const result = runRaid(user, { balance, storage, now, rng: () => 0.5, idFactory: idFactory() });

    assert.equal(result.player.inventory.materials.iron, 6);

    const sell = sellMaterial(user, 'iron', 1, { balance, storage, now, idFactory: idFactory() });
    assert.equal(sell.ok, true);
    assert.equal(sell.player.inventory.materials.iron, 5);
    assert.equal(sell.coins, 8);
  });
});

test('simulator produces 7/14/30 day balance summaries', (t) => {
  for (const days of [7, 14, 30]) {
    withTempStorage(storage => {
      const balance = loadBalance();
      const summary = simulateDays({
        days,
        balance,
        storage,
        rng: () => 0.5,
        idFactory: idFactory(),
      });

      assert.equal(summary.length, days);
      assert.equal(summary[summary.length - 1].raids, 10);
      t.diagnostic(`${days}d: ${JSON.stringify(summary[summary.length - 1])}`);
    });
  }
});
