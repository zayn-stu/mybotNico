const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readJsonFile,
  writeJsonFile,
  writeJsonFileAtomic,
} = require('../shared/jsonStore');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('readJsonFile returns independent fallback objects for missing files', () => {
  withTempDir(dir => {
    const filePath = path.join(dir, 'missing.json');
    const first = readJsonFile(filePath, {});
    first.changed = true;

    assert.deepEqual(readJsonFile(filePath, {}), {});
  });
});

test('readJsonFile returns fallback and reports parse errors', () => {
  withTempDir(dir => {
    const filePath = path.join(dir, 'broken.json');
    fs.writeFileSync(filePath, '{broken');
    let reported = false;

    const result = readJsonFile(filePath, [], {
      onError: () => {
        reported = true;
      },
    });

    assert.deepEqual(result, []);
    assert.equal(reported, true);
  });
});

test('writeJsonFile writes the expected JSON shape directly', () => {
  withTempDir(dir => {
    const filePath = path.join(dir, 'direct.json');

    writeJsonFile(filePath, { pending: [{ id: '1' }] });

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      pending: [{ id: '1' }],
    });
  });
});

test('writeJsonFileAtomic writes final file and removes temp file', () => {
  withTempDir(dir => {
    const filePath = path.join(dir, 'atomic.json');

    writeJsonFileAtomic(filePath, { broadcasts: [{ id: 'b1' }] });

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      broadcasts: [{ id: 'b1' }],
    });
    assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  });
});

test('writers can preserve explicit directory creation behavior', () => {
  withTempDir(dir => {
    const filePath = path.join(dir, 'nested', 'state.json');

    writeJsonFileAtomic(filePath, { ok: true }, { ensureDirectory: true });

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { ok: true });
  });
});
