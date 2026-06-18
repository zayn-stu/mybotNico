function getAttachmentUrls(attachments = []) {
  return attachments
    .map(attachment => {
      if (typeof attachment === 'string') return attachment;
      return attachment?.url || attachment?.attachment || null;
    })
    .filter(Boolean);
}

function truncateText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatBroadcastPreview(broadcast) {
  const date = new Date(broadcast.createdAt).toLocaleString();
  const content = truncateText(broadcast.content || '(attachment only)', 600);
  const destinations = broadcast.messages
    .map(entry => `${entry.serverName} (#${entry.channelName})`)
    .slice(0, 8);
  const remaining = broadcast.messages.length - destinations.length;

  let msg = `**Broadcast:** \`${broadcast.id}\`\n`;
  msg += `**Source:** ${broadcast.source}\n`;
  if (broadcast.isFallback) {
    msg += `**Found By:** Fallback channel scan\n`;
  }
  msg += `**Date:** ${date}\n`;
  msg += `**Messages:** ${broadcast.messages.length}\n`;
  msg += `**Content:**\n${content}\n`;
  if (broadcast.attachments?.length) {
    msg += `**Attachments:** ${broadcast.attachments.length}\n`;
  }
  msg += `**Destinations:**\n${destinations.map(dest => `- ${dest}`).join('\n')}`;
  if (remaining > 0) msg += `\n- ...and ${remaining} more`;
  return msg;
}

function formatDeleteResult(result) {
  let msg = `**Delete Results:** ${result.deleted}/${result.total} deleted`;
  if (result.alreadyMissing > 0) msg += `, ${result.alreadyMissing} already missing`;
  if (result.failed.length > 0) {
    msg += `, ${result.failed.length} failed\n\n**Failures:**\n`;
    for (const failure of result.failed.slice(0, 10)) {
      msg += `❌ ${failure.serverName} (#${failure.channelName}) — ${failure.error}\n`;
    }
    if (result.failed.length > 10) {
      msg += `...and ${result.failed.length - 10} more failures\n`;
    }
  }
  return msg;
}

function getBroadcastMessagesFromResults(results) {
  return results
    .filter(result => result.success && result.sentMessage)
    .map(result => ({
      serverId: result.serverId,
      serverName: result.name,
      channelId: result.channelId,
      channelName: result.channelName,
      messageId: result.sentMessage.id
    }));
}

function getMessageAttachments(message) {
  return [...message.attachments.values()].map(attachment => ({
    url: attachment.url,
    name: attachment.name || null
  }));
}

function buildCandidateSearchText(candidate) {
  const pieces = [
    candidate.id,
    candidate.source,
    candidate.content,
    ...(candidate.attachments || []).flatMap(a => [a.name, a.url]),
    ...(candidate.messages || []).flatMap(m => [m.serverName, m.channelName, m.serverId, m.channelId, m.messageId])
  ];
  return pieces.filter(Boolean).join(' ').toLowerCase();
}

function queryMatchesCandidate(candidate, query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const searchText = buildCandidateSearchText(candidate);
  return tokens.every(token => searchText.includes(token));
}

function getFallbackSignature(candidate) {
  const attachmentPart = (candidate.attachments || [])
    .map(attachment => `${attachment.name || ''}:${attachment.url || ''}`)
    .sort()
    .join('|');
  return `${candidate.content || ''}::${attachmentPart}`;
}

function groupFallbackCandidates(candidates) {
  const groups = [];
  const windowMs = 15 * 60 * 1000;

  for (const candidate of candidates) {
    const signature = getFallbackSignature(candidate);
    const created = new Date(candidate.createdAt).getTime();
    const group = groups.find(existing => {
      return existing.signature === signature && Math.abs(existing.createdTimestamp - created) <= windowMs;
    });

    if (group) {
      group.messages.push(...candidate.messages);
      if (created > group.createdTimestamp) {
        group.createdTimestamp = created;
        group.createdAt = candidate.createdAt;
      }
      continue;
    }

    groups.push({
      ...candidate,
      id: `fallback-${candidate.messages[0].messageId}`,
      signature,
      createdTimestamp: created,
      messages: [...candidate.messages]
    });
  }

  return groups
    .map(({ signature, createdTimestamp, ...group }) => group)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  getAttachmentUrls,
  truncateText,
  formatBroadcastPreview,
  formatDeleteResult,
  getBroadcastMessagesFromResults,
  getMessageAttachments,
  buildCandidateSearchText,
  queryMatchesCandidate,
  getFallbackSignature,
  groupFallbackCandidates,
};
