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

function handleCommand(message, prefix) {
  if (!message.content.startsWith(prefix)) return;

  const content = message.content.slice(prefix.length);
  const args = parseArgs(content);
  const commandName = args.shift()?.toLowerCase();

  const command = message.client.commands.get(commandName);
  if (!command) return;

  try {
    command.execute(message, args);
  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    message.reply('❌ Command error.');
  }
}

module.exports = { loadCommands, handleCommand };
