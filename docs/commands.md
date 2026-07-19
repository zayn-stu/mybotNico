# Bot Commands

## help
- `!help` - Shows all available commands
- `!help admin` - Shows admin-only commands

## ping
- `!ping` - Check bot responsiveness

## role
- `!role menu` - Create or edit your custom role with the interactive menu
- `!role delete` - Delete your custom role
- `!role info` - Show your role details
- `!role info "name"` - Show a specific role's details
- `!role help` - Show role commands

### Admin Commands (Manage Roles permission)
- `!role menu create` - Create an unowned role
- `!role menu @user` - Assign or edit a user's role
- `!role set @user none` - Unassign role from user (keeps role)
- `!role delete {role}` - Delete any role
- `!role sync` - Sync tracked color roles from Discord
- `!role cleanup` - Delete orphaned color roles

**Note:** Gradient colors must be different. Server requires ENHANCED_ROLE_COLORS feature for gradients. Admins cannot modify roles belonging to higher-ranked users.

## panda
- `!panda` or `!panda me` - Check your panda count
- `!panda list` - View top 10 leaderboard
- `!panda help` - Show panda commands

## Nico's Cave
- `!play` - Run one dungeon raid. Players get 10 raids per Europe/Istanbul day.
- `!store` - Open the gear store with buy buttons.
- `!profile` - Show your level, coins, XP, equipped gear, stats, depth, and raids left.
- `!inventory` - View owned gear/materials and equip, unequip, or sell items.

## reset (owner-only)
- `!reset pandas` - Reset panda leaderboard data

## purge
- `!purge {count}` - Delete the last `{count}` messages in the current channel
  - **Requires:** User and bot both need "Manage Messages"
  - **Range:** `{count}` must be a whole number between `1` and `100`
  - **Note:** Discord does not bulk delete messages older than 14 days

## imitate
- `!imitate @user {message}` - Send a message appearing as another user
  - The bot will send the message with the mentioned user's profile picture and username
  - The original command message will be deleted
  - **Requires:** Bot needs "Manage Webhooks" permission in the server
