const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { VoiceConnectionStatus } = require('@discordjs/voice');

const {
  activeConnections,
  attachReconnectHandler,
  getReconnectDelay,
} = require('../features/voice/connection');

function createTrackedConnection(status = VoiceConnectionStatus.Ready) {
  const connection = new EventEmitter();
  connection.joinConfig = { guildId: 'guild-1' };
  connection.state = { status };

  const tracked = {
    channelId: 'channel-1',
    connection,
    selfDeaf: false,
    selfMute: false,
    shouldReconnect: true,
    reconnectAttempts: 0,
    reconnectTimer: null,
    recoveryTimer: null,
    recoveryGraceMs: null,
  };
  activeConnections.set('guild-1', tracked);
  return { connection, tracked };
}

function clearTrackedConnections() {
  for (const tracked of activeConnections.values()) {
    if (tracked.reconnectTimer) clearTimeout(tracked.reconnectTimer);
    if (tracked.recoveryTimer) clearTimeout(tracked.recoveryTimer);
  }
  activeConnections.clear();
}

test.afterEach(clearTrackedConnections);

test('voice reconnect delay starts immediately and caps at 30 seconds', () => {
  assert.equal(getReconnectDelay(0), 0);
  assert.equal(getReconnectDelay(1), 1_000);
  assert.equal(getReconnectDelay(4), 10_000);
  assert.equal(getReconnectDelay(5), 30_000);
  assert.equal(getReconnectDelay(50), 30_000);
});

test('an explicit voice disconnect schedules an immediate channel rejoin', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = createTrackedConnection();
  let fetches = 0;
  const client = {
    channels: {
      fetch: async () => {
        fetches++;
        // An invalid fetched target stops the test before joinVoiceChannel is
        // reached; fetching it proves the immediate reconnect ran.
        return { isVoiceBased: () => false };
      },
    },
  };

  attachReconnectHandler(connection, client);
  connection.state = { status: VoiceConnectionStatus.Disconnected };
  connection.emit(
    'stateChange',
    { status: VoiceConnectionStatus.Ready },
    connection.state
  );

  t.mock.timers.tick(0);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fetches, 1);
  assert.equal(activeConnections.has('guild-1'), false);
});

test('a stuck 521-style recovery gets replaced after the grace period', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = createTrackedConnection();
  let fetches = 0;
  const client = {
    channels: {
      fetch: async () => {
        fetches++;
        return { isVoiceBased: () => false };
      },
    },
  };

  attachReconnectHandler(connection, client);
  connection.state = { status: VoiceConnectionStatus.Signalling };
  connection.emit(
    'stateChange',
    { status: VoiceConnectionStatus.Ready },
    connection.state
  );

  t.mock.timers.tick(4_999);
  assert.equal(fetches, 0);

  t.mock.timers.tick(1);
  t.mock.timers.tick(0);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fetches, 1);
  assert.equal(activeConnections.has('guild-1'), false);
});

test('becoming ready cancels a pending reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = createTrackedConnection();
  let fetches = 0;
  const client = { channels: { fetch: async () => { fetches++; } } };

  attachReconnectHandler(connection, client);
  connection.emit(
    'stateChange',
    { status: VoiceConnectionStatus.Ready },
    { status: VoiceConnectionStatus.Disconnected }
  );
  connection.state = { status: VoiceConnectionStatus.Ready };
  connection.emit(
    'stateChange',
    { status: VoiceConnectionStatus.Disconnected },
    connection.state
  );

  t.mock.timers.tick(0);
  await Promise.resolve();

  assert.equal(fetches, 0);
});
