# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # production
npm run dev        # nodemon (auto-restarts on file changes, ignores data/*.json writes)
npm test           # run all tests (Node built-in test runner, no extra deps)

# Run a single test file
node --test tests/jsonStore.test.js

# Run tests matching a name pattern
node --test --test-name-pattern="bump"
```

## Architecture

### Entry point & startup flow

`index.js` → `loadCommands()` + `registerEvents()` → bot connects.

`registerEvents.js` creates a **`context` object** that is threaded through every event handler. It holds guild IDs, config constants, and in-memory Maps (`voiceActivityTracker`, `pirateMessageCounter`). All event handlers receive this context rather than importing globals.

`bot/events/ready.js` runs migrations, caches invites, starts the giveaway scheduler, and sets up two recurring timers (voice reward check every 60s, voice resync every 10 min).

### Command system

Prefix-based text commands only (`nico`, `n`, or `!` — all three work). Commands live in `commands/` as modules exporting `{ name, execute(message, args) }`. They are auto-loaded by `handlers/commandHandler.js`. Some commands delegate entirely to a feature module (e.g. `commands/panda.js` just re-exports `features/pandas/pandaCommand.js`).

### Feature modules (`features/`)

Each feature is self-contained with its own storage, logic, and sometimes an interaction handler:

- **`pandas/`** — core economy. Panda scores are per `(guildId, userId)`. The chat award system uses a rolling random threshold (30–40 messages) tracked in `pandaRuntimeState.json`. The bot also awards pandas for bumps (via Disboard webhook) and voice time (60 min = 1 panda). Pirate bounty rolls happen every 3rd message in the panda channel. `lastPlaceBoost.js` can award bonus pandas to the last-place user.
- **`nicoscave/`** — dungeon RPG. Players have coins, XP/level, gear slots, material inventory, and daily raid charges. `engine.js` runs raid logic, `service.js` handles purchases/equipping, `render.js` builds Discord embeds.
- **`partners/`** — DM-driven partner ad broadcast system. Server owners DM the bot to submit ads; owners approve/reject via reactions. Broadcasts go to a partner channel. Entirely DM-operated — no slash commands.
- **`verification/`** — join verification gating. Stores pending verifications by `guildId:userId` key. The verification prompt message is pinned in a channel and persisted across restarts.
- **`roles/`** — custom colour roles. Users can own a personal colour role; staff can assign roles to others. Roles are bounded between two separator roles (`COLOR_SEPARATOR_ROLE_ID`, `BOTS_SEPARATOR_ROLE_ID`).
- **`giveaways/`** — button/select-menu giveaways. Set up via interaction flow, ended by a 30s scheduler (`lifecycle.js`).
- **`voice/`** — voice channel connection management (`connection.js`). Persists which channel the bot was in across restarts via `voiceConnections.json`.

### Data layer (`shared/jsonStore.js`)

All persistent state is flat JSON files in `data/`. Three write modes:

| Function | Use case |
|---|---|
| `writeJsonFile` | Immediate sync write (rare, avoid in hot paths) |
| `writeJsonFileAtomic` | Sync write via temp-file rename (crash-safe) |
| `writeJsonFileDebounced` | Coalesces rapid writes into one flush via `setImmediate` |

Most feature storage modules keep an **in-memory cache** (`let cache = null`) and lazy-load on first read. `writeJsonFileDebounced` is the default for anything written frequently (panda scores, runtime state).

`flushAllWrites()` drains the debounce queue — called in the `SIGINT`/`SIGTERM` handler in `index.js` so queued writes aren't lost on restart.

The `DATA_DIR` env var redirects all file paths (used by `loadTest.js` to isolate writes to `/tmp`).

### Two guilds

- **Socials** (`SOCIALS_GUILD_ID`) — main community. Has the panda channel, verification, invite tracking, partner ads.
- **Degeneracy** (`DEGENERACY_GUILD_ID`) — separate community. Also has panda tracking; staff role used to hide/show on leaderboard.

Both are in `trackedGuilds` and get bump/voice/invite rewards. Guild-specific behaviour is branched on `guildId` comparisons inside event handlers.

### Interaction handling

Slash-command/button/modal interactions flow through `handlers/interactionHandler.js`, which tries each feature's handler in priority order (verification → nicoscave → roles → giveaways). Each returns a truthy value to short-circuit the chain.

Use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`) for private replies.

### Testing

Tests use Node's built-in `node --test`. All tests are in `tests/`. They mock Discord.js objects inline and redirect data writes to `/tmp` via `DATA_DIR`. `loadTest.js` is a stress/performance script, not a unit test — run it manually.
