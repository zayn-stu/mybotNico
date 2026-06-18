const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { INVITE_SOURCES } = require('../../utils/inviteTracker');
const {
  INVITE_SOURCE_LABELS,
  MEMBER_ROLE_ID,
  MODAL_ID,
  MODAL_QUESTIONS_BY_SOURCE,
  REVIEW_ACCEPT_BUTTON_PREFIX,
  REVIEW_DENY_BUTTON_PREFIX,
  STAFF_REVIEW_CHANNEL_ID,
  VERIFY_BUTTON_ID,
} = require('./constants');
const {
  getPendingVerification,
  getSubmission,
  removePendingVerification,
  upsertPendingVerification,
  upsertSubmission,
} = require('./storage');

function getSocialsGuildId() {
  return process.env.SOCIALS_GUILD_ID || '';
}

async function handleVerificationInteraction(interaction) {
  if (interaction.isButton?.() && interaction.customId === VERIFY_BUTTON_ID) {
    await handleVerifyButton(interaction);
    return true;
  }

  if (interaction.isModalSubmit?.() && interaction.customId.startsWith(`${MODAL_ID}:`)) {
    await handleVerificationModal(interaction);
    return true;
  }

  if (interaction.isButton?.() && isReviewButton(interaction.customId)) {
    await handleReviewButton(interaction);
    return true;
  }

  return false;
}

async function handleVerifyButton(interaction) {
  if (!isSocialsGuildInteraction(interaction)) {
    return interaction.reply({
      content: '❌ Verification is only available in Socials.',
      ephemeral: true,
    });
  }

  await waitForInviteDetection(interaction.guild.id, interaction.user.id);

  const statusReply = getBlockingStatusReply(interaction);
  if (statusReply) {
    return interaction.reply({ content: statusReply, ephemeral: true });
  }

  const pending = getOrCreatePendingVerification(interaction);
  const modal = buildVerificationModal(interaction.user.id, pending.source);
  return interaction.showModal(modal);
}

async function handleVerificationModal(interaction) {
  if (!isSocialsGuildInteraction(interaction)) {
    return interaction.reply({
      content: '❌ Verification is only available in Socials.',
      ephemeral: true,
    });
  }

  const modalUserId = interaction.customId.split(':')[2];
  if (modalUserId && modalUserId !== interaction.user.id) {
    return interaction.reply({
      content: '❌ This verification form is not yours.',
      ephemeral: true,
    });
  }

  await waitForInviteDetection(interaction.guild.id, interaction.user.id);

  const statusReply = getBlockingStatusReply(interaction);
  if (statusReply) {
    return interaction.reply({ content: statusReply, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const pending = getOrCreatePendingVerification(interaction);
  const questions = getQuestionsForSource(pending.source);
  const answers = questions.map(question => ({
    id: question.id,
    question: question.label,
    answer: interaction.fields.getTextInputValue(question.id)?.trim() || 'No answer',
  }));

  let reviewMessage;
  try {
    reviewMessage = await sendStaffReview(interaction, pending, answers);
  } catch (err) {
    console.error('[verification] Failed to send staff review:', err);
    return interaction.editReply('❌ Failed to submit verification for staff review. Please try again later.');
  }
  const submittedAt = Date.now();
  const reviewData = {
    status: 'review_pending',
    submittedAt,
    reviewChannelId: STAFF_REVIEW_CHANNEL_ID,
    reviewMessageId: reviewMessage.id,
    answers,
  };

  upsertPendingVerification(interaction.guild.id, interaction.user.id, reviewData);
  upsertSubmission(interaction.guild.id, interaction.user.id, {
    ...pending,
    ...reviewData,
  });

  return interaction.editReply('✅ Your verification has been submitted for staff review.');
}

async function handleReviewButton(interaction) {
  if (!isSocialsGuildInteraction(interaction)) {
    return interaction.reply({
      content: '❌ This review action is only available in Socials.',
      ephemeral: true,
    });
  }

  if (!canReviewVerifications(interaction.member)) {
    return interaction.reply({
      content: '❌ You need Ban Members or Moderate Members permission to review verifications.',
      ephemeral: true,
    });
  }

  const { action, userId } = parseReviewButton(interaction.customId);
  if (!action || !userId) {
    return interaction.reply({
      content: '❌ Invalid verification review action.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const submission = getSubmission(interaction.guild.id, userId);
  if (!submission || submission.status !== 'review_pending') {
    const status = submission?.status ? ` Current status: ${submission.status}.` : '';
    return interaction.editReply(`⚠️ This verification is not pending review.${status}`);
  }

  if (action === 'accept') {
    return acceptVerification(interaction, userId, submission);
  }

  return denyVerification(interaction, userId, submission);
}

function buildVerificationModal(userId, source) {
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_ID}:${userId}`)
    .setTitle('Socials Verification');

  const rows = getQuestionsForSource(source).map(question => {
    const input = new TextInputBuilder()
      .setCustomId(question.id)
      .setLabel(question.label)
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(1)
      .setMaxLength(500)
      .setRequired(true);

    return new ActionRowBuilder().addComponents(input);
  });

  modal.addComponents(...rows);
  return modal;
}

function getQuestionsForSource(source) {
  return MODAL_QUESTIONS_BY_SOURCE[source] || MODAL_QUESTIONS_BY_SOURCE[INVITE_SOURCES.UNKNOWN];
}

function getOrCreatePendingVerification(interaction) {
  const existing = getPendingVerification(interaction.guild.id, interaction.user.id);
  if (existing) return existing;

  const member = interaction.member;
  return upsertPendingVerification(interaction.guild.id, interaction.user.id, {
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    joinedAt: member?.joinedTimestamp || Date.now(),
    accountCreatedAt: interaction.user.createdTimestamp || null,
    source: INVITE_SOURCES.UNKNOWN,
    inviteCode: null,
    inviterId: null,
    confidence: 'low',
    detectionReason: 'button_without_join_record',
    status: 'pending',
    createdAt: Date.now(),
  });
}

async function waitForInviteDetection(guildId, userId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const pending = getPendingVerification(guildId, userId);
    if (pending?.detectionReason !== 'pending_invite_detection') return pending;
    await sleep(250);
  }

  const pending = getPendingVerification(guildId, userId);
  if (pending?.detectionReason === 'pending_invite_detection') {
    return upsertPendingVerification(guildId, userId, {
      source: INVITE_SOURCES.UNKNOWN,
      inviteCode: null,
      inviterId: null,
      confidence: 'low',
      detectionReason: 'invite_detection_timeout',
      status: pending.status || 'pending',
    });
  }
  return pending;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBlockingStatusReply(interaction) {
  const pending = getPendingVerification(interaction.guild.id, interaction.user.id);
  const submission = getSubmission(interaction.guild.id, interaction.user.id);

  if (pending?.status === 'pending') {
    return null;
  }

  const status = pending?.status || submission?.status;

  if (status === 'review_pending') {
    return '⏳ You already have a verification submission under review.';
  }

  if (status === 'accepted') {
    if (!memberHasVerifiedRole(interaction.member)) return null;
    return '✅ Your verification has already been accepted.';
  }

  if (status === 'denied') {
    return '❌ Your verification has already been denied.';
  }

  return null;
}

function memberHasVerifiedRole(member) {
  const roles = member?.roles;
  if (!roles) return false;
  if (roles.cache?.has) return roles.cache.has(MEMBER_ROLE_ID);
  if (Array.isArray(roles)) return roles.includes(MEMBER_ROLE_ID);
  return false;
}

async function sendStaffReview(interaction, pending, answers) {
  const channel = await interaction.client.channels.fetch(STAFF_REVIEW_CHANNEL_ID);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    throw new Error(`Staff review channel ${STAFF_REVIEW_CHANNEL_ID} is not sendable`);
  }

  const embed = buildReviewEmbed(interaction.user, pending, answers);
  return channel.send({
    embeds: [embed],
    components: buildReviewButtons(interaction.user.id),
  });
}

function buildReviewEmbed(user, pending, answers) {
  const source = pending.source || INVITE_SOURCES.UNKNOWN;

  return new EmbedBuilder()
    .setTitle('Verification Review')
    .setColor(0xf1c40f)
    .addFields(
      { name: 'Member', value: `<@${user.id}>\n${user.id}`, inline: false },
      { name: 'Account Created', value: formatTimestampWithAge(pending.accountCreatedAt), inline: true },
      { name: 'Joined', value: formatTimestamp(pending.joinedAt), inline: true },
      { name: 'Invite Source', value: INVITE_SOURCE_LABELS[source] || INVITE_SOURCE_LABELS[INVITE_SOURCES.UNKNOWN], inline: false },
      { name: 'Answers', value: formatAnswers(answers), inline: false }
    )
    .setTimestamp(new Date());
}

function buildReviewButtons(userId, disabled = false) {
  const accept = new ButtonBuilder()
    .setCustomId(`${REVIEW_ACCEPT_BUTTON_PREFIX}${userId}`)
    .setLabel('Accept')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  const deny = new ButtonBuilder()
    .setCustomId(`${REVIEW_DENY_BUTTON_PREFIX}${userId}`)
    .setLabel('Deny')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return [new ActionRowBuilder().addComponents(accept, deny)];
}

async function acceptVerification(interaction, userId, submission) {
  const member = await fetchGuildMember(interaction.guild, userId);
  if (!member) {
    return interaction.editReply('⚠️ That member is no longer in the server. No action was taken.');
  }

  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.editReply('❌ Nico needs Manage Roles permission to accept verifications.');
  }

  const role = interaction.guild.roles.cache.get(MEMBER_ROLE_ID);
  if (!role) {
    return interaction.editReply(`❌ Member role ${MEMBER_ROLE_ID} was not found.`);
  }

  try {
    await member.roles.add(role, `Verification accepted by ${interaction.user.tag}`);
  } catch (err) {
    console.error('[verification] Failed to add member role:', err);
    return interaction.editReply('❌ Failed to add the member role. Check Nico\'s role hierarchy and Manage Roles permission.');
  }

  markProcessed(interaction.guild.id, userId, submission, {
    status: 'accepted',
    processedBy: interaction.user.id,
    processedAt: Date.now(),
  });
  await disableReviewButtons(interaction);
  return interaction.editReply(`✅ Accepted <@${userId}> and added the member role.`);
}

async function denyVerification(interaction, userId, submission) {
  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.editReply('❌ Nico needs Ban Members permission to deny verifications.');
  }

  try {
    await interaction.guild.members.ban(userId, {
      reason: `Verification denied by ${interaction.user.tag}`,
    });
  } catch (err) {
    console.error('[verification] Failed to ban denied member:', err);
    return interaction.editReply('❌ Failed to ban that user. Check Nico\'s Ban Members permission and role hierarchy.');
  }

  markProcessed(interaction.guild.id, userId, submission, {
    status: 'denied',
    processedBy: interaction.user.id,
    processedAt: Date.now(),
  });
  await disableReviewButtons(interaction);
  return interaction.editReply(`✅ Denied and banned <@${userId}>.`);
}

function markProcessed(guildId, userId, submission, updates) {
  removePendingVerification(guildId, userId);
  upsertSubmission(guildId, userId, {
    ...submission,
    ...updates,
  });
}

async function fetchGuildMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

async function disableReviewButtons(interaction) {
  try {
    await interaction.message.edit({
      components: buildReviewButtons(parseReviewButton(interaction.customId).userId, true),
    });
  } catch (err) {
    console.error('[verification] Failed to disable review buttons:', err.message);
  }
}

function isSocialsGuildInteraction(interaction) {
  const socialsGuildId = getSocialsGuildId();
  return Boolean(socialsGuildId && interaction.guild?.id === socialsGuildId);
}

function canReviewVerifications(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.BanMembers) ||
    member?.permissions?.has(PermissionFlagsBits.ModerateMembers)
  );
}

function isReviewButton(customId) {
  return customId.startsWith(REVIEW_ACCEPT_BUTTON_PREFIX) || customId.startsWith(REVIEW_DENY_BUTTON_PREFIX);
}

function parseReviewButton(customId) {
  if (customId.startsWith(REVIEW_ACCEPT_BUTTON_PREFIX)) {
    return { action: 'accept', userId: customId.slice(REVIEW_ACCEPT_BUTTON_PREFIX.length) };
  }

  if (customId.startsWith(REVIEW_DENY_BUTTON_PREFIX)) {
    return { action: 'deny', userId: customId.slice(REVIEW_DENY_BUTTON_PREFIX.length) };
  }

  return { action: null, userId: null };
}

function formatTimestamp(timestampMs) {
  if (!timestampMs) return 'Unknown';
  const seconds = Math.floor(timestampMs / 1000);
  return `<t:${seconds}:F>\n<t:${seconds}:R>`;
}

function formatTimestampWithAge(timestampMs) {
  if (!timestampMs) return 'Unknown';
  return `${formatTimestamp(timestampMs)}\nAge: ${formatDuration(Date.now() - timestampMs)}`;
}

function formatDuration(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.max(0, Math.floor(ms / (60 * 1000)));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function formatAnswers(answers) {
  const value = answers
    .map(answer => `**${answer.question}**\n${answer.answer}`)
    .join('\n\n');

  if (value.length <= 1024) return value || 'No answers';
  return `${value.slice(0, 1021)}...`;
}

module.exports = {
  handleVerificationInteraction,
  buildVerificationModal,
  buildReviewEmbed,
  buildReviewButtons,
  canReviewVerifications,
  getQuestionsForSource,
  parseReviewButton,
};
