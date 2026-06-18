const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { getAttachmentThumbnail, getDepth } = require('./balance');
const { getHpForLevel, getXpForNextLevel, getPlayerStats } = require('./engine');

const COLOR = 0x8b5a2b;

function customId(action, userId, ...parts) {
  return ['nc', action, userId, ...parts].join(':');
}

function formatStats(item) {
  const stats = item?.stats || {};
  const parts = [];
  if (stats.attack) parts.push(`Attack ${stats.attack}`);
  if (stats.mining) parts.push(`Mining ${stats.mining}`);
  return parts.join(' | ') || 'No stats';
}

function formatDrops(drops, balance) {
  if (!drops?.length) return 'No drops';
  return drops
    .map(drop => `${balance.items[drop.itemId]?.name || drop.itemId} x${drop.quantity}`)
    .join(', ');
}

function itemDisplayName(item, gear = null) {
  if (!gear) return item?.name || 'Unknown Item';
  return `${item?.name || gear.itemId} (${gear.id.slice(-6)})`;
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Number.isFinite(index) ? index : 0));
}

function buildRaidResult(result, balance) {
  if (!result.ok && result.reason === 'daily_limit') {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("Nico's Cave")
          .setColor(COLOR)
          .setDescription('You already used all 10 raids for today. The cave needs time to emotionally recover.')
          .addFields({ name: 'Raids Remaining', value: '0', inline: true }),
      ],
      components: [],
      files: [],
    };
  }

  const depth = result.depth;
  const multiplierLabel = `${result.rewards.multiplier}x`;
  const nextDepthText = result.unlockedNextDepth
    ? `Depth ${result.player.unlockedDepth} unlocked.`
    : `Highest depth: ${result.player.unlockedDepth}`;
  const embed = new EmbedBuilder()
    .setTitle(`Depth ${depth.id}: ${depth.name}`)
    .setColor(COLOR)
    .setDescription(result.flavor)
    .addFields(
      { name: 'Completion', value: `${result.completion}%`, inline: true },
      { name: 'Multiplier', value: multiplierLabel, inline: true },
      { name: 'Raids Left', value: String(result.raidsRemaining), inline: true },
      { name: 'Rewards', value: `${result.rewards.coins} coins\n${result.rewards.xp} XP`, inline: true },
      { name: 'Drops', value: formatDrops(result.drops, balance), inline: true },
      { name: 'Progress', value: result.leveledUp ? `Level ${result.player.level}. ${nextDepthText}` : nextDepthText, inline: false }
    )
    .setFooter({ text: `Attack ${result.stats.attack} | HP ${result.stats.hp} | Mining ${result.stats.mining}` });

  return { embeds: [embed], components: [], files: [] };
}

function buildStoreView(userId, player, balance, pageIndex = 0, notice = null) {
  const items = balance.storeItems;
  const index = clampIndex(pageIndex, items.length);
  const item = items[index];
  const attachment = getAttachmentThumbnail(item);
  const canBuy = item && (player.coins || 0) >= (item.buyPrice || 0);

  const embed = new EmbedBuilder()
    .setTitle("Nico's Cave Store")
    .setColor(COLOR)
    .setDescription(notice || 'Buy gear here, then equip it from inventory.')
    .addFields(
      { name: 'Your Coins', value: String(player.coins || 0), inline: true },
      { name: 'Item', value: item?.name || 'No items', inline: true },
      { name: 'Price', value: item ? `${item.buyPrice} coins` : '-', inline: true },
      { name: 'Stats', value: formatStats(item), inline: false },
      { name: 'Sell Value', value: item ? `${item.sellValue || 0} coins` : '-', inline: true }
    )
    .setFooter({ text: items.length ? `Item ${index + 1}/${items.length}` : 'No store items configured' });

  if (attachment.thumbnailUrl) embed.setThumbnail(attachment.thumbnailUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId('store_prev', userId, index))
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId(customId('store_buy', userId, item?.id || 'none', index))
      .setLabel('Buy')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!item || !canBuy),
    new ButtonBuilder()
      .setCustomId(customId('store_next', userId, index))
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= items.length - 1),
    new ButtonBuilder()
      .setCustomId(customId('inventory_open', userId, 0))
      .setLabel('Inventory')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row], files: attachment.files };
}

function getInventoryEntries(player, balance) {
  const gearEntries = Object.values(player.inventory?.gear || {})
    .sort((a, b) => String(a.acquiredAt).localeCompare(String(b.acquiredAt)))
    .map(gear => ({
      type: 'gear',
      id: gear.id,
      gear,
      item: balance.items[gear.itemId],
      equipped: player.equipped?.[gear.slot] === gear.id,
    }));

  const materialEntries = Object.entries(player.inventory?.materials || {})
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, quantity]) => ({
      type: 'material',
      id: itemId,
      item: balance.items[itemId],
      quantity,
    }));

  return [...gearEntries, ...materialEntries];
}

function buildInventoryView(userId, player, balance, pageIndex = 0, notice = null) {
  const entries = getInventoryEntries(player, balance);
  const index = clampIndex(pageIndex, entries.length);
  const entry = entries[index];
  const item = entry?.item;
  const attachment = getAttachmentThumbnail(item);

  const embed = new EmbedBuilder()
    .setTitle("Nico's Cave Inventory")
    .setColor(COLOR)
    .setDescription(notice || 'Equip, unequip, or sell your stuff here.')
    .setFooter({ text: entries.length ? `Item ${index + 1}/${entries.length}` : 'Inventory empty' });

  if (!entry) {
    embed.addFields({ name: 'Items', value: 'Nothing here yet.', inline: false });
  } else if (entry.type === 'gear') {
    embed.addFields(
      { name: 'Item', value: itemDisplayName(item, entry.gear), inline: true },
      { name: 'Slot', value: item?.slot || entry.gear.slot, inline: true },
      { name: 'Status', value: entry.equipped ? 'Equipped' : 'Not equipped', inline: true },
      { name: 'Stats', value: formatStats(item), inline: false },
      { name: 'Sell Value', value: `${entry.gear.sellValue || item?.sellValue || 0} coins`, inline: true }
    );
  } else {
    embed.addFields(
      { name: 'Material', value: item?.name || entry.id, inline: true },
      { name: 'Quantity', value: String(entry.quantity), inline: true },
      { name: 'Sell 1 For', value: `${item?.sellValue || 0} coins`, inline: true }
    );
  }

  if (attachment.thumbnailUrl) embed.setThumbnail(attachment.thumbnailUrl);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId('inv_prev', userId, index))
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index <= 0),
    new ButtonBuilder()
      .setCustomId(customId('inv_next', userId, index))
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= entries.length - 1),
    new ButtonBuilder()
      .setCustomId(customId('profile_open', userId))
      .setLabel('Profile')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId('store_open', userId, 0))
      .setLabel('Store')
      .setStyle(ButtonStyle.Primary)
  );

  const actionButtons = [];
  if (entry?.type === 'gear') {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(customId('equip', userId, entry.gear.id, index))
        .setLabel('Equip')
        .setStyle(ButtonStyle.Success)
        .setDisabled(entry.equipped),
      new ButtonBuilder()
        .setCustomId(customId('unequip', userId, entry.gear.slot, index))
        .setLabel('Unequip')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!entry.equipped),
      new ButtonBuilder()
        .setCustomId(customId('sell_gear', userId, entry.gear.id, index))
        .setLabel('Sell')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(entry.equipped)
    );
  } else if (entry?.type === 'material') {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(customId('sell_material', userId, entry.id, index))
        .setLabel('Sell 1')
        .setStyle(ButtonStyle.Danger)
    );
  }

  const components = [navRow];
  if (actionButtons.length) {
    components.push(new ActionRowBuilder().addComponents(...actionButtons));
  }

  return { embeds: [embed], components, files: attachment.files };
}

function buildProfileView(userId, player, balance, notice = null) {
  const stats = getPlayerStats(player, balance);
  const currentDepth = getDepth(balance, player.unlockedDepth);
  const xpNeeded = player.level >= (balance.progression.levelCap || 20)
    ? 'Level cap'
    : `${player.xp}/${getXpForNextLevel(player.level, balance.progression)}`;
  const dailyLimit = balance.progression.dailyRaidLimit || 10;
  const raidsUsed = player.raids?.used || 0;

  const embed = new EmbedBuilder()
    .setTitle(`${player.username}'s Nico's Cave Profile`)
    .setColor(COLOR)
    .setDescription(notice || 'Current raid setup.')
    .addFields(
      { name: 'Level', value: String(player.level), inline: true },
      { name: 'XP', value: xpNeeded, inline: true },
      { name: 'Coins', value: String(player.coins || 0), inline: true },
      { name: 'Depth', value: `${player.unlockedDepth}: ${currentDepth?.name || 'Unknown'}`, inline: false },
      { name: 'Stats', value: `Attack ${stats.attack}\nHP ${stats.hp}\nMining ${stats.mining}`, inline: true },
      { name: 'Equipped', value: `Weapon: ${stats.weaponItem?.name || 'None'}\nTool: ${stats.toolItem?.name || 'None'}`, inline: true },
      { name: 'Raids Today', value: `${Math.max(0, dailyLimit - raidsUsed)}/${dailyLimit} left`, inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId('unequip_profile', userId, 'weapon'))
      .setLabel('Unequip Weapon')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player.equipped?.weapon),
    new ButtonBuilder()
      .setCustomId(customId('unequip_profile', userId, 'tool'))
      .setLabel('Unequip Tool')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!player.equipped?.tool),
    new ButtonBuilder()
      .setCustomId(customId('inventory_open', userId, 0))
      .setLabel('Inventory')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(customId('store_open', userId, 0))
      .setLabel('Store')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row], files: [] };
}

module.exports = {
  customId,
  buildRaidResult,
  buildStoreView,
  buildInventoryView,
  buildProfileView,
  getInventoryEntries,
};
