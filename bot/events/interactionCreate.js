const { handleInteraction } = require('../../handlers/interactionHandler');

async function handleInteractionCreate(interaction) {
  await handleInteraction(interaction);
}

module.exports = { handleInteractionCreate };
