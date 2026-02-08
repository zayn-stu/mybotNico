const { PermissionFlagsBits } = require('discord.js');
const { parseColor, COLOR_NAMES } = require('../utils/colors');
const { getUserRoles, addRole, removeRole, updateRole, findRoleByName, getRoleById } = require('../utils/roleStorage');

const COLOR_SEPARATOR_ROLE_ID = '1468679022694109358';

function canManageRoles(guild) {
  return guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles);
}

function userCanManageRoles(member) {
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

function isColorArg(str) {
  const lower = str.toLowerCase();
  return COLOR_NAMES[lower] || /^#?[0-9A-Fa-f]{6}$/.test(str);
}

function isMention(str) {
  return /^<@!?\d+>$/.test(str);
}

function parseMention(str) {
  const match = str.match(/^<@!?(\d+)>$/);
  return match ? match[1] : null;
}

function canModifyMember(executor, target) {
  // Can't modify someone with equal or higher role position
  return executor.roles.highest.position > target.roles.highest.position;
}

async function getTargetMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

const subcommands = {
  async set(message, args) {
    if (!canManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    // Check if first arg is a mention (admin mode)
    if (args.length > 0 && isMention(args[0])) {
      return subcommands.setForUser(message, args);
    }

    // Self mode: create role for yourself
    const userRoles = getUserRoles(message.guild.id, message.author.id);
    if (userRoles.length > 0) {
      return message.reply('❌ You already have a custom role. Delete it first with `!role delete`');
    }

    if (args.length < 2) {
      return message.reply('Usage: `!role set "name" color` or `!role set "name" color1 color2` for gradient');
    }

    // Check if last two args are colors (gradient) or just one (standard)
    const potentialColor2 = args[args.length - 1];
    const potentialColor1 = args[args.length - 2];
    const hexColor2 = parseColor(potentialColor2);
    const hexColor1 = args.length >= 3 ? parseColor(potentialColor1) : null;

    let name, primaryColor, secondaryColor;

    if (hexColor1 && hexColor2) {
      // Two colors provided = gradient
      if (hexColor1.toUpperCase() === hexColor2.toUpperCase()) {
        return message.reply('❌ Gradient colors must be different.');
      }
      args.pop(); // remove color2
      args.pop(); // remove color1
      name = args.join(' ');
      primaryColor = hexColor1;
      secondaryColor = hexColor2;
    } else if (hexColor2) {
      // One color provided = standard
      args.pop(); // remove color
      name = args.join(' ');
      primaryColor = hexColor2;
      secondaryColor = null;
    } else {
      return message.reply('❌ Invalid color. Use hex (#FF5733) or name (red, blue, etc.).');
    }

    if (!name) {
      return message.reply('Usage: `!role set "name" color` or `!role set "name" color1 color2` for gradient');
    }

    try {
      const roleOptions = {
        name: name,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Custom role for ${message.author.tag}`
      };

      // Use colors object for gradient support
      if (secondaryColor) {
        roleOptions.colors = {
          primaryColor: primaryColor,
          secondaryColor: secondaryColor
        };
      } else {
        roleOptions.colors = {
          primaryColor: primaryColor
        };
      }

      const role = await message.guild.roles.create(roleOptions);

      // Position the role right below the color separator
      const separatorRole = message.guild.roles.cache.get(COLOR_SEPARATOR_ROLE_ID);
      if (separatorRole) {
        await role.setPosition(separatorRole.position - 1);
      }

      await message.member.roles.add(role);
      addRole(message.guild.id, role.id, message.author.id, name, primaryColor, secondaryColor);

      if (secondaryColor) {
        message.reply(`✅ Created gradient role **${name}** with colors \`${primaryColor}\` → \`${secondaryColor}\``);
      } else {
        message.reply(`✅ Created role **${name}** with color \`${primaryColor}\``);
      }
    } catch (err) {
      console.error('Role creation error:', err);
      message.reply('❌ Failed to create role. The server may not support gradient colors.');
    }
  },

  async setForUser(message, args) {
    // Admin mode: !role set @user {name} {color} or !role set @user {name} {color} {color}
    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to assign roles to others.');
    }

    const targetUserId = parseMention(args.shift());
    const targetMember = await getTargetMember(message.guild, targetUserId);
    if (!targetMember) {
      return message.reply('❌ User not found.');
    }

    // Hierarchy check
    if (!canModifyMember(message.member, targetMember)) {
      return message.reply('❌ You cannot modify roles for someone with equal or higher rank than you.');
    }

    // Handle "none" - unassign role from user
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

    // Check if target user already has a custom role
    const targetUserRoles = getUserRoles(message.guild.id, targetUserId);
    if (targetUserRoles.length > 0) {
      return message.reply(`❌ ${targetMember.user.tag} already has a custom role.`);
    }

    if (args.length < 1) {
      return message.reply('Usage: `!role set @user {name} {color}` or `!role set @user {name} {color1} {color2}` or `!role set @user none`');
    }

    // Parse colors from the end
    const potentialColor2 = args[args.length - 1];
    const potentialColor1 = args.length >= 2 ? args[args.length - 2] : null;
    const hexColor2 = parseColor(potentialColor2);
    const hexColor1 = potentialColor1 ? parseColor(potentialColor1) : null;

    let name, primaryColor, secondaryColor;

    if (hexColor1 && hexColor2) {
      // Two colors = gradient
      if (hexColor1.toUpperCase() === hexColor2.toUpperCase()) {
        return message.reply('❌ Gradient colors must be different.');
      }
      args.pop();
      args.pop();
      name = args.join(' ');
      primaryColor = hexColor1;
      secondaryColor = hexColor2;
    } else if (hexColor2) {
      // One color
      args.pop();
      name = args.join(' ');
      primaryColor = hexColor2;
      secondaryColor = null;
    } else {
      // No valid colors - check if this is an existing role to assign
      name = args.join(' ');
      primaryColor = null;
      secondaryColor = null;
    }

    if (!name) {
      return message.reply('Usage: `!role set @user {name} {color}` or `!role set @user {name} {color1} {color2}`');
    }

    // Check if role with this name already exists
    const existingRole = findRoleByName(message.guild.id, name);

    if (existingRole) {
      const [roleId, roleData] = existingRole;

      // Check if role has an owner
      if (roleData.creatorId) {
        return message.reply(`❌ Role "${name}" already belongs to another user.`);
      }

      // Assign existing unowned role to user
      const role = message.guild.roles.cache.get(roleId);
      if (!role) {
        return message.reply('❌ Role exists in storage but not in server.');
      }

      try {
        // Update colors if provided
        if (primaryColor) {
          const colorOptions = { colors: { primaryColor } };
          if (secondaryColor) {
            colorOptions.colors.secondaryColor = secondaryColor;
          }
          await role.edit(colorOptions);
          updateRole(message.guild.id, roleId, { 
            color: primaryColor, 
            color2: secondaryColor,
            creatorId: targetUserId 
          });
        } else {
          updateRole(message.guild.id, roleId, { creatorId: targetUserId });
        }

        await targetMember.roles.add(role);
        message.reply(`✅ Assigned role **${name}** to ${targetMember.user.tag}`);
      } catch (err) {
        console.error('Role assignment error:', err);
        message.reply('❌ Failed to assign role.');
      }
    } else {
      // Create new role
      if (!primaryColor) {
        return message.reply('❌ Role doesn\'t exist. Provide a color to create it: `!role set @user {name} {color}`');
      }

      try {
        const roleOptions = {
          name: name,
          hoist: false,
          mentionable: false,
          permissions: [],
          reason: `Custom role for ${targetMember.user.tag} (created by ${message.author.tag})`
        };

        if (secondaryColor) {
          roleOptions.colors = { primaryColor, secondaryColor };
        } else {
          roleOptions.colors = { primaryColor };
        }

        const role = await message.guild.roles.create(roleOptions);

        const separatorRole = message.guild.roles.cache.get(COLOR_SEPARATOR_ROLE_ID);
        if (separatorRole) {
          await role.setPosition(separatorRole.position - 1);
        }

        await targetMember.roles.add(role);
        addRole(message.guild.id, role.id, targetUserId, name, primaryColor, secondaryColor);

        if (secondaryColor) {
          message.reply(`✅ Created gradient role **${name}** for ${targetMember.user.tag} with colors \`${primaryColor}\` → \`${secondaryColor}\``);
        } else {
          message.reply(`✅ Created role **${name}** for ${targetMember.user.tag} with color \`${primaryColor}\``);
        }
      } catch (err) {
        console.error('Role creation error:', err);
        message.reply('❌ Failed to create role. The server may not support gradient colors.');
      }
    }
  },

  async create(message, args) {
    // Admin only: create unowned role
    if (!canManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    if (!userCanManageRoles(message.member)) {
      return message.reply('❌ You need the Manage Roles permission to use this command.');
    }

    if (args.length < 2) {
      return message.reply('Usage: `!role create {name} {color}` or `!role create {name} {color1} {color2}`');
    }

    // Parse colors from the end
    const potentialColor2 = args[args.length - 1];
    const potentialColor1 = args[args.length - 2];
    const hexColor2 = parseColor(potentialColor2);
    const hexColor1 = args.length >= 3 ? parseColor(potentialColor1) : null;

    let name, primaryColor, secondaryColor;

    if (hexColor1 && hexColor2) {
      if (hexColor1.toUpperCase() === hexColor2.toUpperCase()) {
        return message.reply('❌ Gradient colors must be different.');
      }
      args.pop();
      args.pop();
      name = args.join(' ');
      primaryColor = hexColor1;
      secondaryColor = hexColor2;
    } else if (hexColor2) {
      args.pop();
      name = args.join(' ');
      primaryColor = hexColor2;
      secondaryColor = null;
    } else {
      return message.reply('❌ Invalid color. Use hex (#FF5733) or name (red, blue, etc.).');
    }

    if (!name) {
      return message.reply('Usage: `!role create {name} {color}` or `!role create {name} {color1} {color2}`');
    }

    // Check if role already exists
    const existingRole = findRoleByName(message.guild.id, name);
    if (existingRole) {
      return message.reply(`❌ Role "${name}" already exists.`);
    }

    try {
      const roleOptions = {
        name: name,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Unowned role created by ${message.author.tag}`
      };

      if (secondaryColor) {
        roleOptions.colors = { primaryColor, secondaryColor };
      } else {
        roleOptions.colors = { primaryColor };
      }

      const role = await message.guild.roles.create(roleOptions);

      const separatorRole = message.guild.roles.cache.get(COLOR_SEPARATOR_ROLE_ID);
      if (separatorRole) {
        await role.setPosition(separatorRole.position - 1);
      }

      // Save with null creatorId (unowned)
      addRole(message.guild.id, role.id, null, name, primaryColor, secondaryColor);

      if (secondaryColor) {
        message.reply(`✅ Created unowned gradient role **${name}** with colors \`${primaryColor}\` → \`${secondaryColor}\``);
      } else {
        message.reply(`✅ Created unowned role **${name}** with color \`${primaryColor}\``);
      }
    } catch (err) {
      console.error('Role creation error:', err);
      message.reply('❌ Failed to create role. The server may not support gradient colors.');
    }
  },

  async delete(message, args) {
    if (!canManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    let roleData;

    if (args.length > 0) {
      // Admin mode: delete specific role by name
      const targetRoleName = args.join(' ');
      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) {
        return message.reply(`❌ Role "${targetRoleName}" not found.`);
      }

      const [roleId, data] = found;
      roleData = { roleId, ...data };

      // Check if deleting someone else's role
      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to delete other users\' roles.');
        }

        // Hierarchy check: can't delete role of someone with equal or higher rank
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
      message.reply(`✅ Deleted role **${roleData.name}**`);
    } catch {
      message.reply('❌ Failed to delete role.');
    }
  },

  async edit(message, args) {
    if (!canManageRoles(message.guild)) {
      return message.reply('❌ Bot lacks ManageRoles permission.');
    }

    const editType = args.shift()?.toLowerCase();
    if (!editType || !['name', 'color'].includes(editType)) {
      return message.reply('Usage: `!role edit name "new name"` or `!role edit color newcolor` or `!role edit color color1 color2`');
    }

    if (editType === 'name') {
      return subcommands.editName(message, args);
    } else {
      return subcommands.editColor(message, args);
    }
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
      if (!found) {
        return message.reply(`❌ Role "${targetRoleName}" not found.`);
      }

      const [roleId, data] = found;
      roleData = { roleId, ...data };

      // Check if editing someone else's role
      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to edit other users\' roles.');
        }

        // Hierarchy check: can't edit role of someone with equal or higher rank
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot edit roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else {
      // Self mode: edit own role
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
    if (!role) {
      return message.reply('❌ Role not found in server.');
    }

    try {
      await role.setName(newName);
      updateRole(message.guild.id, roleData.roleId, { name: newName });
      message.reply(`✅ Role renamed to **${newName}**`);
    } catch {
      message.reply('❌ Failed to edit role.');
    }
  },

  async editColor(message, args) {
    if (args.length === 0) {
      return message.reply('Usage: `!role edit color newcolor` or `!role edit color color1 color2` for gradient');
    }

    let roleData, colorArgs;

    // Determine mode by checking colors from the end
    const lastArg = args[args.length - 1];
    const secondLastArg = args.length >= 2 ? args[args.length - 2] : null;
    
    const lastIsColor = isColorArg(lastArg);
    const secondLastIsColor = secondLastArg ? isColorArg(secondLastArg) : false;

    if (lastIsColor && !secondLastIsColor && args.length === 1) {
      // Self mode: only one arg and it's a color
      colorArgs = args;

      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) {
        return message.reply('❌ You have no custom roles to edit.');
      }
      roleData = userRoles[userRoles.length - 1];
    } else if (lastIsColor && secondLastIsColor && args.length === 2) {
      // Self mode: two args and both are colors (gradient)
      colorArgs = args;

      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) {
        return message.reply('❌ You have no custom roles to edit.');
      }
      roleData = userRoles[userRoles.length - 1];
    } else if (lastIsColor && secondLastIsColor) {
      // Admin mode: role name + two colors (gradient)
      colorArgs = [args[args.length - 2], args[args.length - 1]];
      const targetRoleName = args.slice(0, -2).join(' ');

      if (!targetRoleName) {
        return message.reply('Usage: `!role edit color RoleName color1 color2`');
      }

      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) {
        return message.reply(`❌ Role "${targetRoleName}" not found.`);
      }

      const [roleId, data] = found;
      roleData = { roleId, ...data };

      // Check if editing someone else's role
      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to edit other users\' roles.');
        }

        // Hierarchy check: can't edit role of someone with equal or higher rank
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot edit roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else if (lastIsColor) {
      // Admin mode: role name + one color
      colorArgs = [args[args.length - 1]];
      const targetRoleName = args.slice(0, -1).join(' ');

      if (!targetRoleName) {
        return message.reply('Usage: `!role edit color RoleName color`');
      }

      const found = findRoleByName(message.guild.id, targetRoleName);
      if (!found) {
        return message.reply(`❌ Role "${targetRoleName}" not found.`);
      }

      const [roleId, data] = found;
      roleData = { roleId, ...data };

      // Check if editing someone else's role
      if (roleData.creatorId && roleData.creatorId !== message.author.id) {
        if (!userCanManageRoles(message.member)) {
          return message.reply('❌ You need the Manage Roles permission to edit other users\' roles.');
        }

        // Hierarchy check: can't edit role of someone with equal or higher rank
        const roleOwner = await getTargetMember(message.guild, roleData.creatorId);
        if (roleOwner && !canModifyMember(message.member, roleOwner)) {
          return message.reply('❌ You cannot edit roles belonging to someone with equal or higher rank than you.');
        }
      }
    } else {
      // No valid colors found
      return message.reply('❌ Invalid color(s). Use hex (#FF5733) or name (red, blue, etc.).');
    }

    const role = message.guild.roles.cache.get(roleData.roleId);
    if (!role) {
      return message.reply('❌ Role not found in server.');
    }

    let primaryColor, secondaryColor;

    if (colorArgs.length >= 2) {
      // Two colors = gradient
      const hexColor1 = parseColor(colorArgs[0]);
      const hexColor2 = parseColor(colorArgs[1]);

      if (!hexColor1 || !hexColor2) {
        return message.reply('❌ Invalid color(s). Use hex (#FF5733) or name (red, blue, etc.).');
      }

      if (hexColor1.toUpperCase() === hexColor2.toUpperCase()) {
        return message.reply('❌ Gradient colors must be different.');
      }

      primaryColor = hexColor1;
      secondaryColor = hexColor2;
    } else {
      // One color = standard (removes gradient if present)
      const hexColor = parseColor(colorArgs[0]);
      if (!hexColor) {
        return message.reply('❌ Invalid color. Use hex (#FF5733) or name (red, blue, etc.).');
      }
      primaryColor = hexColor;
      secondaryColor = null;
    }

    try {
      // Use role.edit with colors object
      if (secondaryColor) {
        await role.edit({
          colors: {
            primaryColor: primaryColor,
            secondaryColor: secondaryColor
          }
        });
        updateRole(message.guild.id, roleData.roleId, { color: primaryColor, color2: secondaryColor });
        message.reply(`✅ Role color changed to gradient \`${primaryColor}\` → \`${secondaryColor}\``);
      } else {
        await role.edit({
          colors: {
            primaryColor: primaryColor
          }
        });
        // Remove color2 if it existed (convert gradient to standard)
        updateRole(message.guild.id, roleData.roleId, { color: primaryColor, color2: null });
        message.reply(`✅ Role color changed to \`${primaryColor}\``);
      }
    } catch (err) {
      console.error('Role edit error:', err);
      message.reply('❌ Failed to edit role. The server may not support gradient colors.');
    }
  },

  async info(message, args) {
    const name = args.join(' ');
    let roleId, data;

    if (!name) {
      // No args = show your own role
      const userRoles = getUserRoles(message.guild.id, message.author.id);
      if (userRoles.length === 0) {
        return message.reply('❌ You have no custom role. Use `!role info "name"` to look up other roles.');
      }
      const roleData = userRoles[userRoles.length - 1];
      roleId = roleData.roleId;
      data = roleData;
    } else {
      const found = findRoleByName(message.guild.id, name);
      if (!found) {
        return message.reply('❌ Role not found.');
      }
      [roleId, data] = found;
    }
    const role = message.guild.roles.cache.get(roleId);
    const creator = data.creatorId 
      ? await message.guild.members.fetch(data.creatorId).catch(() => null)
      : null;

    // Format color display based on gradient or standard
    let colorDisplay;
    if (data.color2) {
      colorDisplay = `\`${data.color}\` → \`${data.color2}\` (gradient)`;
    } else {
      colorDisplay = `\`${data.color}\``;
    }

    message.reply(
      `**Role Info: ${data.name}**\n` +
      `Color: ${colorDisplay}\n` +
      `Members: ${role?.members.size || 0}\n` +
      `Owner: ${creator?.user.tag || 'Unassigned'}`
    );
  },

  async help(message) {
    message.reply(
      '**Role Commands:**\n' +
      '`!role set {name} {color}` - Create a standard role\n' +
      '`!role set {name} {color1} {color2}` - Create a gradient role\n' +
      '`!role delete` - Delete your custom role\n' +
      '`!role edit name {new name}` - Rename your role\n' +
      '`!role edit color {color}` - Change to standard color\n' +
      '`!role edit color {color1} {color2}` - Change to gradient\n' +
      '`!role info` - Show your role details\n' +
      '`!role info {name}` - Show a specific role\'s details\n' +
      '**Colors:** Hex (#FF5733 or FF5733) or names (red, blue, purple, etc.)\n' +
      '**Note:** Gradient colors must be different.'
    );
  }
};

module.exports = {
  name: 'role',
  description: 'Manage custom color roles',
  async execute(message, args) {
    const subcommand = args.shift()?.toLowerCase() || 'help';
    const handler = subcommands[subcommand];

    if (handler) {
      await handler(message, args);
    } else {
      message.reply('Unknown subcommand. Use `!role help` for commands.');
    }
  }
};
