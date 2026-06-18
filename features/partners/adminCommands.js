const partnerConfig = require('../../data/partnerChannels.json');
const path = require('path');
const managerStorage = require('./managerStorage');
const { writeJsonFile } = require('../../shared/jsonStore');

const PARTNER_CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'partnerChannels.json');

async function handleAddPartnerCommand(message, client, args) {
  if (args.length < 2) {
    await message.reply('Usage: !add {server name} {channel ID}');
    return;
  }

  const channelId = args[args.length - 1];
  const displayName = args.slice(0, -1).join(' ').trim();

  if (!/^\d+$/.test(channelId)) {
    await message.reply('Invalid channel ID format.');
    return;
  }

  if (displayName.length < 2 || displayName.length > 40) {
    await message.reply('Server name must be between 2 and 40 characters.');
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      await message.reply(`Channel ${channelId} not found or not accessible.`);
      return;
    }

    if (!channel.guildId) {
      await message.reply(`Channel ${channelId} is not a server channel.`);
      return;
    }

    if (!channel.isTextBased?.() || !channel.send) {
      await message.reply(`Channel ${channelId} is not a sendable text channel.`);
      return;
    }

    const actualGuildName = channel.guild?.name || 'Unknown Server';
    const existing = partnerConfig.channels.find(p =>
      p.serverId === channel.guildId || p.channelId === channelId
    );
    if (existing) {
      await message.reply(`${existing.name} is already in broadcasts.`);
      return;
    }

    partnerConfig.channels.push({
      name: displayName,
      serverId: channel.guildId,
      channelId
    });

    writeJsonFile(PARTNER_CONFIG_PATH, partnerConfig);

    await message.reply(`Added **${displayName}** to broadcasts (actual server: **${actualGuildName}**, channelId: ${channelId})`);
  } catch (err) {
    await message.reply(`Error: ${err.message}`);
  }
}

async function handleRemovePartnerCommand(message, client, args) {
  if (args.length === 0) {
    await message.reply('Usage: !remove {server name}');
    return;
  }

  const serverName = args.join(' ');

  // Find partner by matching against either actual guild name OR config name
  let partnerToRemove = null;

  for (const partner of partnerConfig.channels) {
    let actualGuildName = null;

    // Try to fetch the actual guild name from Discord
    try {
      const guild = await client.guilds.fetch(partner.serverId);
      actualGuildName = guild.name;
    } catch {
      // Guild fetch failed; we'll fall back to config name matching only
    }

    // Match against actual guild name (if available) OR config name
    const matchesActualName = actualGuildName && actualGuildName.toLowerCase() === serverName.toLowerCase();
    const matchesConfigName = partner.name.toLowerCase() === serverName.toLowerCase();

    if (matchesActualName || matchesConfigName) {
      partnerToRemove = { ...partner, actualName: actualGuildName || partner.name };
      break;
    }
  }

  if (!partnerToRemove) {
    await message.reply(`Server "${serverName}" not found in broadcasts.`);
    return;
  }

  await message.reply(`Remove ${partnerToRemove.actualName} from broadcasts? Reply 'yes' to confirm.`);

  try {
    const responses = await message.channel.awaitMessages({
      filter: m => m.author.id === message.author.id,
      max: 1,
      time: 30000
    });

    const response = responses.first();
    if (!response || response.content.toLowerCase() !== 'yes') {
      await message.reply('Cancelled.');
      return;
    }

    // Remove from partnerChannels
    const index = partnerConfig.channels.findIndex(p => p.serverId === partnerToRemove.serverId);
    partnerConfig.channels.splice(index, 1);

    writeJsonFile(PARTNER_CONFIG_PATH, partnerConfig);

    await message.reply(`Removed ${partnerToRemove.actualName} from broadcasts.`);
  } catch (err) {
    await message.reply('Confirmation timeout. Cancelled.');
  }
}

function isValidUserID(id) {
  return /^\d{17,19}$/.test(id);
}

async function handleAddManagerCommand(message, client, args) {
  if (args.length < 2) {
    await message.reply('Usage: !add manager {userID} {serverName}');
    return;
  }

  const userID = args[0];
  const serverName = args.slice(1).join(' ');

  if (!isValidUserID(userID)) {
    await message.reply('❌ Invalid userID format. Must be a Discord snowflake (17-19 digits).');
    return;
  }

  const existing = managerStorage.getManagerByUserID(userID);
  if (existing) {
    await message.reply(`⚠️ <@${userID}> is already a manager for **${existing.serverName}**.`);
    return;
  }

  managerStorage.addManager(userID, serverName);
  await message.reply(`✅ Added <@${userID}> as partner manager for **${serverName}**.`);
}

async function handleRemoveManagerCommand(message, client, args) {
  if (args.length === 0) {
    await message.reply('Usage: !remove manager {userID}');
    return;
  }

  const userID = args[0];

  if (!isValidUserID(userID)) {
    await message.reply('❌ Invalid userID format. Must be a Discord snowflake (17-19 digits).');
    return;
  }

  const existing = managerStorage.getManagerByUserID(userID);
  if (!existing) {
    await message.reply(`⚠️ No manager found for userID \`${userID}\`.`);
    return;
  }

  await message.reply(`Remove <@${userID}> (manager for **${existing.serverName}**)? Reply 'yes' to confirm.`);

  try {
    const responses = await message.channel.awaitMessages({
      filter: m => m.author.id === message.author.id,
      max: 1,
      time: 30000
    });

    const response = responses.first();
    if (!response || response.content.toLowerCase() !== 'yes') {
      await message.reply('Cancelled.');
      return;
    }

    const removed = managerStorage.removeManager(userID);
    if (removed) {
      await message.reply(`✅ Removed <@${userID}> from partner managers.`);
    } else {
      await message.reply('⚠️ Something went wrong — manager not found on second lookup.');
    }
  } catch {
    await message.reply('Confirmation timeout. Cancelled.');
  }
}

async function handleListManagersCommand(message, client) {
  const managers = managerStorage.listManagers();

  if (managers.length === 0) {
    await message.reply('📋 No partner managers registered.');
    return;
  }

  const lines = managers.map((m, i) =>
    `${i + 1}. <@${m.userID}> — **${m.serverName}** (added ${new Date(m.addedAt).toLocaleDateString()})`
  );

  const chunks = [];
  let current = '**Partner Managers:**\n\n';
  for (const line of lines) {
    if ((current + line).length > 1900) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  chunks.push(current);

  for (const chunk of chunks) {
    await message.author.send(chunk);
  }
}

async function handleListServersCommand(message, client) {
  if (partnerConfig.channels.length === 0) {
    await message.reply('📋 No partner servers registered.');
    return;
  }

  let msg = '**Partner Servers for Ad Broadcasting:**\n\n';
  for (let i = 0; i < partnerConfig.channels.length; i++) {
    const partner = partnerConfig.channels[i];
    msg += `${i + 1}. **${partner.name}** (ID: \`${partner.serverId}\`)\n`;
    msg += `   └─ Channel: \`${partner.channelId}\`\n`;
  }

  await message.reply(msg);
}

module.exports = {
  handleAddPartnerCommand,
  handleRemovePartnerCommand,
  handleAddManagerCommand,
  handleRemoveManagerCommand,
  handleListManagersCommand,
  handleListServersCommand,
  isValidUserID,
};
