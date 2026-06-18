const fs = require('fs');
const path = require('path');

function loadCommands(client) {
  client.commands = new Map();
  const commandsPath = path.join(__dirname, '..', 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.name, command);
    console.log(`  ✓ Loaded command: ${command.name}`);
  }
}

function parseArgs(content) {
  const args = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    args.push(match[1] || match[2]);
  }
  return args;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCommandContent(content, prefixes) {
  const prefixList = Array.isArray(prefixes) ? prefixes : [prefixes];

  for (const prefix of prefixList) {
    if (!prefix) continue;

    if (/^[a-z0-9]+$/i.test(prefix)) {
      const trimmedContent = content.trimStart();
      const match = trimmedContent.match(new RegExp(`^${escapeRegex(prefix)}(?:\\s+|$)`, 'i'));
      if (match) return trimmedContent.slice(match[0].length).trimStart();
      continue;
    }

    if (content.startsWith(prefix)) return content.slice(prefix.length);
  }

  return null;
}

async function handleCommand(message, prefix) {
  const content = getCommandContent(message.content, prefix);
  if (content === null) return;

  const args = parseArgs(content);
  const commandName = args.shift()?.toLowerCase();

  const command = message.client.commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    await message.reply('❌ Command error.');
  }
}

module.exports = { loadCommands, handleCommand, parseArgs, getCommandContent };
