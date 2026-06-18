const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const {
  VERIFY_CHANNEL_ID,
  VERIFY_BUTTON_ID,
  VERIFICATION_EMBED_TITLE,
} = require('./constants');
const {
  getVerifyMessageId,
  setVerifyMessageId,
} = require('./storage');

function buildVerificationPromptPayload() {
  const embed = new EmbedBuilder()
    .setTitle(VERIFICATION_EMBED_TITLE)
    .setColor(0x2f8f83);

  const button = new ButtonBuilder()
    .setCustomId(VERIFY_BUTTON_ID)
    .setLabel('Verify')
    .setStyle(ButtonStyle.Success);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

async function ensureVerificationMessage(context) {
  const { client, socialsGuildId } = context;
  if (!socialsGuildId) return null;

  const channel = await fetchVerifyChannel(client);
  if (!channel) return null;

  const botUserId = client.user?.id || null;
  const existingPrompts = await fetchRecentVerificationPrompts(channel, botUserId);
  const storedMessage = await fetchStoredVerificationMessage(channel, socialsGuildId);
  const prompt = storedMessage || existingPrompts[0] || null;
  const payload = buildVerificationPromptPayload();
  const verificationMessage = prompt
    ? await editOrReplacePrompt(channel, prompt, payload)
    : await channel.send(payload);

  setVerifyMessageId(socialsGuildId, channel.id, verificationMessage.id);
  await deleteDuplicatePrompts(existingPrompts, verificationMessage.id);

  console.log(`[verification] Verification prompt ready in channel ${channel.id} (${verificationMessage.id})`);
  return verificationMessage;
}

async function fetchVerifyChannel(client) {
  try {
    const channel = await client.channels.fetch(VERIFY_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      console.error(`[verification] Verify channel ${VERIFY_CHANNEL_ID} is not a text channel Nico can send to.`);
      return null;
    }
    return channel;
  } catch (err) {
    console.error(`[verification] Failed to fetch verify channel ${VERIFY_CHANNEL_ID}:`, err.message);
    return null;
  }
}

async function fetchStoredVerificationMessage(channel, guildId) {
  const messageId = getVerifyMessageId(guildId);
  if (!messageId) return null;

  try {
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

async function fetchRecentVerificationPrompts(channel, botUserId) {
  if (!channel.messages?.fetch) return [];

  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return Array.from(messages.values())
      .filter(message => isVerificationPromptMessage(message, botUserId))
      .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
  } catch (err) {
    console.error(`[verification] Failed to scan verify channel ${channel.id}:`, err.message);
    return [];
  }
}

function isVerificationPromptMessage(message, botUserId) {
  if (botUserId && message.author?.id !== botUserId) return false;
  return hasVerificationButton(message) || hasVerificationTitle(message);
}

function hasVerificationButton(message) {
  return message.components?.some(row =>
    row.components?.some(component =>
      component.customId === VERIFY_BUTTON_ID ||
      component.data?.custom_id === VERIFY_BUTTON_ID
    )
  );
}

function hasVerificationTitle(message) {
  return message.embeds?.some(embed => embed.title === VERIFICATION_EMBED_TITLE);
}

async function editOrReplacePrompt(channel, message, payload) {
  try {
    return await message.edit(payload);
  } catch (err) {
    console.error(`[verification] Failed to edit verification prompt ${message.id}; sending replacement:`, err.message);
    return channel.send(payload);
  }
}

async function deleteDuplicatePrompts(messages, keepMessageId) {
  for (const message of messages) {
    if (message.id === keepMessageId) continue;
    try {
      await message.delete();
      console.log(`[verification] Deleted duplicate verification prompt ${message.id}`);
    } catch (err) {
      console.error(`[verification] Failed to delete duplicate verification prompt ${message.id}:`, err.message);
    }
  }
}

module.exports = {
  buildVerificationPromptPayload,
  ensureVerificationMessage,
  isVerificationPromptMessage,
};
