# Discord Bot (mybotNico)

A Discord bot built with [Discord.js v14](https://discord.js.org/) supporting multiple guilds simultaneously.

## Features

- **Panda System** — Tracks messages in designated channels. Every 30–40 unique-user messages, the last sender earns a panda (custom emoji reaction + persistent leaderboard).
- **Custom Role System** — Users can create personal color roles (solid or gradient). Admins can manage roles for others with role-hierarchy enforcement.
- **Member Leave Log** — Posts a rich embed to a log channel when a member leaves, including join date and account age.
- **Partner Broadcast** — Bot owners can DM the bot to broadcast a message to all configured partner server channels. Supports "delete last" to undo.
- **Imitate** — Uses webhooks to send a message appearing as another user (name + avatar). Requires Manage Messages permission.
- **Purge** — Bulk-deletes up to 100 messages with permission checks.
- **Screen Recording** — Bot owners can capture a visible prejoined Discord call window, while members in the recorded voice channel can save MP4 clips with 60 seconds back plus 20 seconds forward.
- **Help** — Layered help system with a user view and `!help admin` for admin commands.

## Required Bot Permissions

The bot needs the following permissions in each server:

| Permission | Used by |
|---|---|
| Read Messages / View Channels | All commands |
| Send Messages | All commands |
| Manage Messages | `!purge`, `!imitate` |
| Manage Roles | `!role` |
| Manage Webhooks | `!imitate` |
| Add Reactions | Panda award system |
| Read Message History | `!purge` |
| Connect / Speak / Use Voice Activity | `!join`, `!leave` |

## Setup

1. Create a Discord application at https://discord.com/developers/applications
2. Copy your bot token and client ID
3. Create a `.env` file based on `.env.example` and fill in all values
4. Install dependencies: `npm install`
5. Run the bot: `npm start`

## Environment Variables

See `.env.example` for all required and optional variables:

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Your bot token |
| `CLIENT_ID` | ✅ | Your bot's client ID |
| `MEMBER_LEAVE_LOG_CHANNEL_ID` | ✅ | Channel ID for member leave logs |
| `BOT_OWNER_IDS` | ✅ | Comma-separated user IDs for owner-only commands |
| `FFMPEG_PATH` | Optional | Legacy fallback FFmpeg path |
| `SCREEN_RECORDING_FFMPEG_PATH` | Optional | System FFmpeg binary for screen recording; defaults to `FFMPEG_PATH` or `ffmpeg` |
| `SCREEN_RECORDING_WINDOW_TITLE` | Optional | Visible recorder window title to find with `xdotool`; defaults to `Discord` |
| `SCREEN_RECORDING_GEOMETRY` | Optional | Exact capture region as `WIDTHxHEIGHT+X,Y`; bypasses `xdotool` window lookup |
| `SCREEN_RECORDING_DISPLAY` | Optional | X11 display for `x11grab`; defaults to `DISPLAY` |
| `SCREEN_RECORDING_AUDIO_SOURCE` | Optional | Pulse/PipeWire monitor source to include call audio; auto-detects the default sink monitor when blank |
| `SCREEN_RECORDING_ALLOW_VIDEO_ONLY` | Optional | Set to `true` to allow screen clips without audio |
| `SCREEN_RECORDING_FPS` | Optional | Screen capture FPS; defaults to `30` |
| `VOICE_DEBUG` | Optional | Set to `true` for verbose Discord voice connection diagnostics |
| `SOCIALS_GUILD_ID` | ✅ | Guild ID for verbose panda logging and leave tracking |
| `PANDA_EMOJI_NAME` | ✅ | Name of the custom emoji used for panda awards |
| `COLOR_SEPARATOR_ROLE_ID` | ✅ | Role ID used to position custom color roles |

## Data Files

The bot stores persistent data in the `data/` directory:

- `data/pandas.json` — Panda counts per guild/user
- `data/pandaRuntimeState.json` — In-progress panda message counters (survives restarts)
- `data/roles.json` — Custom role registry per guild
- `data/pandaChannels.json` — Maps guild IDs to their designated panda channel
- `data/partnerChannels.json` — Partner server channel configuration
- `recordings/` — Screen recording sessions, rolling segments, and MP4 clips (ignored by git)

## Screen Recording Notes

`!record on` does not join or automate Discord. A dedicated recorder account/window must already be joined to the call and visible on the host running the bot. Clips capture only what that window renders, so hidden, minimized, or offscreen cams and streams will not appear.

## Inviting the Bot

Use this URL format to invite your bot:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot
```

Replace `YOUR_CLIENT_ID` with your bot's client ID.

## Development

```bash
npm run dev   # Start with nodemon (auto-restart on file changes)
npm start     # Start normally
```
