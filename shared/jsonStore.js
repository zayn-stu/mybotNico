const fs = require('fs');
const path = require('path');

function cloneFallback(fallbackValue) {
  if (typeof fallbackValue === 'function') return fallbackValue();
  if (fallbackValue === undefined) return undefined;
  return JSON.parse(JSON.stringify(fallbackValue));
}

function readJsonFile(filePath, fallbackValue, { onError } = {}) {
  try {
    if (!fs.existsSync(filePath)) return cloneFallback(fallbackValue);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (onError) onError(err);
    return cloneFallback(fallbackValue);
  }
}

function ensureDirectoryForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath, value, { spaces = 2, ensureDirectory = false } = {}) {
  if (ensureDirectory) ensureDirectoryForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, spaces));
}

function writeJsonFileAtomic(filePath, value, { spaces = 2, ensureDirectory = false } = {}) {
  if (ensureDirectory) ensureDirectoryForFile(filePath);
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, spaces));
  fs.renameSync(tempFile, filePath);
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  writeJsonFileAtomic,
};
