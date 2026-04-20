const { addPanda, getPandaCount, getLeaderboard, getStaffHidden, setStaffHidden } = require('../utils/pandaStorage');
const { getVictoriesMap } = require('../utils/victoryStorage');
const { startTimer, endTimer } = require('../utils/perfMetrics');
const { getDisplayName } = require('../utils/memberDisplayNames');

const PANDA_EMOJI_NAME = 'SN_RooHappi';
const SOCIALS_GUILD_ID = process.env.SOCIALS_GUILD_ID || '';

// Cooldown for !panda list: userId -> timestamp
const listCooldowns = new Map();
const LIST_COOLDOWN_MS = 15_000; // 15 seconds

// Guild IDs where !panda staff hide/show is available
const PERISHED_GUILD_ID = process.env.PERISHED_GUILD_ID || '';
const PERISHED_STAFF_ROLE_ID = process.env.PERISHED_STAFF_ROLE_ID || '';

function getPandaEmoji(guild) {
  const emoji = guild.emojis.cache.find(e => e.name === PANDA_EMOJI_NAME);
  return emoji ? emoji.toString() : '🐼';
}

/**
 * Returns true if the member has the staff role for this guild.
 */
function isStaff(member) {
  if (!PERISHED_STAFF_ROLE_ID) return false;
  return member.roles.cache.has(PERISHED_STAFF_ROLE_ID);
}

/**
 * Returns true if the member is an admin/owner (can toggle staff visibility).
 */
function isAdmin(member) {
  return member.permissions.has('Administrator') || member.guild.ownerId === member.user.id;
}

const subcommands = {
  async me(message) {
    const count = getPandaCount(message.guild.id, message.author.id);
    const plural = count === 1 ? 'Panda' : 'Pandas';
    const pandaEmoji = getPandaEmoji(message.guild);
    message.reply(`${pandaEmoji} <@${message.author.id}> has ${count} ${plural}`);
  },

  async list(message) {
    const listStartTime = startTimer();
    
    // Cooldown check
    const now = Date.now();
    const lastUsed = listCooldowns.get(message.author.id) || 0;
    const remaining = LIST_COOLDOWN_MS - (now - lastUsed);
    if (remaining > 0) {
      return message.reply(`⏳ Please wait ${(remaining / 1000).toFixed(1)}s before using this again.`);
    }
    listCooldowns.set(message.author.id, now);

    const staffHidden = getStaffHidden(message.guild.id);

    // Fetch more entries than needed to account for staff filtering
    const t1 = Date.now();
    const leaderboard = getLeaderboard(message.guild.id, 25);
    const t2 = Date.now();
    
    const pandaEmoji = getPandaEmoji(message.guild);
    const t3 = Date.now();
    const victoryEmojiObj = message.guild.emojis.cache.find(e => e.name === 'SN_VictoryPanda');
    const victoryEmojiStr = victoryEmojiObj ? victoryEmojiObj.toString() : '🏆';
    const victoriesMap = getVictoriesMap(message.guild.id);
    const t4 = Date.now();

    if (leaderboard.length === 0) {
      return message.reply('No pandas have been collected yet!');
    }

    let response = `${pandaEmoji} **Leaderboard** ${pandaEmoji}\n\n`;
    let rank = 0;

    const t5 = Date.now();
    for (const entry of leaderboard) {
      if (rank >= 10) break;

      // Get cached member (in-memory, no API calls)
      const member = message.guild.members.cache.get(entry.userId);
      const memberIsStaff = member ? isStaff(member) : false;

      // Skip staff if hidden
      if (staffHidden && memberIsStaff) continue;

      rank++;
      const displayName = getDisplayName(message.guild.id, entry.userId, member, entry.username, entry.displayName);
      const rankDisplay = memberIsStaff ? `**${rank}**` : `${rank}`;
      const victories = victoriesMap[entry.userId] || 0;
      const victoryBadge = victories > 0 ? ` ${victoryEmojiStr.repeat(victories)}` : '';
      response += `${rankDisplay}. ${displayName} - ${entry.count}${victoryBadge}\n`;
    }
    const t6 = Date.now();

    if (rank === 0) {
      response += '_No entries to display._';
    }

    if (staffHidden) {
      response += `\n_Staff members are currently hidden from the leaderboard._`;
    }

    const listDuration = endTimer(listStartTime);
    response += `\n_⏱️ Response time: ${listDuration}ms | getLeaderboard: ${t2-t1}ms | victoryMap: ${t4-t3}ms | fetchMembers: ${t6-t5}ms_`;

    message.reply(response);
  },

  async staff(message, args) {
    // Only available for Perished guild
    if (message.guild.id !== PERISHED_GUILD_ID) {
      return message.reply('❌ This command is not available in this server.');
    }

    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can toggle staff visibility on the leaderboard.');
    }

    const action = args[0]?.toLowerCase();

    if (action === 'hide') {
      setStaffHidden(message.guild.id, true);
      return message.reply('✅ Staff members are now **hidden** from the leaderboard.');
    }

    if (action === 'show') {
      setStaffHidden(message.guild.id, false);
      return message.reply('✅ Staff members are now **visible** on the leaderboard.');
    }

    const current = getStaffHidden(message.guild.id);
    return message.reply(
      `Usage: \`!panda staff hide\` or \`!panda staff show\`\n` +
      `Current status: staff are **${current ? 'hidden' : 'visible'}**.`
    );
  },

  async help(message) {
    const isPerished = message.guild.id === PERISHED_GUILD_ID;
    let helpText =
      '**Panda Commands:**\n' +
      '`!panda` or `!panda me` - Check your panda count\n' +
      '`!panda list` - View the top 10 leaderboard\n';

    if (isPerished) {
      helpText +=
        '`!panda staff hide` - Hide staff from leaderboard (admin only)\n' +
        '`!panda staff show` - Show staff on leaderboard (admin only)\n';
    }

    message.reply(helpText);
  }
};

module.exports = {
  name: 'panda',
  description: 'View panda collection stats',
  async execute(message, args) {
    const subcommand = args[0]?.toLowerCase() || 'me';

    if (!subcommands[subcommand]) {
      return message.reply(`Unknown subcommand. Use \`!panda help\` for commands.`);
    }

    await subcommands[subcommand](message, args.slice(1));
  }
};

