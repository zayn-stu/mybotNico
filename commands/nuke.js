const { PermissionFlagsBits } = require('discord.js');

function getOwnerIds() {
  const rawOwnerIds = process.env.BOT_OWNER_IDS || '';
  return rawOwnerIds
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

module.exports = {
  name: 'nuke',
  description: 'Owner-only — kick every kickable member from the server',
  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server channel.');
    }

    const ownerIds = getOwnerIds();
    if (!ownerIds.includes(message.author.id)) {
      return message.reply('❌ You are not authorized to use this command.');
    }

    const botMember = message.guild.members.me
      || await message.guild.members.fetchMe().catch(() => null);

    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply('❌ I need the Kick Members permission to nuke the server.');
    }

    // Fetch all members (ensure cache is full)
    const statusMsg = await message.channel.send('☢️ **NUKE INITIATED** — Fetching all members...');
    let allMembers;
    try {
      allMembers = await message.guild.members.fetch();
    } catch (err) {
      console.error('[nuke] Failed to fetch members:', err);
      return statusMsg.edit('❌ Failed to fetch member list. Check my permissions.');
    }

    const botId = message.client.user.id;

    // Filter out: this bot, bot owners, and all other bots
    const targets = allMembers.filter(member => {
      if (member.id === botId) return false;                // this bot
      if (ownerIds.includes(member.id)) return false;       // bot owners
      if (member.user.bot) return false;                    // other bots
      return true;
    });

    if (targets.size === 0) {
      return statusMsg.edit('☢️ No members to nuke. Everyone is either a bot, an owner, or already gone.');
    }

    await statusMsg.edit(`☢️ **NUKE IN PROGRESS** — Kicking **${targets.size}** member${targets.size === 1 ? '' : 's'}...`);

    let kicked = 0;
    let failed = 0;
    const delayMs = 300; // small delay between kicks to avoid rate limits

    for (const [memberId, member] of targets) {
      try {
        await member.kick('Server nuke by bot owner');
        kicked++;
        // Log progress every 10 kicks
        if (kicked % 10 === 0) {
          await statusMsg.edit(`☢️ **NUKE IN PROGRESS** — Kicked ${kicked}/${targets.size}...`).catch(() => {});
        }
      } catch (err) {
        failed++;
        console.error(`[nuke] Failed to kick ${member.user.tag} (${memberId}):`, err.message);
      }
      // Rate-limit safety
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Final summary
    const summary = [
      '☢️ **NUKE COMPLETE**',
      '',
      `✅ **Kicked:** ${kicked} member${kicked === 1 ? '' : 's'}`,
      failed > 0 ? `❌ **Failed:** ${failed} member${failed === 1 ? '' : 's'}` : '',
      `📊 **Total targets:** ${targets.size}`,
    ].filter(Boolean).join('\n');

    await statusMsg.edit(summary).catch(() => {});
    console.log(`[nuke] Completed in ${message.guild.name}: ${kicked} kicked, ${failed} failed`);
  }
};