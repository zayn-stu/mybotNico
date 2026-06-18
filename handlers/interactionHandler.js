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
    if (!interaction.replied) {
      interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };
