const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { parseColor, COLOR_NAMES } = require('./colors');
const { positionRole, buildColorOptions, buildColorEditorMessage } = require('./roleHelpers');
const {
  getUserRoles,
  getGuildRoles,
  addRole,
  updateRole,
} = require('./storage');
const { setColors, setSelectedRole, getColorsAndClear, getColors } = require('./colorSelectionCache');
const { userCanManageRoles, canModifyMember } = require('./permissions');

const ROLE_CREATE_CONTEXT = 'create';

function getTargetUserIdFromCustomId(customId) {
  return customId.split(':')[1] || null;
}

async function getRoleMenuContext(interaction, targetUserId = null) {
  const isCreateMode = targetUserId === ROLE_CREATE_CONTEXT;
  if (isCreateMode) {
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: '❌ This action can only be used in a guild.',
        ephemeral: true,
      });
      return null;
    }

    if (!userCanManageRoles(interaction.member)) {
      await interaction.reply({
        content: '❌ You need the Manage Roles permission to create unowned roles.',
        ephemeral: true,
      });
      return null;
    }

    return {
      contextUserId: ROLE_CREATE_CONTEXT,
      targetMember: null,
      isAdminTargetMode: false,
      isCreateMode: true,
    };
  }

  const contextUserId = targetUserId || interaction.user.id;
  const isAdminTargetMode = contextUserId !== interaction.user.id;

  if (!isAdminTargetMode) {
    return { contextUserId, targetMember: interaction.member, isAdminTargetMode };
  }

  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: '❌ This action can only be used in a guild.',
      ephemeral: true,
    });
    return null;
  }

  if (!userCanManageRoles(interaction.member)) {
    await interaction.reply({
      content: '❌ You need the Manage Roles permission to edit another user\'s role.',
      ephemeral: true,
    });
    return null;
  }

  const targetMember = await interaction.guild.members.fetch(contextUserId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({
      content: '❌ Target user not found.',
      ephemeral: true,
    });
    return null;
  }

  if (!canModifyMember(interaction.member, targetMember)) {
    await interaction.reply({
      content: '❌ You cannot modify roles for someone with equal or higher rank than you.',
      ephemeral: true,
    });
    return null;
  }

  return { contextUserId, targetMember, isAdminTargetMode };
}

function buildRoleEditorContent(selectedColors, context = {}) {
  let content = buildColorEditorMessage(selectedColors);
  if (context.isCreateMode) {
    content = content.replace(
      'Select your colors from the dropdowns below, then click "Edit Role".',
      'Create an unowned role. It will be saved for later assignment and will not be assigned to anyone now.'
    );
  } else if (context.isAdminTargetMode && context.targetMember) {
    content = content.replace(
      'Select your colors from the dropdowns below, then click "Edit Role".',
      `Target: ${context.targetMember.user.tag}\nSelect colors to create/edit, or assign an existing unowned role.`
    );
  }
  if (selectedColors?.selectedRoleId) {
    const selectedRoleName = context.guild?.roles.cache.get(selectedColors.selectedRoleId)?.name || selectedColors.selectedRoleId;
    content += `✓ Existing role: **${selectedRoleName}**\n`;
  }
  return content;
}

async function handleRoleEditModal(interaction) {
  const { guild, user } = interaction;
  const targetUserId = getTargetUserIdFromCustomId(interaction.customId);
  const context = await getRoleMenuContext(interaction, targetUserId);
  if (!context) return;
  const { contextUserId, targetMember } = context;

  if (!guild || (!targetMember && !context.isCreateMode)) {
    return interaction.reply({
      content: '❌ This command can only be used in a guild.',
      ephemeral: true,
    });
  }

  const roleName = interaction.fields.getTextInputValue('role_name_input')?.trim();
  const primaryColorInput = interaction.fields.getTextInputValue('primary_color_input')?.trim();
  const secondaryColorInput = interaction.fields.getTextInputValue('secondary_color_input')?.trim();

  if (!roleName || roleName.length === 0 || roleName.length > 100) {
    return interaction.reply({
      content: '❌ Role name must be between 1 and 100 characters.',
      ephemeral: true,
    });
  }

  const primaryColor = parseColor(primaryColorInput);
  if (!primaryColor) {
    return interaction.reply({
      content: `❌ Invalid primary color. Use hex (#FF0000) or name (red, blue, etc.).\n\n**Available colors:** ${Object.keys(COLOR_NAMES).join(', ')}`,
      ephemeral: true,
    });
  }

  let secondaryColor = null;
  if (secondaryColorInput && secondaryColorInput.length > 0) {
    secondaryColor = parseColor(secondaryColorInput);
    if (!secondaryColor) {
      return interaction.reply({
        content: `❌ Invalid secondary color. Use hex (#FF0000) or name (red, blue, etc.).\n\n**Available colors:** ${Object.keys(COLOR_NAMES).join(', ')}`,
        ephemeral: true,
      });
    }

    if (primaryColor.toUpperCase() === secondaryColor.toUpperCase()) {
      return interaction.reply({
        content: '❌ Gradient colors must be different.',
        ephemeral: true,
      });
    }
  }

  const userRoles = context.isCreateMode ? [] : getUserRoles(guild.id, contextUserId);
  const existingRoleData = userRoles.length > 0 ? userRoles[userRoles.length - 1] : null;

  try {
    if (existingRoleData) {
      const role = guild.roles.cache.get(existingRoleData.roleId);
      if (!role) {
        return interaction.reply({
          content: '❌ Your role no longer exists in the server. Please use `!role set` to create a new one.',
          ephemeral: true,
        });
      }

      await role.setName(roleName);
      await role.edit(buildColorOptions(primaryColor, secondaryColor));
      await updateRole(guild.id, role.id, {
        name: roleName,
        color: primaryColor,
        color2: secondaryColor || null,
      });

      return interaction.reply({
        content: secondaryColor
          ? `✅ Updated role **${roleName}** with colors \`${primaryColor}\` → \`${secondaryColor}\``
          : `✅ Updated role **${roleName}** with color \`${primaryColor}\``,
        ephemeral: true,
      });
    }

    const roleOptions = {
      name: roleName,
      hoist: false,
      mentionable: false,
      permissions: [],
      reason: context.isCreateMode
        ? `Unowned color role created by ${user.tag}`
        : context.isAdminTargetMode
        ? `Custom color role for ${targetMember.user.tag} (by ${user.tag})`
        : `Custom color role for ${user.tag}`,
      ...buildColorOptions(primaryColor, secondaryColor),
    };

    const role = await guild.roles.create(roleOptions);
    await positionRole(role, guild);
    if (!context.isCreateMode) {
      await targetMember.roles.add(role);
    }
    await addRole(
      guild.id,
      role.id,
      context.isCreateMode ? null : contextUserId,
      roleName,
      primaryColor,
      secondaryColor
    );

    return interaction.reply({
      content: context.isCreateMode
        ? secondaryColor
          ? `✅ Created unowned gradient role **${roleName}** with colors \`${primaryColor}\` → \`${secondaryColor}\``
          : `✅ Created unowned role **${roleName}** with color \`${primaryColor}\``
        : secondaryColor
        ? `✅ Created gradient role **${roleName}** with colors \`${primaryColor}\` → \`${secondaryColor}\``
        : `✅ Created role **${roleName}** with color \`${primaryColor}\``,
      ephemeral: true,
    });
  } catch (err) {
    console.error('[interaction] Error handling role edit:', err);
    return interaction.reply({
      content: `❌ Failed to update role: ${err.message}`,
      ephemeral: true,
    });
  }
}

async function handleColorSelect(interaction, isPrimary, targetUserId = null) {
  const context = await getRoleMenuContext(interaction, targetUserId);
  if (!context) return;
  const selectedValue = interaction.values[0];
  const currentColors = getColors(interaction.guildId, interaction.user.id, context.contextUserId) || {};

  let primaryColor, secondaryColor;

  if (isPrimary) {
    primaryColor = selectedValue;
    secondaryColor = currentColors.secondaryColor || null;
  } else {
    primaryColor = currentColors.primaryColor;
    secondaryColor = selectedValue === '__none__' ? null : selectedValue;
  }

  if (primaryColor) {
    setColors(interaction.guildId, interaction.user.id, primaryColor, secondaryColor, context.contextUserId);
  }

  const updatedColors = getColors(interaction.guildId, interaction.user.id, context.contextUserId);
  const content = buildRoleEditorContent(updatedColors, { ...context, guild: interaction.guild });

  try {
    await interaction.update({ content });
  } catch (err) {
    console.error('[interaction] Error updating message:', err);
    await interaction.reply({
      content: '❌ Failed to update colors.',
      ephemeral: true,
    }).catch(() => {});
  }
}

async function handleExistingRoleSelect(interaction, targetUserId = null) {
  const context = await getRoleMenuContext(interaction, targetUserId);
  if (!context) return;
  const selectedValue = interaction.values[0];
  const selectedRoleId = selectedValue === '__none__' ? null : selectedValue;

  setSelectedRole(interaction.guildId, interaction.user.id, selectedRoleId, context.contextUserId);

  const updatedColors = getColors(interaction.guildId, interaction.user.id, context.contextUserId);
  const content = buildRoleEditorContent(updatedColors, { ...context, guild: interaction.guild });

  try {
    await interaction.update({ content });
  } catch (err) {
    console.error('[interaction] Error updating selected role:', err);
    await interaction.reply({
      content: '❌ Failed to update selected role.',
      ephemeral: true,
    }).catch(() => {});
  }
}

async function handleRoleEditButton(interaction, targetUserId = null) {
  const { guild, user } = interaction;
  const context = await getRoleMenuContext(interaction, targetUserId);
  if (!context) return;
  const { contextUserId, targetMember } = context;

  if (!guild) {
    return interaction.reply({
      content: '❌ This command can only be used in a guild.',
      ephemeral: true,
    });
  }

  const userRoles = context.isCreateMode ? [] : getUserRoles(guild.id, contextUserId);
  const existingRoleData = userRoles.length > 0 ? userRoles[userRoles.length - 1] : null;
  const cachedColors = getColorsAndClear(guild.id, user.id, contextUserId);

  if (cachedColors?.selectedRoleId && context.isAdminTargetMode && !existingRoleData) {
    const selectedRole = guild.roles.cache.get(cachedColors.selectedRoleId);
    if (!selectedRole) {
      return interaction.reply({
        content: '❌ Selected role no longer exists.',
        ephemeral: true,
      });
    }

    const storedRole = getGuildRoles(guild.id)[selectedRole.id];
    if (!storedRole || storedRole.creatorId) {
      return interaction.reply({
        content: '❌ Selected role is no longer available for assignment.',
        ephemeral: true,
      });
    }

    try {
      await targetMember.roles.add(selectedRole);
      await updateRole(guild.id, selectedRole.id, { creatorId: contextUserId });
      return interaction.reply({
        content: `✅ Assigned role **${selectedRole.name}** to ${targetMember.user.tag}.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[interaction] Error assigning existing role:', err);
      return interaction.reply({
        content: `❌ Failed to assign role: ${err.message}`,
        ephemeral: true,
      });
    }
  }

  const modal = new ModalBuilder()
    .setCustomId(context.isAdminTargetMode || context.isCreateMode ? `role_edit_modal:${contextUserId}` : 'role_edit_modal')
    .setTitle(context.isCreateMode ? 'Create Unowned Role' : existingRoleData ? 'Edit Role' : 'Create Role');

  const nameInput = new TextInputBuilder()
    .setCustomId('role_name_input')
    .setLabel('Role Name')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(100)
    .setPlaceholder('e.g., "Mystic Wizard"');
  if (existingRoleData) nameInput.setValue(existingRoleData.name);

  const colorInput = new TextInputBuilder()
    .setCustomId('primary_color_input')
    .setLabel('Primary Color (hex or name)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(50)
    .setPlaceholder('e.g., #FF0000 or "red"')
    .setRequired(true);
  if (cachedColors?.primaryColor) {
    colorInput.setValue(cachedColors.primaryColor);
  } else if (existingRoleData && existingRoleData.color) {
    colorInput.setValue(existingRoleData.color);
  }

  const color2Input = new TextInputBuilder()
    .setCustomId('secondary_color_input')
    .setLabel('Secondary Color (optional, for gradient)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(0)
    .setMaxLength(50)
    .setPlaceholder('Leave blank for solid color, or use hex or name')
    .setRequired(false);
  if (cachedColors?.secondaryColor) {
    color2Input.setValue(cachedColors.secondaryColor);
  } else if (existingRoleData && existingRoleData.color2) {
    color2Input.setValue(existingRoleData.color2);
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(colorInput),
    new ActionRowBuilder().addComponents(color2Input)
  );

  try {
    await interaction.showModal(modal);
  } catch (err) {
    console.error('[interaction] Error showing modal:', err);
    return interaction.reply({
      content: `❌ Failed to open role editor: ${err.message}`,
      ephemeral: true,
    });
  }
}

async function handleRoleInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('role_color_primary_select')) {
      await handleColorSelect(interaction, true, getTargetUserIdFromCustomId(interaction.customId));
      return true;
    }
    if (interaction.customId.startsWith('role_color_secondary_select')) {
      await handleColorSelect(interaction, false, getTargetUserIdFromCustomId(interaction.customId));
      return true;
    }
    if (interaction.customId.startsWith('role_existing_select:')) {
      await handleExistingRoleSelect(interaction, getTargetUserIdFromCustomId(interaction.customId));
      return true;
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('role_edit_button')) {
    await handleRoleEditButton(interaction, getTargetUserIdFromCustomId(interaction.customId));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('role_edit_modal')) {
    await handleRoleEditModal(interaction);
    return true;
  }

  return false;
}

module.exports = { handleRoleInteraction };
