const {
  handleSmartDeleteCommand,
  handleDeleteLast,
  handleBroadcastDeleteReaction,
} = require('./deleteFlow');
const {
  handleShowAds,
  handleSubmitCommand,
  handlePendingAdsCommand,
  handleCancelAdCommand,
  handleAdReaction,
} = require('./adSubmissionFlow');
const {
  handleAddPartnerCommand,
  handleRemovePartnerCommand,
  handleAddManagerCommand,
  handleRemoveManagerCommand,
  handleListManagersCommand,
  handleListServersCommand,
} = require('./adminCommands');

/**
 * Parse BOT_OWNER_IDS from environment (comma-separated).
 */
function getOwnerIDs() {
  const raw = process.env.BOT_OWNER_IDS || '';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

function isOwner(userID) {
  return getOwnerIDs().includes(userID);
}

function normalizeDMCommand(content) {
  const trimmed = content.trim();
  return trimmed.startsWith('!') ? trimmed.slice(1).trim() : trimmed;
}

/**
 * Handles DM messages: public ad commands and owner-only partner broadcasts.
 */
async function handlePartnerDM(message, client) {
  if (message.guild) return false;
  if (message.author.bot) return false;

  const commandContent = normalizeDMCommand(message.content);
  const lowerContent = commandContent.toLowerCase();

  // show ads — available to anyone who can DM the bot
  if (lowerContent === 'show ads') {
    await handleShowAds(message, client);
    return true;
  }

  // submit — available to anyone who can DM the bot (public submission)
  if (lowerContent === 'submit') {
    await handleSubmitCommand(message, client);
    return true;
  }

  // Everything below is owner-only.
  if (!isOwner(message.author.id)) return false;

  // Handle pendingads command
  if (lowerContent === 'pendingads') {
    await handlePendingAdsCommand(message, client);
    return true;
  }

  // Handle cancelad command
  if (lowerContent.startsWith('cancelad ')) {
    const args = commandContent.slice('cancelad'.length).trim().split(/\s+/);
    await handleCancelAdCommand(message, client, args);
    return true;
  }

  // Handle list managers command
  if (lowerContent === 'list managers') {
    await handleListManagersCommand(message, client);
    return true;
  }

  // Handle list servers command
  if (lowerContent === 'list servers') {
    await handleListServersCommand(message, client);
    return true;
  }

  // Handle add manager command — must come before generic add
  if (lowerContent.startsWith('add manager ')) {
    const args = commandContent.slice('add manager'.length).trim().split(/\s+/);
    await handleAddManagerCommand(message, client, args);
    return true;
  }

  // Handle remove manager command — must come before generic remove
  if (lowerContent.startsWith('remove manager ')) {
    const args = commandContent.slice('remove manager'.length).trim().split(/\s+/);
    await handleRemoveManagerCommand(message, client, args);
    return true;
  }

  // Handle add command
  if (lowerContent.startsWith('add ')) {
    const args = commandContent.slice('add'.length).trim().split(/\s+/);
    await handleAddPartnerCommand(message, client, args);
    return true;
  }

  // Handle remove command
  if (lowerContent.startsWith('remove ')) {
    const args = commandContent.slice('remove'.length).trim().split(/\s+/);
    await handleRemovePartnerCommand(message, client, args);
    return true;
  }

  // Handle "Delete last" command
  if (lowerContent === 'delete last') {
    await handleDeleteLast(message, client);
    return true;
  }

  // Handle searchable broadcast delete command.
  if (lowerContent === 'delete' || lowerContent.startsWith('delete ')) {
    const query = commandContent.slice('delete'.length).trim();
    await handleSmartDeleteCommand(message, client, query);
    return true;
  }

  return false;
}

module.exports = { handlePartnerDM, handleAdReaction, handleBroadcastDeleteReaction, normalizeDMCommand };
