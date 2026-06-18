const { PermissionFlagsBits, EmbedBuilder, StickerFormatType } = require('discord.js');

const EMOJI_REGEX = /<a?:[\w]+:(\d+)>/g;

// Extract custom emojis from text or message
function extractEmojisFromText(text) {
  const matches = [];
  let match;
  while ((match = EMOJI_REGEX.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return matches;
}

// Parse emoji to get name and id
function parseEmoji(emojiString) {
  const match = emojiString.match(/<(a)?:([^:]+):(\d+)>/);
  if (!match) return null;
  return {
    animated: !!match[1],
    name: match[2],
    id: match[3],
    string: emojiString
  };
}

function extractStickersFromMessage(message) {
  return [...message.stickers.values()].map(sticker => ({
    type: 'sticker',
    sticker,
    display: `Sticker: **${sticker.name}**`,
  }));
}

function formatChoice(item) {
  if (item.type === 'emoji') return item.value;
  return item.display;
}

module.exports = {
  name: 'steal',
  description: 'Steal an emoji or sticker from another server',
  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server channel.');
    }

    // Permission check: manage server expressions
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      return message.reply('❌ You need the Manage Expressions permission to use this command.');
    }

    let emojiSource = '';
    let items = [];

    // Case 1: Reply to a message
    if (message.reference) {
      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        emojiSource = repliedMessage.content;
        items = [
          ...extractEmojisFromText(emojiSource).map(emoji => ({ type: 'emoji', value: emoji })),
          ...extractStickersFromMessage(repliedMessage),
        ];
      } catch (err) {
        console.error('Error fetching replied message:', err);
        return message.reply('❌ Could not fetch the replied message.');
      }
    } else {
      // Case 2: Emojis in the command arguments or stickers on the command message
      emojiSource = args.join(' ');
      items = [
        ...extractEmojisFromText(emojiSource).map(emoji => ({ type: 'emoji', value: emoji })),
        ...extractStickersFromMessage(message),
      ];
    }

    // No stealable expressions found
    if (items.length === 0) {
      return message.reply('❌ No custom emojis or stickers found. Please reply to a message with emojis/stickers, type emojis after the command, or send the command with a sticker.');
    }

    // Single item - proceed directly
    if (items.length === 1) {
      return await attemptSteal(message, items[0]);
    }

    // Multiple items - ask user to choose
    const emojiList = items.map((item, idx) => `${idx + 1}. ${formatChoice(item)}`).join('\n');
    const choiceEmbed = new EmbedBuilder()
      .setColor('#FF6B6B')
      .setTitle('Which emoji(s) or sticker(s) do you want to steal?')
      .setDescription(emojiList)
      .setFooter({ text: 'Respond with number(s) separated by spaces, e.g., "1" or "1 2 3". (60s timeout)' });

    const choiceMessage = await message.reply({ embeds: [choiceEmbed] });

    // Collect responses from the user
    const collector = message.channel.createMessageCollector({
      filter: m => m.author.id === message.author.id,
      time: 60_000, // 60 second timeout
      max: 1
    });

    collector.on('collect', async (response) => {
      const selectedIndices = response.content
        .split(' ')
        .map(s => parseInt(s.trim()))
        .filter(n => !isNaN(n) && n >= 1 && n <= items.length);

      if (selectedIndices.length === 0) {
        return response.reply('❌ Invalid selection. Please provide valid numbers.');
      }

      for (const idx of selectedIndices) {
        await attemptSteal(response, items[idx - 1]);
      }
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        choiceMessage.reply('❌ Selection timed out (60s).').catch(() => {});
      }
    });
  }
};

async function attemptSteal(message, item) {
  if (typeof item === 'string') {
    return attemptStealEmoji(message, item);
  }

  if (item.type === 'emoji') {
    return attemptStealEmoji(message, item.value);
  }

  if (item.type === 'sticker') {
    return attemptStealSticker(message, item.sticker);
  }

  return message.reply('❌ Could not understand what to steal.');
}

async function attemptStealEmoji(message, emojiString) {
  const emojiData = parseEmoji(emojiString);
  if (!emojiData) {
    return message.reply('❌ Could not parse emoji.');
  }

  // Check if emoji name already exists in server
  const existingEmoji = message.guild.emojis.cache.find(
    e => e.name.toLowerCase() === emojiData.name.toLowerCase()
  );
  if (existingEmoji) {
    return message.reply(`❌ An emoji named **${emojiData.name}** already exists in this server.`);
  }

  // Check if server is at emoji capacity
  const maxEmojis = message.guild.premiumTier >= 2 ? 200 : 50; // Higher limit with Nitro Boost
  if (message.guild.emojis.cache.size >= maxEmojis) {
    return message.reply(`❌ Server emoji limit reached (${maxEmojis} emojis). Delete some emojis first.`);
  }

  try {
    // Fetch emoji image from Discord CDN
    const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiData.id}.${emojiData.animated ? 'gif' : 'png'}?v=1`;
    
    // Fetch the image as a buffer
    const response = await fetch(emojiUrl);
    if (!response.ok) {
      return message.reply('❌ Could not fetch emoji from Discord CDN.');
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create the emoji
    const createdEmoji = await message.guild.emojis.create({
      attachment: buffer,
      name: emojiData.name
    });

    return message.reply(`✅ Successfully stole emoji ${createdEmoji}! (${emojiData.name})`);
  } catch (err) {
    console.error('Error stealing emoji:', err);
    if (err.code === 50013) {
      return message.reply('❌ Bot does not have permission to manage emojis.');
    }
    return message.reply(`❌ Failed to steal emoji: ${err.message}`);
  }
}

async function attemptStealSticker(message, sticker) {
  try {
    if (sticker.partial) {
      sticker = await sticker.fetch();
    }

    if (sticker.format === StickerFormatType.Lottie) {
      return message.reply(`❌ **${sticker.name}** is a Lottie sticker and cannot be uploaded as a server sticker.`);
    }

    const existingSticker = message.guild.stickers.cache.find(
      s => s.name.toLowerCase() === sticker.name.toLowerCase()
    );
    if (existingSticker) {
      return message.reply(`❌ A sticker named **${sticker.name}** already exists in this server.`);
    }

    const response = await fetch(sticker.url);
    if (!response.ok) {
      return message.reply('❌ Could not fetch sticker from Discord CDN.');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const tags = (sticker.tags || 'smile').split(',')[0].trim() || 'smile';

    const createdSticker = await message.guild.stickers.create({
      file: buffer,
      name: sticker.name,
      tags,
      description: sticker.description || `Stolen by ${message.author.tag}`
    });

    return message.reply(`✅ Successfully stole sticker **${createdSticker.name}**!`);
  } catch (err) {
    console.error('Error stealing sticker:', err);
    if (err.code === 50013) {
      return message.reply('❌ Bot does not have permission to manage stickers.');
    }
    return message.reply(`❌ Failed to steal sticker: ${err.message}`);
  }
}
