const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/inviteTracking.json');

const INVITE_WINDOW_MS = 60 * 60 * 1000;        // 60 minutes to use !panda @user
const STAY_WINDOW_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days — if they leave before this, deduct

let cache = null;

function loadData() {
  if (cache !== null) return cache;
  try {
    if (!fs.existsSync(DATA_FILE)) { cache = {}; return cache; }
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return cache;
  } catch (err) {
    console.error('[inviteTracking] Error loading data:', err);
    cache = {};
    return cache;
  }
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    cache = data;
  } catch (err) {
    console.error('[inviteTracking] Error saving data:', err);
  }
}

/**
 * Records a member joining. Called on guildMemberAdd.
 * Overwrites any existing entry (handles rejoiners cleanly).
 */
function recordNewMember(guildId, memberId) {
  const data = loadData();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][memberId] = {
    joinedAt: Date.now(),
    credited: false,
    inviterId: null,
  };
  saveData(data);
}

/**
 * Returns true if this member can still use !panda @user:
 * - Joined within the last 60 minutes
 * - Has not already credited someone
 */
function isEligible(guildId, memberId) {
  const data = loadData();
  const entry = data[guildId]?.[memberId];
  if (!entry) return false;
  if (entry.credited) return false;
  if (Date.now() - entry.joinedAt > INVITE_WINDOW_MS) return false;
  return true;
}

/**
 * Marks the new member as having credited an inviter.
 */
function markCredited(guildId, memberId, inviterId) {
  const data = loadData();
  if (!data[guildId]?.[memberId]) return;
  data[guildId][memberId].credited = true;
  data[guildId][memberId].inviterId = inviterId;
  data[guildId][memberId].creditedAt = Date.now();
  saveData(data);
}

/**
 * If the leaving member credited someone and is leaving within 7 days,
 * returns { inviterId } so the caller can deduct 3 pandas.
 * Returns null otherwise.
 */
function getDeductionInfo(guildId, memberId) {
  const data = loadData();
  const entry = data[guildId]?.[memberId];
  if (!entry || !entry.credited || !entry.inviterId) return null;
  if (Date.now() - entry.joinedAt > STAY_WINDOW_MS) return null;
  return { inviterId: entry.inviterId };
}

/**
 * Removes a member's tracking entry (call after deduction or cleanup).
 */
function removeEntry(guildId, memberId) {
  const data = loadData();
  if (!data[guildId]) return;
  delete data[guildId][memberId];
  saveData(data);
}

module.exports = { recordNewMember, isEligible, markCredited, getDeductionInfo, removeEntry };
