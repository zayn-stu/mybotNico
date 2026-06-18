const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  VoiceConnectionStatus,
  entersState,
  generateDependencyReport,
  getVoiceConnection,
  joinVoiceChannel,
} = require('@discordjs/voice');
const { readJsonFile, writeJsonFileAtomic } = require('../../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'voiceConnections.json');
const activeConnections = new Map();
const diagnosedNetworking = new WeakSet();
const networkingStatusNames = {
  0: 'OpeningWs',
  1: 'Identifying',
  2: 'UdpHandshaking',
  3: 'SelectingProtocol',
  4: 'Ready',
  5: 'Resuming',
  6: 'Closed',
};

function isVoiceDebugEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.VOICE_DEBUG || '').trim());
}

function summarizeVoiceState(connection) {
  const state = connection?.state;
  if (!state) return 'no connection state';

  const parts = [`status=${state.status}`];
  if ('reason' in state) parts.push(`reason=${state.reason}`);
  if ('closeCode' in state) parts.push(`closeCode=${state.closeCode}`);

  const networking = Reflect.get(state, 'networking');
  if (networking?.state) {
    const code = networking.state.code;
    parts.push(`networking=${networkingStatusNames[code] || code}`);

    const options = networking.state.connectionOptions;
    if (options?.endpoint) parts.push(`endpoint=${options.endpoint}`);
  }

  return parts.join(' ');
}

function attachVoiceDiagnostics(connection, label) {
  if (!isVoiceDebugEnabled()) return;

  connection.on('debug', message => {
    console.debug(`[voice-debug] ${label}: ${message}`);
  });

  connection.on('error', error => {
    console.error(`[voice-debug] ${label}: connection error`, error);
  });

  connection.on('stateChange', (oldState, newState) => {
    const oldNetworking = Reflect.get(oldState, 'networking')?.state?.code;
    const newNetworkingObject = Reflect.get(newState, 'networking');
    const newNetworking = newNetworkingObject?.state?.code;
    if (newNetworkingObject && !diagnosedNetworking.has(newNetworkingObject)) {
      diagnosedNetworking.add(newNetworkingObject);
      newNetworkingObject.on('close', code => {
        console.warn(`[voice-debug] ${label}: networking closed with code ${code}`);
      });
      newNetworkingObject.on('error', error => {
        console.error(`[voice-debug] ${label}: networking error`, error);
      });
      newNetworkingObject.on('stateChange', (networkOldState, networkNewState) => {
        console.log(
          `[voice-debug] ${label}: networking ${networkingStatusNames[networkOldState.code] || networkOldState.code} -> ` +
          `${networkingStatusNames[networkNewState.code] || networkNewState.code}`
        );
      });
    }
    console.log(
      `[voice-debug] ${label}: ${oldState.status}/${networkingStatusNames[oldNetworking] || oldNetworking || 'none'} -> ` +
      `${newState.status}/${networkingStatusNames[newNetworking] || newNetworking || 'none'} (${summarizeVoiceState(connection)})`
    );
  });
}

function logVoiceDependencyReport() {
  if (!isVoiceDebugEnabled()) return;
  console.log(generateDependencyReport());
}

function loadVoiceTargets() {
  return readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('[voice] Error loading voice connection targets:', err),
  });
}

function saveVoiceTargets(targets) {
  try {
    writeJsonFileAtomic(DATA_FILE, targets, { ensureDirectory: true });
  } catch (err) {
    console.error('[voice] Error saving voice connection targets:', err);
  }
}

function setVoiceTarget(guildId, channelId) {
  const targets = loadVoiceTargets();
  targets[guildId] = { channelId };
  saveVoiceTargets(targets);
}

function clearVoiceTarget(guildId) {
  const targets = loadVoiceTargets();
  if (!targets[guildId]) return;
  delete targets[guildId];
  saveVoiceTargets(targets);
}

function parseVoiceChannelId(value) {
  if (!value) return null;
  const match = value.match(/^<#(\d+)>$/) || value.match(/^(\d+)$/);
  return match?.[1] || null;
}

async function fetchBotMember(guild) {
  return guild.members.me || guild.members.fetchMe().catch(() => null);
}

function hasVoiceAccess(channel, member) {
  const permissions = channel.permissionsFor(member);
  return permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]) === true;
}

async function resolveVoiceChannel(message, args) {
  const requestedChannelId = parseVoiceChannelId(args[0]);

  if (requestedChannelId) {
    const channel = await message.guild.channels.fetch(requestedChannelId).catch(() => null);
    if (!channel?.isVoiceBased() || channel.type === ChannelType.GuildStageVoice) {
      return { error: 'That is not a normal voice channel I can join.' };
    }
    return { channel };
  }

  const channel = message.member?.voice?.channel;
  if (!channel) {
    return { error: 'Join a voice channel first, or use `nico join <voice_channel_id>`.' };
  }
  if (channel.type === ChannelType.GuildStageVoice) {
    return { error: 'Stage channels are not supported for this command.' };
  }

  return { channel };
}

function attachReconnectHandler(connection, client) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    const tracked = activeConnections.get(connection.joinConfig.guildId);
    if (!tracked?.shouldReconnect) return;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      const latest = activeConnections.get(connection.joinConfig.guildId);
      if (!latest?.shouldReconnect) return;

      const channel = await client.channels.fetch(latest.channelId).catch(() => null);
      if (!channel?.isVoiceBased()) {
        activeConnections.delete(connection.joinConfig.guildId);
        return;
      }

      connectToChannel(channel, client);
    }
  });
}

function connectToChannel(channel, client, options = {}) {
  const {
    selfDeaf = false,
    selfMute = false,
    reason = 'normal',
    shouldReconnect = true,
  } = options;
  const previous = activeConnections.get(channel.guild.id);
  if (previous) {
    previous.shouldReconnect = false;
    activeConnections.delete(channel.guild.id);
  }

  const existing = getVoiceConnection(channel.guild.id);
  if (existing) existing.destroy();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf,
    selfMute,
    debug: isVoiceDebugEnabled(),
  });
  attachVoiceDiagnostics(connection, `${channel.guild.name}#${channel.name}/${reason}`);

  activeConnections.set(channel.guild.id, {
    channelId: channel.id,
    connection,
    selfDeaf,
    selfMute,
    reason,
    shouldReconnect,
  });

  attachReconnectHandler(connection, client);
  return connection;
}

function logReadyState(connection, label) {
  entersState(connection, VoiceConnectionStatus.Ready, 30_000)
    .catch(error => {
      console.warn(`[voice] Joined ${label}, but did not reach Ready state within 30s: ${error.message}. ${summarizeVoiceState(connection)}`);
    });
}

async function joinVoice(message, args) {
  if (!message.guild) {
    return message.reply('This command can only be used in a server channel.');
  }

  const { channel, error } = await resolveVoiceChannel(message, args);
  if (error) return message.reply(error);

  const botMember = await fetchBotMember(message.guild);
  if (!botMember || !hasVoiceAccess(channel, botMember)) {
    return message.reply('I need View Channel and Connect permissions for that voice channel.');
  }

  try {
    const connection = connectToChannel(channel, message.client);
    setVoiceTarget(message.guild.id, channel.id);
    logReadyState(connection, `${channel.name} (${channel.guild.name})`);
    return message.reply(`Joined **${channel.name}**.`);
  } catch (error) {
    console.error('[voice] Failed to join voice channel:', error);
    activeConnections.delete(message.guild.id);
    return message.reply('Failed to join that voice channel.');
  }
}

async function leaveVoice(message) {
  if (!message.guild) {
    return message.reply('This command can only be used in a server channel.');
  }

  const tracked = activeConnections.get(message.guild.id);
  const connection = tracked?.connection || getVoiceConnection(message.guild.id);
  const botMember = await fetchBotMember(message.guild);
  const botVoiceChannel = botMember?.voice?.channel;

  if (!connection && !botVoiceChannel) {
    return message.reply('I am not connected to a voice channel here.');
  }

  if (tracked) {
    tracked.shouldReconnect = false;
    activeConnections.delete(message.guild.id);
  }

  clearVoiceTarget(message.guild.id);

  if (connection) {
    connection.destroy();
    return message.reply('Left the voice channel.');
  }

  try {
    await botMember.voice.disconnect('Leave command requested');
    return message.reply('Left the voice channel.');
  } catch (error) {
    console.error('[voice] Failed to disconnect from voice channel:', error);
    return message.reply('I can see that I am in voice, but failed to disconnect.');
  }
}

async function restoreVoiceConnections(client) {
  const targets = loadVoiceTargets();

  for (const [guildId, target] of Object.entries(targets)) {
    const channel = await client.channels.fetch(target.channelId).catch(() => null);
    if (!channel?.isVoiceBased() || channel.guild.id !== guildId || channel.type === ChannelType.GuildStageVoice) {
      clearVoiceTarget(guildId);
      continue;
    }

    try {
      const connection = connectToChannel(channel, client);
      logReadyState(connection, `${channel.name} (${channel.guild.name})`);
      console.log(`[voice] Restored connection to ${channel.name} (${channel.guild.name})`);
    } catch (err) {
      console.error(`[voice] Failed to restore voice connection for guild ${guildId}:`, err);
    }
  }
}

module.exports = {
  activeConnections,
  connectToChannel,
  fetchBotMember,
  hasVoiceAccess,
  joinVoice,
  logVoiceDependencyReport,
  leaveVoice,
  restoreVoiceConnections,
  summarizeVoiceState,
};
