## Proposed Changes (Performance Only, No Feature Changes)

This plan is strictly for runtime and developer-loop performance. Gameplay rules and command behavior must remain identical.

### 1. Reduce Blocking File I/O in Hot Paths (Performance Critical)
The hottest write path is runtime state persistence. `pandaRuntime` currently coalesces within a tick but still performs synchronous disk writes. `pandaStorage` also writes synchronously when awards happen.
- **Files:** `utils/pandaRuntime.js`, `utils/pandaStorage.js`
- **Action:**
  - Replace per-event synchronous writes with buffered/asynchronous persistence while preserving atomic writes.
  - Keep in-memory state authoritative during burst traffic and flush in short intervals (for example 100-500ms) to reduce event-loop blocking.
  - Ensure write ordering and crash-safety semantics stay equivalent (no partial JSON files, no lost committed updates under normal shutdown).

### 2. Optimize Leaderboard Computation and Member Resolution (Performance)
Leaderboard work is repeated in award paths and list commands, and member fetches can be API-heavy.
- **Files:** `utils/lastPlaceBoost.js`, `index.js`, `commands/panda.js`, `commands/vpanda.js`, `handlers/partnerHandler.js`
- **Action:**
  - Reduce repeated full-board work around `checkLastPlaceBoost` and pirate checks by reusing computed ranking data inside a single event flow where possible.
  - In `!panda list` and `!vpanda list`, use cache-first member lookup (`guild.members.cache.get(id)`) with fetch fallback only when missing.
  - For partner mutual-guild checks, use cache-first strategy with safe fallback fetch to avoid false negatives.

### 3. Preserve Current Boost Mechanics While Optimizing
Last-place boost optimization must not alter current game outcomes.
- **Files:** `utils/lastPlaceBoost.js`, `index.js`
- **Action:**
  - Keep the existing eligibility behavior exactly as implemented now (random recipient from ranks 11+ when a top-3 user earns a panda).
  - Add an explicit regression check to confirm boost trigger frequency and recipient pool are unchanged after optimization.

### 4. Fix Nodemon Restart Loops During Development
`nodemon` watches `data/` but the ignore list is incomplete for generated JSON files.
- **Files:** `nodemon.json`
- **Action:**
  - Add missing runtime data files and their `.tmp` variants to `ignore` (including bump/voice/member/invite tracking artifacts) so normal bot activity does not trigger restart loops.

## Out of Scope for This Performance Pass
- Missing `await` in command execution (correctness/reliability).
- Config cleanup such as moving hardcoded channel IDs to `.env`.
- Dead-code removal that does not affect runtime performance.

## Performance Metrics
Collect before/after numbers with the same workload and sampling window.
1. **Panda-channel message processing latency**: measure time spent in the panda-channel branch of `messageCreate`.
2. **Leaderboard command latency**: measure `!panda list` and `!vpanda list` end-to-end processing time.
3. **Disk write pressure**: track write count and total write time per minute for panda runtime/storage files.

Use temporary timing logs only during benchmarking, then remove instrumentation.

## Verification Plan
1. Confirm no gameplay or command-output changes under normal use.
2. Confirm `!panda list` and `!vpanda list` remain functionally identical and execute faster under load.
3. Confirm panda awards (chat, bump, invite, voice, pirate, boost) still persist correctly.
4. Confirm nodemon no longer restarts from routine writes in `data/`.
