const { PermissionFlagsBits } = require('discord.js');
const { parseColor, COLOR_NAMES } = require('../utils/colors');
const {
  getUserRoles,
  addRole,
  removeRole,
  updateRole,
  findRoleByName,
  syncColorRoles,
  cleanupOrphanedRoles,
} = require('../utils/roleStorage');

const COLOR_SEPARATOR_ROLE_ID = process.env.COLOR_SEPARATOR_ROLE_ID || '';
const BOTS_SEPARATOR_ROLE_ID = process.env.BOTS_SEPARATOR_ROLE_ID || '';

// ─── Permission helpers ───────────────────────────────────────────────────────

function botCanManageRoles(guild) {
  return guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles);
}

function userCanManageRoles(member) {
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

function canModifyMember(executor, target) {
  return executor.roles.highest.position > target.roles.highest.position;
}

// ─── Argument helpers ─────────────────────────────────────────────────────────

function isColorArg(str) {
  const lower = str.toLowerCase();
  return !!(COLOR_NAMES[lower] || /^#?[0-9A-Fa-f]{6}$/.test(str));
}

function isMention(str) {
  return /^<@!?\d+>$/.test(str);
}

function parseMention(str) {
  const match = str.match(/^<@!?(\d+)>$/);
  return match ? match[1] : null;
}

async function getTargetMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

// ─── Role positioning ─────────────────────────────────────────────────────────

/**
 * Positions a newly created role just below the color separator role.
 */
async function positionRole(role, guild) {
  const separatorRole = guild.roles.cache.get(COLOR_SEPARATOR_ROLE_ID);
  if (separatorRole) {
    try {
      await role.setPosition(separatorRole.position - 1);
    } catch (err) {
      console.warn('[role] Could not set role position:', err.message);
    }
  }
}

// ─── Role creation options ────────────────────────────────────────────────────

/**
 * Builds the role options object for guild.roles.create() or role.edit().
 * Supports both standard (single color) and gradient (two colors) roles.
 *
 * Discord.js 14.x supports gradient roles via the `colors` property:
 *   { primaryColor: '#RRGGBB', secondaryColor: '#RRGGBB' }
 * For standard roles, we use the plain `color` property.
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

// ─── Subcommands ──────────────────────────────────────────────────────────────

const subcommands = {

  // !role set [name] [color] OR !role set [name] [color1] [color2]
  // !role set @user [name] [color] ... (admin)
  async set(message, args) {
    if (!botCanManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    if (args.length > 0 && isMention(args[0])) {
      return subcommands.setForUser(message, args);
    }

    // Self mode
    const userRoles = getUserRoles(message.guild.id, message.author.id);
    if (userRoles.length > 0) {
      return message.reply('❌ You already have a custom role. Delete it first with `!role delete`.');
    }

    if (args.length < 2) {
      return message.reply('Usage: `!role set "name" color` or `!role set "name" color1 color2` for gradient.');
    }

    const { name, primaryColor, secondaryColor, error } = parseNameAndColors(args);
    if (error) return message.reply(error);

    try {
      const roleOptions = {
        name,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Custom color role for ${message.author.tag}`,
        ...buildColorOptions(primaryColor, secondaryColor),
      };

      const role = await message.guild.roles.create(roleOptions);
      await positionRole(role, message.guild);
      await message.member.roles.add(role);
      addRole(message.guild.id, role.id, message.author.id, name, primaryColor, secondaryColor);

      return message.reply(secondaryColor
        ? `✅ Created gradient role **${name}** with colors \`${primaryColor}\` → \`${secondaryColor}\``
        : `✅ Created role **${name}** with color \`${primaryColor}\``
      );
    } catch (err) {
      console.error('[role set] Error:', err);
      return message.reply(`❌ Failed to create role: ${err.message}`);
    }
  },

  // Admin: !role set @user [name] [color] ...
  async setForUser(message, args) {
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to assign roles to others.');
    }

    const targetUserId = parseMention(args.shift());
    const targetMember = await getTargetMember(message.guild, targetUserId);
    if (!targetMember) return message.reply('❌ User not found.');

    if (!canModifyMember(message.member, targetMember)) {
      return message.reply('❌ You cannot modify roles for someone with equal or higher rank than you.');
    }

    // !role set @user none  →  unassign
    if (args.length === 1 && args[0].toLowerCase() === 'none') {
      const targetUserRoles = getUserRoles(message.guild.id, targetUserId);
      if (targetUserRoles.length === 0) {
        return message.reply(`❌ ${targetMember.user.tag} doesn't have a custom role.`);
      }
      const roleData = targetUserRoles[targetUserRoles.length - 1];
      const role = message.guild.roles.cache.get(roleData.roleId);
      try {
        if (role) await targetMember.roles.remove(role);
        updateRole(message.guild.id, roleData.roleId, { creatorId: null });
        return message.reply(`✅ Unassigned role **${roleData.name}** from ${targetMember.user.tag}. Role is now unowned.`);
      } catch {
        return message.reply('❌ Failed to unassign role.');
      }
    }

    const targetUserRoles = getUserRoles(message.guild.id, targetUserId);
    if (targetUserRoles.length > 0) {
      return message.reply(`❌ ${targetMember.user.tag} already has a custom role.`);
    }

    if (args.length < 1) {
      return message.reply('Usage: `!role set @user {name} {color}` or `!role set @user none`');
    }

    const { name, primaryColor, secondaryColor } = parseNameAndColors(args, true);

    // Check if role with this name already exists (unowned)
    const existingRole = findRoleByName(message.guild.id, name);
    if (existingRole) {
      const [roleId, roleData] = existingRole;
      if (roleData.creatorId) {
        return message.reply(`❌ Role "${name}" already belongs to another user.`);
      }
      const role = message.guild.roles.cache.get(roleId);
      if (!role) return message.reply('❌ Role exists in storage but not in server.');

      try {
        if (primaryColor) {
          await role.edit({ name, ...buildColorOptions(primaryColor, secondaryColor) });
          updateRole(message.guild.id, roleId, { color: primaryColor, color2: secondaryColor || null, creatorId: targetUserId });
        } else {
          updateRole(message.guild.id, roleId, { creatorId: targetUserId });
        }
        await targetMember.roles.add(role);
        return message.reply(`✅ Assigned role **${name}** to ${targetMember.user.tag}`);
      } catch (err) {
        console.error('[role setForUser] Error:', err);
        return message.reply(`❌ Failed to assign role: ${err.message}`);
      }
    }

    // Create new role
    if (!primaryColor) {
      return message.reply('❌ Role doesn\'t exist. Provide a color to create it: `!role set @user {name} {color}`');
    }

    try {
      const roleOptions = {
        name,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Custom color role for ${targetMember.user.tag} (by ${message.author.tag})`,
        ...buildColorOptions(primaryColor, secondaryColor),
      };

      const role = await message.guild.roles.create(roleOptions);
      await positionRole(role, message.guild);
      await targetMember.roles.add(role);
      addRole(message.guild.id, role.id, targetUserId, name, primaryColor, secondaryColor);

      return message.reply(secondaryColor
        ? `✅ Created gradient role **${name}** for ${targetMember.user.tag} with colors \`${primaryColor}\` → \`${secondaryColor}\``
        : `✅ Created role **${name}** for ${targetMember.user.tag} with color \`${primaryColor}\``
      );
    } catch (err) {
      console.error('[role setForUser] Error:', err);
      return message.reply(`❌ Failed to create role: ${err.message}`);
    }
  },

  // Admin: !role create [name] [color] [color2?]  — creates an unowned role
  async create(message, args) {
    if (!botCanManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to use this command.');
    }
    if (args.length < 2) {
      return message.reply('Usage: `!role create {name} {color}` or `!role create {name} {color1} {color2}`');
    }

    const { name, primaryColor, secondaryColor, error } = parseNameAndColors(args);
    if (error) return message.reply(error);

    const existingRole = findRoleByName(message.guild.id, name);
    if (existingRole) return message.reply(`❌ Role "${name}" already exists.`);

    try {
      const roleOptions = {
        name,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Unowned color role created by ${message.author.tag}`,
        ...buildColorOptions(primaryColor, secondaryColor),
      };

      const role = await message.guild.roles.create(roleOptions);
      await positionRole(role, message.guild);
      addRole(message.guild.id, role.id, null, name, primaryColor, secondaryColor);

      return message.reply(secondaryColor
        ? `✅ Created unowned gradient role **${name}** with colors \`${primaryColor}\` → \`${secondaryColor}\``
        : `✅ Created unowned role **${name}** with color \`${primaryColor}\``
      );
    } catch (err) {
      console.error('[role create] Error:', err);
      return message.reply(`❌ Failed to create role: ${err.message}`);
    }
  },

  // !role delete [name?]
  async delete(message, args) {
    if (!botCanManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    let roleData;

    if (args.length > 0) {
      // Admin mode: delete by name
      if (!userCanManageRoles(message.member)) {
        // Non-admins can only delete their own role (no args)
        return message.reply('❌ You need the Manage Roles permission to delete other users\' roles.');
      }

      const targetRoleName = args.join(' ');
      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) return message.reply(`❌ Role "${targetRoleName}" not found.`);

      const [roleId, data] = found;
      roleData = { roleId, ...data };

      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot delete roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else {
      // Self mode: delete own role
      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) {
        return message.reply('❌ You have no custom roles to delete.');
      }
      roleData = userRoles[userRoles.length - 1];
    }

    const role = message.guild.roles.cache.get(roleData.roleId);

    try {
      if (role) await role.delete(`Deleted by ${message.author.tag}`);
      removeRole(message.guild.id, roleData.roleId);
      return message.reply(`✅ Deleted role **${roleData.name}**`);
    } catch (err) {
      console.error('[role delete] Error:', err);
      return message.reply(`❌ Failed to delete role: ${err.message}`);
    }
  },

  // !role edit name [new name] OR !role edit name [RoleName] to [NewName]
  // !role edit color [color] OR !role edit color [color1] [color2]
  async edit(message, args) {
    if (!botCanManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    const editType = args.shift()?.toLowerCase();
    if (!editType || !['name', 'color'].includes(editType)) {
      return message.reply('Usage: `!role edit name "new name"` or `!role edit color newcolor` or `!role edit color color1 color2`');
    }

    if (editType === 'name') return subcommands.editName(message, args);
    return subcommands.editColor(message, args);
  },

  async editName(message, args) {
    const fullText = args.join(' ');
    const toIndex = fullText.toLowerCase().indexOf(' to ');

    let roleData, newName;

    if (toIndex !== -1) {
      // Admin mode: "RoleName to NewName"
      const targetRoleName = fullText.slice(0, toIndex).trim();
      newName = fullText.slice(toIndex + 4).trim();

      if (!targetRoleName || !newName) {
        return message.reply('Usage: `!role edit name RoleName to NewName`');
      }

      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) return message.reply(`❌ Role "${targetRoleName}" not found.`);

      const [roleId, data] = found;
      roleData = { roleId, ...data };

      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to edit other users\' roles.');
        }
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot edit roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else {
      // Self mode
      newName = fullText.trim();
      if (!newName) {
        return message.reply('Usage: `!role edit name "new name"` or `!role edit name RoleName to NewName`');
      }
      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) {
        return message.reply('❌ You have no custom roles to edit.');
      }
      roleData = userRoles[userRoles.length - 1];
    }

    const role = message.guild.roles.cache.get(roleData.roleId);
    if (!role) return message.reply('❌ Role not found in server.');

    try {
      await role.setName(newName);
      updateRole(message.guild.id, roleData.roleId, { name: newName });
      return message.reply(`✅ Role renamed to **${newName}**`);
    } catch (err) {
      console.error('[role editName] Error:', err);
      return message.reply(`❌ Failed to rename role: ${err.message}`);
    }
  },

  async editColor(message, args) {
    if (args.length === 0) {
      return message.reply('Usage: `!role edit color newcolor` or `!role edit color color1 color2` for gradient');
    }

    let roleData, colorArgs;

    const lastArg = args[args.length - 1];
    const secondLastArg = args.length >= 2 ? args[args.length - 2] : null;
    const lastIsColor = isColorArg(lastArg);
    const secondLastIsColor = secondLastArg ? isColorArg(secondLastArg) : false;

    if (lastIsColor && secondLastIsColor && args.length === 2) {
      // Self mode: two colors
      colorArgs = args;
      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) return message.reply('❌ You have no custom roles to edit.');
      roleData = userRoles[userRoles.length - 1];
    } else if (lastIsColor && !secondLastIsColor && args.length === 1) {
      // Self mode: one color
      colorArgs = args;
      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) return message.reply('❌ You have no custom roles to edit.');
      roleData = userRoles[userRoles.length - 1];
    } else if (lastIsColor && secondLastIsColor) {
      // Admin mode: role name + two colors
      colorArgs = [args[args.length - 2], args[args.length - 1]];
      const targetRoleName = args.slice(0, -2).join(' ');
      if (!targetRoleName) return message.reply('Usage: `!role edit color RoleName color1 color2`');

      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) return message.reply(`❌ Role "${targetRoleName}" not found.`);
      const [roleId, data] = found;
      roleData = { roleId, ...data };

      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to edit other users\' roles.');
        }
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot edit roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else if (lastIsColor) {
      // Admin mode: role name + one color
      colorArgs = [args[args.length - 1]];
      const targetRoleName = args.slice(0, -1).join(' ');
      if (!targetRoleName) return message.reply('Usage: `!role edit color RoleName color`');

      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) return message.reply(`❌ Role "${targetRoleName}" not found.`);
      const [roleId, data] = found;
      roleData = { roleId, ...data };

      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to edit other users\' roles.');
        }
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot edit roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else {
      return message.reply('❌ Invalid color(s). Use hex (#FF5733) or name (red, blue, etc.).');
    }

    const role = message.guild.roles.cache.get(roleData.roleId);
    if (!role) return message.reply('❌ Role not found in server.');

    let primaryColor, secondaryColor;

    if (colorArgs.length >= 2) {
      primaryColor = parseColor(colorArgs[0]);
      secondaryColor = parseColor(colorArgs[1]);
      if (!primaryColor || !secondaryColor) {
        return message.reply('❌ Invalid color(s). Use hex (#FF5733) or name (red, blue, etc.).');
      }
      if (primaryColor.toUpperCase() === secondaryColor.toUpperCase()) {
        return message.reply('❌ Gradient colors must be different.');
      }
    } else {
      primaryColor = parseColor(colorArgs[0]);
      if (!primaryColor) return message.reply('❌ Invalid color. Use hex (#FF5733) or name (red, blue, etc.).');
      secondaryColor = null;
    }

    try {
      await role.edit(buildColorOptions(primaryColor, secondaryColor));
      updateRole(message.guild.id, roleData.roleId, { color: primaryColor, color2: secondaryColor || null });

      return message.reply(secondaryColor
        ? `✅ Role color changed to gradient \`${primaryColor}\` → \`${secondaryColor}\``
        : `✅ Role color changed to \`${primaryColor}\``
      );
    } catch (err) {
      console.error('[role editColor] Error:', err);
      return message.reply(`❌ Failed to edit role color: ${err.message}`);
    }
  },

  // !role info [name?]
  async info(message, args) {
    const name = args.join(' ');
    let roleId, data;

    if (!name) {
      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) {
        return message.reply('❌ You have no custom role. Use `!role info "name"` to look up other roles.');
      }
      const roleData = userRoles[userRoles.length - 1];
      roleId = roleData.roleId;
      data = roleData;
    } else {
      const found = findRoleByName(message.guild.id, name);
      if (!found) return message.reply('❌ Role not found.');
      [roleId, data] = found;
    }

    const role = message.guild.roles.cache.get(roleId);
    const creator = data.creatorId
      ? await message.guild.members.fetch(data.creatorId).catch(() => null)
      : null;

    const colorDisplay = data.color2
      ? `\`${data.color}\` → \`${data.color2}\` (gradient)`
      : `\`${data.color}\``;

    return message.reply(
      `**Role Info: ${data.name}**\n` +
      `Color: ${colorDisplay}\n` +
      `Members: ${role?.members.size ?? 0}\n` +
      `Owner: ${creator?.user.tag ?? 'Unassigned'}`
    );
  },

  // !role sync  — admin: re-sync DB with Discord state
  async sync(message) {
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to sync roles.');
    }
    if (!botCanManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    try {
      const guildRoles = await syncColorRoles(message.guild);
      const count = Object.keys(guildRoles).length;
      return message.reply(`✅ Synced color roles. ${count} role(s) now tracked.`);
    } catch (err) {
      console.error('[role sync] Error:', err);
      return message.reply(`❌ Sync failed: ${err.message}`);
    }
  },

  // !role cleanup  — admin: delete orphaned color roles (no members assigned)
  async cleanup(message) {
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to run cleanup.');
    }
    if (!botCanManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    try {
      const deleted = await cleanupOrphanedRoles(message.guild);
      if (deleted.length === 0) {
        return message.reply('✅ No orphaned color roles found.');
      }
      return message.reply(`✅ Deleted ${deleted.length} orphaned role(s): **${deleted.join('**, **')}**`);
    } catch (err) {
      console.error('[role cleanup] Error:', err);
      return message.reply(`❌ Cleanup failed: ${err.message}`);
    }
  },

  async help(message) {
    return message.reply(
      '**Role Commands:**\n' +
      '`!role set "name" color` — Create your custom role\n' +
      '`!role set "name" color1 color2` — Create a gradient role\n' +
      '`!role delete` — Delete your custom role\n' +
      '`!role delete "name"` — Delete a specific role (admin)\n' +
      '`!role edit name "new name"` — Rename your role\n' +
      '`!role edit name RoleName to NewName` — Rename any role (admin)\n' +
      '`!role edit color color` — Change your role color\n' +
      '`!role edit color color1 color2` — Change to gradient\n' +
      '`!role info` — Show your role details\n' +
      '`!role info "name"` — Show a specific role\'s details\n' +
      '`!role set @user "name" color` — Assign/create role for user (admin)\n' +
      '`!role set @user none` — Unassign role from user (admin)\n' +
      '`!role create "name" color` — Create an unowned role (admin)\n' +
      '`!role sync` — Sync DB with Discord role state (admin)\n' +
      '`!role cleanup` — Delete orphaned color roles (admin)\n' +
      '**Colors:** Hex (#FF5733 or FF5733) or names (red, blue, purple, etc.)\n' +
      '**Note:** Gradient colors must be different.'
    );
  },
};

// ─── Color/name parser ────────────────────────────────────────────────────────

/**
 * Parses args array into { name, primaryColor, secondaryColor, error }.
 * Colors are detected from the end of the args array.
 * @param {string[]} args
 * @param {boolean} allowNoColor - if true, returns null colors instead of error
 */
function parseNameAndColors(args, allowNoColor = false) {
  const potentialColor2 = args[args.length - 1];
  const potentialColor1 = args.length >= 2 ? args[args.length - 2] : null;
  const hexColor2 = parseColor(potentialColor2);
  const hexColor1 = potentialColor1 ? parseColor(potentialColor1) : null;

  let name, primaryColor, secondaryColor;

  if (hexColor1 && hexColor2) {
    if (hexColor1.toUpperCase() === hexColor2.toUpperCase()) {
      return { error: '❌ Gradient colors must be different.' };
    }
    const nameArgs = args.slice(0, -2);
    name = nameArgs.join(' ');
    primaryColor = hexColor1;
    secondaryColor = hexColor2;
  } else if (hexColor2) {
    const nameArgs = args.slice(0, -1);
    name = nameArgs.join(' ');
    primaryColor = hexColor2;
    secondaryColor = null;
  } else {
    if (allowNoColor) {
      name = args.join(' ');
      primaryColor = null;
      secondaryColor = null;
    } else {
      return { error: '❌ Invalid color. Use hex (#FF5733) or name (red, blue, etc.).' };
    }
  }

  if (!name) {
    return { error: '❌ Role name cannot be empty.' };
  }

  return { name, primaryColor, secondaryColor };
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  name: 'role',
  description: 'Manage custom color roles',
  async execute(message, args) {
    const subcommand = args.shift()?.toLowerCase() || 'help';
    const handler = subcommands[subcommand];

    if (handler) {
      await handler(message, args);
    } else {
      message.reply(`Unknown subcommand \`${subcommand}\`. Use \`!role help\` for commands.`);
    }
  },
};
