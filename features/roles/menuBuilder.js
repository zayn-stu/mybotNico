const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const { COLOR_NAMES } = require('./colors');
const { getColorEmoji } = require('./colorEmoji');
const { getUserRoles, getGuildRoles } = require('./storage');
const { getColors } = require('./colorSelectionCache');
const {
  botCanManageRoles,
  userCanManageRoles,
  canModifyMember,
  isMention,
  parseMention,
  getTargetMember,
} = require('./permissions');

async function menu(message, args) {
  if (!botCanManageRoles(message.guild)) {
    return message.reply('❌ Bot lacks ManageRoles permission.');
  }

  const isCreateMode = args[0]?.toLowerCase() === 'create';
  let targetMember = message.member;
  const targetUserId = !isCreateMode && args[0] && isMention(args[0]) ? parseMention(args[0]) : null;
  const isAdminTargetMode = Boolean(!isCreateMode && targetUserId && targetUserId !== message.author.id);

  if (isCreateMode) {
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to create unowned roles.');
    }
  } else if (isAdminTargetMode) {
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to edit another user\'s role.');
    }

    targetMember = await getTargetMember(message.guild, targetUserId);
    if (!targetMember) return message.reply('❌ User not found.');

    if (!canModifyMember(message.member, targetMember)) {
      return message.reply('❌ You cannot modify roles for someone with equal or higher rank than you.');
    }
  }

  const contextUserId = isCreateMode ? 'create' : targetMember.id;
  const customSuffix = isCreateMode || isAdminTargetMode ? `:${contextUserId}` : '';
  const targetRoles = isCreateMode ? [] : getUserRoles(message.guild.id, contextUserId);
  const targetExistingRole = targetRoles.length > 0 ? targetRoles[targetRoles.length - 1] : null;

  const uniqueColors = new Map();
  for (const [name, hex] of Object.entries(COLOR_NAMES)) {
    if (!uniqueColors.has(hex)) {
      uniqueColors.set(hex, name.charAt(0).toUpperCase() + name.slice(1));
    }
  }

  const primaryOptions = Array.from(uniqueColors.entries()).map(([hex, displayName]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${getColorEmoji(hex)} ${displayName}`)
      .setValue(hex)
      .setDescription(hex)
  );

  const primarySelectMenu = new StringSelectMenuBuilder()
    .setCustomId(`role_color_primary_select${customSuffix}`)
    .setPlaceholder('Select primary color...')
    .addOptions(primaryOptions.slice(0, 25));

  const secondaryOptions = [
    new StringSelectMenuOptionBuilder()
      .setLabel('⊘ None')
      .setValue('__none__')
      .setDescription('Skip gradient (solid color)')
  ];
  secondaryOptions.push(...Array.from(uniqueColors.entries()).map(([hex, displayName]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${getColorEmoji(hex)} ${displayName}`)
      .setValue(hex)
      .setDescription(hex)
  ));

  const secondarySelectMenu = new StringSelectMenuBuilder()
    .setCustomId(`role_color_secondary_select${customSuffix}`)
    .setPlaceholder('Select secondary color (optional)...')
    .addOptions(secondaryOptions.slice(0, 25));

  const components = [
    new ActionRowBuilder().addComponents(primarySelectMenu),
    new ActionRowBuilder().addComponents(secondarySelectMenu),
  ];

  let unownedRoleCount = 0;
  if (isAdminTargetMode && !targetExistingRole) {
    const guildRoles = getGuildRoles(message.guild.id);
    const unownedRoleOptions = Object.entries(guildRoles)
      .filter(([roleId, data]) => !data.creatorId && message.guild.roles.cache.has(roleId))
      .map(([roleId, data]) => {
        unownedRoleCount++;
        return new StringSelectMenuOptionBuilder()
          .setLabel((data.name || 'Unnamed role').slice(0, 100))
          .setValue(roleId)
          .setDescription('Assign this existing unowned color role');
      });

    if (unownedRoleOptions.length > 0) {
      const existingRoleSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`role_existing_select:${contextUserId}`)
        .setPlaceholder('Optional: assign an existing unowned role...')
        .addOptions([
          new StringSelectMenuOptionBuilder()
            .setLabel('⊘ Create or edit via modal')
            .setValue('__none__')
            .setDescription('Do not assign an existing role'),
          ...unownedRoleOptions.slice(0, 24),
        ]);
      components.push(new ActionRowBuilder().addComponents(existingRoleSelectMenu));
    }
  }

  const editButton = new ButtonBuilder()
    .setCustomId(`role_edit_button${customSuffix}`)
    .setLabel(isCreateMode ? 'Create Unowned Role' : isAdminTargetMode ? 'Assign / Edit Role' : 'Edit Role')
    .setStyle(ButtonStyle.Primary);
  components.push(new ActionRowBuilder().addComponents(editButton));

  const selectedColors = getColors(message.guild.id, message.author.id, contextUserId);

  let content = '🎨 **Role Color Editor**\n\n';
  if (isCreateMode) {
    content += 'Create an unowned role. It will be saved for later assignment and will not be assigned to anyone now.\n\n';
  } else if (isAdminTargetMode) {
    content += `Target: ${targetMember.user.tag}\n`;
    if (targetExistingRole) {
      content += `Editing existing role: **${targetExistingRole.name}**\n`;
    } else {
      content += 'Select colors to create a new role, or optionally assign an existing unowned role.\n';
      if (unownedRoleCount > 24) {
        content += `Showing the first 24 of ${unownedRoleCount} unowned roles.\n`;
      }
    }
    content += '\n';
  } else {
    content += 'Select your colors from the dropdowns below, then click "Edit Role".\n\n';
  }

  if (selectedColors?.primaryColor) {
    content += `✓ Primary: ${getColorEmoji(selectedColors.primaryColor)} \`${selectedColors.primaryColor}\`\n`;
  }
  if (selectedColors?.secondaryColor) {
    content += `✓ Secondary: ${getColorEmoji(selectedColors.secondaryColor)} \`${selectedColors.secondaryColor}\`\n`;
  }
  if (selectedColors?.selectedRoleId) {
    const selectedRole = message.guild.roles.cache.get(selectedColors.selectedRoleId);
    content += `✓ Existing role: **${selectedRole?.name || selectedColors.selectedRoleId}**\n`;
  }

  try {
    await message.reply({
      content,
      components,
    });
  } catch (err) {
    console.error('[role menu] Error sending color editor:', err);
    return message.reply(`❌ Failed to open role editor: ${err.message}`);
  }
}

module.exports = { menu };
