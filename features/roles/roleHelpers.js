/**
 * Shared utilities for role management used across multiple handlers.
 */

const { getColorEmoji } = require('./colorEmoji');

const COLOR_SEPARATOR_ROLE_ID = process.env.COLOR_SEPARATOR_ROLE_ID || '';

/**
 * Positions a newly created role below the color separator role.
 */
async function positionRole(role, guild) {
  const separatorRole = guild.roles.cache.get(COLOR_SEPARATOR_ROLE_ID);
  if (separatorRole) {
    try {
      await role.setPosition(separatorRole.position - 1);
    } catch (err) {
      console.warn('[roleHelpers] Could not set role position:', err.message);
    }
  }
}

/**
 * Builds role options for create/edit supporting single color or gradient.
 */
function buildColorOptions(primaryColor, secondaryColor) {
  if (secondaryColor) {
    return {
      colors: {
        primaryColor,
        secondaryColor,
      },
    };
  }
  return { color: primaryColor };
}

/**
 * Builds color editor message content.
 */
function buildColorEditorMessage(selectedColors) {
  let content = '🎨 **Role Color Editor**\n\n';
  content += 'Select your colors from the dropdowns below, then click "Edit Role".\n\n';
  
  if (selectedColors?.primaryColor) {
    content += `✓ Primary: ${getColorEmoji(selectedColors.primaryColor)} \`${selectedColors.primaryColor}\`\n`;
  }
  if (selectedColors?.secondaryColor) {
    content += `✓ Secondary: ${getColorEmoji(selectedColors.secondaryColor)} \`${selectedColors.secondaryColor}\`\n`;
  }
  
  return content;
}

module.exports = {
  positionRole,
  buildColorOptions,
  buildColorEditorMessage,
};
