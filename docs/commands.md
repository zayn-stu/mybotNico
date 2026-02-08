# Bot Commands

## help
- `!help` - Shows all available commands
- `!help admin` - Shows admin-only commands

## ping
- `!ping` - Check bot responsiveness

## role
- `!role set "name" color` - Create a standard role
- `!role set "name" color1 color2` - Create a gradient role
- `!role delete` - Delete your custom role
- `!role edit name "new name"` - Rename your role
- `!role edit color {color}` - Change to standard color
- `!role edit color {color1} {color2}` - Change to gradient
- `!role info` - Show your role details
- `!role info "name"` - Show a specific role's details
- `!role help` - Show role commands

### Admin Commands (Manage Roles permission)
- `!role create {name} {color}` - Create unowned role
- `!role create {name} {color1} {color2}` - Create unowned gradient role
- `!role set @user {name} {color}` - Create/assign role to user
- `!role set @user {name} {color1} {color2}` - Gradient for user
- `!role set @user {existing role}` - Assign existing unowned role
- `!role set @user none` - Unassign role from user (keeps role)
- `!role delete {role}` - Delete any role
- `!role edit name {role} to {new name}` - Rename any role
- `!role edit color {role} {color}` - Change any role's color
- `!role edit color {role} {color1} {color2}` - Gradient for any role

**Note:** Gradient colors must be different. Server requires ENHANCED_ROLE_COLORS feature for gradients. Admins cannot modify roles belonging to higher-ranked users.

## panda
- `!panda` or `!panda me` - Check your panda count
- `!panda list` - View top 10 leaderboard
- `!panda help` - Show panda commands

## imitate
- `!imitate @user {message}` - Send a message appearing as another user
  - The bot will send the message with the mentioned user's profile picture and username
  - The original command message will be deleted
  - **Requires:** Bot needs "Manage Webhooks" permission in the server
