const assert = require('node:assert/strict');
const test = require('node:test');

const { loadCommands, handleCommand, parseArgs, getCommandContent } = require('../handlers/commandHandler');

test('parseArgs keeps quoted arguments together', () => {
  assert.deepEqual(
    parseArgs('role set "Night Panda" #ffcc00'),
    ['role', 'set', 'Night Panda', '#ffcc00']
  );
});

test('parseArgs handles extra whitespace', () => {
  assert.deepEqual(parseArgs('  panda   list  '), ['panda', 'list']);
});

test('getCommandContent supports word prefixes without partial matches', () => {
  assert.equal(getCommandContent('nico panda list', ['nico', 'n', '!']), 'panda list');
  assert.equal(getCommandContent('N panda list', ['nico', 'n', '!']), 'panda list');
  assert.equal(getCommandContent('!panda list', ['nico', 'n', '!']), 'panda list');
  assert.equal(getCommandContent('not a command', ['nico', 'n', '!']), null);
  assert.equal(getCommandContent('nicotine panda list', ['nico', 'n', '!']), null);
});

test('handleCommand ignores messages without the prefix', async () => {
  let executed = false;
  const message = {
    content: 'ping',
    client: { commands: new Map([['ping', { execute: () => { executed = true; } }]]) },
    reply: () => {},
  };

  await handleCommand(message, '!');

  assert.equal(executed, false);
});

test('handleCommand invokes matching command with parsed args', async () => {
  let receivedArgs = null;
  const message = {
    content: 'nico PING "hello there" now',
    client: {
      commands: new Map([
        ['ping', {
          execute: (_message, args) => {
            receivedArgs = args;
          },
        }],
      ]),
    },
    reply: () => {},
  };

  await handleCommand(message, ['nico', 'n', '!']);

  assert.deepEqual(receivedArgs, ['hello there', 'now']);
});

test('handleCommand replies on synchronous command errors', async () => {
  const replies = [];
  const originalError = console.error;
  console.error = () => {};

  try {
    const message = {
      content: '!boom',
      client: {
        commands: new Map([
          ['boom', {
            execute: () => {
              throw new Error('sync failure');
            },
          }],
        ]),
      },
      reply: (content) => replies.push(content),
    };

    await handleCommand(message, '!');
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(replies, ['❌ Command error.']);
});

test('handleCommand replies on asynchronous command errors', async () => {
  const replies = [];
  const originalError = console.error;
  console.error = () => {};

  try {
    const message = {
      content: '!boom',
      client: {
        commands: new Map([
          ['boom', {
            execute: async () => {
              throw new Error('async failure');
            },
          }],
        ]),
      },
      reply: (content) => replies.push(content),
    };

    await handleCommand(message, '!');
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(replies, ['❌ Command error.']);
});

test('loadCommands dynamically loads command modules', () => {
  const client = {};
  const originalLog = console.log;
  console.log = () => {};

  try {
    loadCommands(client);
  } finally {
    console.log = originalLog;
  }

  assert.ok(client.commands instanceof Map);
  assert.ok(client.commands.has('panda'));
  assert.ok(client.commands.has('role'));
  assert.ok(client.commands.has('giveaway'));
});
