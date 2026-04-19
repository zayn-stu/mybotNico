const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/inviteRewards.json');
const STAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// In-memory cache of guild invites: guildId -> Map(code -> { uses, inviterId })
const inviteCache = new Map();

// Persistent reward tracking cache
let rewardCache = null;

// ─── Reward persistence (who invited who) ─────────────────────────────────────

function loadRewards() {
  if (rewardCache !== null) return rewardCache;
  try {
    if (!fs.existsSync(DATA_FILE)) { rewardCache = {}; return rewardCache; }
    rewardCache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return rewardCache;
  } catch (err) {
    console.error('[inviteTracker] Error loading rewards:', err);
    rewardCache = {};
    return rewardCache;
  }
}

function saveRewards(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    rewardCache = data;
  } catch (err) {
    console.error('[inviteTracker] Error saving rewards:', err);
  }
}

function recordInviteReward(guildId, memberId, inviterId) {
  const data = loadRewards();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][memberId] = { inviterId, joinedAt: Date.now() };
  saveRewards(data);
}

function getDeductionInfo(guildId, memberId) {
  const data = loadRewards();
  const entry = data[guildId]?.[memberId];
  if (!entry || !entry.inviterId) return null;
  if (Date.now() - entry.joinedAt > STAY_WINDOW_MS) return null;
  return { inviterId: entry.inviterId };
}

function removeRewardEntry(guildId, memberId) {
  const data = loadRewards();
  if (!data[guildId]) return;
  delete data[guildId][memberId];
  saveRewards(data);
}

// ─── Invite cache management ──────────────────────────────────────────────────

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    invites.forEach(inv => {
      if (inv.inviter) {
        map.set(inv.code, { uses: inv.uses, inviterId: inv.inviter.id });
      }
    });
    inviteCache.set(guild.id, map);
    console.log(`[inviteTracker] Cached ${map.size} invites for ${guild.name}`);
  } catch (err) {
    console.error(`[inviteTracker] Failed to cache invites for ${guild.name}:`, err.message);
  }
}

function handleInviteCreate(invite) {
  if (!invite.inviter) return;
  const guildMap = inviteCache.get(invite.guild.id);
  if (!guildMap) return;
  guildMap.set(invite.code, { uses: invite.uses, inviterId: invite.inviter.id });
}

function handleInviteDelete(invite) {
  const guildMap = inviteCache.get(invite.guild.id);
  if (!guildMap) return;
  guildMap.delete(invite.code);
}

/**
 * Called on guildMemberAdd. Compares cached invites to current invites
 * to determine who invited the new member.
 * Returns { inviterId } or null.
 */
async function detectInviter(member) {
  const oldInvites = inviteCache.get(member.guild.id);
  if (!oldInvites) {
    console.log(`[inviteTracker] No cached invites for ${member.guild.name} — skipping detection`);
    return null;
  }

  try {
    const newInvites = await member.guild.invites.fetch();
    let usedInvite = null;

    // Check for invites whose use count increased
    newInvites.forEach(inv => {
      const old = oldInvites.get(inv.code);
      if (old && inv.uses > old.uses) {
        usedInvite = inv;
      }
    });

    // Check for invites that disappeared (one-time use invites get deleted after use)
    if (!usedInvite) {
      const newCodes = new Set();
      newInvites.forEach(inv => newCodes.add(inv.code));
      for (const [code, old] of oldInvites) {
        if (!newCodes.has(code) && old.inviterId) {
          // This invite was in cache but is now gone — likely a one-time use invite
          usedInvite = { inviter: { id: old.inviterId, bot: false } };
          console.log(`[inviteTracker] Detected deleted invite ${code} (likely one-time use) by ${old.inviterId}`);
          break;
        }
      }
    }

    // Update cache with fresh data
    const map = new Map();
    newInvites.forEach(inv => {
      if (inv.inviter) {
        map.set(inv.code, { uses: inv.uses, inviterId: inv.inviter.id });
      }
    });
    inviteCache.set(member.guild.id, map);

    if (!usedInvite || !usedInvite.inviter) return null;
    const inviterId = usedInvite.inviter.id;
    // Don't award if someone invited themselves (bot accounts, etc.)
    if (inviterId === member.user.id) return null;
    if (usedInvite.inviter.bot) return null;

    return { inviterId };
  } catch (err) {
    console.error(`[inviteTracker] Error detecting inviter in ${member.guild.name}:`, err.message);
    return null;
  }
}

module.exports = {
  cacheGuildInvites,
  handleInviteCreate,
  handleInviteDelete,
  detectInviter,
  recordInviteReward,
  getDeductionInfo,
  removeRewardEntry,
};
