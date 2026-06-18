const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
} = require('discord.js');
const { parseDuration } = require('./time');
const { updateDraft, getDraft, getDraftAndClear } = require('./setupCache');
const { upsertGiveaway } = require('./storage');

/**
 * Handle giveaway_setup_open button → open modal
 */
async function handleGiveawaySetupOpen(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('giveaway_setup_modal')
    .setTitle('Giveaway Setup');

  const prizeInput = new TextInputBuilder()
    .setCustomId('giveaway_prize_input')
    .setLabel('Prize')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(256)
    .setPlaceholder('What are you giving away?')
    .setRequired(true);

  const winnersInput = new TextInputBuilder()
    .setCustomId('giveaway_winners_input')
    .setLabel('Number of Winners')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(10)
    .setPlaceholder('e.g., 1, 5, 10')
    .setRequired(true);

  const durationInput = new TextInputBuilder()
    .setCustomId('giveaway_duration_input')
    .setLabel('Duration')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(50)
    .setPlaceholder('e.g., 10m, 2h, 1d')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prizeInput),
    new ActionRowBuilder().addComponents(winnersInput),
    new ActionRowBuilder().addComponents(durationInput)
  );

  try {
    await interaction.showModal(modal);
  } catch (err) {
    console.error('[giveaway] Error showing modal:', err);
    await interaction.reply({
      content: '❌ Failed to open giveaway setup modal.',
      ephemeral: true,
    });
  }
}

/**
 * Handle giveaway_setup_modal submit
 */
async function handleGiveawaySetupModal(interaction) {
  const { guild, user, channel } = interaction;

  if (!guild || !channel) {
    return interaction.reply({
      content: '❌ Cannot process giveaway setup.',
      ephemeral: true,
    });
  }

  // Get form inputs
  const prize = interaction.fields.getTextInputValue('giveaway_prize_input')?.trim();
  const winnersInput = interaction.fields.getTextInputValue('giveaway_winners_input')?.trim();
  const durationRaw = interaction.fields.getTextInputValue('giveaway_duration_input')?.trim();

  // Validation: prize
  if (!prize) {
    return interaction.reply({
      content: '❌ Prize cannot be empty.',
      ephemeral: true,
    });
  }

  // Validation: winners count
  const winnerCount = parseInt(winnersInput, 10);
  if (isNaN(winnerCount) || winnerCount < 1) {
    return interaction.reply({
      content: '❌ Number of winners must be a positive integer.',
      ephemeral: true,
    });
  }

  // Validation: duration
  const durationMs = parseDuration(durationRaw);
  if (durationMs === null) {
    return interaction.reply({
      content: '❌ Invalid duration. Use formats like 10m, 2h, 1d, etc.',
      ephemeral: true,
    });
  }

  const endAtMs = Date.now() + durationMs;

  // Save to draft cache
  updateDraft(guild.id, user.id, {
    prize,
    winnerCount,
    durationRaw,
    endAtMs,
    setupMessageId: interaction.message.id,
    channelId: channel.id,
  });

  // Build Constraints button
  const constraintsButton = new ButtonBuilder()
    .setCustomId('giveaway_constraints_open')
    .setLabel('Constraints')
    .setStyle(ButtonStyle.Primary);

  // Build summary embed
  const summaryEmbed = new EmbedBuilder()
    .setTitle('Giveaway Setup Preview')
    .setColor(0x2f3136)
    .addFields(
      { name: 'Prize', value: prize, inline: false },
      { name: 'Winners', value: winnerCount.toString(), inline: true },
      { name: 'Duration', value: durationRaw, inline: true }
    );

  try {
    await interaction.update({
      embeds: [summaryEmbed],
      components: [new ActionRowBuilder().addComponents(constraintsButton)],
    });

    await interaction.followUp({
      content: '✅ Setup saved! Now select eligible roles using the Constraints button.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[giveaway] Error updating setup message:', err);
    await interaction.reply({
      content: '❌ Failed to save giveaway setup.',
      ephemeral: true,
    });
  }
}

/**
 * Handle giveaway_constraints_open button → render paginated roles
 */
async function handleGiveawayConstraintsOpen(interaction) {
  const { guild, user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: '❌ Cannot access guild roles.',
      ephemeral: true,
    });
  }

  // Get draft
  const draft = getDraft(guild.id, user.id);
  if (!draft) {
    return interaction.reply({
      content: '❌ Setup data not found. Start over with `!giveaway setup`.',
      ephemeral: true,
    });
  }

  // Fetch all roles (exclude @everyone)
  try {
    await guild.roles.fetch();
  } catch (err) {
    console.error('[giveaway] Error fetching roles:', err);
  }

  const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
  const roleArray = Array.from(roles.values());

  // Paginate: 25 per page
  const PAGE_SIZE = 25;
  const pages = Math.ceil(roleArray.length / PAGE_SIZE);
  const currentPage = 0;

  renderConstraintsPage(interaction, roleArray, currentPage, pages, draft);
}

/**
 * Render a single page of role constraints
 */
async function renderConstraintsPage(interaction, roleArray, currentPage, totalPages, draft) {
  const PAGE_SIZE = 25;
  const startIdx = currentPage * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const pageRoles = roleArray.slice(startIdx, endIdx);

  // Build select options
  const options = pageRoles.map(role =>
    new StringSelectMenuOptionBuilder()
      .setLabel(role.name)
      .setValue(role.id)
      .setDescription(`ID: ${role.id}`)
      .setDefault(draft.allowRoleIds.includes(role.id))
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`giveaway_constraints_select:p:${currentPage}`)
    .setPlaceholder('Select eligible roles...')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);

  // Build navigation buttons
  const buttons = [];

  if (currentPage > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`giveaway_constraints_prev:${currentPage}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (currentPage < totalPages - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`giveaway_constraints_next:${currentPage}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Build Finish button (disabled until at least 1 role selected)
  const finishButton = new ButtonBuilder()
    .setCustomId('giveaway_finish')
    .setLabel('Finish')
    .setStyle(ButtonStyle.Success)
    .setDisabled(draft.allowRoleIds.length === 0);

  buttons.push(finishButton);

  // Build page info embed
  const infoEmbed = new EmbedBuilder()
    .setTitle('Select Eligible Roles')
    .setColor(0x2f3136)
    .setDescription(
      `Page ${currentPage + 1} of ${totalPages}\n\n` +
      (draft.allowRoleIds.length > 0
        ? `✓ Selected: ${draft.allowRoleIds.length} role(s)`
        : '⊘ No roles selected yet')
    );

  const rows = [new ActionRowBuilder().addComponents(selectMenu)];
  if (buttons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(buttons));
  }

  try {
    if (interaction.isButton() && interaction.message) {
      // Update existing message (for prev/next navigation)
      await interaction.update({
        embeds: [infoEmbed],
        components: rows,
      });
    } else if (interaction.isStringSelectMenu() && interaction.message) {
      // Update for select menu
      await interaction.update({
        embeds: [infoEmbed],
        components: rows,
      });
    } else {
      // Initial render (from button click)
      await interaction.update({
        embeds: [infoEmbed],
        components: rows,
      });
    }
  } catch (err) {
    console.error('[giveaway] Error rendering constraints page:', err);
    if (!interaction.replied) {
      await interaction.reply({
        content: '❌ Failed to render role selection.',
        ephemeral: true,
      });
    }
  }
}

/**
 * Handle giveaway_constraints_select:p:{page}
 */
async function handleGiveawayConstraintsSelect(interaction) {
  const { guild, user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: '❌ Cannot process role selection.',
      ephemeral: true,
    });
  }

  // Get draft
  let draft = getDraft(guild.id, user.id);
  if (!draft) {
    return interaction.reply({
      content: '❌ Setup data not found.',
      ephemeral: true,
    });
  }

  // Get selected role IDs
  const selectedRoleIds = interaction.values || [];

  // Clear previous selections for this page and accumulate
  // Parse current page from custom ID
  const pageMatch = interaction.customId.match(/:p:(\d+)$/);
  const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 0;

  // Fetch all roles to maintain page state
  try {
    await guild.roles.fetch();
  } catch (err) {
    console.error('[giveaway] Error fetching roles:', err);
  }

  const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
  const roleArray = Array.from(roles.values());
  const PAGE_SIZE = 25;
  const pages = Math.ceil(roleArray.length / PAGE_SIZE);

  // Update draft with accumulated selections
  // Remove old selections from this page
  const pageStartIdx = currentPage * PAGE_SIZE;
  const pageEndIdx = pageStartIdx + PAGE_SIZE;
  const pageRoles = roleArray.slice(pageStartIdx, pageEndIdx);
  const pageRoleIds = pageRoles.map(r => r.id);

  // Filter out old selections from this page
  draft.allowRoleIds = draft.allowRoleIds.filter(id => !pageRoleIds.includes(id));

  // Add new selections
  selectedRoleIds.forEach(roleId => {
    if (!draft.allowRoleIds.includes(roleId)) {
      draft.allowRoleIds.push(roleId);
    }
  });

  updateDraft(guild.id, user.id, draft);

  // Re-render current page with updated state
  renderConstraintsPage(interaction, roleArray, currentPage, pages, draft);
}

/**
 * Handle giveaway_constraints_prev:{page}
 */
async function handleGiveawayConstraintsPrev(interaction, pageStr) {
  const { guild, user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: '❌ Cannot navigate roles.',
      ephemeral: true,
    });
  }

  const currentPage = parseInt(pageStr, 10);
  const prevPage = Math.max(0, currentPage - 1);

  let draft = getDraft(guild.id, user.id);
  if (!draft) {
    return interaction.reply({
      content: '❌ Setup data not found.',
      ephemeral: true,
    });
  }

  // Fetch all roles
  try {
    await guild.roles.fetch();
  } catch (err) {
    console.error('[giveaway] Error fetching roles:', err);
  }

  const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
  const roleArray = Array.from(roles.values());
  const PAGE_SIZE = 25;
  const pages = Math.ceil(roleArray.length / PAGE_SIZE);

  renderConstraintsPage(interaction, roleArray, prevPage, pages, draft);
}

/**
 * Handle giveaway_constraints_next:{page}
 */
async function handleGiveawayConstraintsNext(interaction, pageStr) {
  const { guild, user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: '❌ Cannot navigate roles.',
      ephemeral: true,
    });
  }

  const currentPage = parseInt(pageStr, 10);
  const PAGE_SIZE = 25;

  let draft = getDraft(guild.id, user.id);
  if (!draft) {
    return interaction.reply({
      content: '❌ Setup data not found.',
      ephemeral: true,
    });
  }

  // Fetch all roles
  try {
    await guild.roles.fetch();
  } catch (err) {
    console.error('[giveaway] Error fetching roles:', err);
  }

  const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
  const roleArray = Array.from(roles.values());
  const PAGE_SIZE_VAL = 25;
  const pages = Math.ceil(roleArray.length / PAGE_SIZE_VAL);

  const nextPage = Math.min(pages - 1, currentPage + 1);

  renderConstraintsPage(interaction, roleArray, nextPage, pages, draft);
}

/**
 * Handle giveaway_finish button → create and post live giveaway message
 */
async function handleGiveawayFinish(interaction) {
  const { guild, user, channel } = interaction;

  if (!guild || !channel) {
    return interaction.reply({
      content: '❌ Cannot process giveaway finish.',
      ephemeral: true,
    });
  }

  // Get and clear draft
  const draft = getDraftAndClear(guild.id, user.id);
  if (!draft) {
    return interaction.reply({
      content: '❌ Setup data not found.',
      ephemeral: true,
    });
  }

  try {
    // Build role mentions
    const roleMentions = draft.allowRoleIds.length > 0
      ? draft.allowRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
      : 'No restrictions';

    // Convert endAtMs to Unix seconds for Discord timestamp
    const endUnixSeconds = Math.floor(draft.endAtMs / 1000);

    // Build giveaway embed
    const giveawayEmbed = new EmbedBuilder()
      .setTitle('🎉 Giveaway')
      .setColor(0xffd700)
      .addFields(
        { name: 'Prize', value: draft.prize, inline: false },
        { name: 'Winners', value: draft.winnerCount.toString(), inline: true },
        { name: 'Eligible Roles', value: roleMentions, inline: false },
        { name: 'Ends', value: `<t:${endUnixSeconds}:R>`, inline: false }
      )
      .setFooter({ text: 'React with 🎉 to enter!' });

    // Post giveaway message
    const giveawayMessage = await channel.send({ embeds: [giveawayEmbed] });

    // Self-react with 🎉
    await giveawayMessage.react('🎉');

    // Generate unique giveaway ID (timestamp + user ID)
    const giveawayId = `ga_${Date.now()}_${user.id}`;

    // Persist to storage
    const giveawayData = {
      prize: draft.prize,
      winnerCount: draft.winnerCount,
      durationRaw: draft.durationRaw,
      endAtMs: draft.endAtMs,
      allowRoleIds: draft.allowRoleIds,
      setupMessageId: draft.setupMessageId,
      channelId: draft.channelId,
      giveawayMessageId: giveawayMessage.id,
      status: 'active',
      createdAt: Date.now(),
      hostId: user.id,
    };

    upsertGiveaway(guild.id, giveawayId, giveawayData);

    // Reply to user first
    await interaction.reply({
      content: '✅ Giveaway started! Members can react with 🎉 to enter.',
      ephemeral: true,
    });

    // Delete the setup panel message (bot's message with Setup/Constraints/Finish buttons)
    const setupMessage = await channel.messages.fetch(draft.setupMessageId).catch(() => null);
    if (setupMessage) {
      await setupMessage.delete().catch(() => null);
    }

    // Delete the user's !giveaway setup command message
    if (draft.commandMessageId) {
      const commandMessage = await channel.messages.fetch(draft.commandMessageId).catch(() => null);
      if (commandMessage) {
        await commandMessage.delete().catch(() => null);
      }
    }
  } catch (err) {
    console.error('[giveaway] Error finishing giveaway:', err);
    await interaction.reply({
      content: `❌ Failed to start giveaway: ${err.message}`,
      ephemeral: true,
    });
  }
}

async function handleGiveawayInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('giveaway_constraints_select:p:')) {
      await handleGiveawayConstraintsSelect(interaction);
      return true;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'giveaway_setup_open') {
      await handleGiveawaySetupOpen(interaction);
      return true;
    }
    if (interaction.customId === 'giveaway_constraints_open') {
      await handleGiveawayConstraintsOpen(interaction);
      return true;
    }
    if (interaction.customId.startsWith('giveaway_constraints_prev:')) {
      const pageStr = interaction.customId.split(':')[1];
      await handleGiveawayConstraintsPrev(interaction, pageStr);
      return true;
    }
    if (interaction.customId.startsWith('giveaway_constraints_next:')) {
      const pageStr = interaction.customId.split(':')[1];
      await handleGiveawayConstraintsNext(interaction, pageStr);
      return true;
    }
    if (interaction.customId === 'giveaway_finish') {
      await handleGiveawayFinish(interaction);
      return true;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'giveaway_setup_modal') {
    await handleGiveawaySetupModal(interaction);
    return true;
  }

  return false;
}

module.exports = {
  handleGiveawayInteraction,
  handleGiveawaySetupOpen,
  handleGiveawaySetupModal,
  handleGiveawayConstraintsOpen,
  handleGiveawayConstraintsSelect,
  handleGiveawayConstraintsPrev,
  handleGiveawayConstraintsNext,
  handleGiveawayFinish,
};
