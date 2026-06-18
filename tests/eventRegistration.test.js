const assert = require('node:assert/strict');
const test = require('node:test');

const { createRuntimeContext, registerEvents } = require('../bot/registerEvents');

test('createRuntimeContext builds isolated runtime maps', () => {
  const client = {};
  const context = createRuntimeContext(client);

  assert.equal(context.client, client);
  assert.deepEqual(context.prefix, ['nico', 'n', '!']);
  assert.ok(context.voiceActivityTracker instanceof Map);
  assert.ok(context.pirateMessageCounter instanceof Map);
});

test('registerEvents wires the expected Discord events', () => {
  const registrations = [];
  const client = {
    once: (eventName, handler) => registrations.push(['once', eventName, handler]),
    on: (eventName, handler) => registrations.push(['on', eventName, handler]),
  };

  registerEvents(client);

  assert.deepEqual(
    registrations.map(([method, eventName]) => `${method}:${eventName}`),
    [
      'once:ready',
      'on:inviteCreate',
      'on:inviteDelete',
      'on:guildMemberRemove',
      'on:guildMemberAdd',
      'on:guildMemberUpdate',
      'on:roleDelete',
      'on:interactionCreate',
      'on:messageCreate',
      'on:voiceStateUpdate',
      'on:messageReactionAdd',
      'on:messageReactionRemove',
    ]
  );

  for (const [, , handler] of registrations) {
    assert.equal(typeof handler, 'function');
  }
});
