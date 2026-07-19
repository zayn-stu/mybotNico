const { MessageFlags } = require('discord.js');
const { handleRoleInteraction } = require('../features/roles/interactionHandler');
const { handleGiveawayInteraction } = require('../features/giveaways/interactionHandler');
const { handleNicosCaveInteraction } = require('../features/nicoscave/interactionHandler');
const { handleVerificationInteraction } = require('../features/verification/interactionHandler');

async function handleInteraction(interaction) {
  try {
    if (await handleVerificationInteraction(interaction)) return;
    if (await handleNicosCaveInteraction(interaction)) return;
    if (await handleRoleInteraction(interaction)) return;
    if (await handleGiveawayInteraction(interaction)) return;
  } catch (err) {
    console.error('[interaction] Unhandled error:', err);
    if (!interaction.isRepliable()) return;
    const payload = {
      content: '❌ An error occurred while processing your request.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      interaction.followUp(payload).catch(() => {});
    } else {
      interaction.reply(payload).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };
