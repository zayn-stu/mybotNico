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
const RECONNECT_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 30_000];
const RECOVERY_GRACE_MS = 5_000;
const INITIAL_CONNECTION_GRACE_MS = 30_000;
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

function getReconnectDelay(attempt) {
  const index = Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index];
}

function clearTimer(tracked, key) {
  if (!tracked?.[key]) return;
  clearTimeout(tracked[key]);
  tracked[key] = null;
  if (key === 'recoveryTimer') tracked.recoveryGraceMs = null;
}

function clearReconnectTimers(tracked) {
  clearTimer(tracked, 'reconnectTimer');
  clearTimer(tracked, 'recoveryTimer');
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

function scheduleReconnect(guildId, client, cause, delayOverride) {
  const tracked = activeConnections.get(guildId);
  if (!tracked?.shouldReconnect || tracked.reconnectTimer) return;

  clearTimer(tracked, 'recoveryTimer');
  const attempt = tracked.reconnectAttempts || 0;
  const delayMs = delayOverride ?? getReconnectDelay(attempt);
  console.warn(
    `[voice] Rejoining guild ${guildId} in ${delayMs}ms after ${cause} ` +
    `(attempt ${attempt + 1})`
  );

  tracked.reconnectTimer = setTimeout(async () => {
    const latest = activeConnections.get(guildId);
    if (latest !== tracked || !tracked.shouldReconnect) return;

    tracked.reconnectTimer = null;
    tracked.reconnectAttempts = attempt + 1;

    let channel;
    try {
      channel = await client.channels.fetch(tracked.channelId);
    } catch (error) {
      console.warn(`[voice] Could not fetch channel ${tracked.channelId} for rejoin: ${error.message}`);
      scheduleReconnect(guildId, client, 'channel fetch failure');
      return;
    }

    // A successful fetch of a non-voice channel means the saved target is no
    // longer usable. Fetch failures above remain retryable because Discord or
    // the main gateway may still be recovering.
    if (!channel?.isVoiceBased() || channel.type === ChannelType.GuildStageVoice) {
      console.error(`[voice] Stopping reconnects for guild ${guildId}: voice channel ${tracked.channelId} no longer exists`);
      tracked.shouldReconnect = false;
      activeConnections.delete(guildId);
      clearVoiceTarget(guildId);
      return;
    }

    if (activeConnections.get(guildId) !== tracked || !tracked.shouldReconnect) return;

    try {
      connectToChannel(channel, client, {
        selfDeaf: tracked.selfDeaf,
        selfMute: tracked.selfMute,
        reason: `reconnect:${cause}`,
        reconnectAttempts: tracked.reconnectAttempts,
      });
    } catch (error) {
      console.error(`[voice] Rejoin attempt failed for guild ${guildId}:`, error);
      tracked.connection = null;
      tracked.shouldReconnect = true;
      activeConnections.set(guildId, tracked);
      scheduleReconnect(guildId, client, 'join failure');
    }
  }, delayMs);
  tracked.reconnectTimer.unref?.();
}

function armRecoveryWatchdog(connection, client, cause, graceMs = RECOVERY_GRACE_MS) {
  const guildId = connection.joinConfig.guildId;
  const tracked = activeConnections.get(guildId);
  if (
    !tracked?.shouldReconnect ||
    tracked.connection !== connection ||
    tracked.reconnectTimer
  ) return;

  // Keep the earliest watchdog. A concrete WebSocket error shortens the
  // relaxed initial-join deadline instead of waiting the full 30 seconds.
  if (tracked.recoveryTimer) {
    if (tracked.recoveryGraceMs <= graceMs) return;
    clearTimer(tracked, 'recoveryTimer');
  }

  tracked.recoveryTimer = setTimeout(() => {
    const latest = activeConnections.get(guildId);
    if (latest !== tracked || !tracked.shouldReconnect || tracked.connection !== connection) return;

    tracked.recoveryTimer = null;
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      tracked.reconnectAttempts = 0;
      return;
    }

    scheduleReconnect(guildId, client, `${cause}; stuck in ${connection.state.status}`);
  }, graceMs);
  tracked.recoveryGraceMs = graceMs;
  tracked.recoveryTimer.unref?.();
}

function attachReconnectHandler(connection, client) {
  connection.on('stateChange', (oldState, newState) => {
    const guildId = connection.joinConfig.guildId;
    const tracked = activeConnections.get(guildId);
    if (!tracked?.shouldReconnect || tracked.connection !== connection) return;

    if (newState.status === VoiceConnectionStatus.Ready) {
      const recovered = tracked.reconnectAttempts > 0;
      clearReconnectTimers(tracked);
      tracked.reconnectAttempts = 0;
      if (recovered) console.log(`[voice] Reconnected successfully in guild ${guildId}`);
      return;
    }

    if (
      newState.status === VoiceConnectionStatus.Disconnected ||
      newState.status === VoiceConnectionStatus.Destroyed
    ) {
      clearTimer(tracked, 'recoveryTimer');
      scheduleReconnect(guildId, client, `connection became ${newState.status}`, 0);
      return;
    }

    if (
      newState.status === VoiceConnectionStatus.Signalling ||
      newState.status === VoiceConnectionStatus.Connecting
    ) {
      const graceMs = oldState.status === VoiceConnectionStatus.Ready
        ? RECOVERY_GRACE_MS
        : INITIAL_CONNECTION_GRACE_MS;
      armRecoveryWatchdog(connection, client, 'automatic recovery did not finish', graceMs);
    }
  });
}

function connectToChannel(channel, client, options = {}) {
  const {
    selfDeaf = false,
    selfMute = false,
    reason = 'normal',
    shouldReconnect = true,
    reconnectAttempts = 0,
  } = options;
  const previous = activeConnections.get(channel.guild.id);
  if (previous) {
    previous.shouldReconnect = false;
    clearReconnectTimers(previous);
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
  // Always handle 'error' so a voice websocket/networking failure (e.g. a 521
  // from Discord) is logged instead of crashing the process. The library gets
  // a short chance to recover, then our watchdog creates a fresh connection.
  connection.on('error', error => {
    console.error(`[voice] Connection error in ${channel.guild.name}#${channel.name}: ${error.message}`);
    armRecoveryWatchdog(connection, client, `connection error: ${error.message}`);
  });
  attachVoiceDiagnostics(connection, `${channel.guild.name}#${channel.name}/${reason}`);

  activeConnections.set(channel.guild.id, {
    channelId: channel.id,
    connection,
    selfDeaf,
    selfMute,
    reason,
    shouldReconnect,
    reconnectAttempts,
    reconnectTimer: null,
    recoveryTimer: null,
    recoveryGraceMs: null,
  });

  attachReconnectHandler(connection, client);
  armRecoveryWatchdog(
    connection,
    client,
    'initial connection did not become ready',
    INITIAL_CONNECTION_GRACE_MS
  );
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
    clearReconnectTimers(tracked);
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
  attachReconnectHandler,
  connectToChannel,
  fetchBotMember,
  getReconnectDelay,
  hasVoiceAccess,
  joinVoice,
  logVoiceDependencyReport,
  leaveVoice,
  restoreVoiceConnections,
  summarizeVoiceState,
};
