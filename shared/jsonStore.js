const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;

function resolvePath(filePath) {
  if (!DATA_DIR) return filePath;
  const relative = path.relative(PROJECT_ROOT, filePath);
  if (relative.startsWith('..')) return filePath;
  return path.join(DATA_DIR, relative);
}

function cloneFallback(fallbackValue) {
  if (typeof fallbackValue === 'function') return fallbackValue();
  if (fallbackValue === undefined) return undefined;
  return JSON.parse(JSON.stringify(fallbackValue));
}

function readJsonFile(filePath, fallbackValue, { onError } = {}) {
  try {
    const resolved = resolvePath(filePath);
    // A newly attached persistent volume starts empty. Seed reads from the
    // repository copy until the first write creates the persistent copy.
    const readPath = fs.existsSync(resolved)
      ? resolved
      : resolved !== filePath && fs.existsSync(filePath)
        ? filePath
        : resolved;
    if (!fs.existsSync(readPath)) return cloneFallback(fallbackValue);
    return JSON.parse(fs.readFileSync(readPath, 'utf8'));
  } catch (err) {
    if (onError) onError(err);
    return cloneFallback(fallbackValue);
  }
}

function ensureDirectoryForFile(filePath) {
  fs.mkdirSync(path.dirname(resolvePath(filePath)), { recursive: true });
}

function writeJsonFile(filePath, value, { spaces = 2, ensureDirectory = false } = {}) {
  if (ensureDirectory) ensureDirectoryForFile(filePath);
  fs.writeFileSync(resolvePath(filePath), JSON.stringify(value, null, spaces));
}

function writeJsonFileAtomic(filePath, value, { spaces = 2, ensureDirectory = false } = {}) {
  if (ensureDirectory) ensureDirectoryForFile(filePath);
  const resolved = resolvePath(filePath);
  const tempFile = `${resolved}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, spaces));
  fs.renameSync(tempFile, resolved);
}

// ─── Debounced async writer ─────────────────────────────────────────────────

const pendingWrites = new Map();
let flushing = false;
let flushQueued = false;
let flushDone = null;

async function flush() {
  if (flushing) return;
  flushing = true;

  while (pendingWrites.size > 0) {
    const batch = Array.from(pendingWrites.entries());
    pendingWrites.clear();

    for (const [filePath, { value, spaces, ensureDir }] of batch) {
      try {
        if (ensureDir) fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(value, null, spaces));
        await fs.promises.rename(tmp, filePath);
      } catch (err) {
        console.error(`[jsonStore] Debounced write failed: ${filePath}`, err.message);
      }
    }
  }

  flushing = false;
  if (flushDone) {
    flushDone();
    flushDone = null;
  }
}

function writeJsonFileDebounced(filePath, value, { spaces = 2, ensureDirectory = false } = {}) {
  const resolved = resolvePath(filePath);
  // FORCE_SYNC_WRITES reverts to old immediate sync writes for A/B comparison
  if (process.env.FORCE_SYNC_WRITES) {
    if (ensureDirectory) fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const tmp = `${resolved}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, spaces));
    fs.renameSync(tmp, resolved);
    return;
  }
  pendingWrites.set(resolved, { value, spaces, ensureDir: ensureDirectory });
  if (!flushQueued) {
    flushQueued = true;
    setImmediate(() => {
      flushQueued = false;
      flush();
    });
  }
}

function flushAllWrites() {
  if (pendingWrites.size === 0 && !flushing) return Promise.resolve();
  return new Promise(resolve => {
    flushDone = resolve;
  });
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  writeJsonFileAtomic,
  writeJsonFileDebounced,
  flushAllWrites,
};
