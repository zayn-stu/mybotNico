const { MessageFlags } = require('discord.js');
const { loadBalance } = require('./balance');
const {
  buyItem,
  ensurePlayer,
  equipGear,
  sellGear,
  sellMaterial,
  unequipSlot,
} = require('./service');
const {
  buildInventoryView,
  buildProfileView,
  buildStoreView,
} = require('./render');

function parseIndex(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function rejectWrongUser(interaction) {
  await interaction.reply({
    content: 'This cave paperwork belongs to someone else.',
    flags: MessageFlags.Ephemeral,
  });
}

async function updateWith(interaction, payload) {
  await interaction.update(payload);
}

async function handleNicosCaveInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!interaction.customId?.startsWith('nc:')) return false;

  const [, action, ownerId, ...parts] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    await rejectWrongUser(interaction);
    return true;
  }

  const balance = loadBalance();
  let player = ensurePlayer(interaction.user, { balance });

  if (action === 'store_open') {
    const index = parseIndex(parts[0]);
    await updateWith(interaction, buildStoreView(ownerId, player, balance, index));
    return true;
  }

  if (action === 'store_prev' || action === 'store_next') {
    const current = parseIndex(parts[0]);
    const index = action === 'store_prev' ? current - 1 : current + 1;
    await updateWith(interaction, buildStoreView(ownerId, player, balance, index));
    return true;
  }

  if (action === 'store_buy') {
    const [itemId, rawIndex] = parts;
    const result = buyItem(interaction.user, itemId, { balance });
    player = result.player;
    const notice = result.ok
      ? `Bought ${result.item.name}. Equip it from inventory.`
      : result.reason === 'not_enough_coins'
        ? `Not enough coins for ${result.item.name}.`
        : 'That item is not for sale.';
    await updateWith(interaction, buildStoreView(ownerId, player, balance, parseIndex(rawIndex), notice));
    return true;
  }

  if (action === 'inventory_open') {
    await updateWith(interaction, buildInventoryView(ownerId, player, balance, parseIndex(parts[0])));
    return true;
  }

  if (action === 'inv_prev' || action === 'inv_next') {
    const current = parseIndex(parts[0]);
    const index = action === 'inv_prev' ? current - 1 : current + 1;
    await updateWith(interaction, buildInventoryView(ownerId, player, balance, index));
    return true;
  }

  if (action === 'profile_open') {
    await updateWith(interaction, buildProfileView(ownerId, player, balance));
    return true;
  }

  if (action === 'equip') {
    const [gearId, rawIndex] = parts;
    const result = equipGear(interaction.user, gearId, { balance });
    player = result.player;
    await updateWith(
      interaction,
      buildInventoryView(ownerId, player, balance, parseIndex(rawIndex), result.ok ? 'Equipped.' : 'Could not equip that item.')
    );
    return true;
  }

  if (action === 'unequip') {
    const [slot, rawIndex] = parts;
    const result = unequipSlot(interaction.user, slot, { balance });
    player = result.player;
    await updateWith(
      interaction,
      buildInventoryView(ownerId, player, balance, parseIndex(rawIndex), result.ok ? 'Unequipped.' : 'Could not unequip that slot.')
    );
    return true;
  }

  if (action === 'unequip_profile') {
    const [slot] = parts;
    const result = unequipSlot(interaction.user, slot, { balance });
    player = result.player;
    await updateWith(
      interaction,
      buildProfileView(ownerId, player, balance, result.ok ? 'Unequipped.' : 'Could not unequip that slot.')
    );
    return true;
  }

  if (action === 'sell_gear') {
    const [gearId, rawIndex] = parts;
    const result = sellGear(interaction.user, gearId, { balance });
    player = result.player;
    const notice = result.ok
      ? `Sold ${result.item?.name || 'item'} for ${result.coins} coins.`
      : result.reason === 'equipped'
        ? 'Unequip that item before selling it.'
        : 'Could not sell that item.';
    await updateWith(interaction, buildInventoryView(ownerId, player, balance, parseIndex(rawIndex), notice));
    return true;
  }

  if (action === 'sell_material') {
    const [itemId, rawIndex] = parts;
    const result = sellMaterial(interaction.user, itemId, 1, { balance });
    player = result.player;
    const notice = result.ok
      ? `Sold 1 ${result.item.name} for ${result.coins} coins.`
      : 'Could not sell that material.';
    await updateWith(interaction, buildInventoryView(ownerId, player, balance, parseIndex(rawIndex), notice));
    return true;
  }

  return true;
}

module.exports = { handleNicosCaveInteraction };
