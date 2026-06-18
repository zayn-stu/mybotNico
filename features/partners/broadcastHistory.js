const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const HISTORY_PATH = path.join(__dirname, '..', '..', 'data', 'broadcastHistory.json');
const MAX_BROADCASTS = 50;

function generateID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function readRaw() {
  const parsed = readJsonFile(HISTORY_PATH, {});
  return parsed && Array.isArray(parsed.broadcasts) ? parsed.broadcasts : [];
}

function writeRaw(broadcasts) {
  const normalized = broadcasts
    .map(normalizeBroadcast)
    .filter(broadcast => broadcast.messages.length > 0)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, MAX_BROADCASTS);
  writeJsonFileAtomic(HISTORY_PATH, { broadcasts: normalized });
}

function normalizeAttachment(attachment) {
  if (typeof attachment === 'string') {
    return { url: attachment, name: null };
  }
  return {
    url: attachment?.url || attachment?.attachment || '',
    name: attachment?.name || null
  };
}

function normalizeMessage(message) {
  return {
    serverId: message.serverId || null,
    serverName: message.serverName || message.name || 'Unknown Server',
    channelId: message.channelId,
    channelName: message.channelName || 'Unknown Channel',
    messageId: message.messageId,
    lastDeleteAttemptAt: message.lastDeleteAttemptAt || null,
    lastDeleteError: message.lastDeleteError || null
  };
}

function buildSearchText(broadcast) {
  const pieces = [
    broadcast.id,
    broadcast.source,
    broadcast.content,
    ...(broadcast.attachments || []).flatMap(a => [a.name, a.url]),
    ...(broadcast.messages || []).flatMap(m => [m.serverName, m.channelName, m.serverId, m.channelId, m.messageId])
  ];
  return pieces.filter(Boolean).join(' ').toLowerCase();
}

function normalizeBroadcast(broadcast) {
  const normalized = {
    id: broadcast.id || generateID(),
    source: broadcast.source || 'direct',
    createdAt: broadcast.createdAt || new Date().toISOString(),
    authorID: broadcast.authorID || null,
    content: broadcast.content || '',
    attachments: Array.isArray(broadcast.attachments) ? broadcast.attachments.map(normalizeAttachment) : [],
    messages: Array.isArray(broadcast.messages)
      ? broadcast.messages.map(normalizeMessage).filter(message => message.channelId && message.messageId)
      : []
  };
  normalized.searchText = buildSearchText(normalized);
  return normalized;
}

function getBroadcasts() {
  return readRaw()
    .map(normalizeBroadcast)
    .filter(broadcast => broadcast.messages.length > 0)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function recordBroadcast(input) {
  const broadcast = normalizeBroadcast({
    id: generateID(),
    createdAt: new Date().toISOString(),
    ...input
  });
  if (broadcast.messages.length === 0) return null;
  const broadcasts = getBroadcasts();
  broadcasts.unshift(broadcast);
  writeRaw(broadcasts);
  return broadcast;
}

function getLatestBroadcast() {
  return getBroadcasts()[0] || null;
}

function getBroadcastById(id) {
  return getBroadcasts().find(broadcast => broadcast.id === id) || null;
}

function searchBroadcasts(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];
  return getBroadcasts().filter(broadcast => {
    return tokens.every(token => broadcast.searchText.includes(token));
  });
}

function replaceBroadcastMessages(id, messages) {
  const broadcasts = getBroadcasts();
  const index = broadcasts.findIndex(broadcast => broadcast.id === id);
  if (index === -1) return false;

  if (messages.length === 0) {
    broadcasts.splice(index, 1);
  } else {
    broadcasts[index].messages = messages.map(normalizeMessage);
    broadcasts[index] = normalizeBroadcast(broadcasts[index]);
  }

  writeRaw(broadcasts);
  return true;
}

module.exports = {
  getBroadcasts,
  recordBroadcast,
  getLatestBroadcast,
  getBroadcastById,
  searchBroadcasts,
  replaceBroadcastMessages
};
