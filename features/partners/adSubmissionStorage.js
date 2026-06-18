const path = require('path');
const { readJsonFile, writeJsonFile } = require('../../shared/jsonStore');

const PENDING_ADS_PATH = path.join(__dirname, '..', '..', 'data', 'pendingAds.json');
const ORPHANED_REVIEW_GRACE_MS = 5 * 60 * 1000;

function readPendingAds() {
  const parsed = readJsonFile(PENDING_ADS_PATH, {});
  const pending = parsed && Array.isArray(parsed.pending) ? parsed.pending : [];
  return pending
    .filter(ad => ad && (!ad.status || ad.status === 'pending'))
    .map(normalizeAd);
}

function writePendingAds(pending) {
  const pendingOnly = pending
    .filter(ad => ad && (!ad.status || ad.status === 'pending'))
    .map(normalizeAd);
  writeJsonFile(PENDING_ADS_PATH, { pending: pendingOnly });
}

function isOrphanedReviewAd(ad, now = Date.now()) {
  if (!ad || ad.status !== 'pending') return false;
  if (ad.reviewMessages.length > 0) return false;

  const createdAt = Date.parse(ad.createdAt);
  if (!Number.isFinite(createdAt)) return false;

  return now - createdAt > ORPHANED_REVIEW_GRACE_MS;
}

function pruneOrphanedReviewAds() {
  const pending = readPendingAds();
  const filtered = pending.filter(ad => !isOrphanedReviewAd(ad));
  if (filtered.length !== pending.length) {
    writePendingAds(filtered);
  }
  return filtered;
}

function normalizeAd(ad) {
  return {
    ...ad,
    status: 'pending',
    reviewMessages: Array.isArray(ad.reviewMessages) ? ad.reviewMessages : []
  };
}

/**
 * Generates a simple UUID v4-like string without external dependencies.
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Creates a pending ad submission.
 * Returns the ad object with its generated UUID.
 */
function createAd(submitterUserID, content, attachments = []) {
  const pending = readPendingAds();

  const ad = {
    uuid: generateUUID(),
    submitterUserID,
    content: content || '',
    attachments: attachments.map(a => ({
      url: a.url || a,
      name: a.name || null
    })),
    createdAt: new Date().toISOString(),
    status: 'pending',
    reviewMessages: []
  };

  pending.push(ad);
  writePendingAds(pending);

  return ad;
}

/**
 * Returns all pending ads (newest first).
 */
function getPendingAds() {
  const pending = pruneOrphanedReviewAds();
  return [...pending].reverse();
}

/**
 * Finds a single pending ad by UUID, or null.
 */
function getPendingAdByUUID(uuid) {
  const pending = readPendingAds();
  return pending.find(ad => ad.uuid === uuid) || null;
}

/**
 * Removes a pending ad by UUID. Returns true if removed.
 */
function removePendingAd(uuid) {
  const pending = readPendingAds();
  const filtered = pending.filter(ad => ad.uuid !== uuid);
  if (filtered.length === pending.length) return false;
  writePendingAds(filtered);
  return true;
}

/**
 * Updates review DM messages for a pending ad.
 */
function setReviewMessages(uuid, reviewMessages) {
  const pending = readPendingAds();
  const ad = pending.find(a => a.uuid === uuid);
  if (!ad) return false;
  ad.reviewMessages = reviewMessages.map(review => ({
    ownerID: review.ownerID,
    channelID: review.channelID,
    messageID: review.messageID
  }));
  writePendingAds(pending);
  return true;
}

/**
 * Finds a pending ad by one of its owner review DM message IDs.
 */
function getPendingAdByReviewMessage(messageID, channelID) {
  const pending = readPendingAds();
  return pending.find(ad => {
    return ad.reviewMessages.some(review => {
      return review.messageID === messageID && (!channelID || review.channelID === channelID);
    });
  }) || null;
}

/**
 * Checks whether a user already has a pending (un-reviewed) ad.
 */
function hasPendingAdByUser(userID) {
  const pending = pruneOrphanedReviewAds();
  return pending.some(ad => ad.submitterUserID === userID && ad.status === 'pending');
}

/**
 * Returns all ads for a given user, optionally filtered by status.
 */
function getAdsByUser(userID, status) {
  const pending = readPendingAds();
  let results = pending.filter(ad => ad.submitterUserID === userID);
  if (status) {
    results = results.filter(ad => ad.status === status);
  }
  return results;
}

module.exports = {
  createAd,
  getPendingAds,
  getPendingAdByUUID,
  getPendingAdByReviewMessage,
  removePendingAd,
  setReviewMessages,
  hasPendingAdByUser,
  getAdsByUser
};
