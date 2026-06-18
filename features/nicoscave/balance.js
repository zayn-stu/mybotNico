const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('../../shared/jsonStore');

const BALANCE_DIR = path.join(__dirname, 'balance');
const REPO_ROOT = path.join(__dirname, '..', '..');

let balanceCache = null;

function resolveAssetPath(assetPath) {
  if (!assetPath) return null;
  return path.join(REPO_ROOT, assetPath);
}

function loadBalance({ forceReload = false } = {}) {
  if (balanceCache && !forceReload) return balanceCache;

  const items = readJsonFile(path.join(BALANCE_DIR, 'items.json'), {});
  const depths = readJsonFile(path.join(BALANCE_DIR, 'depths.json'), []);
  const progression = readJsonFile(path.join(BALANCE_DIR, 'progression.json'), {});
  const flavor = readJsonFile(path.join(BALANCE_DIR, 'flavor.json'), {});

  balanceCache = {
    items,
    depths,
    progression,
    flavor,
    storeItems: Object.values(items)
      .filter(item => item.type === 'gear' && item.store)
      .sort((a, b) => (a.buyPrice || 0) - (b.buyPrice || 0)),
    starterItems: Object.values(items)
      .filter(item => item.type === 'gear' && item.starter)
      .sort((a, b) => a.slot.localeCompare(b.slot)),
  };

  return balanceCache;
}

function getItem(balance, itemId) {
  return balance.items[itemId] || null;
}

function getDepth(balance, depthId) {
  return balance.depths.find(depth => depth.id === depthId) || balance.depths[0] || null;
}

function getNextDepth(balance, depthId) {
  return balance.depths.find(depth => depth.id === depthId + 1) || null;
}

function getAssetFile(item) {
  const assetFile = resolveAssetPath(item?.assetPath);
  if (!assetFile || !fs.existsSync(assetFile)) return null;
  return {
    attachment: assetFile,
    name: path.basename(assetFile),
  };
}

function getAttachmentThumbnail(item) {
  const file = getAssetFile(item);
  if (!file) return { files: [], thumbnailUrl: null };
  return {
    files: [file],
    thumbnailUrl: `attachment://${file.name}`,
  };
}

module.exports = {
  loadBalance,
  getItem,
  getDepth,
  getNextDepth,
  getAssetFile,
  getAttachmentThumbnail,
};
