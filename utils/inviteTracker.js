const path = require('path');
const { readJsonFile, writeJsonFileAtomic } = require('../shared/jsonStore');

const DATA_FILE = path.join(__dirname, '../data/inviteRewards.json');
const DEFAULT_SNAPSHOT_FILE = path.join(__dirname, '../data/inviteSnapshots.json');
let snapshotFile = DEFAULT_SNAPSHOT_FILE;
const STAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INVITES_FETCH_TIMEOUT_MS = 6000;
const VANITY_FETCH_TIMEOUT_MS = 1500;

const INVITE_SOURCES = {
  OLD_MASTER: 'old_master',
  NEW_MASTER: 'new_master',
  DISBOARD: 'disboard',
  VANITY: 'vanity',
  UNKNOWN: 'unknown',
};

const KNOWN_INVITE_CODES = {
  TxWxQWAJbP: INVITE_SOURCES.OLD_MASTER,
  MZrBqxqbgB: INVITE_SOURCES.NEW_MASTER,
  uYddrAq9CB: INVITE_SOURCES.DISBOARD,
};

const VANITY_CODE = 'SN17';

// In-memory cache of guild invites:
// guildId -> Map(code -> { code, uses, inviterId, inviterBot, channelId, maxUses, temporary })
const inviteCache = new Map();
// guildId -> { code, uses }
const vanityCache = new Map();

// Persistent reward tracking cache
let rewardCache = null;
let snapshotCache = null;

// ─── Reward persistence (who invited who) ─────────────────────────────────────

function loadRewards() {
  if (rewardCache !== null) return rewardCache;
  rewardCache = readJsonFile(DATA_FILE, {}, {
    onError: err => console.error('[inviteTracker] Error loading rewards:', err),
  });
  return rewardCache;
}

function saveRewards(data) {
  try {
    writeJsonFileAtomic(DATA_FILE, data, { ensureDirectory: true });
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

function loadSnapshots() {
  if (snapshotCache !== null) return snapshotCache;
  snapshotCache = readJsonFile(snapshotFile, {}, {
    onError: err => console.error('[inviteTracker] Error loading invite snapshots:', err),
  });
  return snapshotCache;
}

function saveSnapshots() {
  const data = {};
  for (const [guildId, invites] of inviteCache) {
    data[guildId] = {
      updatedAt: Date.now(),
      invites: Array.from(invites.values()),
      vanity: vanityCache.get(guildId) || null,
    };
  }
  writeJsonFileAtomic(snapshotFile, data, { ensureDirectory: true });
  snapshotCache = data;
}

function restoreSnapshotForGuild(guildId) {
  const snapshot = loadSnapshots()[guildId];
  if (!snapshot) return false;

  inviteCache.set(guildId, new Map(
    (snapshot.invites || []).map(invite => [invite.code, invite])
  ));
  if (snapshot.vanity) vanityCache.set(guildId, snapshot.vanity);
  return true;
}

// ─── Invite cache management ──────────────────────────────────────────────────

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = snapshotInvites(invites);
    inviteCache.set(guild.id, map);
    console.log(`[inviteTracker] Cached ${map.size} invites for ${guild.name}`);
  } catch (err) {
    console.error(`[inviteTracker] Failed to cache invites for ${guild.name}:`, err.message);
    restoreSnapshotForGuild(guild.id);
  }

  try {
    const vanityData = await fetchVanitySnapshot(guild);
    if (vanityData) vanityCache.set(guild.id, vanityData);
  } catch (err) {
    console.error(`[inviteTracker] Failed to cache vanity data for ${guild.name}:`, err.message);
  }

  saveSnapshots();
}

function handleInviteCreate(invite) {
  const guildMap = inviteCache.get(invite.guild.id);
  if (!guildMap) return;
  guildMap.set(invite.code, inviteToSnapshot(invite));
  saveSnapshots();
}

function handleInviteDelete(invite) {
  const guildMap = inviteCache.get(invite.guild.id);
  if (!guildMap) return;
  guildMap.delete(invite.code);
  saveSnapshots();
}

/**
 * Called on guildMemberAdd. Compares cached invites to current invites
 * and vanity usage to determine the join source.
 * Returns a detection record. The inviterId field is preserved for invite
 * panda rewards when Nico can confidently identify a real, non-bot inviter.
 */
async function detectInviter(member) {
  const oldInvites = inviteCache.get(member.guild.id);
  const oldVanity = vanityCache.get(member.guild.id) || null;
  if (!oldInvites) {
    const restored = restoreSnapshotForGuild(member.guild.id);
    if (!restored) {
      console.log(`[inviteTracker] No cached invites for ${member.guild.name} — falling back to unknown source`);
      await refreshInviteCaches(member.guild);
      return unknownDetection('missing_cache');
    }
    return detectInviter(member);
  }

  try {
    const newInvites = await withTimeout(
      member.guild.invites.fetch(),
      INVITES_FETCH_TIMEOUT_MS,
      null
    );

    if (!newInvites) {
      console.error(`[inviteTracker] Timed out fetching invites for ${member.guild.name}`);
      await refreshInviteCaches(member.guild);
      return unknownDetection('invite_fetch_timeout');
    }

    const newVanity = await withTimeout(
      fetchVanitySnapshot(member.guild),
      VANITY_FETCH_TIMEOUT_MS,
      null
    );
    const newInviteMap = snapshotInvites(newInvites);
    const changes = findInviteUseChanges(oldInvites, newInviteMap);
    const vanityIncreased = didVanityIncrease(oldVanity, newVanity);
    const detection = classifyJoinSource(changes, vanityIncreased);

    inviteCache.set(member.guild.id, newInviteMap);
    if (newVanity) vanityCache.set(member.guild.id, newVanity);
    saveSnapshots();

    if (detection.inviterId === member.user.id || detection.inviterBot) {
      return { ...detection, inviterId: null, inviterBot: Boolean(detection.inviterBot) };
    }

    return detection;
  } catch (err) {
    console.error(`[inviteTracker] Error detecting inviter in ${member.guild.name}:`, err.message);
    await refreshInviteCaches(member.guild);
    return unknownDetection('api_error');
  }
}

function inviteToSnapshot(invite) {
  return {
    code: invite.code,
    uses: invite.uses ?? 0,
    inviterId: invite.inviter?.id || null,
    inviterBot: Boolean(invite.inviter?.bot),
    channelId: invite.channel?.id || invite.channelId || null,
    maxUses: invite.maxUses ?? null,
    temporary: Boolean(invite.temporary),
  };
}

function snapshotInvites(invites) {
  const map = new Map();
  invites.forEach(invite => {
    if (invite?.code) map.set(invite.code, inviteToSnapshot(invite));
  });
  return map;
}

async function fetchVanitySnapshot(guild) {
  if (typeof guild.fetchVanityData !== 'function') return null;
  const data = await guild.fetchVanityData();
  if (!data) return null;
  return {
    code: data.code || VANITY_CODE,
    uses: data.uses ?? 0,
  };
}

async function refreshInviteCaches(guild) {
  try {
    const invites = await withTimeout(
      guild.invites.fetch(),
      INVITES_FETCH_TIMEOUT_MS,
      null
    );
    if (invites) {
      inviteCache.set(guild.id, snapshotInvites(invites));
      saveSnapshots();
    }
  } catch {
    // Leave the existing cache in place if refresh fails.
  }

  try {
    const vanityData = await withTimeout(
      fetchVanitySnapshot(guild),
      VANITY_FETCH_TIMEOUT_MS,
      null
    );
    if (vanityData) vanityCache.set(guild.id, vanityData);
  } catch {
    // Vanity data is optional and can fail independently.
  }
}

function findInviteUseChanges(oldInvites, newInvites) {
  const changes = [];

  for (const [code, current] of newInvites) {
    const old = oldInvites.get(code);
    if (old && current.uses > old.uses) {
      changes.push({
        ...current,
        code,
        useDelta: current.uses - old.uses,
        deleted: false,
      });
    }
  }

  for (const [code, old] of oldInvites) {
    if (!newInvites.has(code)) {
      changes.push({
        ...old,
        code,
        useDelta: 1,
        deleted: true,
      });
      console.log(`[inviteTracker] Detected deleted invite ${code} (likely one-time use) by ${old.inviterId || 'unknown inviter'}`);
    }
  }

  return changes;
}

function didVanityIncrease(oldVanity, newVanity) {
  if (!oldVanity || !newVanity) return false;
  return (newVanity.uses ?? 0) > (oldVanity.uses ?? 0);
}

function classifyInviteCode(code) {
  return KNOWN_INVITE_CODES[normalizeInviteCode(code)] || INVITE_SOURCES.UNKNOWN;
}

function normalizeInviteCode(code) {
  if (!code) return '';
  const trimmed = String(code).trim();
  const match = trimmed.match(/(?:discord\.gg\/|discord\.com\/invite\/)([^/?#\s]+)/i);
  return match ? match[1] : trimmed;
}

function classifyJoinSource(inviteChanges, vanityIncreased) {
  const changedCount = inviteChanges.length + (vanityIncreased ? 1 : 0);
  if (changedCount === 0) return unknownDetection('no_usage_change');
  if (changedCount > 1) return unknownDetection('ambiguous_usage_change');

  if (vanityIncreased) {
    return {
      source: INVITE_SOURCES.VANITY,
      inviteCode: VANITY_CODE,
      inviterId: null,
      inviterBot: false,
      confidence: 'high',
      detectionReason: 'vanity_usage_increased',
    };
  }

  const invite = inviteChanges[0];
  return {
    source: classifyInviteCode(invite.code),
    inviteCode: invite.code,
    inviterId: invite.inviterId || null,
    inviterBot: Boolean(invite.inviterBot),
    confidence: 'high',
    detectionReason: invite.deleted ? 'deleted_invite' : 'invite_usage_increased',
    channelId: invite.channelId || null,
    maxUses: invite.maxUses ?? null,
    temporary: Boolean(invite.temporary),
  };
}

function unknownDetection(reason) {
  return {
    source: INVITE_SOURCES.UNKNOWN,
    inviteCode: null,
    inviterId: null,
    inviterBot: false,
    confidence: 'low',
    detectionReason: reason,
  };
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  let timeoutId;
  const timeout = new Promise(resolve => {
    timeoutId = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function setInviteCachesForTests(guildId, invites = new Map(), vanity = null) {
  inviteCache.set(guildId, invites);
  if (vanity) vanityCache.set(guildId, vanity);
  else vanityCache.delete(guildId);
}

function resetInviteCachesForTests() {
  inviteCache.clear();
  vanityCache.clear();
  snapshotCache = null;
}

function setInviteSnapshotFileForTests(filePath) {
  snapshotFile = filePath || DEFAULT_SNAPSHOT_FILE;
  snapshotCache = null;
}

module.exports = {
  INVITE_SOURCES,
  KNOWN_INVITE_CODES,
  VANITY_CODE,
  cacheGuildInvites,
  handleInviteCreate,
  handleInviteDelete,
  detectInviter,
  classifyInviteCode,
  normalizeInviteCode,
  classifyJoinSource,
  inviteToSnapshot,
  snapshotInvites,
  setInviteCachesForTests,
  resetInviteCachesForTests,
  setInviteSnapshotFileForTests,
  recordInviteReward,
  getDeductionInfo,
  removeRewardEntry,
};
